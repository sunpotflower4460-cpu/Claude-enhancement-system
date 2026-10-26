// Real framework adapter for isolated durability fixtures; agent/model evidence remains TEST FIXTURE.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { writeReport } from "../../../scripts/lib/reports.mjs";

const project = process.argv[2],
  scenario = process.argv[3],
  env = JSON.parse(process.env.AUTODEV_CHECK_CONTEXT),
  evidence = path.dirname(process.env.AUTODEV_REPORT_PATH),
  assertions = [],
  artifacts = [],
  actions = [],
  inputs = [],
  progress = [];
const check = (name, actual, expected) =>
  assertions.push({
    name,
    status:
      JSON.stringify(actual) === JSON.stringify(expected) ? "PASS" : "FAIL",
    expected: JSON.stringify(expected),
    actual: JSON.stringify(actual) ?? "undefined",
  });
const artifact = (suffix, bytes, media_type) => {
  const name = `${env.check_id}-${env.nonce}-${suffix}`;
  fs.writeFileSync(path.join(evidence, name), bytes);
  artifacts.push({
    path: name,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    media_type,
  });
  return name;
};
let details,
  browser,
  server,
  browserVersion,
  outcome = "Not reached";
try {
  if (env.kind === "build") {
    const files = fs.readdirSync(project);
    for (const file of files.filter((file) => file.endsWith(".mjs")))
      execFileSync(process.execPath, ["--check", path.join(project, file)], {
        stdio: "pipe",
      });
    const outputs = files.map((file) =>
      artifact(
        file,
        fs.readFileSync(path.join(project, file)),
        file.endsWith(".html") ? "text/html" : "text/plain",
      ),
    );
    check(
      "Static distribution generated after module syntax checks",
      outputs.length >= 2,
      true,
    );
    details = { exit_code: 0, outputs };
  } else if (scenario === "existing") {
    const { total } = await import(
      pathToFileURL(path.join(project, "pricing.mjs"))
    );
    if (env.kind === "test") {
      check(
        "Legacy small order keeps tax and currency",
        total([{ price: 100, quantity: 2 }]),
        { amount: 220, currency: "JPY" },
      );
      check(
        "New volume discount applies before tax",
        total([{ price: 600, quantity: 2 }]),
        { amount: 1056, currency: "JPY" },
      );
      check(
        "Discount threshold inclusive",
        total([{ price: 1000, quantity: 1 }]).amount,
        880,
      );
      check("Empty legacy order", total([]).amount, 0);
      let rejected = false;
      try {
        total([{ price: 100, quantity: 0 }]);
      } catch {
        rejected = true;
      }
      check("Invalid quantity is rejected", rejected, true);
    } else {
      const { createServer } = await import(
        pathToFileURL(path.join(project, "api.mjs"))
      );
      server = createServer();
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const requests = [];
      for (const [method, route, payload, expected_status, expected] of [
        ["GET", "/health", null, 200, { ok: true }],
        [
          "POST",
          "/quote",
          { items: [{ price: 600, quantity: 2 }] },
          200,
          { amount: 1056, currency: "JPY" },
        ],
        [
          "POST",
          "/quote",
          { items: [{ price: 100, quantity: 0 }] },
          400,
          { error: "Invalid item" },
        ],
        ["GET", "/missing", null, 404, { error: "Not found" }],
      ]) {
        const url = `http://127.0.0.1:${server.address().port}${route}`,
          response = await fetch(url, {
            method,
            ...(payload
              ? {
                  body: JSON.stringify(payload),
                  headers: { "content-type": "application/json" },
                }
              : {}),
          }),
          bytes = Buffer.from(await response.text()),
          response_artifact = artifact(
            requests.length + ".json",
            bytes,
            "application/json",
          );
        check(`${method} ${route} status`, response.status, expected_status);
        check(`${method} ${route} response`, JSON.parse(bytes), expected);
        requests.push({
          method,
          url,
          status: response.status,
          expected_status,
          response_artifact,
          response_sha256: artifacts.at(-1).sha256,
        });
      }
      details = { requests };
    }
  } else {
    server = http.createServer((req, res) => {
      const name = new URL(req.url, "http://localhost").pathname;
      const file = path.join(
        project,
        name === "/" ? "index.html" : path.basename(name),
      );
      if (!fs.existsSync(file)) {
        res.statusCode = 404;
        return res.end("Missing");
      }
      res.setHeader(
        "content-type",
        file.endsWith(".mjs")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(fs.readFileSync(file));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true, ...(process.env.AUTODEV_CHROMIUM_EXECUTABLE ? { executablePath: process.env.AUTODEV_CHROMIUM_EXECUTABLE } : {}) });
    browserVersion = browser.version();
    const page = await browser.newPage({
        viewport: { width: 800, height: 700 },
      }),
      errors = [];
    page.setDefaultTimeout(4000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    check("Heading visible", await page.locator("h1").isVisible(), true);
    if (scenario === "web") {
      await page.getByRole("link", { name: "New note" }).click();
      await page.getByLabel("Title").fill("Inspect the northern trail");
      await page.getByRole("button", { name: "Save note" }).click();
      await page.waitForURL("**/#notes");
      check(
        "New note navigates back to list",
        (await page.locator("li").innerText()).trim(),
        "Inspect the northern trail",
      );
      await page.getByRole("checkbox").check();
      check(
        "Completion summary updates",
        await page.locator("#summary").innerText(),
        "1/1 complete",
      );
      await page.reload();
      const persisted = await page.locator("#summary").innerText();
      check("Note and completion survive reload", persisted, "1/1 complete");
      actions.push({
        input: "Create note, complete it, reload",
        before: "0/0 complete",
        after: persisted,
        expected: "1/1 complete",
      });
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await page.getByLabel("Owner").fill("Mika");
      await page.getByRole("button", { name: "Save settings" }).click();
      await page.getByRole("link", { name: "Notes", exact: true }).click();
      await page.reload();
      check(
        "Settings persist independently",
        await page.locator("h2").innerText(),
        "Mika's notes",
      );
      await page.setViewportSize({ width: 375, height: 700 });
      check(
        "Mobile layout does not overflow",
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      check(
        "All navigation remains visible",
        await page.getByRole("link", { name: "New note" }).isVisible(),
        true,
      );
    } else {
      const press = async (key) => {
        await page.keyboard.press(key);
        inputs.push(key);
        progress.push(
          (await page.locator("#status").innerText()) +
            ":" +
            (await page.locator("#score").innerText()),
        );
      };
      const restart = async () => {
        await page.getByRole("button", { name: "Restart" }).click();
        inputs.push("Restart");
      };
      await press("ArrowDown");
      check(
        "Hazard produces loss",
        await page.locator("#status").innerText(),
        "Lost",
      );
      await restart();
      check(
        "Restart clears loss",
        await page.locator("#status").innerText(),
        "Playing",
      );
      await press("ArrowRight");
      await press("ArrowRight");
      await press("ArrowRight");
      outcome = await page.locator("#status").innerText();
      check("Collecting three parcels wins", outcome, "Won");
      check(
        "Progress is not blocked",
        await page.locator("#score").innerText(),
        "3",
      );
      await restart();
      check(
        "Restart clears score",
        await page.locator("#score").innerText(),
        "0",
      );
      const started = performance.now();
      for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
      const elapsed = Math.ceil(performance.now() - started);
      assertions.push({
        name: "Forty bounded inputs complete within ten seconds",
        status: elapsed < 10000 ? "PASS" : "FAIL",
        expected: "<10000ms",
        actual: `${elapsed}ms`,
      });
      check(
        "Boundary inputs preserve playable state",
        await page.locator("#status").innerText(),
        "Playing",
      );
      await press("ArrowRight");
      await press("ArrowRight");
      await press("ArrowRight");
      outcome = await page.locator("#status").innerText();
      check("A second game can finish", outcome, "Won");
      const bounds = await page.locator("canvas").boundingBox();
      check(
        "Playfield has useful visible size",
        Boolean(bounds && bounds.width >= 300 && bounds.height >= 100),
        true,
      );
      actions.push({
        input: "Lose, restart, win, restart, boundary inputs, win",
        before: "Playing",
        after: outcome,
        expected: "Won",
      });
    }
    check("No browser runtime errors", errors, []);
    const name = artifact("screen.png", await page.screenshot(), "image/png");
    if (env.kind === "visual")
      details = {
        browser: "Chromium " + browserVersion,
        viewport: { width: scenario === "web" ? 375 : 800, height: 700 },
        captures: [name],
        inspections: [
          "Heading and navigation visible",
          "Useful layout bounds",
          "Real interactions and persistence",
          "No browser runtime errors",
        ],
      };
    else if (env.kind === "play")
      details = {
        engine: "Chromium " + browserVersion,
        inputs,
        progress,
        outcome,
        expected_outcome: "Won",
        captures: [name],
      };
    else if (env.kind === "behavior") details = { actions };
  }
} catch (error) {
  check("Runner completed requested scenario", error.message, "No error");
} finally {
  if (browser) await browser.close();
  if (server) {
    server.closeAllConnections();
    server.close();
  }
}
if (env.kind === "test")
  details = {
    total: assertions.length,
    passed: assertions.filter((a) => a.status === "PASS").length,
    failed: assertions.filter((a) => a.status === "FAIL").length,
    skipped: 0,
  };
// A browser/tool failure has no valid capture: its nonzero exit is FAIL, never fabricated visual evidence.
if (details)
  writeReport({
    tool: {
      name: browserVersion
        ? "Playwright Chromium durability"
        : "Node durability assertions",
      version: browserVersion || process.version,
    },
    assertions,
    artifacts,
    details,
  });
if (assertions.some((a) => a.status !== "PASS") || !details)
  process.exitCode = 1;

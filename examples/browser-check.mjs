// Runnable adapter example for the isolated game fixture. Adapt selectors/assertions for a real project.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { writeReport } from "../scripts/lib/reports.mjs";
const pagePath = process.argv[2],
  env = JSON.parse(process.env.AUTODEV_CHECK_CONTEXT),
  dir = path.dirname(process.env.AUTODEV_REPORT_PATH),
  assertions = [],
  artifacts = [],
  errors = [];
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(fs.readFileSync(pagePath));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  const check = (name, actual, expected) =>
    assertions.push({
      name,
      status: actual === expected ? "PASS" : "FAIL",
      expected: String(expected),
      actual: String(actual),
    });
  const bounds = await page.locator("#board").boundingBox();
  check(
    "Board renders at useful size",
    Boolean(bounds && bounds.width > 100 && bounds.height > 100),
    true,
  );
  check("Heading is visible", await page.locator("h1").isVisible(), true);
  const progress = [],
    inputs = [];
  if (["play", "behavior"].includes(env.kind)) {
    await page.locator("#start").click();
    inputs.push("Start");
    progress.push(await page.locator("#status").innerText());
    for (let i = 0; i < 3; i++) {
      await page.locator("#collect").click();
      inputs.push("Collect star");
      progress.push(await page.locator("#score").innerText());
    }
    check(
      "Three inputs advance score",
      await page.locator("#score").innerText(),
      "3",
    );
    check("Win condition", await page.locator("#status").innerText(), "Won");
  }
  check("No runtime page errors", errors.length, 0);
  const name = env.check_id + "-" + env.nonce + ".png",
    bytes = await page.screenshot({ path: path.join(dir, name) });
  artifacts.push({
    path: name,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    media_type: "image/png",
  });
  let details;
  if (env.kind === "visual")
    details = {
      browser: "Chromium " + browser.version(),
      viewport: { width: 800, height: 600 },
      captures: [name],
      inspections: [
        "Board bounds >100px",
        "Heading visible",
        "No page exceptions",
      ],
    };
  else if (env.kind === "play")
    details = {
      engine: "Chromium " + browser.version(),
      inputs,
      progress,
      outcome: await page.locator("#status").innerText(),
      expected_outcome: "Won",
      captures: [name],
    };
  else
    details = {
      actions: [
        {
          input: inputs.join(", "),
          before: "Ready",
          after: await page.locator("#status").innerText(),
          expected: "Won",
        },
      ],
    };
  writeReport({
    tool: { name: "Playwright Chromium", version: browser.version() },
    assertions,
    artifacts,
    details,
  });
  if (assertions.some((a) => a.status !== "PASS")) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  server.close();
}

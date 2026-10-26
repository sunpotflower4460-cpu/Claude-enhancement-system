// Isolated live-probe project adapter. Executes actual assertions and real HTTP requests.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { writeReport } from "../scripts/lib/reports.mjs";
import { hash } from "../scripts/lib/core.mjs";
const env = JSON.parse(process.env.AUTODEV_CHECK_CONTEXT),
  app = await import(pathToFileURL(path.resolve("autodev-probe/app.mjs"))),
  assertions = [],
  artifacts = [];
function check(name, fn) {
  try {
    fn();
    assertions.push({
      name,
      status: "PASS",
      expected: "assertions satisfied",
      actual: "assertions satisfied",
    });
  } catch (e) {
    assertions.push({
      name,
      status: "FAIL",
      expected: "assertions satisfied",
      actual: e.message,
    });
  }
}
if (env.task_id === "R1")
  check("addition preserves arithmetic", () => {
    assert.equal(app.add(5, 3), 8);
    assert.equal(app.add(-1, 2), 1);
  });
if (env.task_id === "R2")
  check("division and zero error", () => {
    assert.equal(app.divide(8, 2), 4);
    assert.throws(() => app.divide(1, 0));
  });
if (env.task_id === "R3")
  check("greeting trims names with default", () => {
    assert.equal(app.greet(" Ada "), "Hello, Ada");
    assert.equal(app.greet(" "), "Hello, friend");
  });
if (env.task_id === "R4")
  check("clamp bounds and interior", () => {
    assert.equal(app.clamp(12, 0, 10), 10);
    assert.equal(app.clamp(-1, 0, 10), 0);
    assert.equal(app.clamp(5, 0, 10), 5);
  });
let details = {
  total: assertions.length,
  passed: assertions.filter((a) => a.status === "PASS").length,
  failed: assertions.filter((a) => a.status === "FAIL").length,
  skipped: 0,
};
if (env.kind === "api") {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ sum: app.add(5, 3), greeting: app.greet(" Ada ") }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = "http://127.0.0.1:" + server.address().port,
      r = await fetch(url),
      body = await r.text(),
      name = env.check_id + "-" + env.nonce + ".response.json";
    fs.writeFileSync(
      path.join(path.dirname(process.env.AUTODEV_REPORT_PATH), name),
      body,
    );
    artifacts.push({
      path: name,
      sha256: hash(body),
      media_type: "application/json",
    });
    check("HTTP JSON response", () => {
      assert.equal(r.status, 200);
      assert.equal(typeof JSON.parse(body).sum, "number");
    });
    details = {
      requests: [
        {
          method: "GET",
          url,
          status: r.status,
          expected_status: 200,
          response_sha256: hash(body),
          response_artifact: name,
        },
      ],
    };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
writeReport({
  tool: { name: "node:assert + HTTP fetch", version: process.version },
  assertions,
  artifacts,
  details,
});
if (assertions.some((a) => a.status === "FAIL")) process.exitCode = 1;

// TEST FIXTURE: visual/play images here are synthetic. Never used as live browser evidence.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const { writeReport } = await import(process.argv[2]);
const env = JSON.parse(process.env.AUTODEV_CHECK_CONTEXT),
  product = JSON.parse(fs.readFileSync("product.json"));
const good = product[env.task_id] === true,
  artifacts = [],
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
let details;
if (env.kind === "test") {
  try {
    assert.equal(good, true);
  } catch {}
  details = {
    total: 1,
    passed: good ? 1 : 0,
    failed: good ? 0 : 1,
    skipped: 0,
  };
}
if (env.kind === "api") {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: product[env.task_id] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = "http://127.0.0.1:" + server.address().port,
      r = await fetch(url),
      body = await r.text();
    const name = env.check_id + ".response.json";
    fs.writeFileSync(path.join(".autodev/evidence", name), body);
    artifacts.push({
      path: name,
      sha256: sha(body),
      media_type: "application/json",
    });
    details = {
      requests: [
        {
          method: "GET",
          url,
          status: r.status,
          expected_status: 200,
          response_sha256: sha(body),
          response_artifact: name,
        },
      ],
    };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
if (env.kind === "build") {
  const name = env.check_id + ".build.txt",
    bytes = Buffer.from("TEST FIXTURE build output");
  fs.writeFileSync(path.join(".autodev/evidence", name), bytes);
  artifacts.push({ path: name, sha256: sha(bytes), media_type: "text/plain" });
  details = { exit_code: 0, outputs: [name] };
}
if (env.kind === "behavior")
  details = {
    actions: [
      {
        input: "fixture action",
        before: "pending",
        after: good ? "done" : "broken",
        expected: "done",
      },
    ],
  };
if (["visual", "play"].includes(env.kind)) {
  const name = env.check_id + ".png",
    bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvJkAAAAASUVORK5CYII=",
      "base64",
    );
  fs.writeFileSync(path.join(".autodev/evidence", name), bytes);
  artifacts.push({ path: name, sha256: sha(bytes), media_type: "image/png" });
  details =
    env.kind === "visual"
      ? {
          browser: "TEST FIXTURE",
          viewport: { width: 1, height: 1 },
          captures: [name],
          inspections: ["fixture assertion"],
        }
      : {
          engine: "TEST FIXTURE",
          inputs: ["start", "collect"],
          progress: ["pending", "done"],
          outcome: good ? "win" : "broken",
          expected_outcome: "win",
          captures: [name],
        };
}
writeReport({
  tool: { name: "TEST FIXTURE node assertions", version: process.version },
  assertions: [
    {
      name: "Feature " + env.task_id,
      status: good ? "PASS" : "FAIL",
      expected: "true",
      actual: String(product[env.task_id]),
    },
  ],
  artifacts,
  details,
});
if (!good) process.exitCode = 1;

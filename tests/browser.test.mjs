import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, read, json, contracts, shared } from "./helpers/fixture.mjs";
import { record } from "../scripts/record.mjs";
import { checkEvidence } from "../scripts/verify.mjs";
import { fingerprint } from "../scripts/lib/core.mjs";
function setup(t) {
  const f = fixture(t, { profile: "game" });
  fs.copyFileSync(
    new URL("./fixtures/game.html", import.meta.url),
    path.join(f.target, "app.html"),
  );
  const c = read(path.join(f.dir, "contract.json"));
  for (const check of c.checks.filter((x) =>
    ["visual", "play", "behavior"].includes(x.kind),
  )) {
    check.command = `node '${shared}/examples/browser-check.mjs' '${f.target}/app.html'`;
    check.timeout_ms = 20000;
  }
  json(path.join(f.dir, "contract.json"), c);
  return f;
}
test("C1 real Chromium renders, captures, clicks and reaches the game win condition", (t) => {
  const f = setup(t);
  for (const kind of ["visual", "play", "behavior"]) {
    const c = contracts(f.target),
      check = c.contract.checks.find((x) => x.kind === kind),
      e = record({ target: f.target, check: check.id });
    assert.equal(
      e.exit_code,
      0,
      fs.readFileSync(path.join(f.dir, "evidence", e.log), "utf8") +
        " report=" +
        JSON.stringify(
          e.report ? read(path.join(f.dir, "evidence", e.report.path)) : e,
        ),
    );
    assert.equal(checkEvidence(c, check, fingerprint(f.target)).status, "PASS");
    const report = read(path.join(f.dir, "evidence", e.report.path));
    assert.match(report.tool.name, /Playwright/);
    assert.ok(
      report.artifacts.every(
        (a) => fs.statSync(path.join(f.dir, "evidence", a.path)).size > 1000,
      ),
    );
  }
});
test("C1 actual broken browser controls fail even when source and build could succeed", (t) => {
  const f = setup(t),
    p = path.join(f.target, "app.html");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace("score++;", "score+=0;"),
  );
  const c = contracts(f.target),
    check = c.contract.checks.find((x) => x.kind === "play"),
    e = record({ target: f.target, check: check.id });
  assert.notEqual(e.exit_code, 0);
  assert.equal(checkEvidence(c, check, fingerprint(f.target)).status, "FAIL");
});

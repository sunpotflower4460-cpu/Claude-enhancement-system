import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fixture,
  read,
  json,
  contracts,
  fingerprint,
  attest,
  completed,
  seal,
} from "./helpers/fixture.mjs";
import { record } from "../scripts/record.mjs";
import { checkEvidence, verify } from "../scripts/verify.mjs";

const fixtures = fileURLToPath(
  new URL("./fixtures/durability", import.meta.url),
);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
function setup(t, scenario, profile) {
  const f = fixture(t, { profile }),
    project = path.join(f.target, "project");
  fs.cpSync(path.join(fixtures, scenario), project, { recursive: true });
  const contract = read(path.join(f.dir, "contract.json"));
  for (const check of contract.checks) {
    check.command = `node ${quote(path.join(fixtures, "check.mjs"))} ${quote(project)} ${quote(scenario)}`;
    check.timeout_ms = 30000;
  }
  json(path.join(f.dir, "contract.json"), contract);
  return { ...f, project };
}
function execute(f, kind, expected) {
  const c = contracts(f.target),
    check = c.contract.checks.find((check) => check.kind === kind),
    execution = record({ target: f.target, check: check.id });
  assert.equal(
    checkEvidence(c, check, fingerprint(f.target)).status,
    expected,
    fs.readFileSync(path.join(f.dir, "evidence", execution.log), "utf8") +
      JSON.stringify(execution) +
      JSON.stringify(
        execution.report
          ? read(path.join(f.dir, "evidence", execution.report.path))
          : null,
      ),
  );
  return execution;
}
function accept(f) {
  for (const check of contracts(f.target).contract.checks)
    execute(f, check.kind, "PASS");
  attest(f, { scope: "task" });
  completed(f);
  seal(f);
  const result = verify({ target: f.target, fixture: true });
  assert.equal(result.status, "TEST_COMPLETE", JSON.stringify(result));
  assert.equal(
    verify({ target: f.target }).status,
    "UNVERIFIED",
    "Mock agents must never become actual Claude acceptance",
  );
}

test("D1 realistic web app rejects lost persistence, then accepts multi-screen inputs, reload and mobile layout", (t) => {
  const f = setup(t, "web", "web-app"),
    store = path.join(f.project, "store.mjs"),
    original = fs.readFileSync(store, "utf8");
  fs.writeFileSync(
    store,
    original.replace(
      "localStorage.setItem(key, JSON.stringify(state));",
      "void state; // injected lost persistence",
    ),
  );
  execute(f, "build", "PASS");
  execute(f, "behavior", "FAIL");
  assert.notEqual(
    verify({ target: f.target, fixture: true }).status,
    "TEST_COMPLETE",
  );
  fs.writeFileSync(store, original);
  // Repair changes product fingerprint: previous build evidence must also be rerun.
  const c = contracts(f.target),
    build = c.contract.checks.find((check) => check.kind === "build");
  assert.equal(
    checkEvidence(c, build, fingerprint(f.target)).status,
    "UNVERIFIED",
  );
  accept(f);
});

test("D2 realistic game rejects blocked progress, then accepts loss, restart, win, UI and bounded input performance", (t) => {
  const f = setup(t, "game", "game"),
    game = path.join(f.project, "game.mjs"),
    original = fs.readFileSync(game, "utf8");
  fs.writeFileSync(
    game,
    original.replace("score++;", "score += 0; // injected blocked progression"),
  );
  execute(f, "build", "PASS");
  execute(f, "play", "FAIL");
  assert.notEqual(
    verify({ target: f.target, fixture: true }).status,
    "TEST_COMPLETE",
  );
  fs.writeFileSync(game, original);
  accept(f);
});

test("D3 existing multi-file API change rejects legacy regression and missing integration, preserving configuration", (t) => {
  const f = setup(t, "existing", "backend"),
    pricing = path.join(f.project, "pricing.mjs"),
    api = path.join(f.project, "api.mjs"),
    original = fs.readFileSync(pricing, "utf8"),
    apiOriginal = fs.readFileSync(api, "utf8"),
    settings = fs.readFileSync(path.join(f.project, "settings.json"), "utf8"),
    existingSettings = fs.readFileSync(
      path.join(f.target, ".claude/settings.json"),
      "utf8",
    );
  fs.writeFileSync(pricing, original.replace("settings.taxRate", "0"));
  execute(f, "test", "FAIL");
  fs.writeFileSync(pricing, original);
  fs.writeFileSync(
    api,
    apiOriginal.replace(
      "total(JSON.parse(body).items)",
      "{amount:1320,currency:'JPY'}",
    ),
  );
  execute(f, "test", "PASS");
  execute(f, "api", "FAIL");
  fs.writeFileSync(api, apiOriginal);
  accept(f);
  assert.equal(
    fs.readFileSync(path.join(f.project, "settings.json"), "utf8"),
    settings,
  );
  assert.equal(
    fs.readFileSync(path.join(f.target, ".claude/settings.json"), "utf8"),
    existingSettings,
  );
});

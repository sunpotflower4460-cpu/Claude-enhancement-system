import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  fixture,
  read,
  json,
  runtime,
  artifactPath,
  contracts,
  shared,
  allPass,
} from "./helpers/fixture.mjs";
import { importRuntime } from "../scripts/import-runtime.mjs";
import { prepareProbe } from "../scripts/live-probe.mjs";
import { saveAssessment } from "../scripts/assessment.mjs";
function cli(script, args) {
  try {
    return {
      code: 0,
      out: execFileSync(
        process.execPath,
        [path.join(shared, "scripts", script + ".mjs"), ...args],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    };
  } catch (e) {
    return { code: e.status, out: e.stdout };
  }
}
test("A3 real importer parses SDK envelopes but preserves explicit fixture assurance", (t) => {
  const f = fixture(t),
    ref = runtime(f),
    r = read(artifactPath(f.dir, ref)),
    result = importRuntime({
      target: f.target,
      raw: artifactPath(f.dir, r.record),
      tool_use: r.tool_use_id,
      stage: "review",
      task: "mission",
      expected: r.expected_model,
      mode: "TEST_FIXTURE",
    });
  assert.equal(result.status, "TEST_FIXTURE_OBSERVED");
  assert.equal(result.observation.observed_model, "claude-sonnet-5-5");
  assert.ok(read(path.join(f.dir, "routing.json")).includes(result.name));
});
test("A2 assessment persistence refuses stamping old review with current code", (t) => {
  const f = fixture(t);
  allPass(f);
  const a = read(artifactPath(f.dir, "review.json")),
    p = path.join(f.base, "assessment.json");
  json(p, a);
  fs.appendFileSync(path.join(f.target, "check.mjs"), "\n// after review");
  assert.throws(
    () =>
      saveAssessment({
        target: f.target,
        input: p,
        kind: "review",
        scope: "final",
        runtime: a.runtime_ref,
        fixture: true,
      }),
    /changed since review/,
  );
});
test("CLI bootstrap/record/context/verify/doctor preserve exit-code and JSON behavior", (t) => {
  const f = fixture(t);
  assert.equal(
    cli("bootstrap", ["--target", f.target, "--mission", f.source]).code,
    0,
  );
  assert.equal(
    cli("record", ["--target", f.target, "--check", "R1-api"]).code,
    0,
  );
  assert.equal(cli("context", ["--target", f.target]).code, 0);
  assert.equal(cli("verify", ["--target", f.target]).code, 1);
  const doctor = cli("doctor", ["--target", f.target]);
  assert.equal(doctor.code, 2);
  assert.equal(
    JSON.parse(doctor.out).checks.actual_model_routing,
    "UNVERIFIED",
  );
  allPass(f);
  assert.equal(
    cli("verify", ["--target", f.target, "--fixture", "true"]).code,
    1,
  );
  assert.equal(
    JSON.parse(cli("verify", ["--target", f.target, "--fixture", "true"]).out)
      .status,
    "TEST_COMPLETE",
  );
});
test("F one-command live probe prepares isolated clone, all checks UNVERIFIED, source unchanged", (t) => {
  const f = fixture(t);
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-qm",
    "test-source",
  );
  const before = f.git("status", "--porcelain"),
    branch = f.git("branch", "--show-current"),
    output = path.join(f.base, "isolated-live");
  const result = prepareProbe({ source: f.target, output });
  assert.equal(result.status, "PREPARED_UNVERIFIED");
  assert.equal(f.git("status", "--porcelain"), before);
  assert.equal(f.git("branch", "--show-current"), branch);
  assert.equal(contracts(output).backlog.items.length, 4);
  assert.match(result.prompt, /^\/goal /);
  const manifest = read(path.join(output, ".autodev/probe-results.json"));
  assert.ok(manifest.checks.every((c) => c.status === "UNVERIFIED"));
  assert.throws(
    () => prepareProbe({ source: f.target, output }),
    /must not exist/,
  );
});
test("F agent-only preflight can run before mission/session without touching existing settings", async (t) => {
  const f = fixture(t);
  fs.rmSync(f.dir, { recursive: true });
  const before = fs.readFileSync(
      path.join(f.target, ".claude/settings.json"),
      "utf8",
    ),
    { installAgents } = await import("../scripts/install-agents.mjs");
  assert.equal(
    installAgents(f).agents["sonnet-reviewer"],
    "autodev-sonnet-reviewer",
  );
  assert.equal(fs.existsSync(f.dir), false);
  assert.equal(
    fs.readFileSync(path.join(f.target, ".claude/settings.json"), "utf8"),
    before,
  );
});
test("G report assertion FAIL overrides a shell that masks failure with exit 0", (t) => {
  const f = fixture(t);
  json(path.join(f.target, "product.json"), { R1: false });
  const p = path.join(f.dir, "contract.json"),
    c = read(p);
  c.checks[0].command += "; true";
  json(p, c);
  const result = cli("record", ["--target", f.target, "--check", "R1-test"]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.out).exit_code, 0);
  assert.equal(JSON.parse(result.out).check_status, "FAIL");
});
test("G known-dead pre-mission installer lock can be recovered without replacing user files", async (t) => {
  const f = fixture(t);
  fs.rmSync(f.dir, { recursive: true });
  const { identity, owner } = await import("../scripts/lib/core.mjs"),
    { installAgents } = await import("../scripts/install-agents.mjs"),
    id = identity(f.target);
  json(path.join(id.gitDir, "autodev-agent-install.lock"), {
    pid: 999999999,
    host: owner().host,
    start: "dead",
  });
  assert.equal(installAgents(f).status, "INSTALLED_NOT_RUNTIME_VERIFIED");
});
test("G terminal importer requires actual correlated SDK Workflow launch and drained result", async (t) => {
  const f = fixture(t),
    proof = read(path.join(f.dir, "termination.json")),
    { importTermination } = await import("../scripts/import-termination.mjs");
  const r = importTermination({
    target: f.target,
    raw: artifactPath(f.dir, proof.record),
    tool_use: "workflow-tool",
    mode: "TEST_FIXTURE",
  });
  assert.equal(r.status, "TERMINATION_OBSERVED");
  assert.equal(read(r.file).source, "TEST_FIXTURE");
});
test("F repeated failed mock CLI probe launches preserve separate raw files without claiming live success", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.dir, "probe-prompt.txt"),
    "/goal TEST FIXTURE mock process transport only",
  );
  for (let i = 0; i < 2; i++) {
    const result = cli("live-probe", [
      "--mode",
      "run",
      "--target",
      f.target,
      "--claude",
      "/bin/false",
    ]);
    assert.equal(result.code, 1);
    assert.equal(
      JSON.parse(result.out).status,
      "UNVERIFIED_UNTIL_PROBE_RESULTS_CHECKED",
    );
  }
  assert.equal(
    fs
      .readdirSync(path.join(f.dir, "evidence"))
      .filter((n) => n.startsWith("live-sdk-")).length,
    2,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
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
import { prepareProbe, recoverPrepare } from "../scripts/live-probe.mjs";
import { observationId as coreObservationId } from "../scripts/lib/core.mjs";
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
  assert.equal(
    result.request.max_sprints,
    1,
    "live probe must exercise parent continuation across multiple bursts",
  );
  const pending = read(path.join(output, ".autodev/probe-results.json"));
  assert.ok(pending.checks.some((c) => c.id === "multi_burst_state"));
  assert.ok(pending.checks.some((c) => c.id === "checkpoint_reclone"));
  assert.equal(f.git("status", "--porcelain"), before);
  assert.equal(f.git("branch", "--show-current"), branch);
  assert.equal(contracts(output).backlog.items.length, 4);
  assert.equal(
    coreObservationId(contracts(output)),
    result.request.observation_id,
  );
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

test("C1 probe output inside source is rejected before source changes", (t) => {
  const f = fixture(t);
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-qm",
    "source",
  );
  const before = f.git("status", "--porcelain", "--untracked-files=all");
  assert.throws(
    () =>
      prepareProbe({
        source: f.target,
        output: path.join(f.target, "nested-probe"),
      }),
    /outside source/,
  );
  assert.equal(f.git("status", "--porcelain", "--untracked-files=all"), before);
});

test("C1 failed preparation leaves no partial output and can retry after source repair", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.target, "autodev-probe"));
  fs.writeFileSync(path.join(f.target, "autodev-probe/existing"), "preserve");
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-qm",
    "collision",
  );
  const output = path.join(f.base, "failed-probe");
  assert.throws(
    () => prepareProbe({ source: f.target, output }),
    /fixture path already exists/,
  );
  assert.equal(fs.existsSync(output), false);
  const journal = read(output + ".autodev-probe-prepare.json");
  assert.equal(journal.status, "FAILED");
  assert.match(journal.reason, /fixture path already exists/);
  f.git("rm", "-r", "autodev-probe");
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-qm",
    "repair",
  );
  assert.equal(
    prepareProbe({ source: f.target, output }).status,
    "PREPARED_UNVERIFIED",
  );
  assert.equal(contracts(output).session.root, output);
});

test("C1 repeated CLI invocations reset prior observations and preserve run manifests", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.dir, "probe-prompt.txt"),
    "/goal TEST FIXTURE process transport only",
  );
  json(path.join(f.dir, "probe-results.json"), {
    version: 2,
    mode: "LIVE_PROBE_OBSERVATIONS",
    checks: [
      { id: "actual_models", status: "PASS", evidence_refs: [], reason: "old" },
    ],
  });
  json(path.join(f.dir, "probe-input.json"), {
    run_id: "old",
    attempt_id: "old",
    capabilities: { registry_verified: true, readonly_verified: true },
  });
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const r = cli("live-probe", [
      "--mode",
      "run",
      "--target",
      f.target,
      "--claude",
      "/bin/false",
    ]);
    assert.equal(r.code, 1);
    const data = JSON.parse(r.out);
    ids.push(data.invocation_id);
    const results = read(path.join(f.dir, "probe-results.json"));
    assert.equal(results.invocation_id, data.invocation_id);
    const input = read(path.join(f.dir, "probe-input.json"));
    assert.equal(input.run_id, "live-probe-" + data.invocation_id);
    assert.notEqual(input.attempt_id, "old");
    assert.equal(input.capabilities.registry_verified, false);
    assert.ok(results.checks.every((x) => x.status === "UNVERIFIED"));
    const manifest = read(path.join(f.dir, "evidence", data.manifest));
    assert.equal(manifest.exit_code, 1);
    assert.equal(manifest.status, "EXITED_UNVERIFIED");
    assert.equal(fs.existsSync(path.join(f.dir, ".probe-run.lock")), false);
  }
  assert.notEqual(ids[0], ids[1]);
});

test("C1 interrupted preparation is journaled and recovered before a clean retry", (t) => {
  const f = fixture(t);
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-qm",
    "source",
  );
  const output = path.join(f.base, "interrupted-probe");
  const code = `import fs from 'node:fs'; import {prepareProbe} from ${JSON.stringify(path.join(shared, "scripts/live-probe.mjs"))}; const write=fs.writeFileSync; fs.writeFileSync=function(p,...args){const r=write.call(this,p,...args); if(typeof p==='string'&&p.endsWith('/probe-prompt.txt'))process.kill(process.pid,'SIGKILL');return r;};prepareProbe(${JSON.stringify({ source: f.target, output })});`;
  assert.throws(() =>
    execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      stdio: "pipe",
    }),
  );
  const journal = read(output + ".autodev-probe-prepare.json");
  assert.equal(journal.status, "PREPARING");
  assert.ok(fs.existsSync(journal.staging));
  assert.equal(fs.existsSync(output), false);
  assert.throws(
    () => prepareProbe({ source: f.target, output }),
    /recover-prepare/,
  );
  assert.equal(recoverPrepare({ output }).status, "RECOVERED_UNVERIFIED");
  assert.equal(fs.existsSync(journal.staging), false);
  assert.equal(
    prepareProbe({ source: f.target, output }).status,
    "PREPARED_UNVERIFIED",
  );
});

test("C1 probe run lease rejects a second launch and SIGTERM preserves interrupted evidence", async (t) => {
  const f = fixture(t),
    mock = path.join(f.base, "mock-cli.sh");
  fs.writeFileSync(
    path.join(f.dir, "probe-prompt.txt"),
    "/goal TEST FIXTURE process transport only",
  );
  fs.writeFileSync(
    mock,
    "#!/bin/sh\nprintf 'mock runtime transport only\\n'\nprintf 'diagnostic stderr\\n' >&2\nsleep 30\n",
    { mode: 0o755 },
  );
  const child = spawn(
    process.execPath,
    [
      path.join(shared, "scripts/live-probe.mjs"),
      "--mode",
      "run",
      "--target",
      f.target,
      "--claude",
      mock,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const done = new Promise((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal })),
  );
  t.after(() => {
    try {
      child.kill("SIGKILL");
    } catch {}
  });
  let lock;
  for (let i = 0; i < 200; i++) {
    try {
      lock = read(path.join(f.dir, ".probe-run.lock"));
      if (lock.child) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(lock?.child, "mock child recorded in launcher lease");
  const second = cli("live-probe", [
    "--mode",
    "run",
    "--target",
    f.target,
    "--claude",
    "/bin/false",
  ]);
  assert.equal(second.code, 2);
  assert.match(second.out, /active or unknown/);
  child.kill("SIGTERM");
  await done;
  assert.equal(fs.existsSync(path.join(f.dir, ".probe-run.lock")), false);
  const manifest = read(
    path.join(f.dir, "evidence", "live-run-" + lock.invocation_id + ".json"),
  );
  assert.equal(manifest.interrupted, true);
  assert.equal(manifest.signal, "SIGTERM");
  assert.match(
    fs.readFileSync(path.join(f.dir, "evidence", manifest.stderr), "utf8"),
    /diagnostic stderr/,
  );
  assert.match(manifest.raw_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    cli("live-probe", [
      "--mode",
      "run",
      "--target",
      f.target,
      "--claude",
      "/bin/false",
    ]).code,
    1,
  );
});

test("C1 stale probe-result updates cannot overwrite a newer invocation", (t) => {
  const f = fixture(t),
    resultsPath = path.join(f.dir, "probe-results.json");
  json(resultsPath, {
    version: 2,
    invocation_id: "new",
    checks: [{ id: "actual_models", status: "UNVERIFIED", evidence_refs: [] }],
  });
  const result = cli("probe-result", [
    "--target",
    f.target,
    "--check",
    "actual_models",
    "--status",
    "BLOCKED",
    "--invocation",
    "old",
  ]);
  assert.equal(result.code, 2);
  assert.match(result.out, /invocation changed/);
  assert.equal(read(resultsPath).checks[0].status, "UNVERIFIED");
});

test("C1 probe launcher refuses an unresolved native root run even without its old CLI lease", (t) => {
  const f = fixture(t),
    statePath = path.join(f.dir, "current-task.json"),
    s = read(statePath);
  s.active = true;
  json(statePath, s);
  fs.writeFileSync(
    path.join(f.dir, "probe-prompt.txt"),
    "/goal TEST FIXTURE transport only",
  );
  const result = cli("live-probe", [
    "--mode",
    "run",
    "--target",
    f.target,
    "--claude",
    "/bin/false",
  ]);
  assert.equal(result.code, 2);
  assert.match(result.out, /establish termination and recover/);
  assert.equal(
    fs
      .readdirSync(path.join(f.dir, "evidence"))
      .filter((n) => n.startsWith("live-run-")).length,
    0,
  );
});

test("C1 missing Claude executable saves diagnostic manifest and releases launch lease", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.dir, "probe-prompt.txt"),
    "/goal TEST FIXTURE transport only",
  );
  const result = cli("live-probe", [
    "--mode",
    "run",
    "--target",
    f.target,
    "--claude",
    path.join(f.base, "missing-cli"),
  ]);
  assert.equal(result.code, 2);
  assert.match(result.out, /ENOENT/);
  assert.equal(fs.existsSync(path.join(f.dir, ".probe-run.lock")), false);
  const names = fs
    .readdirSync(path.join(f.dir, "evidence"))
    .filter((n) => n.startsWith("live-run-"));
  assert.equal(names.length, 1);
  const manifest = read(path.join(f.dir, "evidence", names[0]));
  assert.equal(manifest.status, "LAUNCH_FAILED_UNVERIFIED");
  assert.match(manifest.reason, /ENOENT/);
});

test("C1 symlinked output parent cannot redirect preparation into the source", (t) => {
  const f = fixture(t),
    alias = path.join(f.base, "source-alias");
  fs.symlinkSync(f.target, alias, "dir");
  assert.throws(
    () => prepareProbe({ source: f.target, output: path.join(alias, "probe") }),
    /outside source/,
  );
  assert.equal(fs.existsSync(path.join(f.target, "probe")), false);
});

test("C1 preparation permissions failure keeps source unchanged and can be retried", (t) => {
  const f = fixture(t),
    parent = path.join(f.base, "read-only"),
    output = path.join(parent, "probe");
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-qm",
    "source",
  );
  fs.mkdirSync(parent);
  const before = f.git("status", "--porcelain", "--untracked-files=all");
  // Privileged runners cannot enforce owner mode bits; inject the same kernel
  // EACCES at journal creation there, while ordinary Linux/macOS uses real permissions.
  if (process.getuid?.() === 0) {
    const original = fs.openSync;
    fs.openSync = function (p, ...args) {
      if (p === output + ".autodev-probe-prepare.json")
        throw Object.assign(Error("permission denied"), { code: "EACCES" });
      return original.call(this, p, ...args);
    };
    try {
      assert.throws(
        () => prepareProbe({ source: f.target, output }),
        /permission denied/,
      );
    } finally {
      fs.openSync = original;
    }
  } else {
    fs.chmodSync(parent, 0o500);
    try {
      assert.throws(() => prepareProbe({ source: f.target, output }), /EACCES/);
    } finally {
      fs.chmodSync(parent, 0o700);
    }
  }
  assert.equal(fs.existsSync(output), false);
  assert.equal(f.git("status", "--porcelain", "--untracked-files=all"), before);
  assert.equal(
    prepareProbe({ source: f.target, output }).status,
    "PREPARED_UNVERIFIED",
  );
});

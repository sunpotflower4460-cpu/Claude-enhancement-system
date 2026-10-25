import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fixture,
  allPass,
  recordAll,
  seal,
  completed,
  read,
  json,
  contracts,
  fingerprint,
  hash,
  artifactPath,
  attest,
  runtime,
  shared,
} from "./helpers/fixture.mjs";
import { verify } from "../scripts/verify.mjs";
import { record } from "../scripts/record.mjs";
import { validate, canonicalRemote } from "../scripts/lib/core.mjs";
import { runtimeObservation } from "../scripts/lib/runtime.mjs";
const gate = (f) => verify({ target: f.target, fixture: true });
for (const status of ["UNVERIFIED", "FAIL", "BLOCKED"])
  test("A1 rejects unfinished backlog " + status, (t) => {
    const f = fixture(t);
    allPass(f);
    const b = read(path.join(f.dir, "backlog.json"));
    b.items[0].status = status;
    json(path.join(f.dir, "backlog.json"), b);
    const r = gate(f);
    assert.notEqual(r.status, "TEST_COMPLETE");
    assert.equal(r.tasks[0].status, status);
  });
test("A1 manual task PASS without evidence is refused", (t) => {
  const f = fixture(t);
  completed(f);
  seal(f);
  assert.equal(gate(f).status, "UNVERIFIED");
});
test("A1 aligned checks/tasks/requirements get test-only completion; default refuses fixtures", (t) => {
  const f = fixture(t);
  allPass(f);
  assert.equal(gate(f).status, "TEST_COMPLETE");
  assert.equal(verify(f).status, "UNVERIFIED");
  assert.equal(gate(f).assurance, "TEST_FIXTURE");
});
test("A1 partial requirement achievement remains visible", (t) => {
  const f = fixture(t, { count: 3 });
  allPass(f);
  const b = read(path.join(f.dir, "backlog.json"));
  b.items[2].status = "UNVERIFIED";
  json(path.join(f.dir, "backlog.json"), b);
  const r = gate(f);
  assert.equal(r.requirements[0].status, "PASS", JSON.stringify(r));
  assert.equal(r.requirements[2].status, "UNVERIFIED");
  assert.notEqual(r.status, "TEST_COMPLETE");
});
for (const kind of ["review", "audit"])
  for (const status of ["NEEDS_FIX", "BLOCKED", "UNVERIFIED"])
    test(
      "A2 " + kind + " " + status + " with zero findings refuses completion",
      (t) => {
        const f = fixture(t);
        allPass(f);
        attest(f, { kind, status });
        assert.notEqual(gate(f).status, "TEST_COMPLETE");
      },
    );
test("A2 prior task, prior run, stale code, missing coverage cannot serve as final approval", (t) => {
  const f = fixture(t, { count: 2 });
  allPass(f);
  const p = artifactPath(f.dir, "review.json"),
    a = read(p);
  for (const patch of [
    { scope: "task" },
    { run_id: "old-run" },
    { attempt_id: "old-attempt" },
    { task_ids: ["R1"] },
    { requirement_refs: ["R1"] },
    { task_id: "old-task" },
  ]) {
    json(p, { ...a, ...patch });
    assert.notEqual(gate(f).status, "TEST_COMPLETE");
  }
  json(p, a);
  fs.appendFileSync(path.join(f.target, "check.mjs"), "\n// new product");
  assert.equal(gate(f).status, "UNVERIFIED");
});
test("A2 version-1 assessment is rejected rather than upgraded to PASS", (t) => {
  const f = fixture(t);
  allPass(f);
  const p = artifactPath(f.dir, "review.json"),
    a = read(p);
  a.version = 1;
  json(p, a);
  assert.equal(gate(f).status, "UNVERIFIED");
});
test("A2 unresolved major findings override PASS and human review stays separate", (t) => {
  const f = fixture(t);
  allPass(f);
  attest(f, {
    findings: [{ severity: "major", message: "fault", resolved: false }],
  });
  assert.equal(gate(f).status, "FAIL");
  const c = read(path.join(f.dir, "contract.json"));
  c.human_review = true;
  json(path.join(f.dir, "contract.json"), c);
  allPass(f);
  assert.equal(gate(f).status, "TEST_READY_FOR_HUMAN_REVIEW");
});
test("A3 parses actual SDK envelope model and rejects normalized forgery", (t) => {
  const f = fixture(t),
    c = contracts(f.target),
    ref = runtime(f);
  assert.equal(
    runtimeObservation(c, ref, {}, { fixture: true }).observed_model,
    "claude-sonnet-5-5",
  );
  const r = read(artifactPath(f.dir, ref)),
    raw = artifactPath(f.dir, r.record);
  const es = fs.readFileSync(raw, "utf8").split("\n").map(JSON.parse);
  es[2].message.model = "substituted";
  fs.writeFileSync(raw, es.map(JSON.stringify).join("\n"));
  r.sha256 = hash(fs.readFileSync(raw));
  json(artifactPath(f.dir, ref), r);
  assert.throws(
    () => runtimeObservation(c, ref, {}, { fixture: true }),
    /substituted|mismatch/,
  );
});
test("A3 rejects unrecognized formats, absent timestamps and unrelated SDK task IDs", (t) => {
  const f = fixture(t),
    c = contracts(f.target),
    ref = runtime(f),
    p = artifactPath(f.dir, ref),
    r = read(p),
    raw = artifactPath(f.dir, r.record);
  for (const es of [
    [{ model: "claude-sonnet-5-5" }],
    [
      {
        type: "assistant",
        uuid: r.message_uuid,
        message: { model: r.expected_model },
      },
    ],
  ]) {
    fs.writeFileSync(raw, es.map(JSON.stringify).join("\n"));
    r.sha256 = hash(fs.readFileSync(raw));
    json(p, r);
    assert.throws(() => runtimeObservation(c, ref, {}, { fixture: true }));
  }
});
for (const kind of ["visual", "play"])
  test("C1 " + kind + " placeholder exit 0 produces UNVERIFIED", (t) => {
    const f = fixture(t, { profile: "game" });
    allPass(f);
    const p = path.join(f.dir, "contract.json"),
      c = read(p),
      check = c.checks.find((x) => x.kind === kind);
    check.command = "true";
    json(p, c);
    const e = record({ target: f.target, check: check.id });
    assert.equal(e.exit_code, 0);
    assert.equal(e.report, null);
    assert.equal(gate(f).status, "UNVERIFIED");
  });
test("C1 failed browser assertions give FAIL, report/artifact removal or tampering invalidates", (t) => {
  const f = fixture(t, { profile: "web-app" });
  allPass(f);
  const check = contracts(f.target).contract.checks.find(
      (c) => c.kind === "visual",
    ),
    e = read(artifactPath(f.dir, hash(check.id) + ".json")),
    report = read(artifactPath(f.dir, e.report.path)),
    capture = artifactPath(f.dir, report.artifacts[0].path);
  fs.appendFileSync(capture, "changed");
  assert.equal(gate(f).status, "UNVERIFIED");
  recordAll(f);
  fs.unlinkSync(capture);
  assert.equal(gate(f).status, "UNVERIFIED");
  recordAll(f);
  const reportPath = artifactPath(f.dir, e.report.path);
  fs.unlinkSync(reportPath);
  assert.equal(gate(f).status, "UNVERIFIED");
});
test("C1 actual test assertion failure cannot complete", (t) => {
  const f = fixture(t);
  allPass(f);
  json(path.join(f.target, "product.json"), { R1: false });
  recordAll(f);
  seal(f);
  assert.equal(gate(f).status, "FAIL");
});
test("C2 evidence updates do not self-invalidate; contract and product changes do", (t) => {
  const f = fixture(t);
  allPass(f);
  const before = fingerprint(f.target);
  fs.writeFileSync(artifactPath(f.dir, "extra.txt"), "note");
  assert.equal(fingerprint(f.target), before);
  assert.equal(gate(f).status, "TEST_COMPLETE");
  fs.writeFileSync(path.join(f.target, "new.js"), "new");
  assert.equal(gate(f).status, "UNVERIFIED");
});
test("C2 staged deletion does not change fingerprint again on commit; mode and symlink changes detected", (t) => {
  const f = fixture(t);
  f.git("add", "product.json");
  let before = fingerprint(f.target);
  fs.unlinkSync(path.join(f.target, "product.json"));
  assert.notEqual(fingerprint(f.target), before);
  before = fingerprint(f.target);
  f.git("rm", "--cached", "product.json");
  assert.equal(fingerprint(f.target), before);
  const p = path.join(f.target, "script");
  fs.writeFileSync(p, "x");
  before = fingerprint(f.target);
  fs.chmodSync(p, 0o755);
  assert.notEqual(fingerprint(f.target), before);
  fs.symlinkSync("a", path.join(f.target, "link"));
  before = fingerprint(f.target);
  fs.unlinkSync(path.join(f.target, "link"));
  fs.symlinkSync("b", path.join(f.target, "link"));
  assert.notEqual(fingerprint(f.target), before);
});
test("contract validation rejects missing task checks, dropped requirements and cycles", (t) => {
  const f = fixture(t, { count: 2 }),
    p = path.join(f.dir, "backlog.json"),
    b = read(p);
  b.items[0].check_refs = [];
  json(p, b);
  assert.throws(() => contracts(f.target), /no acceptance/);
  b.items[0].check_refs = ["R1-test", "R1-api"];
  b.items[0].dependencies = ["R2"];
  b.items[1].dependencies = ["R1"];
  json(p, b);
  assert.throws(() => contracts(f.target), /cycle/);
  b.items.pop();
  json(p, b);
  assert.throws(() => contracts(f.target), /coverage/);
});
test("checks changing product/contract during execution cannot create fresh evidence", (t) => {
  const f = fixture(t),
    p = path.join(f.dir, "contract.json"),
    c = read(p);
  c.checks[0].command = "echo changed >> product.json";
  json(p, c);
  const e = record({ target: f.target, check: c.checks[0].id });
  assert.equal(e.stable, false);
});
test("duplicate IDs, malformed schema, state symlinks and mission tampering rejected", (t) => {
  const f = fixture(t);
  assert.throws(() => validate("assessment", { version: 1 }));
  fs.appendFileSync(path.join(f.dir, "mission.md"), "changed");
  assert.throws(() => contracts(f.target), /mission changed/);
  fs.writeFileSync(
    path.join(f.dir, "mission.md"),
    read(path.join(f.dir, "mission.json")).original,
  );
  fs.symlinkSync(f.source, artifactPath(f.dir, "bad"));
  assert.throws(() => contracts(f.target), /Symlink/);
});
test("canonical repository IDs match SSH/HTTPS but preserve case for other hosts", () => {
  assert.equal(
    canonicalRemote("git@github.com:Example/Project.git"),
    canonicalRemote("https://github.com/example/project"),
  );
  assert.notEqual(
    canonicalRemote("https://git.example/Owner/Project"),
    canonicalRemote("https://git.example/owner/project"),
  );
});
test("G prior SDK assistant cannot approve a new SDK run sharing task/tool identity", (t) => {
  const f = fixture(t),
    ref = runtime(f),
    r = read(artifactPath(f.dir, ref)),
    raw = artifactPath(f.dir, r.record),
    es = fs.readFileSync(raw, "utf8").split("\n").map(JSON.parse);
  es.push({ ...es[1], run_id: "new-sdk-run" });
  fs.writeFileSync(raw, es.map(JSON.stringify).join("\n"));
  r.sdk_run_id = "new-sdk-run";
  r.sha256 = hash(fs.readFileSync(raw));
  json(artifactPath(f.dir, ref), r);
  assert.throws(
    () => runtimeObservation(contracts(f.target), ref, {}, { fixture: true }),
    /window/,
  );
});
test("G raw SDK from another cwd or another invocation cannot be relabelled as current", (t) => {
  const f = fixture(t),
    ref = runtime(f),
    p = artifactPath(f.dir, ref),
    r = read(p),
    raw = artifactPath(f.dir, r.record),
    es = fs.readFileSync(raw, "utf8").split("\n").map(JSON.parse);
  es[0].cwd = f.base;
  fs.writeFileSync(raw, es.map(JSON.stringify).join("\n"));
  r.sha256 = hash(fs.readFileSync(raw));
  json(p, r);
  assert.throws(
    () => runtimeObservation(contracts(f.target), ref, {}, { fixture: true }),
    /cwd/,
  );
  es[0].cwd = f.target;
  es[1].description = "unrelated task";
  fs.writeFileSync(raw, es.map(JSON.stringify).join("\n"));
  r.sha256 = hash(fs.readFileSync(raw));
  json(p, r);
  assert.throws(
    () => runtimeObservation(contracts(f.target), ref, {}, { fixture: true }),
    /invocation/,
  );
});
test("G final assessment cannot be reused after a task execution is reset on identical code", (t) => {
  const f = fixture(t);
  allPass(f);
  const p = path.join(f.dir, "backlog.json"),
    b = read(p);
  b.items[0].execution.attempt_id = "new-task-attempt";
  json(p, b);
  assert.ok(gate(f).issues.some((x) => x.includes("previous task execution")));
});
test("G ignored internal symlink targets are hashed; external executable symlinks are refused", (t) => {
  const f = fixture(t),
    ignored = path.join(f.target, "node_modules");
  fs.mkdirSync(ignored);
  const binary = path.join(ignored, "binary");
  fs.writeFileSync(binary, "v1");
  fs.symlinkSync("node_modules/binary", path.join(f.target, "local-bin"));
  const fp = fingerprint(f.target);
  fs.writeFileSync(binary, "v2");
  assert.notEqual(fp, fingerprint(f.target));
  fs.symlinkSync("/bin/true", path.join(f.target, "outside"));
  assert.throws(() => fingerprint(f.target), /External/);
});
test("G bundled API/browser checker edits change common verifier version even outside target", async (t) => {
  const f = fixture(t),
    copy = path.join(f.base, "common-copy");
  fs.mkdirSync(copy);
  for (const name of ["package.json", "package-lock.json"])
    fs.copyFileSync(path.join(shared, name), path.join(copy, name));
  for (const dir of [
    "scripts",
    "examples",
    "schemas",
    "agents",
    "profiles",
    "workflows",
    "skills",
  ])
    fs.cpSync(path.join(shared, dir), path.join(copy, dir), {
      recursive: true,
    });
  fs.symlinkSync(
    path.join(shared, "node_modules"),
    path.join(copy, "node_modules"),
    "dir",
  );
  const { pathToFileURL } = await import("node:url"),
    core = await import(pathToFileURL(path.join(copy, "scripts/lib/core.mjs")));
  const before = core.verifierVersion();
  fs.appendFileSync(
    path.join(copy, "examples/api-check.mjs"),
    "\n// Changed acceptance assertions",
  );
  assert.notEqual(core.verifierVersion(), before);
  const second = core.verifierVersion();
  fs.appendFileSync(
    path.join(copy, "examples/browser-check.mjs"),
    "\n// Changed browser assertions",
  );
  assert.notEqual(core.verifierVersion(), second);
  const third = core.verifierVersion();
  fs.appendFileSync(path.join(copy, "package-lock.json"), "\n");
  assert.notEqual(core.verifierVersion(), third);
});

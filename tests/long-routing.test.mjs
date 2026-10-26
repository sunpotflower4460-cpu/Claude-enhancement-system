import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fixture,
  allPass,
  read,
  json,
  attest,
  terminated,
  artifactPath,
  contracts,
  hash,
  recordAll,
  runtime,
} from "./helpers/fixture.mjs";
import { verify } from "../scripts/verify.mjs";
import { state } from "../scripts/state.mjs";
import { mutex } from "../scripts/lib/core.mjs";
const gate = (f) => verify({ target: f.target, fixture: true });
function retainProvenance(f) {
  const c = contracts(f.target),
    s = read(path.join(f.dir, "current-task.json"));
  for (const name of read(path.join(f.dir, "routing.json"))) {
    const p = artifactPath(f.dir, name),
      r = read(p),
      task = c.backlog.items.find((t) => t.id === r.task_id);
    r.provenance = {
      mission_id: c.mission.mission_id,
      repository: c.mission.target.repository,
      binding: {
        session_id: c.session.session_id,
        repository: c.session.repository,
        root: c.session.root,
      },
      execution: task?.execution || {
        run_id: s.run_id,
        attempt_id: s.attempt_id,
        started_at: s.run_started_at,
      },
      contract: c.digest,
      architecture_sha256: hash(
        fs.readFileSync(path.join(f.dir, "architecture.md")),
      ),
    };
    json(p, r);
  }
}
function newRun(f) {
  state({
    target: f.target,
    action: "begin",
    run: "new-run",
    task: "mission",
    attempt: "new-attempt",
  });
  const s = read(path.join(f.dir, "current-task.json"));
  s.active = false;
  json(path.join(f.dir, "current-task.json"), s);
  attest(f);
  attest(f, { kind: "audit" });
  terminated(f);
}
test("long routing retains proved role provenance across a fresh root run without duplicate implementation", (t) => {
  const f = fixture(t);
  allPass(f);
  retainProvenance(f);
  newRun(f);
  assert.equal(gate(f).status, "TEST_COMPLETE", JSON.stringify(gate(f)));
  assert.ok(
    gate(f).routing_provenance.some((x) => x.assurance === "HISTORICAL_VALID"),
  );
});
test("long routing legacy or missing historical raw never becomes current assurance", (t) => {
  const f = fixture(t);
  allPass(f);
  // Schema-v2 records without provenance remain current-only.
  for (const name of read(path.join(f.dir, "routing.json"))) {
    const p = artifactPath(f.dir, name),
      r = read(p);
    delete r.provenance;
    json(p, r);
  }
  newRun(f);
  assert.notEqual(gate(f).status, "TEST_COMPLETE");
  const g = fixture(t);
  allPass(g);
  retainProvenance(g);
  newRun(g);
  const r = read(
    artifactPath(g.dir, read(path.join(g.dir, "routing.json"))[0]),
  );
  fs.unlinkSync(artifactPath(g.dir, r.record));
  assert.notEqual(gate(g).status, "TEST_COMPLETE");
});
test("long routing changed retained architecture invalidates historical architect and planner", (t) => {
  const f = fixture(t);
  allPass(f);
  retainProvenance(f);
  newRun(f);
  fs.appendFileSync(path.join(f.dir, "architecture.md"), "\nChanged design.\n");
  assert.notEqual(gate(f).status, "TEST_COMPLETE");
});
test("long routing a different task execution cannot reuse historical implementation", (t) => {
  const f = fixture(t);
  allPass(f);
  retainProvenance(f);
  newRun(f);
  const b = read(path.join(f.dir, "backlog.json"));
  b.items[0].execution = {
    ...b.items[0].execution,
    attempt_id: "other-execution",
  };
  json(path.join(f.dir, "backlog.json"), b);
  recordAll(f);
  attest(f);
  attest(f, { kind: "audit" });
  assert.notEqual(gate(f).status, "TEST_COMPLETE");
});
test("long routing previous session remains historical and never substitutes for a fresh assessment", (t) => {
  const f = fixture(t);
  allPass(f);
  retainProvenance(f);
  const session = read(path.join(f.dir, "session.json"));
  session.session_id = "fresh-session";
  json(path.join(f.dir, "session.json"), session);
  newRun(f);
  recordAll(f);
  const result = gate(f);
  assert.equal(result.status, "TEST_COMPLETE", JSON.stringify(result));
  assert.equal(
    result.routing_provenance.filter((x) => x.assurance === "HISTORICAL_VALID")
      .length,
    3,
  );
  const p = artifactPath(f.dir, "review.json"),
    a = read(p);
  a.session_id = "old-binding";
  json(p, a);
  assert.notEqual(gate(f).status, "TEST_COMPLETE");
});

test("long final gate refuses overlapping recorder or writer mutex", (t) => {
  const f = fixture(t);
  allPass(f);
  mutex(f.target, () => assert.throws(() => gate(f), /EEXIST|mutex|busy/i));
  assert.equal(gate(f).status, "TEST_COMPLETE");
});

function omitHistoricalArchitecture(
  f,
  { declared = true, replacement = true } = {},
) {
  const old = read(path.join(f.dir, "routing.json"));
  const oldRecord = read(artifactPath(f.dir, old[0]));
  const raw = artifactPath(f.dir, oldRecord.record),
    bytes = fs.readFileSync(raw);
  fs.unlinkSync(raw);
  if (declared)
    json(path.join(f.dir, "checkpoint-omitted.json"), [
      {
        path: ".autodev/evidence/" + oldRecord.record,
        sha256: hash(bytes),
        size: bytes.length,
        reason: "Explicit checkpoint size policy",
      },
    ]);
  newRun(f);
  const b = read(path.join(f.dir, "backlog.json")),
    s = read(path.join(f.dir, "current-task.json"));
  b.items[0].execution = {
    run_id: s.run_id,
    attempt_id: s.attempt_id,
    started_at: s.run_started_at,
  };
  json(path.join(f.dir, "backlog.json"), b);
  recordAll(f);
  attest(f);
  attest(f, { kind: "audit" });
  const fresh = replacement
    ? [
        runtime(f, {
          role: "architecture",
          model: "claude-opus-5-5",
          run_id: s.run_id,
          attempt_id: s.attempt_id,
        }),
        runtime(f, {
          role: "plan",
          model: "claude-sonnet-5-5",
          run_id: s.run_id,
          attempt_id: s.attempt_id,
        }),
        runtime(f, {
          role: "implement",
          model: "claude-haiku-5-5",
          task_id: "R1",
          run_id: s.run_id,
          attempt_id: s.attempt_id,
        }),
      ]
    : [];
  json(path.join(f.dir, "routing.json"), [...old, ...fresh]);
  return { oldRecord, fresh };
}
test("long routing explicit omitted historical raw is unavailable and fresh real role replacements can pass", (t) => {
  const f = fixture(t);
  allPass(f);
  omitHistoricalArchitecture(f);
  const result = gate(f);
  assert.equal(result.status, "TEST_COMPLETE", JSON.stringify(result));
  assert.ok(
    result.routing_provenance.some(
      (x) => x.assurance === "HISTORICAL_UNAVAILABLE",
    ),
  );
  assert.equal(
    result.routing_provenance.filter((x) => x.assurance === "CURRENT_VALID")
      .length,
    3,
  );
});
test("long routing omitted historical raw cannot count without replacement, unexplained loss cannot be hidden", (t) => {
  const f = fixture(t);
  allPass(f);
  omitHistoricalArchitecture(f, { replacement: false });
  assert.notEqual(gate(f).status, "TEST_COMPLETE");
  const g = fixture(t);
  allPass(g);
  omitHistoricalArchitecture(g, { declared: false });
  assert.notEqual(gate(g).status, "TEST_COMPLETE");
});
test("long routing omission declarations cannot hide missing current raw or mismatched historical hash", (t) => {
  const f = fixture(t);
  allPass(f);
  const { fresh } = omitHistoricalArchitecture(f);
  const current = read(artifactPath(f.dir, fresh[0])),
    raw = artifactPath(f.dir, current.record),
    bytes = fs.readFileSync(raw);
  fs.unlinkSync(raw);
  const omissions = read(path.join(f.dir, "checkpoint-omitted.json"));
  omissions.push({
    path: ".autodev/evidence/" + current.record,
    sha256: hash(bytes),
    size: bytes.length,
    reason: "Should not exempt current context",
  });
  json(path.join(f.dir, "checkpoint-omitted.json"), omissions);
  assert.notEqual(gate(f).status, "TEST_COMPLETE");
  const g = fixture(t);
  allPass(g);
  omitHistoricalArchitecture(g);
  const wrong = read(path.join(g.dir, "checkpoint-omitted.json"));
  wrong[0].sha256 = "0".repeat(64);
  json(path.join(g.dir, "checkpoint-omitted.json"), wrong);
  assert.notEqual(gate(g).status, "TEST_COMPLETE");
});

test("model, terminal and independent assessment importers cannot write through an active gate mutex", async (t) => {
  const { importRuntime } = await import("../scripts/import-runtime.mjs"),
    { importTermination } = await import("../scripts/import-termination.mjs"),
    { saveAssessment } = await import("../scripts/assessment.mjs");
  const f = fixture(t);
  allPass(f);
  const r = read(
      artifactPath(f.dir, read(path.join(f.dir, "routing.json"))[0]),
    ),
    a = read(artifactPath(f.dir, "review.json"));
  const actions = [
    () =>
      importRuntime({
        target: f.target,
        task: "mission",
        stage: r.stage,
        expected: r.expected_model,
        raw: artifactPath(f.dir, r.record),
        tool_use: r.tool_use_id,
        mode: "TEST_FIXTURE",
      }),
    () =>
      importTermination({
        target: f.target,
        raw: artifactPath(
          f.dir,
          read(path.join(f.dir, "termination.json")).record,
        ),
        tool_use: "workflow-tool",
        mode: "TEST_FIXTURE",
      }),
    () =>
      saveAssessment({
        target: f.target,
        input: artifactPath(f.dir, "review.json"),
        kind: "review",
        scope: "final",
        runtime: a.runtime_ref,
        fixture: true,
      }),
  ];
  const blocked = mutex(f.target, () =>
    actions.map((fn) => {
      try {
        fn();
        return false;
      } catch (e) {
        return e.code === "EEXIST";
      }
    }),
  );
  assert.deepEqual(blocked, [true, true, true]);
});

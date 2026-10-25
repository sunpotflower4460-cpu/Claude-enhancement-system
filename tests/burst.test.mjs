import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fixture,
  read,
  json,
  hash,
  artifactPath,
  contracts,
  terminated,
  shared,
} from "./helpers/fixture.mjs";
import { observationId, observationContext } from "../scripts/lib/core.mjs";
import { bootstrap } from "../scripts/bootstrap.mjs";
import { state } from "../scripts/state.mjs";
import { burst } from "../scripts/burst.mjs";
function begin(f, suffix = "one") {
  return state({
    target: f.target,
    action: "begin",
    run: "root-" + suffix,
    task: "mission",
    attempt: "attempt-" + suffix,
  });
}
function claim(f) {
  const s = read(path.join(f.dir, "current-task.json"));
  return burst({
    target: f.target,
    action: "claim",
    run: s.run_id,
    task: s.task_id,
    attempt: s.attempt_id,
    observation_id: observationId(observationContext(f.target)),
  });
}
function proof(
  f,
  id,
  { suffix = id, state: terminal = "completed", active = false } = {},
) {
  const filename = terminated(f, { state: terminal }),
    p = read(filename),
    events = fs
      .readFileSync(artifactPath(f.dir, p.record), "utf8")
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  const call = events[1].message.content[0];
  call.id = "tool-" + suffix;
  call.input.args.burst_id = id;
  call.input.scriptPath = path.join(shared, "workflows/develop-mission.js");
  events[2].message.content[0].tool_use_id = call.id;
  events[2].tool_use_result.taskId = "native-task-" + suffix;
  events[2].tool_use_result.runId = "native-run-" + suffix;
  events[3].task_id = "native-task-" + suffix;
  events[3].run_id = "native-run-" + suffix;
  if (active) events[4].tasks = [{ task_id: "still-active" }];
  p.record = "burst-fixture-" + hash(id) + ".jsonl";
  fs.writeFileSync(
    artifactPath(f.dir, p.record),
    events.map((x) => JSON.stringify(x)).join("\n"),
  );
  p.sha256 = hash(fs.readFileSync(artifactPath(f.dir, p.record)));
  p.sdk_tool_use_id = call.id;
  p.sdk_task_id = events[3].task_id;
  p.sdk_run_id = events[3].run_id;
  json(filename, p);
  return filename;
}
test("burst claim requires active root ownership and current observed state", (t) => {
  const f = fixture(t);
  assert.throws(() => claim(f), /active root/i);
  const s = begin(f);
  assert.throws(
    () =>
      burst({
        target: f.target,
        action: "claim",
        run: s.run_id,
        task: s.task_id,
        attempt: s.attempt_id,
        observation_id: "0".repeat(64),
      }),
    /observation/i,
  );
  assert.throws(
    () =>
      burst({
        target: f.target,
        action: "claim",
        run: "another",
        task: s.task_id,
        attempt: s.attempt_id,
        observation_id: observationId(observationContext(f.target)),
      }),
    /ownership/i,
  );
});
test("durable planned burst prevents duplicate launch even after parent result is lost", (t) => {
  const f = fixture(t);
  begin(f);
  const first = claim(f);
  assert.equal(first.status, "CLAIMED");
  assert.equal(first.args.observation_id, observationId(contracts(f.target)));
  assert.match(first.burst_id, /^[a-f0-9-]{36}$/);
  assert.throws(() => claim(f), /active\/unknown burst/i);
  const observed = burst({ target: f.target, action: "inspect" });
  assert.equal(observed.active.burst_id, first.burst_id);
  assert.match(observed.next, /Do not launch/);
  assert.match(observed.next, /termination/);
});
test("burst attach records known native launch and rejects foreign or ambiguous invocation", (t) => {
  const f = fixture(t);
  begin(f);
  const first = claim(f),
    filename = proof(f, first.burst_id),
    p = read(filename),
    raw = artifactPath(f.dir, p.record);
  assert.throws(
    () =>
      burst({
        target: f.target,
        action: "attach",
        id: first.burst_id,
        raw,
        tool_use: "wrong",
      }),
    /launch/i,
  );
  const attached = burst({
    target: f.target,
    action: "attach",
    id: first.burst_id,
    raw,
    tool_use: p.sdk_tool_use_id,
    mode: "TEST_FIXTURE",
  });
  assert.equal(attached.status, "ATTACHED");
  assert.equal(attached.launch.sdk_tool_use_id, p.sdk_tool_use_id);
  assert.equal(attached.launch.source, "TEST_FIXTURE");
});
test("three drained bursts preserve journal/cadence and cannot reuse the prior completion proof", (t) => {
  const f = fixture(t, { count: 6 });
  begin(f);
  const history = [];
  for (let i = 0; i < 3; i++) {
    const before = read(path.join(f.dir, "progress.json")),
      first = claim(f),
      p = proof(f, first.burst_id);
    if (history.length)
      assert.throws(
        () =>
          burst({
            target: f.target,
            action: "finish",
            id: first.burst_id,
            proof: history.at(-1).proof,
            fixture: true,
          }),
        /burst|invocation|context|termination time/i,
      );
    const saved = path.join(f.base, "proof-" + i + ".json");
    fs.copyFileSync(p, saved);
    const result = burst({
      target: f.target,
      action: "finish",
      id: first.burst_id,
      proof: p,
      fixture: true,
    });
    assert.equal(result.status, "FINISHED");
    assert.equal(result.termination.source, "TEST_FIXTURE");
    assert.deepEqual(read(path.join(f.dir, "progress.json")), before);
    history.push({ id: first.burst_id, proof: saved });
  }
  const observed = burst({ target: f.target, action: "inspect" });
  assert.equal(observed.entries.length, 3);
  assert.equal(observed.active, null);
  assert.deepEqual(
    read(path.join(f.dir, "backlog.json")).items.map((x) => x.status),
    Array(6).fill("UNVERIFIED"),
  );
});
test("burst completion requires live assurance by default and drained native runtime", (t) => {
  const f = fixture(t);
  begin(f);
  const first = claim(f),
    p = proof(f, first.burst_id, { active: true });
  assert.throws(
    () =>
      burst({
        target: f.target,
        action: "finish",
        id: first.burst_id,
        proof: p,
      }),
    /FIXTURE/,
  );
  assert.throws(
    () =>
      burst({
        target: f.target,
        action: "finish",
        id: first.burst_id,
        proof: p,
        fixture: true,
      }),
    /drained/,
  );
  proof(f, first.burst_id);
  assert.equal(
    burst({
      target: f.target,
      action: "finish",
      id: first.burst_id,
      proof: p,
      fixture: true,
    }).status,
    "FINISHED",
  );
});
test("recovered root can close a prior claimed burst only with that burst's proof", (t) => {
  const f = fixture(t);
  begin(f);
  const first = claim(f),
    p = proof(f, first.burst_id, { state: "stopped" });
  state({ target: f.target, action: "recover", proof: p, fixture: true });
  begin(f, "two");
  assert.throws(() => claim(f), /active\/unknown burst/i);
  assert.equal(
    burst({
      target: f.target,
      action: "finish",
      id: first.burst_id,
      proof: p,
      fixture: true,
    }).status,
    "FINISHED",
  );
  assert.equal(claim(f).status, "CLAIMED");
});
test("native tool/task identifiers cannot be replayed into a new burst by rewrapping raw", (t) => {
  const f = fixture(t);
  begin(f);
  const a = claim(f),
    p = proof(f, a.burst_id, { suffix: "same" });
  burst({
    target: f.target,
    action: "finish",
    id: a.burst_id,
    proof: p,
    fixture: true,
  });
  const b = claim(f),
    reused = proof(f, b.burst_id, { suffix: "same" });
  assert.throws(
    () =>
      burst({
        target: f.target,
        action: "finish",
        id: b.burst_id,
        proof: reused,
        fixture: true,
      }),
    /reused native/i,
  );
});
test("tampered launch raw and mismatched burst args cannot close pending work", (t) => {
  const f = fixture(t);
  begin(f);
  const a = claim(f),
    p = proof(f, a.burst_id),
    manifest = read(p);
  const events = fs
    .readFileSync(artifactPath(f.dir, manifest.record), "utf8")
    .split("\n")
    .map(JSON.parse);
  events[1].message.content[0].input.args.burst_id = "some-other-burst";
  fs.writeFileSync(
    artifactPath(f.dir, manifest.record),
    events.map((x) => JSON.stringify(x)).join("\n"),
  );
  assert.throws(
    () =>
      burst({
        target: f.target,
        action: "finish",
        id: a.burst_id,
        proof: p,
        fixture: true,
      }),
    /changed/,
  );
  manifest.sha256 = hash(fs.readFileSync(artifactPath(f.dir, manifest.record)));
  json(p, manifest);
  assert.throws(
    () =>
      burst({
        target: f.target,
        action: "finish",
        id: a.burst_id,
        proof: p,
        fixture: true,
      }),
    /burst/i,
  );
  assert.equal(
    burst({ target: f.target, action: "inspect" }).active.burst_id,
    a.burst_id,
  );
});

test("missing historical logs are UNVERIFIED while receipt identity and next-work safety survive", (t) => {
  const f = fixture(t);
  begin(f);
  const a = claim(f),
    p = proof(f, a.burst_id);
  const finished = burst({
    target: f.target,
    action: "finish",
    id: a.burst_id,
    proof: p,
    fixture: true,
  });
  assert.equal(
    burst({ target: f.target, action: "inspect" }).entries[0].evidence_status,
    "TEST_FIXTURE",
  );
  fs.rmSync(artifactPath(f.dir, finished.launch.record));
  const inspected = burst({ target: f.target, action: "inspect" });
  assert.equal(inspected.entries[0].status, "FINISHED");
  assert.equal(inspected.entries[0].evidence_status, "UNVERIFIED");
  assert.equal(claim(f).status, "CLAIMED");
});
test("attachment pins native identity and cannot be switched by a different terminal proof", (t) => {
  const f = fixture(t);
  begin(f);
  const a = claim(f),
    p = proof(f, a.burst_id, { suffix: "attached" }),
    m = read(p);
  burst({
    target: f.target,
    action: "attach",
    id: a.burst_id,
    raw: artifactPath(f.dir, m.record),
    tool_use: m.sdk_tool_use_id,
    mode: "TEST_FIXTURE",
  });
  proof(f, a.burst_id, { suffix: "different" });
  assert.throws(
    () =>
      burst({
        target: f.target,
        action: "finish",
        id: a.burst_id,
        proof: p,
        fixture: true,
      }),
    /attached launch/,
  );
  assert.equal(
    burst({ target: f.target, action: "inspect" }).active.status,
    "ATTACHED",
  );
});

test("native tool_result error or ambiguous launch is never accepted as success", (t) => {
  const f = fixture(t);
  begin(f);
  const a = claim(f),
    p = proof(f, a.burst_id),
    m = read(p),
    raw = artifactPath(f.dir, m.record),
    original = fs.readFileSync(raw, "utf8");
  for (const change of [
    (events) => {
      events[2].message.content[0].is_error = true;
    },
    (events) => events.push(events[2]),
    (events) => {
      events[1].message.content[0].input.scriptPath = "/some/other/workflow.js";
    },
  ]) {
    const events = original.split("\n").filter(Boolean).map(JSON.parse);
    change(events);
    fs.writeFileSync(raw, events.map((x) => JSON.stringify(x)).join("\n"));
    assert.throws(
      () =>
        burst({
          target: f.target,
          action: "attach",
          id: a.burst_id,
          raw,
          tool_use: m.sdk_tool_use_id,
          mode: "TEST_FIXTURE",
        }),
      /launch|scriptPath/i,
    );
  }
  assert.equal(
    burst({ target: f.target, action: "inspect" }).active.status,
    "CLAIMED",
  );
});

test("raw bootstrap can claim its first Opus planning burst before a contract exists", (t) => {
  const f = fixture(t);
  fs.rmSync(f.dir, { recursive: true });
  bootstrap({ target: f.target, mission: f.source });
  begin(f);
  assert.equal(fs.existsSync(path.join(f.dir, "contract.json")), false);
  const context = observationContext(f.target);
  assert.equal(context.contract, null);
  const first = claim(f);
  assert.equal(first.status, "CLAIMED");
  assert.equal(
    first.args.observation_id,
    observationId(observationContext(f.target)),
  );
  assert.throws(() => contracts(f.target), /ENOENT/);
});
test("initial planning never downgrades a malformed contract or missing original requirement", (t) => {
  const f = fixture(t, { count: 2 });
  fs.rmSync(f.dir, { recursive: true });
  bootstrap({ target: f.target, mission: f.source });
  json(path.join(f.dir, "contract.json"), {});
  assert.throws(() => observationContext(f.target), /contract/);
  fs.rmSync(path.join(f.dir, "contract.json"));
  const backlog = read(path.join(f.dir, "backlog.json"));
  backlog.items.pop();
  json(path.join(f.dir, "backlog.json"), backlog);
  assert.throws(() => observationContext(f.target), /coverage/);
  backlog.items[0].status = "PASS";
  json(path.join(f.dir, "backlog.json"), backlog);
  assert.throws(() => observationContext(f.target), /initialized/);
});

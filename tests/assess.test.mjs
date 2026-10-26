// assess.mjs: deterministic coordinator path from a reviewer's returned result to a saved v2
// assessment, with model proof from the live SDK stream (workflow_agent progress).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fixture,
  read,
  json,
  contracts,
  hash,
  artifactPath,
} from "./helpers/fixture.mjs";
import { invocationTag, fingerprint, binding } from "../scripts/lib/core.mjs";
import { persistAssessment } from "../scripts/assess.mjs";

function sdk(f, { model = "claude-sonnet-5-5", state = "done", stage = "review", burst = "b1", ctxTask = "R1" } = {}) {
  const c = contracts(f.target),
    t = c.backlog.items.find((x) => x.id === ctxTask),
    ctx = { run_id: t.execution.run_id, task_id: t.id, attempt_id: t.execution.attempt_id, session_id: c.session.session_id },
    now = Date.now();
  const es = [
    { type: "system", subtype: "init", session_id: "sdk-session", cwd: c.session.root },
    { type: "assistant", session_id: "sdk-session", message: { content: [{ type: "tool_use", name: "Workflow", id: "toolu-live", input: { args: { burst_id: burst } } }] } },
    { type: "system", subtype: "task_started", session_id: "sdk-session", task_id: "wtask", run_id: "0stream", tool_use_id: "toolu-live", workflow_name: "develop-mission" },
    { type: "system", subtype: "task_progress", session_id: "sdk-session", task_id: "wtask", run_id: "0stream", workflow_progress: [{ type: "workflow_agent", index: 1, label: invocationTag(c, ctx, stage), agentId: "a1", agentType: "autodev-sonnet-reviewer", model, state, startedAt: now }] },
  ];
  const p = path.join(f.dir, "evidence", "assess-sdk-" + hash(JSON.stringify(es)).slice(0, 10) + ".jsonl");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, es.map((e) => JSON.stringify(e)).join("\n"));
  return p;
}
function result(f, over = {}) {
  const c = contracts(f.target),
    p = path.join(f.dir, "evidence", "reviewer-result-" + hash(JSON.stringify(over) + Math.random()).slice(0, 8) + ".json");
  json(p, {
    status: "PASS",
    summary: "reviewed",
    findings: [{ severity: "minor", message: "note" }],
    snapshot: { product: fingerprint(f.target), contract: c.digest, identity: binding(c) },
    ...over,
  });
  return p;
}
const run = (f, o) => persistAssessment({ target: f.target, kind: "review", scope: "task", task: "R1", burst: "b1", ...o });

test("A1 reviewer result becomes a saved v2 task assessment with live model proof", (t) => {
  const f = fixture(t);
  const r = run(f, { result: result(f), raw: sdk(f) });
  assert.equal(r.status, "PERSISTED");
  assert.equal(r.assessment_status, "PASS");
  const a = read(artifactPath(f.dir, fs.readdirSync(path.join(f.dir, "evidence")).find((n) => n.startsWith("review-"))));
  assert.equal(a.version, 2);
  assert.deepEqual(a.task_ids, ["R1"]);
  assert.equal(a.findings[0].resolved, false);
});

test("A2 assess refuses a review of an older product, a missing snapshot, an unfinished or substituted agent, and an unknown burst", (t) => {
  const f = fixture(t);
  const stale = result(f, { snapshot: { product: "0".repeat(64), contract: contracts(f.target).digest, identity: binding(contracts(f.target)) } });
  assert.throws(() => run(f, { result: stale, raw: sdk(f) }), /changed since review: product/);
  assert.throws(() => run(f, { result: result(f, { snapshot: {} }), raw: sdk(f) }), /lacks snapshot\.product/);
  assert.throws(() => run(f, { result: result(f), raw: sdk(f, { state: "running" }) }), /substituted|runtime error/i);
  assert.throws(() => run(f, { result: result(f), raw: sdk(f, { model: "claude-haiku-5-5" }) }), /substituted|mismatch/i);
  assert.throws(() => run(f, { result: result(f), raw: sdk(f), burst: "other" }), /Cannot identify the Workflow launch/);
  assert.throws(() => run(f, { result: result(f, { status: "MAYBE" }), raw: sdk(f) }), /valid status/);
});

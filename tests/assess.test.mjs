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

import { checkpointAudit } from "../scripts/progress.mjs";
import { state } from "../scripts/state.mjs";
test("A3 mid-run milestone audit of the passed tasks resets cadence even while other tasks have no execution (live run 6e)", (t) => {
  const f = fixture(t);
  // Two tasks: R1 passed with execution; R2 not started (no execution) - the live shape.
  const b = read(path.join(f.dir, "backlog.json"));
  const base = b.items[0];
  b.items[0].status = "PASS";
  const ct = read(path.join(f.dir, "contract.json")),
    mine = ct.checks.filter((k) => k.task_id === base.id).map((k) => ({ ...structuredClone(k), id: k.id + "-r2", task_id: "R2" }));
  ct.checks.push(...mine);
  json(path.join(f.dir, "contract.json"), ct);
  b.items.push({ ...structuredClone(base), id: "R2", status: "UNVERIFIED", execution: null, requirement_refs: base.requirement_refs, check_refs: mine.map((k) => k.id) });
  json(path.join(f.dir, "backlog.json"), b);
  json(path.join(f.dir, "progress.json"), { version: 2, completed_since_audit: 2, last_audit_product: null });
  const s = read(path.join(f.dir, "current-task.json"));
  const audit = run(f, {
    kind: "audit",
    scope: "milestone",
    result: result(f),
    raw: sdkRoot(f, s),
  });
  assert.equal(audit.status, "PERSISTED");
  const p = checkpointAudit({ target: f.target });
  assert.equal(p.completed_since_audit, 0);
  assert.ok(p.last_audit_product);
});
function sdkRoot(f, s) {
  const c = contracts(f.target),
    ctx = { run_id: s.run_id, task_id: s.task_id, attempt_id: s.attempt_id, session_id: c.session.session_id };
  const es = [
    { type: "system", subtype: "init", session_id: "sdk-session", cwd: c.session.root },
    { type: "assistant", session_id: "sdk-session", message: { content: [{ type: "tool_use", name: "Workflow", id: "toolu-live", input: { args: { burst_id: "b1" } } }] } },
    { type: "system", subtype: "task_started", session_id: "sdk-session", task_id: "wtask", run_id: "0stream", tool_use_id: "toolu-live", workflow_name: "develop-mission" },
    { type: "system", subtype: "task_progress", session_id: "sdk-session", task_id: "wtask", run_id: "0stream", workflow_progress: [{ type: "workflow_agent", index: 1, label: invocationTag(c, ctx, "audit"), agentId: "a1", agentType: "autodev-opus-auditor", model: "claude-opus-5-5", state: "done", startedAt: Date.now() }] },
  ];
  const p = path.join(f.dir, "evidence", "assess-sdk-root.jsonl");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, es.map((e) => JSON.stringify(e)).join("\n"));
  return p;
}

// Regressions for record shapes observed from a real Claude Code 2.1.310 run
// (docs/evidence/live-*): native Workflow agents are reported through
// system/task_progress.workflow_progress, and a launch's runId differs from the
// SDK stream run_id. Shapes are copied from the live log, ids sanitized.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fixture,
  allPass,
  read,
  artifactPath,
  contracts,
  hash,
} from "./helpers/fixture.mjs";
import { invocationTag } from "../scripts/lib/core.mjs";
import { importRuntime } from "../scripts/import-runtime.mjs";
import { importTermination } from "../scripts/import-termination.mjs";

function liveRaw(f, agents) {
  const c = contracts(f.target),
    s = read(path.join(f.dir, "current-task.json")),
    ctx = {
      run_id: s.run_id,
      task_id: s.task_id,
      attempt_id: s.attempt_id,
      session_id: c.session.session_id,
    },
    now = Date.now();
  const es = [
    { type: "system", subtype: "init", session_id: "sdk-session", cwd: c.session.root },
    {
      type: "system",
      subtype: "task_started",
      session_id: "sdk-session",
      task_id: "wtask",
      run_id: "0mvp52mfl-638d01b3",
      tool_use_id: "toolu-live",
      workflow_name: "runtime-probe",
      task_type: "local_workflow",
      description: "Isolated native agent/model/read-only probe",
    },
    {
      type: "system",
      subtype: "task_progress",
      session_id: "sdk-session",
      task_id: "wtask",
      run_id: "0mvp52mfl-638d01b3",
      uuid: "progress-1",
      workflow_progress: agents.map(([stage, agentType, model, state], i) => ({
        type: "workflow_agent",
        index: i + 1,
        label: invocationTag(c, ctx, stage),
        agentId: "agent-" + i,
        agentType,
        model,
        state,
        startedAt: now,
      })),
    },
    {
      type: "system",
      subtype: "task_notification",
      session_id: "sdk-session",
      task_id: "wtask",
      run_id: "0mvp52mfl-638d01b3",
      status: "completed",
    },
  ];
  const raw = path.join(f.dir, "evidence", "live-shape-" + hash(JSON.stringify(es)) + ".jsonl");
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  fs.writeFileSync(raw, es.map((e) => JSON.stringify(e)).join("\n"));
  return raw;
}
const imp = (f, raw, stage, expected) =>
  importRuntime({
    target: f.target,
    task: "mission",
    stage,
    expected,
    raw,
    tool_use: "toolu-live",
    mode: "TEST_FIXTURE",
  });

test("L1 native workflow_agent progress is accepted as per-stage model evidence", (t) => {
  const f = fixture(t);
  allPass(f);
  const raw = liveRaw(f, [
    ["architecture", "autodev-opus-architect", "claude-opus-5-5", "done"],
    ["implement", "autodev-haiku-builder", "claude-haiku-5-5", "done"],
    ["review", "claude-autodev:sonnet-reviewer", "claude-sonnet-5-5", "done"],
  ]);
  for (const [stage, model] of [
    ["architecture", "claude-opus-5-5"],
    ["implement", "claude-haiku-5-5"],
    ["review", "claude-sonnet-5-5"],
  ]) {
    const r = imp(f, raw, stage, model);
    assert.equal(r.observation.observed_model, model);
    assert.equal(r.observation.evidence_kind, "workflow-agent-progress");
  }
});

test("L2 workflow_agent evidence rejects substituted model, unfinished agent, foreign stage and unknown agent type", (t) => {
  const f = fixture(t);
  allPass(f);
  const ok = ["review", "autodev-sonnet-reviewer", "claude-sonnet-5-5", "done"];
  assert.throws(
    () => imp(f, liveRaw(f, [["review", "autodev-sonnet-reviewer", "claude-haiku-5-5", "done"]]), "review", "claude-sonnet-5-5"),
    /substituted|mismatch/i,
  );
  assert.throws(
    () => imp(f, liveRaw(f, [["review", "autodev-sonnet-reviewer", "claude-sonnet-5-5", "running"]]), "review", "claude-sonnet-5-5"),
    /substituted|runtime error/i,
  );
  assert.throws(
    () => imp(f, liveRaw(f, [ok]), "verify", "claude-sonnet-5-5"),
    /evidence absent/i,
  );
  assert.throws(
    () => imp(f, liveRaw(f, [["review", "general-purpose", "claude-sonnet-5-5", "done"]]), "review", "claude-sonnet-5-5"),
    /substituted|runtime error/i,
  );
  // A second same-stage agent on another model also voids the observation.
  assert.throws(
    () => imp(f, liveRaw(f, [ok, ["review", "autodev-sonnet-reviewer", "claude-haiku-5-5", "done"]]), "review", "claude-sonnet-5-5"),
    /substituted|runtime error/i,
  );
});

test("L3 launch runId (wf_...) differs from the SDK stream run_id: termination binds to the stream id", (t) => {
  const f = fixture(t);
  allPass(f);
  const base = read(path.join(f.dir, "termination.json")),
    es = fs
      .readFileSync(artifactPath(f.dir, base.record), "utf8")
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  const launch = es.find((e) => e.type === "user");
  launch.tool_use_result.runId = "wf_02f0e124-14a";
  const idx = es.indexOf(launch);
  es.splice(idx + 1, 0, {
    type: "system",
    subtype: "task_started",
    session_id: launch.session_id,
    task_id: launch.tool_use_result.taskId,
    run_id: "0mvp52mfl-638d01b3",
    tool_use_id: "workflow-tool",
  });
  for (const e of es)
    if (e.subtype === "task_notification") e.run_id = "0mvp52mfl-638d01b3";
  const raw = path.join(f.dir, "evidence", "live-launch-" + hash(JSON.stringify(es)) + ".jsonl");
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  fs.writeFileSync(raw, es.map((e) => JSON.stringify(e)).join("\n"));
  const r = importTermination({ target: f.target, raw, tool_use: "workflow-tool", mode: "TEST_FIXTURE" });
  assert.equal(r.status, "TERMINATION_OBSERVED");
  assert.equal(read(r.file).sdk_run_id, "0mvp52mfl-638d01b3");
  // Two task_started for one launch are ambiguous and fail closed.
  es.splice(idx + 2, 0, { ...es[idx + 1], run_id: "other" });
  const dup = path.join(f.dir, "evidence", "live-dup.jsonl");
  fs.writeFileSync(dup, es.map((e) => JSON.stringify(e)).join("\n"));
  assert.throws(
    () => importTermination({ target: f.target, raw: dup, tool_use: "workflow-tool", mode: "TEST_FIXTURE" }),
    /ambiguous/i,
  );
});

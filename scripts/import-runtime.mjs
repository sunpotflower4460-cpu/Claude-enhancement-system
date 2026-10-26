import { mutex } from "./lib/core.mjs";
import { isMain } from "./lib/core.mjs";
import fs from "node:fs";
import path from "node:path";
import {
  observationContext,
  read,
  json,
  hash,
  context,
  artifactPath,
  main,
} from "./lib/core.mjs";
import {
  runtimeObservation,
  invocationWindow,
  routingProvenance,
  streamRunId,
  launchToolUse,
  newestSdk,
  condenseSdk,
} from "./lib/runtime.mjs";
import { invocationTag } from "./lib/core.mjs";
const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Live run 7: the coordinator imported a stage's model proof moments before the runtime wrote the
// agent's `done` progress record and got "Subagent evidence absent" (one extra final-audit
// NEEDS_FIX round). With o.wait seconds, re-read the live capture until the record appears.
// Only that transient absence is retried; substitution, wrong model or ambiguity fail at once.
const TRANSIENT =
  /Subagent evidence absent|Cannot identify the Workflow launch|uniquely observed SDK tool_use_id|Missing SDK assistant model observation/;
export function importRuntime(o) {
  const deadline = Date.now() + Math.max(0, Number(o.wait) || 0) * 1000;
  for (;;) {
    try {
      return mutex(o.target, () => importRuntimeUnlocked(o));
    } catch (e) {
      if (!TRANSIENT.test(e.message) || Date.now() >= deadline) throw e;
      sleep(2000);
    }
  }
}
function importRuntimeUnlocked(o) {
  const c = observationContext(o.target),
    s = read(path.join(c.dir, "current-task.json")),
    task = c.backlog.items.find((t) => t.id === o.task),
    ctx =
      o.task === "mission"
        ? {
            run_id: s.run_id,
            task_id: s.task_id,
            attempt_id: s.attempt_id,
            session_id: c.session.session_id,
          }
        : context(c, task);
  // Inside a Workflow the coordinator knows its burst, not the launch tool_use id or capture path.
  const rawPath = o.raw || newestSdk(c.dir),
    raw = condenseSdk(fs.readFileSync(rawPath)),
    events = raw
      .toString()
      .split("\n")
      .filter((x) => x.trim())
      .map(JSON.parse),
    toolUse = o.tool_use || launchToolUse(events.slice(0), o.burst),
    starts = events.filter(
      (e) =>
        e.type === "system" &&
        e.subtype === "task_started" &&
        e.tool_use_id === toolUse,
    );
  if (starts.length !== 1)
    throw Error("Specify a uniquely observed SDK tool_use_id");
  const start = starts[0],
    window = invocationWindow(events, {
      sdk_task_id: start.task_id,
      sdk_run_id: start.run_id,
      tool_use_id: toolUse,
      sdk_session_id: start.session_id,
    }),
    // Forwarded subagent messages (Agent tool) or, for native Workflows, the
    // runtime's own workflow_agent progress record carrying this stage's tag.
    msg =
      window.messages.filter((e) => e.message?.model).at(-1) ||
      (() => {
        const mine = window.agents.filter(
          (a) => a.label === invocationTag(c, ctx, o.stage) && a.message.model,
        );
        return mine.filter((a) => a.state === "done").at(-1) || mine.at(-1);
      })();
  if (!msg)
    throw Error(
      "Subagent evidence absent: no forwarded subagent messages and no workflow_agent progress carrying this stage tag (use --forward-subagent-text)",
    );
  const digest = hash(raw),
    record = "sdk-" + digest + ".jsonl",
    name =
      "runtime-" +
      hash(JSON.stringify({ ...ctx, stage: o.stage, tool_use: toolUse })) +
      ".json";
  fs.writeFileSync(artifactPath(c.dir, record), raw);
  const r = {
    version: 2,
    mode: o.mode === "TEST_FIXTURE" ? "TEST_FIXTURE" : "LIVE",
    source: "claude-sdk-jsonl",
    ...ctx,
    stage: o.stage,
    expected_model: o.expected,
    record,
    sha256: digest,
    sdk_session_id: start.session_id,
    tool_use_id: toolUse,
    message_uuid: msg.uuid,
    ...(msg.agent_type
      ? {
          evidence_kind: "workflow-agent-progress",
          agent_type: msg.agent_type,
          agent_id: msg.agent_id,
        }
      : {}),
    sdk_task_id: start.task_id,
    sdk_run_id: start.run_id,
    observed_at: new Date().toISOString(),
    provenance: routingProvenance(
      c,
      ctx,
      events.find(
        (e) =>
          e.type === "system" &&
          e.subtype === "init" &&
          e.session_id === start.session_id,
      )?.cwd,
    ),
  };
  json(artifactPath(c.dir, name), r);
  const observation = runtimeObservation(
      c,
      name,
      {},
      { fixture: o.mode === "TEST_FIXTURE" },
    ),
    p = path.join(c.dir, "routing.json"),
    routing = fs.existsSync(p) ? read(p) : [];
  if (!Array.isArray(routing))
    throw Error("Legacy/invalid routing manifest; migrate first");
  if (!routing.includes(name)) routing.push(name);
  json(p, routing);
  return {
    status: observation.mode === "LIVE" ? "OBSERVED" : "TEST_FIXTURE_OBSERVED",
    name,
    observation,
  };
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(importRuntime(o), null, 2)));

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
} from "./lib/runtime.mjs";
export function importRuntime(o) {
  return mutex(o.target, () => importRuntimeUnlocked(o));
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
  const raw = fs.readFileSync(o.raw),
    events = raw
      .toString()
      .split("\n")
      .filter((x) => x.trim())
      .map(JSON.parse),
    starts = events.filter(
      (e) =>
        e.type === "system" &&
        e.subtype === "task_started" &&
        e.tool_use_id === o.tool_use,
    );
  if (starts.length !== 1)
    throw Error("Specify a uniquely observed SDK tool_use_id");
  const start = starts[0],
    msg = invocationWindow(events, {
      sdk_task_id: start.task_id,
      sdk_run_id: start.run_id,
      tool_use_id: o.tool_use,
      sdk_session_id: start.session_id,
    })
      .messages.filter((e) => e.message?.model)
      .at(-1);
  if (!msg)
    throw Error(
      "Subagent messages absent; use --forward-subagent-text / forwardSubagentText",
    );
  const digest = hash(raw),
    record = "sdk-" + digest + ".jsonl",
    name =
      "runtime-" +
      hash(JSON.stringify({ ...ctx, stage: o.stage, tool_use: o.tool_use })) +
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
    tool_use_id: o.tool_use,
    message_uuid: msg.uuid,
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

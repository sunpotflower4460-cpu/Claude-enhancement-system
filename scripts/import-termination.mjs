import { mutex } from "./lib/core.mjs";
import { isMain } from "./lib/core.mjs";
import fs from "node:fs";
import path from "node:path";
import { load, read, json, hash, artifactPath, main } from "./lib/core.mjs";
import { terminationProof } from "./lib/recovery.mjs";
export function importTermination(o) {
  return mutex(o.target, () => importTerminationUnlocked(o));
}
function importTerminationUnlocked(o) {
  const c = load(o.target),
    s = read(path.join(c.dir, "current-task.json")),
    raw = fs.readFileSync(o.raw),
    es = raw
      .toString()
      .split("\n")
      .filter((x) => x.trim())
      .map(JSON.parse);
  const launches = es.filter(
    (e) =>
      e.type === "user" &&
      e.message?.content?.some(
        (b) => b.type === "tool_result" && b.tool_use_id === o.tool_use,
      ) &&
      e.tool_use_result?.taskId,
  );
  if (launches.length !== 1)
    throw Error("Missing/ambiguous actual Workflow launch result");
  const launch = launches[0],
    r = launch.tool_use_result,
    terminal = es
      .filter(
        (e) =>
          e.type === "system" &&
          e.subtype === "task_notification" &&
          e.session_id === launch.session_id &&
          e.task_id === r.taskId &&
          e.run_id === r.runId,
      )
      .at(-1);
  if (!terminal) throw Error("Workflow terminal notification missing");
  const record = "sdk-termination-" + hash(raw) + ".jsonl";
  fs.writeFileSync(artifactPath(c.dir, record), raw);
  const p = {
      version: 2,
      source:
        o.mode === "TEST_FIXTURE"
          ? "TEST_FIXTURE"
          : "parent-runtime-observation",
      run_id: s.run_id,
      task_id: s.task_id,
      attempt_id: s.attempt_id,
      state: terminal.status,
      observed_at: new Date().toISOString(),
      record,
      sha256: hash(raw),
      sdk_session_id: launch.session_id,
      sdk_task_id: r.taskId,
      sdk_run_id: r.runId,
      sdk_tool_use_id: o.tool_use,
    },
    file = path.join(c.dir, "termination-import.json");
  json(file, p);
  terminationProof(c.dir, file, s, { fixture: o.mode === "TEST_FIXTURE" });
  return { status: "TERMINATION_OBSERVED", file };
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(importTermination(o), null, 2)));

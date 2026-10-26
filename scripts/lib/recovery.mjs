import fs from "node:fs";
import path from "node:path";
import { read, hash, validate, artifactPath, alive } from "./core.mjs";
export function terminationProof(
  dir,
  filename,
  state,
  { fixture = false } = {},
) {
  const proof = validate("termination", read(filename));
  for (const k of ["run_id", "task_id", "attempt_id"])
    if (proof[k] !== state[k])
      throw Error("Termination context mismatch: " + k);
  if (proof.source === "TEST_FIXTURE" && !fixture)
    throw Error("TEST FIXTURE termination is not live");
  if (
    !Number.isFinite(Date.parse(proof.observed_at)) ||
    Date.parse(proof.observed_at) < Date.parse(state.run_started_at) ||
    Date.parse(proof.observed_at) > Date.now() + 60000
  )
    throw Error("Missing termination time");
  const raw = fs.readFileSync(artifactPath(dir, proof.record));
  if (hash(raw) !== proof.sha256) throw Error("Termination raw record changed");
  const session = read(path.join(dir, "session.json")),
    mission = read(path.join(dir, "mission.json"));
  const es = raw
    .toString()
    .split("\n")
    .filter((x) => x.trim())
    .map((x) => JSON.parse(x));
  const init = es.find(
    (e) =>
      e.type === "system" &&
      e.subtype === "init" &&
      e.session_id === proof.sdk_session_id,
  );
  if (!init || path.resolve(init.cwd || "") !== session.root)
    throw Error("Termination SDK cwd mismatch");
  const call = es
    .filter(
      (e) => e.type === "assistant" && e.session_id === proof.sdk_session_id,
    )
    .flatMap((e) => e.message?.content || [])
    .find(
      (b) =>
        b.type === "tool_use" &&
        b.id === proof.sdk_tool_use_id &&
        b.name === "Workflow",
    );
  const args = call?.input?.args;
  if (
    !args ||
    typeof args !== "object" ||
    args.run_id !== state.run_id ||
    args.attempt_id !== state.attempt_id ||
    args.mission_id !== mission.mission_id ||
    args.session_id !== session.session_id ||
    args.target !== session.root
  )
    throw Error("No correlated Workflow invocation for termination");
  const launched = es.find(
    (e) =>
      e.type === "user" &&
      e.session_id === proof.sdk_session_id &&
      e.tool_use_result?.taskId === proof.sdk_task_id &&
      e.tool_use_result?.runId === proof.sdk_run_id &&
      e.message?.content?.some(
        (b) =>
          b.type === "tool_result" && b.tool_use_id === proof.sdk_tool_use_id,
      ),
  );
  if (
    !launched ||
    launched.tool_use_result.error ||
    !["async_launched", "remote_launched"].includes(
      launched.tool_use_result.status,
    )
  )
    throw Error("No successful Workflow launch correlated to terminal task");
  const endedIndex = es.findIndex(
    (e) =>
      e.type === "system" &&
      e.subtype === "task_notification" &&
      e.session_id === proof.sdk_session_id &&
      e.task_id === proof.sdk_task_id &&
      e.run_id === proof.sdk_run_id &&
      e.status === proof.state,
  );
  if (endedIndex < 0) throw Error("No matching SDK terminal notification");
  const snapshots = es
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e }) =>
          e.type === "system" &&
          e.subtype === "background_tasks_changed" &&
          e.session_id === proof.sdk_session_id,
      ),
    last = snapshots.at(-1);
  if (
    !last ||
    last.i < endedIndex ||
    !Array.isArray(last.e.tasks) ||
    last.e.tasks.length
  )
    throw Error("Runtime is not observed drained after termination");
  // A previously empty snapshot cannot certify tasks started later in the same transcript.
  const pending = new Map();
  for (const e of es
    .slice(last.i + 1)
    .filter(
      (e) => e.type === "system" && e.session_id === proof.sdk_session_id,
    )) {
    if (e.subtype === "task_started")
      pending.set(e.task_id + "/" + (e.run_id || ""), e);
    if (e.subtype === "task_notification") {
      if (!["completed", "failed", "stopped"].includes(e.status))
        throw Error("Invalid SDK task terminal status");
      if (e.run_id) pending.delete(e.task_id + "/" + e.run_id);
      else {
        const keys = [...pending.keys()].filter((k) =>
          k.startsWith(e.task_id + "/"),
        );
        if (keys.length !== 1) throw Error("Ambiguous task termination");
        pending.delete(keys[0]);
      }
    }
  }
  if (pending.size)
    throw Error("Runtime has tasks started after drained snapshot");
  if (alive(state.owner) === true)
    throw Error("Previous local owner still active");
  for (const name of fs
    .readdirSync(path.join(dir, "evidence"))
    .filter((n) => n.startsWith("runner-") && n.endsWith(".json"))) {
    const r = read(artifactPath(dir, name));
    if (r.state === "running" && alive(r.owner) !== false)
      throw Error("Check process still active/unknown");
  }
  return proof;
}

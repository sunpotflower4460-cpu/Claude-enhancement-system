import fs from "node:fs";
import path from "node:path";
import {
  contracts,
  read,
  json,
  context,
  artifactPath,
  hash,
  main,
  isMain,
} from "./lib/core.mjs";
import { importRuntime } from "./import-runtime.mjs";
import { launchToolUse, newestSdk } from "./lib/runtime.mjs";
import { saveAssessment } from "./assessment.mjs";

// Live run 6e: a real coordinator refused to hand-build the v2 assessment envelope (it would
// stamp a review with fingerprints the reviewer never saw) and persisted nothing. This is the
// deterministic path: the envelope fields product/contract/identity come from the reviewer's
// own returned snapshot, so assessment.mjs still rejects any review of an older product;
// run/task/attempt/executions/requirements come from the current files; the model proof is
// imported from the live SDK stream (workflow_agent progress for this stage's tag).
const MODEL = { review: "claude-sonnet-5-5", audit: "claude-opus-5-5" };
export function persistAssessment(o) {
  const kind = o.kind,
    scope = o.scope;
  if (!MODEL[kind] || !["task", "final", "milestone"].includes(scope))
    throw Error("kind review|audit and scope task|final|milestone required");
  const c = contracts(o.target),
    result = read(o.result),
    snap = result.snapshot || {};
  for (const k of ["product", "contract", "identity"])
    if (!/^[a-f0-9]{64}$/.test(snap[k] || ""))
      throw Error(
        "Reviewer result lacks snapshot." +
          k +
          " (copy it from the inspect snapshot the reviewer was given)",
      );
  if (!["PASS", "NEEDS_FIX", "UNVERIFIED", "BLOCKED"].includes(result.status))
    throw Error("Reviewer result has no valid status");
  const raw = o.raw || newestSdk(c.dir),
    events = fs
      .readFileSync(raw, "utf8")
      .split("\n")
      .filter((x) => x.trim())
      .map(JSON.parse),
    tool_use = o.tool_use || launchToolUse(events, o.burst);
  const items = c.backlog.items,
    s = read(path.join(c.dir, "current-task.json")),
    task = scope === "task" ? items.find((t) => t.id === o.task) : null;
  if (scope === "task" && !task) throw Error("Unknown task");
  const taskIds =
      scope === "task"
        ? [task.id]
        : o.task_ids
          ? o.task_ids.split(",")
          : scope === "final"
            ? items.map((t) => t.id)
            : items.filter((t) => t.status === "PASS").map((t) => t.id),
    chosen = items.filter((t) => taskIds.includes(t.id));
  if (!taskIds.length || chosen.length !== taskIds.length)
    throw Error("No assessed tasks");
  const ctx =
    scope === "task"
      ? context(c, task)
      : {
          run_id: s.run_id,
          task_id: s.task_id,
          attempt_id: s.attempt_id,
          session_id: c.session.session_id,
        };
  const imported = importRuntime({
    target: o.target,
    task: scope === "task" ? task.id : "mission",
    stage: kind,
    expected: MODEL[kind],
    raw,
    tool_use,
  });
  const a = {
    version: 2,
    kind,
    scope,
    status: result.status,
    ...ctx,
    task_ids: taskIds,
    product: snap.product,
    contract: snap.contract,
    identity: snap.identity,
    findings: (result.findings || []).map((f) => ({
      severity: f.severity,
      message: String(f.message),
      resolved: f.resolved === true,
    })),
    requirement_refs: [...new Set(chosen.flatMap((t) => t.requirement_refs))],
    runtime_ref: imported.name,
    executions: chosen
      .filter((t) => t.execution)
      .map((t) => ({
        task_id: t.id,
        run_id: t.execution.run_id,
        attempt_id: t.execution.attempt_id,
      })),
  };
  if (!a.executions.length) throw Error("Assessed tasks have no execution");
  const input = artifactPath(
    c.dir,
    "assess-input-" + hash(JSON.stringify(a)).slice(0, 16) + ".json",
  );
  json(input, a);
  const saved = saveAssessment({
    target: o.target,
    input,
    kind,
    scope,
    task: task?.id,
    runtime: imported.name,
  });
  return {
    status: "PERSISTED",
    assessment_status: saved.status,
    runtime_ref: imported.name,
  };
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(persistAssessment(o), null, 2)));

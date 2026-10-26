import { isMain } from "./lib/core.mjs";
import fs from "node:fs";
import path from "node:path";
import {
  load,
  read,
  json,
  validate,
  mutex,
  fingerprint,
  hash,
  artifactPath,
  main,
} from "./lib/core.mjs";
const external = new Set([
  "environment",
  "model_limit",
  "permission",
  "terminated",
  "evidence",
]);
function journal(c) {
  const p = path.join(c.dir, "failure.json");
  const data = fs.existsSync(p)
    ? validate("failure", read(p))
    : { version: 2, mission_id: c.mission.mission_id, events: [] };
  if (data.mission_id !== c.mission.mission_id)
    throw Error("Failure journal mission mismatch");
  if (new Set(data.events.map((e) => e.id)).size !== data.events.length)
    throw Error("Duplicate failure event");
  return data;
}
export function failureSummary(target, taskId) {
  const c = load(target),
    ledger = journal(c),
    items = validate("backlog", read(path.join(c.dir, "backlog.json"))).items;
  const result = {};
  for (const t of items.filter((t) => !taskId || t.id === taskId)) {
    const selected = ledger.events.filter((e) => e.task_id === t.id),
      failures = selected.filter((e) => e.kind === "failure"),
      codeFailures = failures.filter((e) => !external.has(e.category)),
      lastCodeFailure = codeFailures.at(-1),
      last = selected.at(-1),
      count = failures.length,
      lastFailure = failures.at(-1),
      lastStrategy = selected.findLast((e) => e.kind === "strategy"),
      lastReplan = selected.findLast(
        (e) =>
          e.kind === "strategy" &&
          e.model === "claude-opus-5-5" &&
          codeFailures.some((f) => selected.indexOf(f) < selected.indexOf(e)),
      ),
      repairAttempt = lastReplan
        ? 2 +
          codeFailures.filter(
            (e) => selected.indexOf(e) > selected.indexOf(lastReplan),
          ).length
        : codeFailures.length,
      afterStrategy = lastStrategy
        ? codeFailures.filter(
            (e) => selected.indexOf(e) > selected.indexOf(lastStrategy),
          ).length
        : codeFailures.length;
    const designPending =
      lastCodeFailure?.category === "design" &&
      (!lastReplan ||
        selected.indexOf(lastReplan) < selected.indexOf(lastCodeFailure));
    const externalPending =
      lastFailure &&
      external.has(lastFailure.category) &&
      (!lastStrategy ||
        selected.indexOf(lastStrategy) < selected.indexOf(lastFailure));
    result[t.id] = {
      failures: count,
      repair_attempt: repairAttempt,
      next_model: repairAttempt >= 2 ? "claude-sonnet-5-5" : "claude-haiku-5-5",
      next_action: externalPending
        ? "DEFER"
        : designPending || repairAttempt >= 4
          ? "REPLAN"
          : repairAttempt >= 2 && (!lastStrategy || afterStrategy >= 2)
            ? "DIAGNOSE"
            : "IMPLEMENT",
      blocker: externalPending
        ? { category: lastFailure.category, next_step: lastFailure.next_step }
        : null,
      last_strategy: lastStrategy
        ? {
            hypothesis: lastStrategy.hypothesis,
            experiment: lastStrategy.experiment,
            next_step: lastStrategy.next_step,
            model: lastStrategy.model,
          }
        : null,
      recent: selected.slice(-2).map((e) => ({
        id: e.id,
        kind: e.kind,
        category: e.category,
        summary: e.summary,
        hypothesis: e.hypothesis,
        experiment: e.experiment,
        next_step: e.next_step,
        model: e.model,
        evidence_refs: e.evidence_refs,
      })),
      last_event_id: last?.id || null,
    };
  }
  if (taskId && !items.some((t) => t.id === taskId))
    throw Error("Unknown failure task");
  return taskId ? result[taskId] : result;
}
export function failureAction(o) {
  // Live run 5: the planner called `failure.mjs --target T` without --action and got a
  // misleading "ownership mismatch". Name the missing argument instead.
  if (!["summary", "record", "strategy"].includes(o.action))
    throw Error(
      "failure.mjs requires --action summary|record|strategy (read-only: --action summary --target TARGET)",
    );
  if (o.action === "summary")
    return {
      status: "OBSERVED",
      failure_state: failureSummary(o.target, o.task),
    };
  const c = load(o.target);
  return mutex(o.target, () => {
    const s = validate(
      "current-task",
      read(path.join(c.dir, "current-task.json")),
    );
    if (!s.active || s.run_id !== o.run || s.attempt_id !== o.attempt)
      throw Error("Failure journal ownership mismatch");
    const task = validate(
      "backlog",
      read(path.join(c.dir, "backlog.json")),
    ).items.find((t) => t.id === o.task);
    if (!task?.execution)
      throw Error("Failure journal task execution required");
    if (!o.id || !o.input) throw Error("Failure event id/input required");
    const data = journal(c),
      input = read(o.input),
      kind =
        o.action === "record"
          ? "failure"
          : o.action === "strategy"
            ? "strategy"
            : null;
    if (!kind) throw Error("Unknown failure action");
    const exists = data.events.find((e) => e.id === o.id);
    if (exists) {
      const expected = {
        task_id: task.id,
        execution_run_id: task.execution.run_id,
        execution_attempt_id: task.execution.attempt_id,
        kind,
      };
      if (
        Object.entries(expected).some(([k, v]) => exists[k] !== v) ||
        [
          "hypothesis",
          "experiment",
          "next_step",
          "model",
          ...(kind === "failure"
            ? ["stage", "category", "status", "summary"]
            : []),
        ].some((k) => input[k] !== exists[k]) ||
        JSON.stringify(input.evidence_refs || []) !==
          JSON.stringify(exists.evidence_refs)
      )
        throw Error("Failure event id reused for different outcome");
      return {
        status: "ALREADY_RECORDED",
        summary: failureSummary(o.target, task.id),
      };
    }
    if (
      kind === "failure" &&
      (!["NEEDS_FIX", "BLOCKED", "UNVERIFIED"].includes(input.status) ||
        input.category === undefined)
    )
      throw Error("Actual non-PASS failure classification required");
    if (kind === "strategy") {
      if (
        !data.events.some((e) => e.task_id === task.id && e.kind === "failure")
      )
        throw Error("Diagnosis requires retained task failure");
      if (!["claude-sonnet-5-5", "claude-opus-5-5"].includes(input.model))
        throw Error("Diagnosis/replan requires elevated model");
      const old = data.events.filter(
        (e) => e.task_id === task.id && e.kind === "strategy",
      );
      if (
        old.some(
          (e) =>
            e.hypothesis === input.hypothesis &&
            e.experiment === input.experiment &&
            JSON.stringify(e.evidence_refs) ===
              JSON.stringify(input.evidence_refs || []),
        )
      )
        throw Error(
          "Repeated strategy requires a new hypothesis or experiment",
        );
    }
    const refs = (input.evidence_refs || []).map((ref) => {
      const bytes = fs.readFileSync(artifactPath(c.dir, ref.name));
      if (hash(bytes) !== ref.sha256)
        throw Error("Failure evidence reference changed");
      return ref;
    });
    data.events.push({
      id: o.id,
      kind,
      task_id: task.id,
      execution_run_id: task.execution.run_id,
      execution_attempt_id: task.execution.attempt_id,
      run_id: s.run_id,
      attempt_id: s.attempt_id,
      session_id: c.session.session_id,
      at: new Date().toISOString(),
      product: fingerprint(o.target),
      stage:
        kind === "strategy"
          ? input.model === "claude-opus-5-5"
            ? "replan"
            : "diagnosis"
          : input.stage,
      category: kind === "strategy" ? "repeated_fix" : input.category,
      status: kind === "strategy" ? "PASS" : input.status,
      model: input.model,
      summary:
        input.summary ||
        "New diagnosis and experiment recorded; this is not product acceptance",
      hypothesis: input.hypothesis,
      experiment: input.experiment,
      next_step: input.next_step,
      evidence_refs: refs,
    });
    json(path.join(c.dir, "failure.json"), validate("failure", data));
    return { status: "RECORDED", summary: failureSummary(o.target, task.id) };
  });
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(failureAction(o), null, 2)));

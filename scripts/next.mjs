import { isMain } from "./lib/core.mjs";
import fs from "node:fs";
import path from "node:path";
import {
  observationContext,
  read,
  validate,
  fingerprint,
  main,
} from "./lib/core.mjs";
import { readonlyResume } from "./lib/interruption.mjs";
function receipts(c) {
  const dir = path.join(c.dir, "operations");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      try {
        return read(path.join(dir, n));
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.state === "completed");
}
// Operation ids are encodeURIComponent parts joined by "|":
// root run | task | execution attempt | action | phase.
function implementedNotReviewed(c, task) {
  const part = (action) =>
      "|" +
      encodeURIComponent(task.id) +
      "|" +
      encodeURIComponent(task.execution.attempt_id) +
      "|" +
      action +
      "|",
    all = receipts(c).filter((r) => r.task_id === task.id);
  const impl = all.filter(
      (r) => r.stage === "IMPLEMENT" && r.operation_id?.includes(part("implement")),
    ),
    reviewed = all.some(
      (r) => r.stage === "REVIEW" && r.operation_id?.includes(part("review")),
    );
  return !reviewed && impl.length
    ? impl.sort((a, b) => (a.updated_at || "").localeCompare(b.updated_at || "")).at(-1)
    : null;
}
export function nextAction(o) {
  const c = observationContext(o.target),
    s = validate("current-task", read(path.join(c.dir, "current-task.json"))),
    blocked = c.backlog.items
      .filter((t) => t.status === "BLOCKED")
      .map((t) => t.id),
    pending = c.backlog.items.filter(
      (t) => t.status !== "PASS" && t.status !== "BLOCKED",
    ),
    ready = pending.find((t) =>
      t.dependencies.every(
        (id) => c.backlog.items.find((x) => x.id === id).status === "PASS",
      ),
    );
  // Live run 5: the planner called next.mjs without --run and was told "Active/unknown owner".
  if (s.active && !o.run)
    return {
      action: "MISSING_ARGUMENT",
      reason: "--run RUN is required (pass the run_id from AUTODEV_REQUEST)",
    };
  if (s.active && o.run !== s.run_id)
    return {
      action: "WAIT_OR_RECOVER",
      reason: "Active/unknown owner",
      run_id: s.run_id,
      attempt_id: s.attempt_id,
    };
  if (!c.contract)
    return {
      action: "ARCHITECTURE",
      reason: "Initial Opus planning and complete task/check contract required",
    };
  const p = path.join(c.dir, "resume.json");
  if (fs.existsSync(p)) {
    const r = read(p);
    if (r.recovery_kind === "READONLY") {
      const retained = readonlyResume(c);
      return {
        action: "RESUME",
        resume: {
          stage: retained.stage,
          task_id: retained.task_id,
          operation_id: retained.operation_id,
          recovery_kind: "READONLY",
          receipt_state: retained.basis === "SNAPSHOT" ? "absent" : "completed",
          basis: retained.basis,
          observe_required: true,
          changed: retained.changed,
          inspection_fingerprint: retained.inspection_fingerprint,
          reason: retained.reason,
        },
      };
    }
    return {
      action: "RESUME",
      resume: {
        stage:
          r.action === "VERIFY" && r.product !== fingerprint(o.target)
            ? "REVIEW"
            : r.action,
        task_id: r.task_id,
        operation_id: r.operation_id,
        observe_required: true,
        changed: r.product !== fingerprint(o.target),
      },
    };
  }
  const current = c.backlog.items.find((t) => t.id === s.sprint_task_id),
    changed = s.fingerprint !== null && s.fingerprint !== fingerprint(o.target);
  if (current && current.status !== "PASS") {
    if (s.stage === "IMPLEMENT" && changed)
      return {
        action: "RESUME",
        resume: {
          stage: "REVIEW",
          task_id: current.id,
          observe_required: true,
          changed,
        },
      };
    if (["REVIEW", "VERIFY"].includes(s.stage))
      return {
        action: "RESUME",
        resume: {
          stage: s.stage === "VERIFY" && changed ? "REVIEW" : s.stage,
          task_id: current.id,
          observe_required: false,
          changed,
        },
      };
  }
  // Live run 6: every new root attempt (state begin) clears current-task.sprint_task_id, so a
  // task already implemented in an earlier burst was offered as a fresh SPRINT and its review
  // never happened. A selected execution with a completed IMPLEMENT receipt and no completed
  // REVIEW receipt for that execution resumes at REVIEW instead of re-implementing.
  const retained = pending.find(
    (t) =>
      t.execution &&
      t.dependencies.every(
        (id) => c.backlog.items.find((x) => x.id === id).status === "PASS",
      ) &&
      implementedNotReviewed(c, t),
  );
  if (retained) {
    const rec = implementedNotReviewed(c, retained);
    return {
      action: "RESUME",
      resume: {
        stage: "REVIEW",
        task_id: retained.id,
        operation_id: rec.operation_id,
        recovery_kind: "RETAINED_IMPLEMENTATION",
        observe_required: true,
        changed: rec.after?.fingerprint
          ? rec.after.fingerprint !== fingerprint(o.target)
          : true,
      },
    };
  }
  if (ready) return { action: "SPRINT", task_id: ready.id, blocked };
  if (pending.length || blocked.length)
    return {
      action: "BLOCKED",
      blocked,
      pending: pending.map((t) => t.id),
      reason: "No dependency-ready independent task",
    };
  return { action: "FINAL_REVIEW_AND_AUDIT", blocked };
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(nextAction(o), null, 2)));

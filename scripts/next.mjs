import fs from "node:fs";
import path from "node:path";
import { contracts, read, validate, fingerprint, main } from "./lib/core.mjs";
export function nextAction(o) {
  const c = contracts(o.target),
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
  if (s.active && o.run !== s.run_id)
    return {
      action: "WAIT_OR_RECOVER",
      reason: "Active/unknown owner",
      run_id: s.run_id,
      attempt_id: s.attempt_id,
    };
  const p = path.join(c.dir, "resume.json");
  if (fs.existsSync(p)) {
    const r = read(p);
    return {
      action: "RESUME",
      resume: {
        stage: r.action,
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
          stage: s.stage,
          task_id: current.id,
          observe_required: false,
          changed,
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
if (process.argv[1] === new URL(import.meta.url).pathname)
  main((o) => console.log(JSON.stringify(nextAction(o), null, 2)));

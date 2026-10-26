import { isMain } from "./lib/core.mjs";
import path from "node:path";
import {
  contracts,
  read,
  json,
  main,
  mutex,
  validate,
  fingerprint,
} from "./lib/core.mjs";
import { assessment } from "./verify.mjs";
export function checkpointAudit(o) {
  return mutex(o.target, () => {
    const c = contracts(o.target),
      s = read(path.join(c.dir, "current-task.json")),
      ctx = {
        run_id: s.run_id,
        task_id: s.task_id,
        attempt_id: s.attempt_id,
        session_id: c.session.session_id,
      },
      // Live run 6e: a mid-run milestone audit can only cover tasks that have an execution, but
      // this demanded every backlog task, so cadence could never reset before the last task
      // started. Accept an explicit list or the audit of the tasks passed so far; keep the
      // whole-backlog audit as the fallback.
      ids = c.backlog.items.map((t) => t.id),
      passed = c.backlog.items
        .filter((t) => t.status === "PASS")
        .map((t) => t.id),
      candidates = o.task_ids
        ? [o.task_ids.split(",")]
        : [passed, ids].filter((x) => x.length),
      attempt = (taskIds) =>
        assessment(
          c,
          "audit",
          "milestone",
          taskIds,
          ctx,
          fingerprint(o.target),
          {
            fixture: o.fixture === true || o.fixture === "true",
          },
        );
    let a, firstError;
    for (const taskIds of candidates) {
      try {
        a = attempt(taskIds);
        break;
      } catch (e) {
        firstError ||= e;
      }
    }
    if (!a) throw firstError || Error("Milestone audit not performed");
    if (!["PASS", "NEEDS_FIX"].includes(a.status))
      throw Error("Milestone audit not performed");
    const p = path.join(c.dir, "progress.json"),
      progress = read(p);
    progress.completed_since_audit = 0;
    progress.last_audit_product = fingerprint(o.target);
    json(p, progress);
    return progress;
  });
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(checkpointAudit(o), null, 2)));

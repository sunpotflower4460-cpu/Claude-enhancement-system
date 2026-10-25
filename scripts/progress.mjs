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
      a = assessment(
        c,
        "audit",
        "milestone",
        c.backlog.items.map((t) => t.id),
        ctx,
        fingerprint(o.target),
        { fixture: o.fixture === true || o.fixture === "true" },
      );
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
if (process.argv[1] === new URL(import.meta.url).pathname)
  main((o) => console.log(JSON.stringify(checkpointAudit(o), null, 2)));

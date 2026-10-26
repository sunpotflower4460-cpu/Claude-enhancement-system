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
  main,
} from "./lib/core.mjs";
export function operation(o) {
  const c = load(o.target);
  return mutex(o.target, () => {
    const s = validate(
      "current-task",
      read(path.join(c.dir, "current-task.json")),
    );
    if (!s.active || s.run_id !== o.run || s.attempt_id !== o.attempt)
      throw Error("Operation ownership mismatch");
    if (!o.task || !o.id) throw Error("operation id and task required");
    if (
      o.task !== "mission" &&
      !read(path.join(c.dir, "backlog.json")).items.some((t) => t.id === o.task)
    )
      throw Error("Unknown operation task");
    const p = path.join(c.dir, "operations", hash(o.id) + ".json"),
      fp = fingerprint(o.target),
      existing = fs.existsSync(p) ? validate("operation", read(p)) : null;
    if (o.action === "observe") {
      if (!existing || existing.state !== "interrupted" || !o.result)
        throw Error(
          "Observe requires interrupted receipt and inspection result",
        );
      const observation = read(o.result);
      if (
        observation.observed_fingerprint !== fp ||
        typeof observation.reason !== "string" ||
        !observation.reason
      )
        throw Error("Inspection must bind actual current product");
      existing.state = "observed";
      existing.result = {
        ...existing.result,
        observation,
        observed_by_run: o.run,
        observed_by_attempt: o.attempt,
      };
      existing.updated_at = new Date().toISOString();
      json(p, existing);
      const rp = path.join(c.dir, "resume.json");
      if (fs.existsSync(rp) && read(rp).operation_id === existing.operation_id)
        fs.unlinkSync(rp);
      return { status: "OBSERVED", operation: existing };
    }
    if (existing) {
      if (
        existing.run_id !== o.run ||
        existing.task_id !== o.task ||
        existing.attempt_id !== o.attempt ||
        existing.session_id !== c.session.session_id
      )
        throw Error("Operation belongs to another attempt/binding");
    }
    if (o.action === "start") {
      if (!existing) {
        for (const file of fs.readdirSync(path.join(c.dir, "operations"))) {
          const prior = validate(
            "operation",
            read(path.join(c.dir, "operations", file)),
          );
          if (prior.state === "started")
            throw Error(
              "Pending operation must be observed/reconciled before another writer",
            );
          if (
            prior.state === "interrupted" &&
            prior.task_id === o.task &&
            o.stage === "IMPLEMENT"
          )
            throw Error(
              "Interrupted partial edits require observation/review before implementation",
            );
        }
      }
      if (existing)
        return {
          status:
            existing.state === "completed" && existing.after === fp
              ? "ALREADY_APPLIED"
              : "OBSERVE_REQUIRED",
          resume:
            existing.stage === "IMPLEMENT" && existing.before !== fp
              ? "REVIEW"
              : existing.stage,
          operation: existing,
        };
      const op = validate("operation", {
        version: 2,
        operation_id: o.id,
        run_id: o.run,
        task_id: o.task,
        attempt_id: o.attempt,
        session_id: c.session.session_id,
        stage: o.stage,
        state: "started",
        before: fp,
        after: null,
        result: null,
        updated_at: new Date().toISOString(),
      });
      json(p, op);
      return { status: "STARTED", operation: op };
    }
    if (o.action === "complete") {
      if (!existing || existing.state !== "started")
        throw Error("No started operation");
      existing.state = "completed";
      existing.after = fp;
      existing.result = o.result ? JSON.parse(fs.readFileSync(o.result)) : null;
      existing.updated_at = new Date().toISOString();
      json(p, existing);
      return { status: "RECORDED", operation: existing };
    }
    throw Error("Unknown operation action");
  });
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(operation(o), null, 2)));

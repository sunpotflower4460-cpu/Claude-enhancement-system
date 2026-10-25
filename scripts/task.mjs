import path from "node:path";
import crypto from "node:crypto";
import { contracts, json, read, validate, mutex, main } from "./lib/core.mjs";
import { taskGate } from "./verify.mjs";
export function taskAction(o) {
  return mutex(o.target, () => {
    const c = contracts(o.target),
      task = c.backlog.items.find((t) => t.id === o.task),
      s = validate("current-task", read(path.join(c.dir, "current-task.json")));
    if (!task) throw Error("Unknown task");
    if (!s.active || s.run_id !== o.run || s.attempt_id !== o.attempt)
      throw Error("Task owner mismatch");
    if (o.action === "select") {
      if (
        task.dependencies.some(
          (id) => c.backlog.items.find((t) => t.id === id).status !== "PASS",
        )
      )
        throw Error("Unfinished dependency");
      if (task.status === "PASS") return { status: "ALREADY_COMPLETED", task };
      if (!task.execution || task.execution.run_id !== o.run || o.task_attempt)
        task.execution = {
          run_id: o.run,
          attempt_id: o.task_attempt || o.attempt,
          started_at: new Date().toISOString(),
        };
      task.status = "UNVERIFIED";
      s.sprint_task_id = task.id;
    } else if (o.action === "reset") {
      task.status = "UNVERIFIED";
      task.execution = {
        run_id: o.run,
        attempt_id: o.attempt + ":" + crypto.randomUUID(),
        started_at: new Date().toISOString(),
      };
      s.sprint_task_id = task.id;
    } else if (o.action === "complete") {
      const gate = taskGate(c, task, {
        fixture: o.fixture === true || o.fixture === "true",
        ignoreDeclared: true,
      });
      if (gate.status !== "PASS") return { status: "UNVERIFIED", gate };
      if (task.status !== "PASS") {
        const pp = path.join(c.dir, "progress.json"),
          progress = validate("progress", read(pp));
        progress.completed_since_audit++;
        json(pp, progress);
      }
      task.status = "PASS";
    } else if (o.action === "block" || o.action === "fail")
      task.status = o.action === "block" ? "BLOCKED" : "FAIL";
    else throw Error("Unknown task action");
    json(path.join(c.dir, "backlog.json"), c.backlog);
    json(path.join(c.dir, "current-task.json"), s);
    return { status: task.status, task };
  });
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  main((o) => console.log(JSON.stringify(taskAction(o), null, 2)));

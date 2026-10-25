import { isMain } from "./lib/core.mjs";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { contracts, json, read, validate, mutex, main } from "./lib/core.mjs";
import { readonlyResume } from "./lib/interruption.mjs";
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
      const resume = o.resume === true || o.resume === "true";
      const retained = resume ? readonlyResume(c) : null;
      if (retained) {
        if (retained.task_id !== task.id)
          throw Error("Readonly resume belongs to another task");
        if (
          o.observed_fingerprint !== retained.inspection_fingerprint ||
          typeof o.reason !== "string" ||
          !o.reason.trim()
        )
          throw Error(
            "Readonly resume requires current inspection: --observed_fingerprint and --reason",
          );
        json(path.join(c.dir, "resume.json"), {
          ...retained,
          action: retained.stage,
          observed_by: {
            run_id: o.run,
            attempt_id: o.attempt,
            product: retained.inspection_fingerprint,
            reason: o.reason,
          },
        });
      }
      if (
        resume &&
        !retained &&
        (!task.execution ||
          !fs.readdirSync(path.join(c.dir, "operations")).some((n) => {
            const op = validate(
              "operation",
              read(path.join(c.dir, "operations", n)),
            );
            return (
              op.task_id === task.id &&
              ["interrupted", "observed"].includes(op.state)
            );
          }))
      )
        throw Error(
          "Resume requires selected execution and retained interrupted/observed receipt",
        );
      if (
        !resume &&
        (!task.execution || task.execution.run_id !== o.run || o.task_attempt)
      )
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
    if (["complete", "reset"].includes(o.action)) {
      const resumeFile = path.join(c.dir, "resume.json");
      if (fs.existsSync(resumeFile) && read(resumeFile).task_id === task.id)
        fs.unlinkSync(resumeFile);
    }
    json(path.join(c.dir, "backlog.json"), c.backlog);
    json(path.join(c.dir, "current-task.json"), s);
    return { status: task.status, task };
  });
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(taskAction(o), null, 2)));

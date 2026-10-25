import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  load,
  validate,
  read,
  json,
  mutex,
  fingerprint,
  main,
  owner,
  artifactPath,
  alive,
} from "./lib/core.mjs";
import { terminationProof } from "./lib/recovery.mjs";
const next = {
  IDLE: ["ARCHITECTURE", "PLAN"],
  ARCHITECTURE: ["PLAN"],
  PLAN: ["IMPLEMENT", "AUDIT"],
  IMPLEMENT: ["REVIEW", "AUDIT"],
  REVIEW: ["VERIFY", "IMPLEMENT", "AUDIT"],
  VERIFY: ["IMPLEMENT", "PLAN", "AUDIT"],
  AUDIT: ["PLAN", "IDLE"],
  BLOCKED: ["PLAN", "REVIEW", "VERIFY", "AUDIT"],
};
export function state(o) {
  const { dir } = load(o.target);
  return mutex(o.target, () => {
    const p = path.join(dir, "current-task.json"),
      s = validate("current-task", read(p)),
      fp = fingerprint(o.target);
    if (o.action === "begin") {
      if (s.active)
        throw Error("Active/unknown workflow; inspect runtime before recovery");
      if (!o.run || !o.task || !o.attempt)
        throw Error("run/task/attempt required");
      if (
        s.attempt_history.some(
          (x) => x.run_id === o.run && x.attempt_id === o.attempt,
        )
      )
        throw Error(
          "Attempt already used; inspect operations instead of replaying",
        );
      s.attempt_history.push({
        run_id: o.run,
        task_id: o.task,
        attempt_id: o.attempt,
      });
      s.run_started_at = new Date().toISOString();
      s.active = true;
      s.run_id = o.run;
      s.task_id = o.task;
      s.attempt_id = o.attempt;
      s.attempt++;
      s.owner = o.pid ? owner(Number(o.pid)) : null;
    } else if (o.action === "recover" || o.action === "end") {
      if (!s.active || !o.proof) throw Error("Termination proof required");
      const proof = terminationProof(dir, o.proof, s, {
        fixture: o.fixture === true || o.fixture === "true",
      });
      json(path.join(dir, "termination.json"), proof);
      if (
        o.action === "end" &&
        (s.stage !== "IDLE" || proof.state !== "completed")
      )
        throw Error("End requires IDLE and completed workflow");
      s.active = false;
      s.owner = null;
      if (o.action === "recover") {
        s.stage = "BLOCKED";
        for (const file of fs.readdirSync(path.join(dir, "operations"))) {
          const p = path.join(dir, "operations", file),
            op = validate("operation", read(p));
          if (op.state === "started") {
            const resume =
              op.stage === "IMPLEMENT" && op.before !== fp
                ? "REVIEW"
                : op.stage;
            op.state = "interrupted";
            op.after = fp;
            op.result = {
              status: "UNVERIFIED",
              reason:
                "Runtime terminal proof confirms interruption; original effects retained",
              resume,
              termination_sha256: proof.sha256,
            };
            op.updated_at = new Date().toISOString();
            json(p, op);
            if (op.task_id !== "mission")
              json(path.join(dir, "resume.json"), {
                operation_id: op.operation_id,
                task_id: op.task_id,
                action: resume,
                product: fp,
                reason:
                  "Observe interrupted operation before new implementation",
              });
          }
        }
        for (const name of fs
          .readdirSync(path.join(dir, "evidence"))
          .filter((n) => n.startsWith("runner-") && n.endsWith(".json"))) {
          const r = read(artifactPath(dir, name));
          if (r.state === "running" && alive(r.owner) === false)
            json(artifactPath(dir, name), {
              ...r,
              state: "stopped",
              recovered: true,
            });
        }
      }
    } else {
      if (
        !s.active ||
        s.run_id !== o.run ||
        s.task_id !== o.task ||
        s.attempt_id !== o.attempt
      )
        throw Error("Run/task/attempt ownership mismatch");
      if (o.action === "transition") {
        if (!next[s.stage].includes(o.stage))
          throw Error("Invalid state transition");
        s.stage = o.stage;
      } else if (o.action === "fail") {
        s.stage = "BLOCKED";
        s.failures++;
      } else throw Error("Unknown action");
    }
    const changed = s.fingerprint !== null && s.fingerprint !== fp;
    s.fingerprint = fp;
    s.history.push({
      stage: s.stage,
      at: new Date().toISOString(),
      fingerprint: fp,
      note:
        (o.note || o.action) +
        (changed
          ? " Product changed; observe partial edits."
          : " Product unchanged."),
    });
    json(p, validate("current-task", s));
    fs.writeFileSync(
      path.join(dir, "handoff.md"),
      `# Handoff\nStage: ${s.stage}\nRun/task/attempt: ${s.run_id}/${s.task_id}/${s.attempt_id}\nActive: ${s.active}\nFailures: ${s.failures}\n${s.history.at(-1).note}\nNext: inspect operations and resume recommendation; never blindly repeat writes.\n`,
    );
    return s;
  });
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  main((o) => console.log(JSON.stringify(state(o), null, 2)));

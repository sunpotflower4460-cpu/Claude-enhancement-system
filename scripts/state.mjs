import { isMain } from "./lib/core.mjs";
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
import { reconcileInterrupted } from "./lib/interruption.mjs";
import { burstStatus } from "./burst.mjs";
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
    } else if (
      o.action === "recover" ||
      o.action === "end" ||
      o.action === "pause"
    ) {
      if (!s.active || !o.proof) throw Error("Termination proof required");
      if (
        o.action !== "recover" &&
        burstStatus({ dir, mission: load(o.target).mission }).active
      )
        throw Error(
          "Finish current burst with correlated terminal/drained proof before pause/end",
        );
      const proof = terminationProof(dir, o.proof, s, {
        fixture: o.fixture === true || o.fixture === "true",
      });
      json(path.join(dir, "termination.json"), proof);
      if (
        o.action === "end" &&
        (s.stage !== "IDLE" || proof.state !== "completed")
      )
        throw Error("End requires IDLE and completed workflow");
      if (o.action === "pause" && proof.state !== "completed")
        throw Error("Pause requires a completed and drained burst");
      const unfinished = fs
        .readdirSync(path.join(dir, "operations"))
        .some(
          (n) =>
            validate("operation", read(path.join(dir, "operations", n)))
              .state === "started",
        );
      if (o.action === "end" && unfinished)
        throw Error(
          "Unfinished operation; use pause/recover and inspect partial effects before ending",
        );
      if (o.action === "pause") {
        reconcileInterrupted(dir, fp, proof);
        if (unfinished) s.stage = "BLOCKED";
      }
      s.active = false;
      s.owner = null;
      if (o.action === "recover") {
        s.stage = fs.existsSync(path.join(dir, "contract.json"))
          ? "BLOCKED"
          : "IDLE";
        reconcileInterrupted(dir, fp, proof);
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
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(state(o), null, 2)));

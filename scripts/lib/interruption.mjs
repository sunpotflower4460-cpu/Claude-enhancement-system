import fs from "node:fs";
import path from "node:path";
import {
  read,
  json,
  validate,
  artifactPath,
  alive,
  hash,
  fingerprint,
} from "./core.mjs";

// Called only after an actual terminal/drained proof has been checked by the caller.
// Keep receipts in the active journal so a fresh binding cannot bypass partial effects.
export function reconcileInterrupted(dir, product, proof) {
  const root = validate(
      "current-task",
      read(path.join(dir, "current-task.json")),
    ),
    records = fs.readdirSync(path.join(dir, "operations")).map((file) => ({
      file,
      op: validate("operation", read(path.join(dir, "operations", file))),
    })),
    pendingTaskWriter = records.some(
      ({ op }) => op.task_id === root.sprint_task_id && op.state === "started",
    );
  for (const file of fs.readdirSync(path.join(dir, "operations"))) {
    const filename = path.join(dir, "operations", file),
      op = validate("operation", read(filename));
    if (op.state !== "started") continue;
    const stage =
      op.stage === "IMPLEMENT" && op.before !== product ? "REVIEW" : op.stage;
    op.state = "interrupted";
    op.after = product;
    op.result = {
      status: "UNVERIFIED",
      reason:
        "Runtime terminal proof confirms interruption; original effects retained",
      resume: stage,
      termination_sha256: proof.sha256,
    };
    op.updated_at = new Date().toISOString();
    json(filename, op);
    if (op.task_id !== "mission")
      json(path.join(dir, "resume.json"), {
        operation_id: op.operation_id,
        task_id: op.task_id,
        action: stage,
        product,
        reason: "Observe interrupted operation before new implementation",
      });
  }
  // Native reviewers have no writer tools and therefore cannot create a
  // started operation. Preserve their continuation from the completed builder
  // receipt instead of inventing an interrupted review writer.
  if (
    !pendingTaskWriter &&
    ["IMPLEMENT", "REVIEW", "VERIFY"].includes(root.stage) &&
    root.sprint_task_id
  ) {
    const task = read(path.join(dir, "backlog.json")).items.find(
        (t) => t.id === root.sprint_task_id,
      ),
      latest = records
        .filter(
          ({ op }) =>
            op.task_id === root.sprint_task_id &&
            op.stage === "IMPLEMENT" &&
            op.state === "completed" &&
            op.result?.status === "PASS",
        )
        .sort(
          (a, b) =>
            a.op.updated_at.localeCompare(b.op.updated_at) ||
            a.file.localeCompare(b.file),
        )
        .at(-1);
    if (
      task?.execution &&
      task.status !== "PASS" &&
      (latest || ["REVIEW", "VERIFY"].includes(root.stage))
    ) {
      const proofName =
        "readonly-resume-proof-" + hash(JSON.stringify(proof)) + ".json";
      json(artifactPath(dir, proofName), proof);
      const stateName =
        "readonly-resume-state-" + hash(JSON.stringify(root)) + ".json";
      json(artifactPath(dir, stateName), root);
      json(path.join(dir, "resume.json"), {
        version: 2,
        recovery_kind: "READONLY",
        mission_id: read(path.join(dir, "mission.json")).mission_id,
        basis: latest ? "IMPLEMENTATION_RECEIPT" : "SNAPSHOT",
        operation_id: latest?.op.operation_id || null,
        task_id: task.id,
        action:
          root.stage === "IMPLEMENT" ||
          (root.stage === "VERIFY" &&
            (latest?.op.after || root.fingerprint) !== product)
            ? "REVIEW"
            : root.stage,
        product,
        execution: task.execution,
        implementation_ref: latest?.file || null,
        implementation_sha256: latest
          ? hash(fs.readFileSync(path.join(dir, "operations", latest.file)))
          : null,
        stopped_state_ref: stateName,
        stopped_state_sha256: hash(
          fs.readFileSync(artifactPath(dir, stateName)),
        ),
        proof_ref: proofName,
        proof_sha256: hash(fs.readFileSync(artifactPath(dir, proofName))),
        stopped_root: {
          run_id: root.run_id,
          task_id: root.task_id,
          attempt_id: root.attempt_id,
        },
        reason:
          "Inspect retained product, historical stop proof and any completed implementation receipt; resume assessment without reapplying implementation",
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

// This validates historical continuation only, never current acceptance or a
// current-runtime completion claim. Original proof/raw and implementation bytes
// remain required even after a new session binding is created.
export function readonlyResume(c) {
  const p = path.join(c.dir, "resume.json");
  if (!fs.existsSync(p)) return null;
  const r = read(p);
  if (r.recovery_kind !== "READONLY") return null;
  const task = c.backlog.items.find((t) => t.id === r.task_id);
  if (
    r.version !== 2 ||
    r.mission_id !== c.mission.mission_id ||
    !["REVIEW", "VERIFY"].includes(r.action) ||
    !task?.execution ||
    JSON.stringify(task.execution) !== JSON.stringify(r.execution)
  )
    throw Error("Readonly resume task execution/mission changed");
  const stoppedBytes = fs.readFileSync(
    artifactPath(c.dir, r.stopped_state_ref),
  );
  if (hash(stoppedBytes) !== r.stopped_state_sha256)
    throw Error("Readonly stopped state changed");
  const stopped = validate("current-task", JSON.parse(stoppedBytes));
  if (
    stopped.sprint_task_id !== task.id ||
    !["IMPLEMENT", "REVIEW", "VERIFY"].includes(stopped.stage) ||
    (r.action === "VERIFY" && stopped.stage !== "VERIFY")
  )
    throw Error("Readonly stopped task/stage changed");
  if (r.basis === "IMPLEMENTATION_RECEIPT") {
    if (r.implementation_ref !== path.basename(r.implementation_ref))
      throw Error("Invalid readonly implementation receipt reference");
    const bytes = fs.readFileSync(
      path.join(c.dir, "operations", r.implementation_ref),
    );
    if (hash(bytes) !== r.implementation_sha256)
      throw Error("Readonly implementation receipt changed");
    const op = validate("operation", JSON.parse(bytes));
    if (
      op.operation_id !== r.operation_id ||
      op.task_id !== task.id ||
      op.stage !== "IMPLEMENT" ||
      op.state !== "completed" ||
      op.result?.status !== "PASS"
    )
      throw Error("Readonly resume requires completed implementation receipt");
  } else if (
    r.basis !== "SNAPSHOT" ||
    !["REVIEW", "VERIFY"].includes(stopped.stage) ||
    r.operation_id !== null ||
    r.implementation_ref !== null
  )
    throw Error("Readonly snapshot continuation has no writer receipt");
  const proofBytes = fs.readFileSync(artifactPath(c.dir, r.proof_ref));
  if (hash(proofBytes) !== r.proof_sha256)
    throw Error("Readonly resume proof changed");
  const proof = validate("termination", JSON.parse(proofBytes));
  if (
    !r.stopped_root ||
    ["run_id", "task_id", "attempt_id"].some(
      (k) => proof[k] !== r.stopped_root[k] || proof[k] !== stopped[k],
    ) ||
    hash(fs.readFileSync(artifactPath(c.dir, proof.record))) !== proof.sha256
  )
    throw Error("Readonly resume proof/raw changed");
  const product = fingerprint(c.session.root),
    changed = product !== r.product;
  return {
    ...r,
    stage: changed ? "REVIEW" : r.action,
    changed,
    inspection_fingerprint: product,
  };
}

import { isMain } from "./lib/core.mjs";
import fs from "node:fs";
import path from "node:path";
import {
  contracts,
  fingerprint,
  hash,
  read,
  validate,
  main,
  binding,
  context,
  evidenceName,
  artifactPath,
  alive,
  mutex,
} from "./lib/core.mjs";
import { runtimeObservation } from "./lib/runtime.mjs";
import { terminationProof } from "./lib/recovery.mjs";
import { validateReport } from "./lib/reports.mjs";
import { burstStatus } from "./burst.mjs";
export function checkEvidence(c, check, product) {
  try {
    const task = c.backlog.items.find((t) => t.id === check.task_id),
      ctx = context(c, task),
      e = validate(
        "evidence",
        read(artifactPath(c.dir, evidenceName(check.id))),
      );
    for (const [k, v] of Object.entries({
      ...ctx,
      check_id: check.id,
      kind: check.kind,
      command: check.command,
      contract: c.digest,
      product,
      identity: binding(c),
    }))
      if (e[k] !== v) throw Error("Stale/mismatched evidence: " + k);
    if (
      !e.stable ||
      hash(fs.readFileSync(artifactPath(c.dir, e.log))) !== e.log_hash
    )
      throw Error("Changed product/log");
    if (e.exit_code !== 0 || e.signal !== null)
      return { id: check.id, status: "FAIL", reason: "Command failed" };
    if (!e.report)
      throw Error("No kind-specific execution report: " + e.report_error);
    const r = validateReport(c, e.report, {
      ...ctx,
      nonce: e.nonce,
      check_id: check.id,
      kind: check.kind,
    });
    return {
      id: check.id,
      status: r.status,
      reason: "Executed " + check.kind + " assertions",
    };
  } catch (e) {
    return { id: check.id, status: "UNVERIFIED", reason: e.message };
  }
}
export function assessment(
  c,
  kind,
  scope,
  taskIds,
  ctx,
  product,
  { fixture = false } = {},
) {
  const name =
    scope === "final"
      ? kind + ".json"
      : kind + "-" + hash(taskIds.join("\0")) + ".json";
  const a = validate("assessment", read(artifactPath(c.dir, name)));
  for (const [k, v] of Object.entries({
    ...ctx,
    kind,
    scope,
    product,
    contract: c.digest,
    identity: binding(c),
  }))
    if (a[k] !== v) throw Error("Stale assessment: " + k);
  for (const id of taskIds) {
    const task = c.backlog.items.find((t) => t.id === id);
    if (
      !task?.execution ||
      !a.executions.some(
        (e) =>
          e.task_id === id &&
          e.run_id === task.execution.run_id &&
          e.attempt_id === task.execution.attempt_id,
      )
    )
      throw Error("Assessment belongs to previous task execution");
  }
  if (taskIds.some((id) => !a.task_ids.includes(id)))
    throw Error("Missing assessed task");
  const required = c.backlog.items
    .filter((t) => taskIds.includes(t.id))
    .flatMap((t) => t.requirement_refs);
  if (required.some((id) => !a.requirement_refs.includes(id)))
    throw Error("Missing assessed requirement");
  const expected_model =
      kind === "review" ? "claude-sonnet-5-5" : "claude-opus-5-5",
    r = runtimeObservation(
      c,
      a.runtime_ref,
      { ...ctx, stage: kind, expected_model },
      { fixture },
    );
  const status = a.findings.some(
    (f) => !f.resolved && ["critical", "major"].includes(f.severity),
  )
    ? "NEEDS_FIX"
    : a.status;
  return { status, mode: r.mode };
}
export function taskGate(
  c,
  task,
  { fixture = false, ignoreDeclared = false } = {},
) {
  const product = fingerprint(c.session.root),
    checks = task.check_refs.map((id) =>
      checkEvidence(
        c,
        c.contract.checks.find((x) => x.id === id),
        product,
      ),
    );
  let review;
  try {
    review = assessment(
      c,
      "review",
      "task",
      [task.id],
      context(c, task),
      product,
      { fixture },
    );
  } catch (e) {
    review = { status: "UNVERIFIED", reason: e.message };
  }
  const status =
    !ignoreDeclared && task.status !== "PASS"
      ? task.status
      : checks.some((x) => x.status === "FAIL") || review.status === "NEEDS_FIX"
        ? "FAIL"
        : checks.some((x) => x.status !== "PASS") || review.status !== "PASS"
          ? "UNVERIFIED"
          : "PASS";
  return { id: task.id, status, checks, review };
}
export function verify(o) {
  return mutex(o.target, () => verifySnapshot(o));
}
function verifySnapshot(o) {
  const c = contracts(o.target),
    product = fingerprint(o.target),
    issues = [],
    state = validate(
      "current-task",
      read(path.join(c.dir, "current-task.json")),
    ),
    fixture = o.fixture === true || o.fixture === "true",
    modes = [],
    routing_history = [],
    routing_provenance = [];
  if (state.active || state.stage !== "IDLE")
    issues.push("UNVERIFIED: active, blocked, or unfinished workflow");
  if (burstStatus(c).active)
    issues.push("UNVERIFIED: active/unknown parent Workflow burst");
  for (const n of fs
    .readdirSync(path.join(c.dir, "evidence"))
    .filter((n) => n.startsWith("runner-") && n.endsWith(".json"))) {
    const r = read(artifactPath(c.dir, n));
    if (r.state === "running")
      issues.push("UNVERIFIED: check runner not closed");
  }
  for (const file of fs.readdirSync(path.join(c.dir, "operations"))) {
    const op = validate(
      "operation",
      read(path.join(c.dir, "operations", file)),
    );
    if (!["completed", "observed"].includes(op.state) || op.result === null)
      issues.push(
        "UNVERIFIED: unfinished/missing operation result: " + op.operation_id,
      );
  }
  const checks = c.contract.checks.map((check) =>
      checkEvidence(c, check, product),
    ),
    tasks = c.backlog.items.map((t) => {
      const own = checks.filter((x) => t.check_refs.includes(x.id)),
        status =
          t.status !== "PASS"
            ? t.status
            : !t.execution
              ? "UNVERIFIED"
              : own.some((x) => x.status === "FAIL")
                ? "FAIL"
                : own.every((x) => x.status === "PASS")
                  ? "PASS"
                  : "UNVERIFIED";
      return { id: t.id, declared: t.status, status, checks: t.check_refs };
    });
  const requirements = c.mission.requirements.map((r) => ({
    id: r.id,
    status: tasks
      .filter((t) =>
        c.backlog.items
          .find((x) => x.id === t.id)
          .requirement_refs.includes(r.id),
      )
      .every((t) => t.status === "PASS")
      ? "PASS"
      : "UNVERIFIED",
  }));
  try {
    const proof = terminationProof(
      c.dir,
      path.join(c.dir, "termination.json"),
      state,
      { fixture },
    );
    if (proof.state !== "completed") throw Error("Final run not completed");
    if (proof.source === "TEST_FIXTURE") modes.push("TEST_FIXTURE");
  } catch (e) {
    issues.push("UNVERIFIED: runtime completion: " + e.message);
  }
  const finalContext = {
    run_id: state.run_id,
    task_id: state.task_id,
    attempt_id: state.attempt_id,
    session_id: c.session.session_id,
  };
  for (const kind of ["review", "audit"]) {
    try {
      const a = assessment(
        c,
        kind,
        "final",
        tasks.map((t) => t.id),
        finalContext,
        product,
        { fixture },
      );
      modes.push(a.mode);
      if (a.status !== "PASS")
        issues.push(
          (a.status === "NEEDS_FIX" ? "FAIL: " : "UNVERIFIED: ") +
            kind +
            " " +
            a.status,
        );
    } catch (e) {
      issues.push("UNVERIFIED: " + kind + ": " + e.message);
    }
  }
  try {
    const routing = read(path.join(c.dir, "routing.json"));
    if (!Array.isArray(routing)) throw Error("Invalid routing manifest");
    const omittedPath = path.join(c.dir, "checkpoint-omitted.json"),
      omitted = fs.existsSync(omittedPath) ? read(omittedPath) : [],
      observed = [];
    if (!Array.isArray(omitted))
      throw Error("Invalid checkpoint omission references");
    for (const name of routing) {
      const manifest = validate("runtime", read(artifactPath(c.dir, name)));
      const selected =
        manifest.task_id === "mission"
          ? state
          : c.backlog.items.find((t) => t.id === manifest.task_id)?.execution;
      const current =
        manifest.session_id === c.session.session_id &&
        manifest.run_id === state.run_id &&
        selected?.run_id === manifest.run_id &&
        selected?.attempt_id === manifest.attempt_id;
      const rawPath = artifactPath(c.dir, manifest.record);
      if (
        !current &&
        !fs.existsSync(rawPath) &&
        omitted.some(
          (entry) =>
            entry.path === ".autodev/evidence/" + manifest.record &&
            entry.sha256 === manifest.sha256 &&
            Number.isInteger(entry.size) &&
            entry.size > 0 &&
            typeof entry.reason === "string" &&
            entry.reason.length > 0,
        )
      ) {
        routing_history.push(name);
        routing_provenance.push({
          name,
          assurance: "HISTORICAL_UNAVAILABLE",
          stage: manifest.stage,
          task_id: manifest.task_id,
          reason:
            "Raw log explicitly omitted by checkpoint; unavailable and excluded from role assurance",
        });
        continue;
      }
      if (hash(fs.readFileSync(rawPath)) !== manifest.sha256)
        throw Error("Routing history log changed");
      if (current) {
        const r = runtimeObservation(c, name, {}, { fixture });
        observed.push(r);
        routing_provenance.push({
          name,
          assurance: "CURRENT_VALID",
          stage: r.stage,
          task_id: r.task_id,
        });
      } else {
        if (!routing_history.includes(name)) routing_history.push(name);
        try {
          const r = runtimeObservation(
            c,
            name,
            {},
            { fixture, historical: true },
          );
          observed.push(r);
          routing_provenance.push({
            name,
            assurance: "HISTORICAL_VALID",
            stage: r.stage,
            task_id: r.task_id,
          });
        } catch (e) {
          routing_provenance.push({
            name,
            assurance: "UNVERIFIED",
            reason: e.message,
          });
        }
      }
    }
    for (const model of [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]) {
      const rs = observed.filter(
        (r) =>
          r.expected_model === model &&
          r.stage ===
            {
              "claude-opus-5-5": "architecture",
              "claude-sonnet-5-5": "plan",
              "claude-haiku-5-5": "implement",
            }[model],
      );
      if (!rs.length)
        throw Error("Missing proved model role observation: " + model);
      modes.push(...rs.map((r) => r.mode));
    }
  } catch (e) {
    issues.push("UNVERIFIED: routing: " + e.message);
  }
  if (
    fingerprint(o.target) !== product ||
    contracts(o.target).digest !== c.digest ||
    JSON.stringify(read(path.join(c.dir, "current-task.json"))) !==
      JSON.stringify(state) ||
    JSON.stringify(read(path.join(c.dir, "backlog.json"))) !==
      JSON.stringify(c.backlog)
  )
    issues.push("UNVERIFIED: changed during gate");
  const failed =
      tasks.some((t) => t.status === "FAIL") ||
      checks.some((x) => x.status === "FAIL") ||
      issues.some((x) => x.startsWith("FAIL:")),
    pending =
      tasks.some((t) => t.status !== "PASS") ||
      requirements.some((r) => r.status !== "PASS") ||
      checks.some((x) => x.status !== "PASS") ||
      issues.length;
  let status = failed
    ? "FAIL"
    : pending
      ? "UNVERIFIED"
      : c.contract.human_review
        ? "READY_FOR_HUMAN_REVIEW"
        : "COMPLETE";
  const assurance = modes.includes("TEST_FIXTURE") ? "TEST_FIXTURE" : "LIVE";
  if (
    assurance === "TEST_FIXTURE" &&
    ["COMPLETE", "READY_FOR_HUMAN_REVIEW"].includes(status)
  )
    status = "TEST_" + status;
  return {
    status,
    assurance,
    routing_history,
    routing_provenance,
    product,
    contract: c.digest,
    tasks,
    requirements,
    checks,
    issues,
  };
}
if (isMain(import.meta.url))
  main((o) => {
    const r = verify(o);
    console.log(JSON.stringify(r, null, 2));
    console.error(
      `${r.status}: ${r.tasks.filter((t) => t.status === "PASS").length}/${r.tasks.length} tasks, ${r.checks.filter((x) => x.status === "PASS").length}/${r.checks.length} checks`,
    );
    if (r.status !== "COMPLETE") process.exitCode = 1;
  });

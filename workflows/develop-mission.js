export const meta = {
  name: "develop-mission",
  description:
    "Serialized multi-sprint development with native model roles, recovery and independent completion gate",
};
const input = args;
if (
  !input ||
  typeof input !== "object" ||
  Array.isArray(input) ||
  !input.target ||
  !input.shared ||
  !input.run_id ||
  !input.attempt_id ||
  !input.agents ||
  !input.mission_id ||
  !input.session_id ||
  !input.observation_id ||
  input.capabilities?.registry_verified !== true ||
  input.capabilities?.readonly_verified !== true
)
  throw new Error(
    "Structured args and isolated native registry/read-only probe required",
  );
const roles = {
  "opus-architect": "claude-opus-5-5",
  "opus-auditor": "claude-opus-5-5",
  "sonnet-planner": "claude-sonnet-5-5",
  "sonnet-reviewer": "claude-sonnet-5-5",
  "sonnet-verifier": "claude-sonnet-5-5",
  "haiku-builder": "claude-haiku-5-5",
};
const resultSchema = {
  type: "object",
  required: ["status", "summary", "findings"],
  properties: {
    status: { enum: ["PASS", "NEEDS_FIX", "UNVERIFIED", "BLOCKED"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "message"],
        properties: {
          severity: { enum: ["critical", "major", "minor"] },
          message: { type: "string" },
        },
      },
    },
    snapshot: { type: "object" },
    gate: { type: "object" },
  },
};
const base = `Read the ${input.shared}/agents role definition and target's preserved mission. Never modify the common repository. Each writer MUST use scripts/operation.mjs start/complete with stable operation_id, and inspect partial diffs before replay. Return non-PASS when real CLI results or runtime evidence are absent. All task/check/assessment state is schema v2. Read-only roles return their actual status, every finding, current snapshot context and requirement coverage; never delegate or edit. The coordinator persists these verbatim via assessment.mjs; do not stamp an old review with a newer fingerprint. Parent alone confirms runtime drained and invokes final verify after Workflow completion. `;
const taskContexts = {};
let planEpoch = 0,
  liveObservation = input.observation_id;
const milestoneEvery = input.milestone_every ?? 2;
if (
  !Number.isInteger(milestoneEvery) ||
  milestoneEvery < 1 ||
  milestoneEvery > 100
)
  throw new Error("Invalid milestone cadence");
async function call(role, action, task_id = "mission", payload = {}) {
  if (
    !["autodev-" + role, "claude-autodev:" + role].includes(input.agents[role])
  )
    throw new Error("Undiscovered native agentType: " + role);
  const execution = taskContexts[task_id],
    coordinator = role === "sonnet-planner" && action !== "implement";
  const stage =
    role === "opus-architect"
      ? "architecture"
      : role === "opus-auditor"
        ? "audit"
        : role === "sonnet-reviewer"
          ? "review"
          : role === "sonnet-verifier"
            ? "verify"
            : action === "implement"
              ? "implement"
              : "plan";
  const ctx = {
    mission_id: input.mission_id,
    session_id: input.session_id,
    run_id: input.run_id,
    task_id: coordinator ? "mission" : task_id,
    attempt_id: coordinator
      ? input.attempt_id
      : execution?.attempt_id || input.attempt_id,
    stage,
  };
  const tag = [
    "autodev",
    ctx.mission_id,
    ctx.session_id,
    ctx.run_id,
    ctx.task_id,
    ctx.attempt_id,
    stage,
  ]
    .map((x) => encodeURIComponent(x))
    .join("|");
  const phase =
    action === "plan"
      ? liveObservation + ":" + planEpoch
      : task_id === "mission"
        ? liveObservation
        : (payload.round ?? payload.attempt ?? "");
  const operation_id =
    action === "inspect"
      ? null
      : [
          input.run_id,
          task_id,
          execution?.attempt_id || input.attempt_id,
          action,
          phase,
        ]
          .map((x) => encodeURIComponent(x))
          .join("|");
  const request = {
    action,
    role,
    task_id,
    run_id: input.run_id,
    attempt_id: input.attempt_id,
    target: input.target,
    shared: input.shared,
    operation_id,
    payload,
    context: ctx,
    observation_id: input.observation_id,
  };
  const r = await agent(
    base +
      "\nAUTODEV_CONTEXT " +
      tag +
      "\nAUTODEV_REQUEST " +
      JSON.stringify(request),
    {
      model: roles[role],
      agentType: input.agents[role],
      label: tag,
      schema: resultSchema,
    },
  );
  if (
    !r ||
    !["PASS", "NEEDS_FIX", "UNVERIFIED", "BLOCKED"].includes(r.status) ||
    typeof r.summary !== "string" ||
    !Array.isArray(r.findings) ||
    r.findings.some(
      (f) =>
        !["critical", "major", "minor"].includes(f.severity) ||
        typeof f.message !== "string",
    )
  )
    throw new Error("Missing/invalid result: " + role + "/" + action);
  if (r.snapshot?.observation_id) liveObservation = r.snapshot.observation_id;
  if (r.snapshot?.tasks)
    for (const task of r.snapshot.tasks) {
      if (task.execution) taskContexts[task.id] = task.execution;
      else delete taskContexts[task.id];
    }
  return r;
}
function passed(r) {
  return (
    r.status === "PASS" &&
    !r.findings.some(
      (f) => !f.resolved && ["major", "critical"].includes(f.severity),
    )
  );
}
const coordinate = (action, task = "mission", payload = {}) =>
  call("sonnet-planner", action, task, payload);
let observed = await coordinate("inspect");
if (!passed(observed)) return observed;
if (!observed.snapshot || !Array.isArray(observed.snapshot.tasks))
  throw new Error("Missing persisted snapshot");
if (!observed.snapshot.architecture_ready) {
  const planned = await call("opus-architect", "architecture");
  if (!passed(planned)) return planned;
  observed = await coordinate("checkpoint-architecture", "mission", {
    result: planned,
  });
  if (!passed(observed)) return observed;
}
let completed = observed.snapshot.completed_since_audit ?? 0;
const deferred = [];
const maxSprints = input.max_sprints ?? 20;
if (!Number.isInteger(maxSprints) || maxSprints < 1 || maxSprints > 100)
  throw new Error("Invalid burst size; scope is never reduced by this bound");
for (let sprint = 0; sprint < maxSprints; sprint++) {
  observed = await coordinate("inspect");
  if (!passed(observed)) return observed;
  const tasks = observed.snapshot?.tasks;
  if (!Array.isArray(tasks) || !tasks.length)
    throw new Error("Missing original task coverage");
  const resume = observed.snapshot.resume;
  const eligible = (t) =>
    t.status !== "PASS" &&
    t.status !== "BLOCKED" &&
    !deferred.includes(t.id) &&
    t.dependencies.every((id) =>
      tasks.some((x) => x.id === id && x.status === "PASS"),
    );
  const available =
    tasks.find((t) => resume?.task_id === t.id && eligible(t)) ||
    tasks.find(
      (t) =>
        t.status !== "PASS" &&
        t.status !== "BLOCKED" &&
        !deferred.includes(t.id) &&
        t.dependencies.every((id) =>
          tasks.some((x) => x.id === id && x.status === "PASS"),
        ),
    );
  if (!available) {
    if (tasks.some((t) => t.status !== "PASS"))
      return {
        status: "BLOCKED",
        summary:
          "No dependency-ready independent task. Preserve blockers and resume instructions; unfinished scope is retained.",
        findings: [],
        snapshot: observed.snapshot,
      };
    const review = await call("sonnet-reviewer", "final-review", "mission", {
      snapshot: observed.snapshot,
    });
    const persisted = await coordinate("persist-final-review", "mission", {
      result: review,
    });
    if (!passed(persisted)) return persisted;
    if (!passed(review)) {
      const repaired = await coordinate("replan-final-review", "mission", {
        result: review,
      });
      if (!passed(repaired)) return repaired;
      continue;
    }
    const audit = await call("opus-auditor", "final-audit", "mission", {
      snapshot: observed.snapshot,
    });
    const saved = await coordinate("persist-final-audit", "mission", {
      result: audit,
    });
    if (!passed(saved)) return saved;
    if (!passed(audit)) {
      const replanned = await coordinate("replan-final-audit", "mission", {
        result: audit,
      });
      if (!passed(replanned)) return replanned;
      continue;
    }
    const verify = await call(
      "sonnet-verifier",
      "final-verification",
      "mission",
      { refresh_all: true },
    );
    if (!passed(verify)) {
      if (verify.status === "NEEDS_FIX") {
        const repaired = await coordinate(
          "replan-final-verification",
          "mission",
          { verification: verify },
        );
        if (!passed(repaired)) return repaired;
        continue;
      }
      return verify;
    }
    // Verifier may discover product changes; any change forces a fresh independent final review/audit.
    const final = await coordinate("prepare-final-gate", "mission", {
      review,
      audit,
      verification: verify,
    });
    if (!passed(final)) return final;
    return {
      status: "PASS",
      summary:
        "READY_FOR_PARENT_GATE: parent must confirm every Workflow/agent stopped, persist terminal runtime proof, end owner, and execute verify.mjs. This is not COMPLETE.",
      findings: [],
      snapshot: final.snapshot,
    };
  }
  const task = available.id;
  planEpoch = sprint;
  const plan = await coordinate("plan", task, {
    resume: resume?.task_id === task ? resume : null,
  });
  if (!passed(plan)) {
    deferred.push(task);
    continue;
  }
  let success = false;
  const resumeStart =
    resume?.task_id === task ? (observed.snapshot.repair_attempt ?? 0) : 0;
  for (let attempt = resumeStart; attempt < 4; attempt++) {
    if (attempt === 2) {
      const diagnosis = await coordinate("diagnose", task, {
        reason:
          "Two failed cycles; investigate root cause before a different implementation",
      });
      if (!passed(diagnosis)) break;
    }
    const resumeStage =
      attempt === resumeStart && resume?.task_id === task ? resume.stage : null;
    if (!["REVIEW", "VERIFY"].includes(resumeStage)) {
      const built = await call(
        attempt >= 2 ? "sonnet-planner" : "haiku-builder",
        "implement",
        task,
        { attempt: attempt + 1, root_cause_required: attempt >= 2 },
      );
      if (!passed(built) && ["BLOCKED", "UNVERIFIED"].includes(built.status))
        break;
    }
    const review = await call("sonnet-reviewer", "review", task, {
      snapshot: plan.snapshot,
      round: attempt + 1,
    });
    const saved = await coordinate("persist-review", task, {
      result: review,
      round: attempt + 1,
    });
    if (!passed(saved)) {
      if (saved.snapshot?.blocker_scope === "global") return saved;
      break;
    }
    if (!passed(review)) {
      log(JSON.stringify({ task, attempt: attempt + 1, review }));
      continue;
    }
    const tested = await call("sonnet-verifier", "verify", task, {
      result: review,
      round: attempt + 1,
    });
    if (!passed(tested)) {
      if (["BLOCKED", "UNVERIFIED"].includes(tested.status)) break;
      continue;
    }
    const gate = await coordinate("close-task", task, {
      review,
      verification: tested,
      round: attempt + 1,
    });
    if (!passed(gate)) {
      if (gate.status === "NEEDS_FIX") continue;
      return gate;
    }
    success = true;
    completed = gate.snapshot?.completed_since_audit ?? completed + 1;
    break;
  }
  if (!success) {
    const audit = await call("opus-auditor", "replan", task, {
      reason:
        "Repeated failure or unavailable verification; do not repeat identical patches",
    });
    const replanned = await coordinate("defer-or-replan", task, {
      result: audit,
    });
    if (!passed(replanned)) return replanned;
    deferred.push(task);
    continue; // Continue other dependency-ready work rather than ending the whole mission.
  }
  if (completed >= milestoneEvery) {
    const audit = await call("opus-auditor", "milestone-audit");
    const checkpoint = await coordinate("checkpoint-audit", "mission", {
      result: audit,
    });
    if (!passed(checkpoint)) return checkpoint;
    completed = checkpoint.snapshot?.completed_since_audit ?? 0;
    if (!passed(audit)) {
      const replanned = await coordinate("replan-milestone", "mission", {
        result: audit,
      });
      if (!passed(replanned)) return replanned;
    }
  }
}
return {
  status: "UNVERIFIED",
  summary:
    "CONTINUE_PARENT: burst ended; persist handoff and relaunch from state under /goal. No completion or requirement reduction.",
  findings: [],
};

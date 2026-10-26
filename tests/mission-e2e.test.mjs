import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fixture,
  contracts,
  read,
  json,
  runtime,
  attest,
  recordAll,
  artifactPath,
  terminated,
  context,
} from "./helpers/fixture.mjs";
import { runController, agents } from "./helpers/controller.mjs";
import { state } from "../scripts/state.mjs";
import { taskAction } from "../scripts/task.mjs";
import { record } from "../scripts/record.mjs";
import { observationId } from "../scripts/lib/core.mjs";
import { verify } from "../scripts/verify.mjs";
import { nextAction } from "../scripts/next.mjs";
import { checkpointAudit } from "../scripts/progress.mjs";
import { operation } from "../scripts/operation.mjs";
import { failureAction, failureSummary } from "../scripts/failure.mjs";
async function scenario(
  t,
  {
    unfixable = false,
    human = false,
    regressFinal = false,
    burstSize = 20,
  } = {},
) {
  const f = fixture(t, { count: 4 });
  json(path.join(f.target, "product.json"), {
    R1: false,
    R2: false,
    R3: false,
    R4: false,
  });
  if (human) {
    const contract = read(path.join(f.dir, "contract.json"));
    contract.human_review = true;
    json(path.join(f.dir, "contract.json"), contract);
  }
  state({
    target: f.target,
    action: "begin",
    run: "mission-run",
    task: "mission",
    attempt: "mission-attempt",
  });
  let architecture = false,
    milestoneFlagged = false,
    regressed = false;
  const trace = [],
    buildCounts = {},
    routing = [];
  const good = (extra = {}) => ({
    status: "PASS",
    summary: "TEST FIXTURE",
    findings: [],
    ...extra,
  });
  const transition = (stage) => {
    const s = read(path.join(f.dir, "current-task.json"));
    if (s.stage === stage) return;
    state({
      target: f.target,
      action: "transition",
      run: "mission-run",
      task: "mission",
      attempt: "mission-attempt",
      stage,
    });
  };
  const snap = () => ({
    observation_id: observationId(contracts(f.target)),
    architecture_ready: architecture,
    failure_state: failureSummary(f.target),
    tasks: read(path.join(f.dir, "backlog.json")).items.map(
      ({ id, status, dependencies, execution }) => ({
        id,
        status,
        dependencies,
        execution,
      }),
    ),
    completed_since_audit: read(path.join(f.dir, "progress.json"))
      .completed_since_audit,
    resume: nextAction({ target: f.target, run: "mission-run" }).resume,
  });
  const callback = async (prompt, opts) => {
    const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]),
      { action, role, task_id, payload, operation_id } = req;
    trace.push({ role, action, task_id });
    assert.equal(opts.agentType, agents[role]);
    assert.equal("tools" in opts, false);
    const isWrite =
      action !== "inspect" &&
      !["sonnet-reviewer", "opus-auditor"].includes(role);
    const op = {
      target: f.target,
      run: "mission-run",
      attempt: "mission-attempt",
      task: task_id,
      id: operation_id,
      stage:
        action === "implement"
          ? "IMPLEMENT"
          : action.includes("verify")
            ? "VERIFY"
            : action.includes("audit")
              ? "AUDIT"
              : "PLAN",
    };
    if (isWrite) {
      const claim = operation({ ...op, action: "start" });
      assert.equal(claim.status, "STARTED");
    }
    let r;
    if (action === "inspect") r = good({ snapshot: snap() });
    else if (action === "architecture") {
      transition("ARCHITECTURE");
      fs.writeFileSync(
        path.join(f.dir, "architecture.md"),
        "All four original requirements mapped to four tasks and executable acceptance checks. TEST FIXTURE.",
      );
      architecture = true;
      r = good({ snapshot: snap() });
      routing.push(
        runtime(f, {
          role: "architecture",
          model: "claude-opus-5-5",
          run_id: "mission-run",
          attempt_id: "mission-attempt",
        }),
      );
    } else if (action === "checkpoint-architecture") {
      transition("PLAN");
      r = good({ snapshot: snap() });
    } else if (action === "plan") {
      if (read(path.join(f.dir, "current-task.json")).stage !== "PLAN")
        transition("PLAN");
      taskAction({
        target: f.target,
        action: "select",
        run: "mission-run",
        attempt: "mission-attempt",
        task: task_id,
      });
      r = good({ snapshot: snap() });
    } else if (action === "diagnose") {
      const source = path.join(f.base, "strategy.json");
      json(source, {
        hypothesis:
          "TEST FIXTURE: shallow implementation misses retained state",
        experiment:
          "Compare current product JSON against each original feature assertion",
        next_step: "Use Sonnet to implement all required state transitions",
        model: "claude-sonnet-5-5",
      });
      failureAction({
        target: f.target,
        action: "strategy",
        run: "mission-run",
        attempt: "mission-attempt",
        task: task_id,
        id: operation_id + ":strategy",
        input: source,
      });
      r = good({ snapshot: snap() });
    } else if (action === "checkpoint-failure") {
      const source = path.join(f.base, "failure-result.json");
      json(source, {
        stage: payload.stage,
        category: payload.category,
        status: payload.result.status,
        model: payload.model,
        summary: payload.result.summary,
        hypothesis: "TEST FIXTURE implementation is incomplete",
        experiment: "Assert actual feature flags and review findings",
        next_step: "Change implementation strategy, then independently review",
        evidence_refs: [],
      });
      failureAction({
        target: f.target,
        action: "record",
        run: "mission-run",
        attempt: "mission-attempt",
        task: task_id,
        id: operation_id,
        input: source,
      });
      r = good({ snapshot: snap() });
    } else if (action === "implement") {
      transition("IMPLEMENT");
      buildCounts[task_id] = (buildCounts[task_id] || 0) + 1;
      const p = read(path.join(f.target, "product.json"));
      p[task_id] =
        !(unfixable && task_id === "R1") &&
        ((task_id === "R1" && buildCounts[task_id] > 1) ||
          (task_id === "R3" && role === "sonnet-planner") ||
          ["R2", "R4"].includes(task_id));
      json(path.join(f.target, "product.json"), p);
      routing.push(
        runtime(f, {
          role: "implement",
          model: opts.model,
          ...context(
            contracts(f.target),
            contracts(f.target).backlog.items.find((t) => t.id === task_id),
          ),
        }),
      );
      r = good();
    } else if (action === "review") {
      transition("REVIEW");
      const works = read(path.join(f.target, "product.json"))[task_id];
      r = good({
        status: works ? "PASS" : "NEEDS_FIX",
        findings: works
          ? []
          : [{ severity: "major", message: "Feature assertion fails" }],
      });
    } else if (action === "persist-review") {
      attest(f, {
        scope: "task",
        taskId: task_id,
        status: payload.result.status,
        findings: payload.result.findings.map((x) => ({
          ...x,
          resolved: false,
        })),
      });
      r = good();
    } else if (action === "verify") {
      transition("VERIFY");
      const c = contracts(f.target);
      for (const check of c.contract.checks.filter(
        (x) => x.task_id === task_id,
      ))
        record({ target: f.target, check: check.id });
      r = good();
    } else if (action === "close-task") {
      const gated = taskAction({
        target: f.target,
        action: "complete",
        run: "mission-run",
        attempt: "mission-attempt",
        task: task_id,
        fixture: true,
      });
      assert.equal(gated.status, "PASS");
      r = good({ snapshot: snap() });
    } else if (action === "milestone-audit") {
      if (!milestoneFlagged) {
        milestoneFlagged = true;
        r = good({
          status: "NEEDS_FIX",
          findings: [
            {
              severity: "major",
              message: "Original R4 is still unfinished; return to planning",
            },
          ],
        });
      } else r = good();
    } else if (
      [
        "checkpoint-audit",
        "persist-final-review",
        "persist-final-audit",
      ].includes(action)
    ) {
      if (action === "checkpoint-audit") {
        transition("AUDIT");
        attest(f, {
          kind: "audit",
          scope: "milestone",
          status: payload.result.status,
          findings: payload.result.findings.map((x) => ({
            ...x,
            resolved: false,
          })),
        });
        checkpointAudit({ target: f.target, fixture: true });
      }
      if (action === "persist-final-review")
        attest(f, {
          status: payload.result.status,
          findings: payload.result.findings.map((x) => ({
            ...x,
            resolved: false,
          })),
        });
      if (action === "persist-final-audit")
        attest(f, {
          kind: "audit",
          status: payload.result.status,
          findings: payload.result.findings.map((x) => ({
            ...x,
            resolved: false,
          })),
        });
      r = good({ snapshot: snap() });
    } else if (action === "replan-milestone") {
      transition("PLAN");
      r = good({ snapshot: snap() });
    } else if (action === "replan") {
      r = good({
        status: "NEEDS_FIX",
        findings: [
          {
            severity: "major",
            message: "Unfixable fixture R1; continue independent work",
          },
        ],
      });
    } else if (action === "defer-or-replan") {
      transition("AUDIT");
      taskAction({
        target: f.target,
        action: "block",
        run: "mission-run",
        attempt: "mission-attempt",
        task: task_id,
      });
      transition("PLAN");
      r = good({ snapshot: snap() });
    } else if (action === "final-review") r = good();
    else if (action === "final-audit") r = good();
    else if (action === "replan-final-verification") {
      transition("PLAN");
      for (const task of contracts(f.target).backlog.items) {
        if (read(path.join(f.target, "product.json"))[task.id] !== true)
          taskAction({
            target: f.target,
            action: "reset",
            run: "mission-run",
            attempt: "mission-attempt",
            task: task.id,
          });
      }
      r = good({ snapshot: snap() });
    } else if (action === "final-verification") {
      const s = read(path.join(f.dir, "current-task.json"));
      if (s.stage === "AUDIT") transition("PLAN");
      if (read(path.join(f.dir, "current-task.json")).stage === "PLAN") {
        transition("IMPLEMENT");
        transition("REVIEW");
      }
      transition("VERIFY");
      if (regressFinal && !regressed) {
        const product = read(path.join(f.target, "product.json"));
        product.R2 = false;
        json(path.join(f.target, "product.json"), product);
        regressed = true;
      }
      recordAll(f);
      r = good({
        status: Object.values(read(path.join(f.target, "product.json"))).every(
          (x) => x === true,
        )
          ? "PASS"
          : "NEEDS_FIX",
      });
    } else if (action === "prepare-final-gate") {
      transition("AUDIT");
      transition("IDLE");
      r = good({ snapshot: snap() });
    } else throw Error("Unimplemented request: " + action);
    if (isWrite) {
      const resultPath = path.join(f.base, "op-result.json");
      json(resultPath, r);
      operation({ ...op, action: "complete", result: resultPath });
    }
    return r;
  };
  let result;
  for (let burst = 0; burst < 30; burst++) {
    result = await runController(
      {
        target: f.target,
        shared: "COMMON",
        run_id: "mission-run",
        attempt_id: "mission-attempt",
        mission_id: contracts(f.target).mission.mission_id,
        session_id: contracts(f.target).session.session_id,
        observation_id: observationId(contracts(f.target)),
        max_sprints: burstSize,
        agents,
        capabilities: { registry_verified: true, readonly_verified: true },
      },
      callback,
    );
    if (!result.summary.startsWith("CONTINUE_PARENT")) break;
  }
  // Native/SDK records here are all marked TEST FIXTURE. Production verify must still reject.
  routing.push(
    runtime(f, {
      role: "plan",
      model: "claude-sonnet-5-5",
      run_id: "mission-run",
      attempt_id: "mission-attempt",
    }),
  );
  json(path.join(f.dir, "routing.json"), routing);
  if (result.status === "PASS") {
    assert.equal(
      verify({ target: f.target, fixture: true }).status,
      "UNVERIFIED",
    );
    const proof = terminated(f);
    state({ target: f.target, action: "end", proof, fixture: true });
  }
  return {
    f,
    result,
    trace,
    buildCounts,
    gate: verify({ target: f.target, fixture: true }),
  };
}
test("D2 four-task mission actually checks files, fixes fault, escalates, replans at milestone and gates completion", async (t) => {
  const { f, result, trace, buildCounts, gate } = await scenario(t);
  assert.equal(result.status, "PASS");
  assert.equal(gate.status, "TEST_COMPLETE");
  assert.equal(verify(f).status, "UNVERIFIED");
  assert.equal(trace[1].role, "opus-architect");
  assert.ok(trace.some((x) => x.action === "diagnose" && x.task_id === "R3"));
  assert.ok(
    trace.some(
      (x) =>
        x.action === "implement" &&
        x.role === "sonnet-planner" &&
        x.task_id === "R3",
    ),
  );
  assert.ok(trace.some((x) => x.action === "replan-milestone"));
  assert.equal(buildCounts.R1, 2);
  assert.equal(buildCounts.R3, 3);
  assert.deepEqual(
    gate.tasks.map((x) => x.status),
    ["PASS", "PASS", "PASS", "PASS"],
  );
});
test("D3 exhausted task does not end development while independent tasks can progress", async (t) => {
  const { result, trace, gate } = await scenario(t, { unfixable: true });
  assert.equal(result.status, "BLOCKED");
  assert.ok(trace.some((x) => x.action === "close-task" && x.task_id === "R4"));
  assert.notEqual(gate.status, "TEST_COMPLETE");
  assert.equal(gate.tasks.find((t) => t.id === "R1").status, "BLOCKED");
});
test("D2 final subjective judgment returns distinct test human-review status", async (t) => {
  const { gate } = await scenario(t, { human: true });
  assert.equal(gate.status, "TEST_READY_FOR_HUMAN_REVIEW");
});
test("G final verification regression resets failed task and returns through implementation before completion", async (t) => {
  const { trace, gate } = await scenario(t, { regressFinal: true });
  assert.ok(trace.some((x) => x.action === "replan-final-verification"));
  assert.ok(
    trace.filter((x) => x.action === "implement" && x.task_id === "R2")
      .length >= 2,
  );
  assert.equal(gate.status, "TEST_COMPLETE", JSON.stringify(gate));
});
test("G one-sprint bursts preserve distinct task writer receipts and milestone cadence across relaunches", async (t) => {
  const { trace, gate } = await scenario(t, { burstSize: 1 });
  assert.ok(trace.filter((x) => x.action === "milestone-audit").length >= 2);
  assert.equal(gate.status, "TEST_COMPLETE", JSON.stringify(gate));
});

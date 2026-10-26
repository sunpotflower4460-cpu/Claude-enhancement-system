import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fixture, read, json, shared } from "./helpers/fixture.mjs";
import { state } from "../scripts/state.mjs";
import { input, runController } from "./helpers/controller.mjs";
const ok = (extra = {}) => ({
  status: "PASS",
  summary: "TEST FIXTURE",
  findings: [],
  ...extra,
});
const cli = (...a) =>
  spawnSync(
    process.execPath,
    [path.join(shared, "scripts/failure.mjs"), ...a],
    { encoding: "utf8" },
  );
test("long continuation resumes Sonnet elevation from persisted task failures without local Workflow repair counter", async () => {
  const trace = [];
  let fails = 2;
  const r = await runController(
    { ...input, max_sprints: 1 },
    async (prompt) => {
      const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
      trace.push(req);
      const snapshot = {
        architecture_ready: true,
        tasks: [
          {
            id: "R1",
            status: "UNVERIFIED",
            dependencies: [],
            execution: { run_id: "run", attempt_id: "task-execution" },
          },
        ],
        failure_state: {
          R1: {
            failures: fails,
            next_model: "claude-sonnet-5-5",
            next_action: "DIAGNOSE",
          },
        },
      };
      if (req.action === "implement")
        return ok({
          status: "BLOCKED",
          failure: {
            category: "environment",
            hypothesis: "browser absent",
            experiment: "check executable",
            next_step: "install browser",
          },
        });
      if (req.action === "defer-or-replan")
        snapshot.tasks[0].status = "BLOCKED";
      return ok({ snapshot });
    },
  );
  assert.ok(
    trace.some((x) => x.action === "implement" && x.role === "sonnet-planner"),
  );
  assert.equal(
    trace.some((x) => x.action === "implement" && x.role === "haiku-builder"),
    false,
  );
  assert.equal(r.status, "UNVERIFIED");
});
test("classified environment blockers are persisted and defer task without an irrelevant Opus code replan", async () => {
  const trace = [];
  let blocked = false;
  await runController({ ...input, max_sprints: 2 }, async (prompt) => {
    const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
    trace.push(req);
    const snapshot = {
      architecture_ready: true,
      tasks: [
        {
          id: "R1",
          status: blocked ? "BLOCKED" : "UNVERIFIED",
          dependencies: [],
        },
      ],
    };
    if (req.action === "implement")
      return ok({
        status: "BLOCKED",
        failure: {
          category: "environment",
          hypothesis: "tool absent",
          experiment: "which tool",
          next_step: "install tool",
        },
      });
    if (req.action === "defer-or-replan") blocked = true;
    return ok({ snapshot });
  });
  assert.ok(trace.some((x) => x.action === "checkpoint-failure"));
  assert.equal(
    trace.some((x) => x.role === "opus-auditor"),
    false,
  );
  assert.ok(trace.some((x) => x.action === "defer-or-replan"));
});
test("failure journal persists causal record, deduplicates retries and rejects same strategy after repeated failure", (t) => {
  const f = fixture(t);
  state({
    target: f.target,
    action: "begin",
    run: "parent",
    task: "mission",
    attempt: "owner",
  });
  const data = {
    stage: "review",
    category: "review",
    status: "NEEDS_FIX",
    model: "claude-haiku-5-5",
    summary: "TEST FIXTURE defect",
    hypothesis: "wrong transition",
    experiment: "replay saved input",
    next_step: "fix transition",
    evidence_refs: [],
  };
  const file = path.join(f.base, "failure.json");
  json(file, data);
  const args = [
    "--target",
    f.target,
    "--action",
    "record",
    "--run",
    "parent",
    "--attempt",
    "owner",
    "--task",
    "R1",
    "--input",
    file,
  ];
  let r = cli(...args, "--id", "e1");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).summary.failures, 1);
  r = cli(...args, "--id", "e1");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).status, "ALREADY_RECORDED");
  r = cli(...args, "--id", "e2");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).summary.next_action, "DIAGNOSE");
  const strategy = path.join(f.base, "strategy.json");
  json(strategy, {
    hypothesis: "state persists too early",
    experiment: "inspect disk before reload",
    next_step: "move persistence after validation",
    model: "claude-sonnet-5-5",
  });
  r = cli(
    "--target",
    f.target,
    "--action",
    "strategy",
    "--run",
    "parent",
    "--attempt",
    "owner",
    "--task",
    "R1",
    "--input",
    strategy,
    "--id",
    "s1",
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = cli(
    "--target",
    f.target,
    "--action",
    "strategy",
    "--run",
    "parent",
    "--attempt",
    "owner",
    "--task",
    "R1",
    "--input",
    strategy,
    "--id",
    "s2",
  );
  assert.notEqual(
    r.status,
    0,
    "identical diagnostic hypothesis is not new progress",
  );
  assert.equal(read(path.join(f.dir, "failure.json")).events.length, 3);
});

test("all long-run failure classes keep exact cause and external blockers defer without losing scope", (t) => {
  const f = fixture(t, { count: 10 });
  state({
    target: f.target,
    action: "begin",
    run: "r",
    task: "mission",
    attempt: "a",
  });
  const categories = [
    "implementation",
    "review",
    "test",
    "repeated_fix",
    "design",
    "environment",
    "model_limit",
    "permission",
    "terminated",
    "evidence",
  ];
  for (const [i, category] of categories.entries()) {
    const input = path.join(f.base, "failure-input.json");
    json(input, {
      stage: "implementation",
      category,
      status: [
        "environment",
        "model_limit",
        "permission",
        "terminated",
        "evidence",
      ].includes(category)
        ? "BLOCKED"
        : "NEEDS_FIX",
      model: "claude-haiku-5-5",
      summary: "TEST FIXTURE " + category,
      hypothesis: "Observe " + category,
      experiment: "Reproduce " + category,
      next_step: "Verify recovery " + category,
      evidence_refs: [],
    });
    const r = cli(
      "--target",
      f.target,
      "--action",
      "record",
      "--run",
      "r",
      "--attempt",
      "a",
      "--task",
      "R" + (i + 1),
      "--id",
      "class-" + i,
      "--input",
      input,
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(
      JSON.parse(r.stdout).summary.next_action,
      i >= 5 ? "DEFER" : category === "design" ? "REPLAN" : "IMPLEMENT",
    );
  }
  assert.equal(read(path.join(f.dir, "backlog.json")).items.length, 10);
});

test("causal failures survive new owner and task execution while changed Opus diagnosis opens an elevated repair window", async (t) => {
  const { failureAction, failureSummary } = await import(
    "../scripts/failure.mjs"
  );
  const { terminated } = await import("./helpers/fixture.mjs");
  const { taskAction } = await import("../scripts/task.mjs");
  const f = fixture(t);
  state({
    target: f.target,
    action: "begin",
    run: "old",
    task: "mission",
    attempt: "old-owner",
  });
  const input = path.join(f.base, "failure-input.json");
  json(input, {
    stage: "test",
    category: "test",
    status: "NEEDS_FIX",
    model: "claude-haiku-5-5",
    summary: "TEST FIXTURE test failed",
    hypothesis: "bad state",
    experiment: "assert state",
    next_step: "repair state",
    evidence_refs: [],
  });
  for (let i = 0; i < 4; i++)
    failureAction({
      target: f.target,
      action: "record",
      run: "old",
      attempt: "old-owner",
      task: "R1",
      id: "e" + i,
      input,
    });
  assert.equal(failureSummary(f.target, "R1").next_action, "REPLAN");
  const proof = terminated(f, { state: "stopped" });
  state({ target: f.target, action: "recover", proof, fixture: true });
  state({
    target: f.target,
    action: "begin",
    run: "new",
    task: "mission",
    attempt: "new-owner",
  });
  taskAction({
    target: f.target,
    action: "select",
    run: "new",
    attempt: "new-owner",
    task: "R1",
  });
  assert.equal(
    failureSummary(f.target, "R1").failures,
    4,
    "new session must not forget repair history",
  );
  json(input, {
    model: "claude-opus-5-5",
    hypothesis: "schema and storage disagree",
    experiment: "compare original schema with stored state",
    next_step: "Sonnet implements corrected storage adapter",
  });
  failureAction({
    target: f.target,
    action: "strategy",
    run: "new",
    attempt: "new-owner",
    task: "R1",
    id: "new-plan",
    input,
  });
  const summary = failureSummary(f.target, "R1");
  assert.equal(summary.repair_attempt, 2);
  assert.equal(summary.next_model, "claude-sonnet-5-5");
  assert.equal(summary.next_action, "IMPLEMENT");
});

test("failure event evidence must exist and ownership/id reuse cannot overwrite causal history", async (t) => {
  const { failureAction } = await import("../scripts/failure.mjs");
  const f = fixture(t);
  state({
    target: f.target,
    action: "begin",
    run: "r",
    task: "mission",
    attempt: "a",
  });
  const input = path.join(f.base, "input.json");
  const data = {
    stage: "review",
    category: "review",
    status: "NEEDS_FIX",
    model: "claude-haiku-5-5",
    summary: "TEST FIXTURE",
    hypothesis: "state error",
    experiment: "replay state",
    next_step: "repair state",
    evidence_refs: [],
  };
  json(input, data);
  const args = {
    target: f.target,
    action: "record",
    run: "r",
    attempt: "a",
    task: "R1",
    id: "e",
    input,
  };
  assert.throws(
    () => failureAction({ ...args, attempt: "wrong" }),
    /ownership/,
  );
  json(input, {
    ...data,
    evidence_refs: [{ name: "absent.json", sha256: "a".repeat(64) }],
  });
  assert.throws(() => failureAction(args), /ENOENT/);
  json(input, data);
  failureAction(args);
  json(input, { ...data, status: "BLOCKED" });
  assert.throws(() => failureAction(args), /reused/);
  assert.equal(read(path.join(f.dir, "failure.json")).events.length, 1);
});

test("five tasks span at least three Workflow bursts with persisted escalation and milestone cadence", async () => {
  const store = {
    architecture_ready: false,
    tasks: Array.from({ length: 5 }, (_, i) => ({
      id: "R" + (i + 1),
      status: "UNVERIFIED",
      dependencies: [],
      execution: { run_id: "run", attempt_id: "task-" + i },
    })),
    completed_since_audit: 0,
    failure_state: {},
    implemented: {},
  };
  let persisted = store;
  const trace = [],
    audits = [];
  const snapshot = () => structuredClone(persisted);
  const callback = async (prompt) => {
    const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
    trace.push({ action: req.action, role: req.role, task: req.task_id });
    const id = req.task_id;
    if (req.action === "architecture") persisted.architecture_ready = true;
    if (req.action === "implement") {
      const failures = persisted.failure_state[id]?.failures || 0;
      if (id === "R1" && failures < 2) return ok({ status: "NEEDS_FIX" });
      persisted.implemented[id] = true;
    }
    if (req.action === "checkpoint-failure") {
      const failures = (persisted.failure_state[id]?.failures || 0) + 1;
      persisted.failure_state[id] = {
        failures,
        repair_attempt: failures,
        next_action: failures >= 2 ? "DIAGNOSE" : "IMPLEMENT",
        next_model: failures >= 2 ? "claude-sonnet-5-5" : "claude-haiku-5-5",
        recent: [{ summary: "TEST FIXTURE repeated defect" }],
      };
    }
    if (req.action === "diagnose")
      persisted.failure_state[id].last_strategy = {
        hypothesis: "initial patch missed persistent state",
        experiment: "reload and inspect saved data",
      };
    if (req.action === "close-task") {
      assert.equal(persisted.implemented[id], true);
      persisted.tasks.find((t) => t.id === id).status = "PASS";
      persisted.completed_since_audit++;
    }
    if (req.action === "milestone-audit")
      audits.push(persisted.tasks.filter((t) => t.status === "PASS").length);
    if (req.action === "checkpoint-audit") persisted.completed_since_audit = 0;
    return ok({ snapshot: snapshot() });
  };
  let result,
    bursts = 0;
  for (; bursts < 10; bursts++) {
    result = await runController(
      { ...input, max_sprints: 1, observation_id: "burst-" + bursts },
      callback,
    );
    if (!result.summary.startsWith("CONTINUE_PARENT")) break;
    assert.equal(result.snapshot.next, "REOBSERVE_AND_LAUNCH");
    if (bursts === 1) persisted = JSON.parse(JSON.stringify(persisted)); // New parent context reads only the persisted handoff.
  }
  assert.ok(bursts >= 5);
  assert.deepEqual(audits, [2, 4]);
  assert.equal(persisted.failure_state.R1.failures, 2);
  assert.ok(
    trace.some(
      (x) =>
        x.task === "R1" &&
        x.action === "implement" &&
        x.role === "sonnet-planner",
    ),
  );
  assert.equal(trace.filter((x) => x.action === "architecture").length, 1);
  assert.equal(
    persisted.tasks.every((t) => t.status === "PASS"),
    true,
  );
  assert.equal(result.status, "PASS");
  assert.match(result.summary, /READY_FOR_PARENT_GATE/);
});

test("resumed task runtime context keeps its original execution while coordinator uses the new root lease", async () => {
  const calls = [];
  let done = false;
  await runController(
    {
      ...input,
      run_id: "new-parent",
      attempt_id: "new-parent-attempt",
      max_sprints: 1,
    },
    async (prompt) => {
      const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
      calls.push(req);
      if (req.action === "close-task") done = true;
      return ok({
        snapshot: {
          architecture_ready: true,
          tasks: [
            {
              id: "R1",
              status: done ? "PASS" : "UNVERIFIED",
              dependencies: [],
              execution: {
                run_id: "old-implementation",
                attempt_id: "old-task-attempt",
              },
            },
          ],
          resume: done
            ? null
            : { task_id: "R1", stage: "REVIEW", observe_required: true },
        },
      });
    },
  );
  const review = calls.find((c) => c.action === "review");
  assert.equal(review.context.run_id, "old-implementation");
  assert.equal(review.context.attempt_id, "old-task-attempt");
  assert.equal(
    calls.find((c) => c.action === "plan").context.run_id,
    "new-parent",
  );
  assert.equal(
    calls.some((c) => c.action === "implement"),
    false,
  );
});

test("persisted external blocker remains a defer after many old failures rather than triggering code redesign", async () => {
  const trace = [];
  let blocked = false;
  await runController({ ...input, max_sprints: 1 }, async (prompt) => {
    const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
    trace.push(req);
    if (req.action === "defer-or-replan") blocked = true;
    return ok({
      snapshot: {
        architecture_ready: true,
        tasks: [
          {
            id: "R1",
            status: blocked ? "BLOCKED" : "UNVERIFIED",
            dependencies: [],
          },
        ],
        failure_state: {
          R1: {
            failures: 8,
            repair_attempt: 8,
            next_action: "DEFER",
            blocker: {
              category: "model_limit",
              next_step: "resume after account quota reset",
            },
          },
        },
      },
    });
  });
  assert.equal(
    trace.some((x) => x.action === "implement"),
    false,
  );
  assert.equal(
    trace.some((x) => x.role === "opus-auditor"),
    false,
  );
  assert.ok(trace.some((x) => x.action === "defer-or-replan"));
});

test("changed recovery strategy clears external defer while preserving failure history and requiring fresh acceptance", async (t) => {
  const { failureAction, failureSummary } = await import(
    "../scripts/failure.mjs"
  );
  const f = fixture(t);
  state({
    target: f.target,
    action: "begin",
    run: "r",
    task: "mission",
    attempt: "a",
  });
  const input = path.join(f.base, "input.json"),
    args = { target: f.target, run: "r", attempt: "a", task: "R1", input };
  json(input, {
    stage: "test",
    category: "environment",
    status: "BLOCKED",
    model: "claude-haiku-5-5",
    summary: "TEST FIXTURE browser unavailable",
    hypothesis: "browser package missing",
    experiment: "launch Chromium",
    next_step: "install browser",
    evidence_refs: [],
  });
  failureAction({ ...args, action: "record", id: "missing-browser" });
  assert.equal(failureSummary(f.target, "R1").next_action, "DEFER");
  json(input, {
    model: "claude-sonnet-5-5",
    hypothesis: "browser installation restored tool availability",
    experiment: "launch installed browser and rerun original scenario",
    next_step: "rerun mandatory acceptance checks",
    evidence_refs: [],
  });
  failureAction({ ...args, action: "strategy", id: "tool-repaired" });
  const s = failureSummary(f.target, "R1");
  assert.equal(s.next_action, "IMPLEMENT");
  assert.equal(s.blocker, null);
  assert.equal(s.failures, 1);
  assert.equal(
    read(path.join(f.dir, "backlog.json")).items[0].status,
    "UNVERIFIED",
  );
});

test("external recovery does not spend code repair rounds or force expensive implementation elevation", async (t) => {
  const { failureAction, failureSummary } = await import(
    "../scripts/failure.mjs"
  );
  const f = fixture(t);
  state({
    target: f.target,
    action: "begin",
    run: "r",
    task: "mission",
    attempt: "a",
  });
  const input = path.join(f.base, "input.json"),
    args = { target: f.target, run: "r", attempt: "a", task: "R1", input };
  json(input, {
    stage: "implementation",
    category: "model_limit",
    status: "BLOCKED",
    model: "claude-haiku-5-5",
    summary: "TEST FIXTURE quota temporarily exhausted",
    hypothesis: "account usage window exhausted",
    experiment: "check current account quota response",
    next_step: "wait for stated reset time",
    evidence_refs: [],
  });
  for (let i = 0; i < 4; i++)
    failureAction({ ...args, action: "record", id: "quota-" + i });
  json(input, {
    model: "claude-sonnet-5-5",
    hypothesis: "quota window has reset",
    experiment: "confirm new request is available then continue unchanged task",
    next_step: "resume normal Haiku implementation",
    evidence_refs: [],
  });
  failureAction({ ...args, action: "strategy", id: "quota-restored" });
  const s = failureSummary(f.target, "R1");
  assert.equal(s.failures, 4);
  assert.equal(s.repair_attempt, 0);
  assert.equal(s.next_model, "claude-haiku-5-5");
  assert.equal(s.next_action, "IMPLEMENT");
});

test("explicit design contradiction returns to Opus after one failed implementation instead of repeated patches", async () => {
  const trace = [];
  let blocked = false;
  await runController({ ...input, max_sprints: 1 }, async (prompt) => {
    const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
    trace.push(req);
    if (req.action === "implement")
      return ok({
        status: "NEEDS_FIX",
        failure: {
          category: "design",
          hypothesis: "state contract contradicts schema",
          experiment: "compare preserved contract and schema",
          next_step: "Opus decides consistent architecture",
        },
      });
    if (req.action === "defer-or-replan") blocked = true;
    return ok({
      snapshot: {
        architecture_ready: true,
        tasks: [
          {
            id: "R1",
            status: blocked ? "BLOCKED" : "UNVERIFIED",
            dependencies: [],
          },
        ],
      },
    });
  });
  assert.equal(trace.filter((x) => x.action === "implement").length, 1);
  assert.ok(
    trace.some((x) => x.action === "replan" && x.role === "opus-auditor"),
  );
});

test("persisted unresolved design contradiction remains an Opus replan across a new Workflow context", async () => {
  const trace = [];
  await runController({ ...input, max_sprints: 1 }, async (prompt) => {
    const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
    trace.push(req);
    return ok({
      snapshot: {
        architecture_ready: true,
        tasks: [{ id: "R1", status: "UNVERIFIED", dependencies: [] }],
        failure_state: {
          R1: {
            failures: 1,
            repair_attempt: 1,
            next_action: "REPLAN",
            recent: [
              {
                category: "design",
                summary: "TEST FIXTURE contradictory architecture",
              },
            ],
          },
        },
      },
    });
  });
  assert.equal(
    trace.some((x) => x.action === "implement"),
    false,
  );
  assert.ok(
    trace.some((x) => x.action === "replan" && x.role === "opus-auditor"),
  );
});

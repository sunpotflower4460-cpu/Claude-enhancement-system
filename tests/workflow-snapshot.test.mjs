import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fixture,
  contracts,
  fingerprint,
  binding,
} from "./helpers/fixture.mjs";
import { runController, input } from "./helpers/controller.mjs";

// These agents are TEST FIXTURE callbacks. The product hash comes from actual
// files; read-only roles consume the provided snapshot just as the native role
// contract requires, rather than silently recomputing/fixing a stale snapshot.
const ok = (extra = {}) => ({
  status: "PASS",
  summary: "TEST FIXTURE",
  findings: [],
  ...extra,
});
function scenario(t, { unfixable = false } = {}) {
  const f = fixture(t),
    trace = [];
  let completed = false,
    revision = 0,
    completedSinceAudit = 0;
  const snapshot = () => {
    const c = contracts(f.target);
    return {
      architecture_ready: true,
      product: fingerprint(f.target),
      contract: c.digest,
      identity: binding(c),
      observation_id: "observed-" + revision,
      tasks: c.backlog.items.map((x) => ({
        ...x,
        status: completed ? "PASS" : "UNVERIFIED",
      })),
      completed_since_audit: completedSinceAudit,
    };
  };
  const agent = async (prompt) => {
    const request = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
    trace.push({ prompt, request });
    if (request.action === "implement") {
      fs.appendFileSync(
        path.join(f.target, "check.mjs"),
        "\n// Actual TEST FIXTURE product edit",
      );
      revision++;
    }
    if (["sonnet-reviewer", "opus-auditor"].includes(request.role)) {
      const supplied = request.payload.snapshot;
      assert.ok(
        supplied,
        "read-only agent must receive the inspected snapshot",
      );
      assert.equal(
        supplied.product,
        fingerprint(f.target),
        "provided snapshot must match product after implementation",
      );
      assert.equal(
        request.observation_id,
        "observed-" + revision,
        "request must carry the latest inspection, not initial burst observation",
      );
    }
    if (request.action === "close-task") {
      completed = true;
      completedSinceAudit++;
    }
    if (request.action === "checkpoint-audit") completedSinceAudit = 0;
    return ok({
      status:
        unfixable && request.action === "implement" ? "NEEDS_FIX" : "PASS",
      snapshot: snapshot(),
    });
  };
  return { f, trace, agent };
}

test("readonly task review receives current actual product after implementation", async (t) => {
  const s = scenario(t);
  await runController({ ...input, max_sprints: 1 }, s.agent);
  const built = s.trace.findIndex((x) => x.request.action === "implement"),
    review = s.trace.findIndex((x) => x.request.action === "review");
  assert.ok(built >= 0 && review > built);
  assert.ok(
    s.trace
      .slice(built + 1, review)
      .some((x) => x.request.action === "inspect"),
    "fresh inspection separates builder and reviewer",
  );
});

test("readonly milestone and final auditors always receive fresh full snapshots", async (t) => {
  const s = scenario(t);
  const result = await runController(
    { ...input, max_sprints: 3, milestone_every: 1 },
    s.agent,
  );
  assert.match(result.summary, /READY_FOR_PARENT_GATE/);
  for (const action of ["milestone-audit", "final-review", "final-audit"]) {
    const i = s.trace.findIndex((x) => x.request.action === action);
    assert.ok(i >= 0, action + " must run");
    assert.equal(
      s.trace[i - 1].request.action,
      "inspect",
      action + " must immediately follow a current inspection",
    );
  }
});

test("repeated inspector prompts have deterministic distinct sequence values across product writes", async (t) => {
  const s = scenario(t);
  await runController(
    { ...input, max_sprints: 3, milestone_every: 1 },
    s.agent,
  );
  const inspections = s.trace.filter((x) => x.request.action === "inspect");
  assert.ok(inspections.length >= 4);
  const sequence = inspections.map(
    (x) => x.request.payload.inspection_sequence,
  );
  assert.deepEqual(
    sequence,
    sequence.map((_, i) => i),
  );
  assert.equal(
    new Set(inspections.map((x) => x.prompt)).size,
    inspections.length,
    "runtime prompt cache must not replay a pre-edit inspection",
  );
});

test("readonly Opus replan receives fresh changed product and retains selected task execution", async (t) => {
  const s = scenario(t, { unfixable: true });
  await runController({ ...input, max_sprints: 1 }, s.agent);
  const i = s.trace.findIndex((x) => x.request.action === "replan");
  assert.ok(i >= 0);
  assert.equal(s.trace[i - 1].request.action, "inspect");
  assert.equal(s.trace[i].request.context.task_id, "R1");
  assert.equal(
    s.trace[i].request.context.attempt_id,
    contracts(s.f.target).backlog.items[0].execution.attempt_id,
  );
});

test("failed fresh inspection blocks read-only assessment instead of reusing a cached snapshot", async (t) => {
  const s = scenario(t);
  let built = false,
    reviewed = false;
  await assert.rejects(
    () =>
      runController({ ...input, max_sprints: 1 }, async (prompt) => {
        const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
        if (req.action === "implement") built = true;
        if (req.action === "inspect" && built)
          return ok({
            status: "BLOCKED",
            summary: "TEST FIXTURE current filesystem cannot be observed",
          });
        if (req.role === "sonnet-reviewer") reviewed = true;
        return s.agent(prompt);
      }),
    /Current read-only assessment snapshot unavailable/,
  );
  assert.equal(reviewed, false);
});

test("overdue persisted milestone is audited before planning another task after interruption", async () => {
  let count = 2;
  const trace = [];
  const snapshot = () => ({
    architecture_ready: true,
    completed_since_audit: count,
    tasks: [
      {
        id: "R1",
        status: "PASS",
        dependencies: [],
        execution: { run_id: "run", attempt_id: "one" },
      },
      {
        id: "R2",
        status: "PASS",
        dependencies: [],
        execution: { run_id: "run", attempt_id: "two" },
      },
      {
        id: "R3",
        status: "UNVERIFIED",
        dependencies: [],
        execution: { run_id: "run", attempt_id: "three" },
      },
    ],
  });
  await runController({ ...input, max_sprints: 1 }, async (prompt) => {
    const r = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
    trace.push(r.action);
    if (r.action === "checkpoint-audit") count = 0;
    return {
      status: r.action === "plan" ? "BLOCKED" : "PASS",
      summary: "TEST FIXTURE",
      findings: [],
      snapshot: snapshot(),
    };
  });
  assert.ok(
    trace.includes("milestone-audit"),
    "due audit cannot wait for another task to finish",
  );
  assert.ok(
    !trace.includes("plan") ||
      trace.indexOf("milestone-audit") < trace.indexOf("plan"),
  );
});

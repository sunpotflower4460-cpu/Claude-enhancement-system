import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  fixture,
  read,
  json,
  terminated,
  contracts,
  fingerprint,
} from "./helpers/fixture.mjs";
import { state } from "../scripts/state.mjs";
import { taskAction } from "../scripts/task.mjs";
import { operation } from "../scripts/operation.mjs";
import { nextAction } from "../scripts/next.mjs";
import { runController, input } from "./helpers/controller.mjs";

function stoppedReadonly(
  t,
  stage = "REVIEW",
  { legacy = false, begin = true, pause = false } = {},
) {
  const f = fixture(t),
    root = {
      target: f.target,
      run: "old",
      task: "mission",
      attempt: "old-root",
    };
  state({ ...root, action: "begin" });
  state({ ...root, action: "transition", stage: "PLAN" });
  taskAction({ ...root, action: "select", task: "R1" });
  const execution = read(path.join(f.dir, "backlog.json")).items[0].execution;
  state({ ...root, action: "transition", stage: "IMPLEMENT" });
  const op = {
    ...root,
    task: "R1",
    id: "implemented-once",
    stage: "IMPLEMENT",
  };
  operation({ ...op, action: "start" });
  fs.appendFileSync(
    path.join(f.target, "check.mjs"),
    "\n// already implemented exactly once",
  );
  const result = path.join(f.base, "built.json");
  json(result, { status: "PASS" });
  operation({ ...op, action: "complete", result });
  if (stage !== "IMPLEMENT")
    state({ ...root, action: "transition", stage: "REVIEW" });
  if (stage === "VERIFY")
    state({ ...root, action: "transition", stage: "VERIFY" });
  if (legacy)
    for (const n of fs.readdirSync(path.join(f.dir, "operations")))
      fs.unlinkSync(path.join(f.dir, "operations", n));
  const proof = terminated(f, { state: pause ? "completed" : "stopped" });
  state({ target: f.target, action: "recover", proof, fixture: true });
  if (begin)
    state({
      target: f.target,
      action: "begin",
      run: "new",
      task: "mission",
      attempt: "new-root",
    });
  return { ...f, execution };
}
for (const stage of ["IMPLEMENT", "REVIEW", "VERIFY"])
  test(
    "readonly " +
      stage +
      " interruption resumes without a fabricated writer or duplicate implementation",
    async (t) => {
      const f = stoppedReadonly(t, stage),
        next = nextAction({ target: f.target, run: "new" });
      assert.equal(next.action, "RESUME");
      assert.equal(next.resume.stage, stage === "IMPLEMENT" ? "REVIEW" : stage);
      assert.equal(next.resume.recovery_kind, "READONLY");
      const ops = fs
        .readdirSync(path.join(f.dir, "operations"))
        .map((n) => read(path.join(f.dir, "operations", n)));
      assert.equal(ops.length, 1);
      assert.equal(ops[0].state, "completed");
      assert.equal(ops[0].stage, "IMPLEMENT");
      taskAction({
        target: f.target,
        action: "select",
        run: "new",
        attempt: "new-root",
        task: "R1",
        resume: true,
        observed_fingerprint: fingerprint(f.target),
        reason: "Inspected retained completed implementation and product diff",
      });
      assert.deepEqual(
        read(path.join(f.dir, "backlog.json")).items[0].execution,
        f.execution,
      );
      const actions = [];
      let done = false;
      await runController(
        { ...input, run_id: "new", attempt_id: "new-root", max_sprints: 1 },
        async (prompt) => {
          const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
          actions.push(req.action);
          if (req.action === "close-task") done = true;
          return {
            status: "PASS",
            summary: "TEST FIXTURE mock agents with real recovered state",
            findings: [],
            snapshot: {
              architecture_ready: true,
              tasks: contracts(f.target).backlog.items.map((t) => ({
                ...t,
                status: done ? "PASS" : "UNVERIFIED",
              })),
              resume: done ? null : next.resume,
            },
          };
        },
      );
      assert.equal(actions.includes("implement"), false);
      assert.equal(
        fs
          .readFileSync(path.join(f.target, "check.mjs"), "utf8")
          .split("already implemented exactly once").length - 1,
        1,
      );
    },
  );

test("readonly VERIFY recovery downgrades to REVIEW when product changed after stop", (t) => {
  const f = stoppedReadonly(t, "VERIFY");
  fs.appendFileSync(
    path.join(f.target, "check.mjs"),
    "\n// external edit after termination",
  );
  const n = nextAction({ target: f.target, run: "new" });
  assert.equal(n.resume.stage, "REVIEW");
  assert.equal(n.resume.changed, true);
});

test("readonly resume needs current inspection and refuses modified proof, receipt, or execution", (t) => {
  const f = stoppedReadonly(t),
    args = {
      target: f.target,
      action: "select",
      run: "new",
      attempt: "new-root",
      task: "R1",
      resume: true,
    };
  assert.throws(() => taskAction(args), /inspection|observed_fingerprint/);
  const resumePath = path.join(f.dir, "resume.json"),
    r = read(resumePath);
  const proofPath = path.join(f.dir, "evidence", r.proof_ref),
    proof = fs.readFileSync(proofPath);
  fs.appendFileSync(proofPath, " ");
  assert.throws(
    () =>
      taskAction({
        ...args,
        observed_fingerprint: fingerprint(f.target),
        reason: "Inspect",
      }),
    /proof.*changed|changed.*proof/i,
  );
  fs.writeFileSync(proofPath, proof);
  const implPath = path.join(f.dir, "operations", r.implementation_ref),
    impl = fs.readFileSync(implPath);
  fs.appendFileSync(implPath, " ");
  assert.throws(
    () => nextAction({ target: f.target, run: "new" }),
    /receipt.*changed|changed.*receipt/i,
  );
  fs.writeFileSync(implPath, impl);
  const backlogPath = path.join(f.dir, "backlog.json"),
    b = read(backlogPath);
  b.items[0].execution.attempt_id = "other";
  json(backlogPath, b);
  assert.throws(
    () => nextAction({ target: f.target, run: "new" }),
    /execution/,
  );
});

for (const stage of ["REVIEW", "VERIFY"])
  test(
    "legacy " +
      stage +
      " continuation uses actual stop/product snapshot without inventing implementation receipt",
    (t) => {
      const f = stoppedReadonly(t, stage, { legacy: true });
      const n = nextAction({ target: f.target, run: "new" });
      assert.equal(n.resume.stage, stage);
      assert.equal(n.resume.basis, "SNAPSHOT");
      assert.equal(n.resume.operation_id, null);
      assert.equal(fs.readdirSync(path.join(f.dir, "operations")).length, 0);
      taskAction({
        target: f.target,
        action: "select",
        run: "new",
        attempt: "new-root",
        task: "R1",
        resume: true,
        observed_fingerprint: fingerprint(f.target),
        reason:
          "Inspect legacy product and real terminal proof before independent review",
      });
      assert.deepEqual(
        contracts(f.target).backlog.items[0].execution,
        f.execution,
      );
    },
  );

test("readonly completed burst pause preserves continuation and new binding retains historical stop proof", async (t) => {
  const f = stoppedReadonly(t, "REVIEW", { pause: true, begin: false }),
    oldSession = contracts(f.target).session.session_id;
  const { reconnect } = await import("../scripts/reconnect.mjs");
  reconnect({ target: f.target });
  assert.notEqual(contracts(f.target).session.session_id, oldSession);
  state({
    target: f.target,
    action: "begin",
    run: "new",
    task: "mission",
    attempt: "new-root",
  });
  const n = nextAction({ target: f.target, run: "new" });
  assert.equal(n.resume.stage, "REVIEW");
  taskAction({
    target: f.target,
    action: "select",
    run: "new",
    attempt: "new-root",
    task: "R1",
    resume: true,
    observed_fingerprint: n.resume.inspection_fingerprint,
    reason:
      "Observe retained product after rebinding; revalidate all assessments",
  });
  assert.deepEqual(contracts(f.target).backlog.items[0].execution, f.execution);
});

test("interrupted verification writer also returns through REVIEW after an external product edit", (t) => {
  const f = fixture(t),
    root = { target: f.target, run: "old", task: "mission", attempt: "a" };
  state({ ...root, action: "begin" });
  state({ ...root, action: "transition", stage: "PLAN" });
  taskAction({ ...root, action: "select", task: "R1" });
  state({ ...root, action: "transition", stage: "IMPLEMENT" });
  state({ ...root, action: "transition", stage: "REVIEW" });
  state({ ...root, action: "transition", stage: "VERIFY" });
  operation({
    ...root,
    task: "R1",
    id: "verification-writer",
    action: "start",
    stage: "VERIFY",
  });
  const proof = terminated(f, { state: "stopped" });
  state({ target: f.target, action: "recover", proof, fixture: true });
  fs.appendFileSync(
    path.join(f.target, "check.mjs"),
    "\n// changed after verification stopped",
  );
  state({
    target: f.target,
    action: "begin",
    run: "new",
    task: "mission",
    attempt: "b",
  });
  const n = nextAction({ target: f.target, run: "new" });
  assert.equal(n.resume.stage, "REVIEW");
  assert.equal(n.resume.changed, true);
});

test("readonly continuation survives a fresh clone after original checkout disappears", async (t) => {
  const f = stoppedReadonly(t, "REVIEW", { begin: false });
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-qm",
    "retain completed implementation",
  );
  const clone = path.join(f.base, "fresh-clone");
  execFileSync("git", ["clone", "--quiet", f.target, clone]);
  execFileSync("git", [
    "-C",
    clone,
    "remote",
    "set-url",
    "origin",
    "https://github.com/example/project.git",
  ]);
  fs.cpSync(f.dir, path.join(clone, ".autodev"), { recursive: true });
  fs.rmSync(f.target, { recursive: true });
  const { reconnect } = await import("../scripts/reconnect.mjs");
  reconnect({ target: clone });
  state({
    target: clone,
    action: "begin",
    run: "new-clone",
    task: "mission",
    attempt: "new-clone-root",
  });
  const n = nextAction({ target: clone, run: "new-clone" });
  assert.equal(n.resume.stage, "REVIEW");
  assert.equal(n.resume.changed, false);
  taskAction({
    target: clone,
    action: "select",
    run: "new-clone",
    attempt: "new-clone-root",
    task: "R1",
    resume: true,
    observed_fingerprint: n.resume.inspection_fingerprint,
    reason:
      "Inspect re-cloned product and archived stop proof; rerun independent acceptance",
  });
  assert.deepEqual(contracts(clone).backlog.items[0].execution, f.execution);
  const { verify } = await import("../scripts/verify.mjs");
  assert.notEqual(
    verify({ target: clone, fixture: true }).status,
    "TEST_COMPLETE",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import {
  fixture,
  allPass,
  read,
  json,
  contracts,
  fingerprint,
  hash,
  artifactPath,
  shared,
  terminated,
} from "./helpers/fixture.mjs";
import { bootstrap } from "../scripts/bootstrap.mjs";
import { reconnect } from "../scripts/reconnect.mjs";
import { state } from "../scripts/state.mjs";
import { operation } from "../scripts/operation.mjs";
import { installAgents } from "../scripts/install-agents.mjs";
import {
  owner,
  unlock,
  load,
  identity,
  validate,
} from "../scripts/lib/core.mjs";
import { verify } from "../scripts/verify.mjs";
import { migrate } from "../scripts/migrate.mjs";
function copyCheckout(f, dest) {
  fs.cpSync(f.target, dest, {
    recursive: true,
    filter: (p) => !p.includes("/.git/") && p !== path.join(f.target, ".git"),
  });
  execFileSync("git", ["-C", dest, "init", "-b", "main"], { stdio: "pipe" });
  execFileSync("git", [
    "-C",
    dest,
    "remote",
    "add",
    "origin",
    "git@github.com:example/project.git",
  ]);
}
test("B1 same repository at another path reconnects but stale session evidence is invalidated", (t) => {
  const f = fixture(t);
  allPass(f);
  const dest = path.join(f.base, "reclone");
  copyCheckout(f, dest);
  assert.throws(() => contracts(dest), /Session binding/);
  const result = reconnect({ target: dest });
  assert.equal(result.status, "RECONNECTED");
  assert.notEqual(
    result.session.session_id,
    read(path.join(f.dir, "session.json")).session_id,
  );
  assert.equal(verify({ target: dest, fixture: true }).status, "UNVERIFIED");
});
test("B1 same folder name from another repository is never rebound", (t) => {
  const f = fixture(t),
    dest = path.join(f.base, "elsewhere", "target");
  fs.mkdirSync(path.dirname(dest));
  copyCheckout(f, dest);
  execFileSync("git", [
    "-C",
    dest,
    "remote",
    "set-url",
    "origin",
    "https://github.com/other/project.git",
  ]);
  assert.throws(() => reconnect({ target: dest }), /Repository identity/);
});
test("B1 new worktree, branch switch and detached HEAD require explicit rebind", (t) => {
  const f = fixture(t);
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-qm",
    "fixture",
  );
  const worktree = path.join(f.base, "worktree");
  f.git("worktree", "add", "-b", "feature", worktree);
  fs.cpSync(f.dir, path.join(worktree, ".autodev"), { recursive: true });
  assert.equal(reconnect({ target: worktree }).session.branch, "feature");
  execFileSync("git", ["-C", worktree, "checkout", "--detach"], {
    stdio: "pipe",
  });
  assert.throws(() => load(worktree), /binding changed/);
  assert.match(reconnect({ target: worktree }).session.branch, /DETACHED:/);
});
test("B1 SSH/HTTPS remote and common source relocation do not change persistent repository ID", (t) => {
  const f = fixture(t);
  f.git("remote", "set-url", "origin", "git@github.com:Example/Project.git");
  assert.equal(
    load(f.target).mission.target.repository,
    "github.com/example/project",
  );
  assert.deepEqual(Object.keys(load(f.target).mission.shared), ["repository"]);
});
test("B1 uncommitted partial edits are preserved during reconnection", (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.target, "check.mjs"), "\n// partial edit");
  const dest = path.join(f.base, "moved");
  copyCheckout(f, dest);
  const r = reconnect({ target: dest });
  assert.equal(r.changed, true);
  assert.match(
    fs.readFileSync(path.join(dest, "check.mjs"), "utf8"),
    /partial edit/,
  );
});
function begin(f, extra = {}) {
  return state({
    target: f.target,
    action: "begin",
    run: "run2",
    task: "mission",
    attempt: "attempt2",
    ...extra,
  });
}
function op(f, stage = "IMPLEMENT") {
  return {
    target: f.target,
    run: "run2",
    task: "R1",
    attempt: "attempt2",
    id: "stable-operation",
    stage,
  };
}
test("B2 duplicate task submission and wrong attempt cannot obtain ownership", (t) => {
  const f = fixture(t);
  begin(f);
  assert.throws(() => begin(f), /Active/);
  assert.throws(
    () =>
      state({
        target: f.target,
        action: "transition",
        run: "run2",
        task: "mission",
        attempt: "old",
        stage: "PLAN",
      }),
    /ownership/,
  );
});
for (const stage of ["IMPLEMENT", "REVIEW", "VERIFY"])
  test(
    "B2 interruption at " +
      stage +
      " resumes from observed stage, not blind implementation",
    (t) => {
      const f = fixture(t);
      begin(f);
      const o = op(f, stage);
      assert.equal(operation({ ...o, action: "start" }).status, "STARTED");
      if (stage === "IMPLEMENT")
        fs.appendFileSync(
          path.join(f.target, "check.mjs"),
          "\n// writer stopped before state update",
        );
      const retry = operation({ ...o, action: "start" });
      assert.equal(retry.status, "OBSERVE_REQUIRED");
      assert.equal(retry.resume, stage === "IMPLEMENT" ? "REVIEW" : stage);
    },
  );
test("B2 completed operation lost to parent is reused only on identical product and context", (t) => {
  const f = fixture(t);
  begin(f);
  const o = op(f);
  operation({ ...o, action: "start" });
  const result = path.join(f.base, "result.json");
  json(result, { status: "PASS", summary: "applied once" });
  operation({ ...o, action: "complete", result });
  const retry = operation({ ...o, action: "start" });
  assert.equal(retry.status, "ALREADY_APPLIED");
  assert.equal(retry.operation.result.summary, "applied once");
  fs.appendFileSync(path.join(f.target, "check.mjs"), "\n// external change");
  assert.equal(operation({ ...o, action: "start" }).status, "OBSERVE_REQUIRED");
});
test("B2 recovery requires terminal runtime proof and refuses living previous owner", (t) => {
  const f = fixture(t);
  begin(f, { pid: String(process.pid) });
  const proof = terminated(f, { state: "stopped" });
  assert.throws(
    () => state({ target: f.target, action: "recover", proof, fixture: true }),
    /owner still active/,
  );
  assert.throws(
    () => reconnect({ target: f.target, proof, fixture: true }),
    /owner still active/,
  );
});
test("B2 terminated writer can recover without losing partial edits; attempt is not reusable", (t) => {
  const f = fixture(t);
  begin(f);
  const o = op(f);
  operation({ ...o, action: "start" });
  fs.appendFileSync(path.join(f.target, "check.mjs"), "\n// partial");
  const proof = terminated(f, { state: "stopped" });
  const recovered = state({
    target: f.target,
    action: "recover",
    proof,
    fixture: true,
  });
  assert.equal(recovered.stage, "BLOCKED");
  assert.match(recovered.history.at(-1).note, /changed/);
  assert.throws(() => begin(f), /already used/);
  assert.match(
    fs.readFileSync(path.join(f.target, "check.mjs"), "utf8"),
    /partial/,
  );
});
test("B2 terminal record with pending runtime tasks cannot unlock the run", (t) => {
  const f = fixture(t);
  begin(f);
  const p = terminated(f, { state: "stopped" }),
    proof = read(p),
    raw = artifactPath(f.dir, proof.record),
    es = fs.readFileSync(raw, "utf8").split("\n").map(JSON.parse);
  es.at(-1).tasks = [{ task_id: "still-running" }];
  fs.writeFileSync(raw, es.map(JSON.stringify).join("\n"));
  proof.sha256 = hash(fs.readFileSync(raw));
  json(p, proof);
  assert.throws(
    () =>
      state({ target: f.target, action: "recover", proof: p, fixture: true }),
    /drained/,
  );
});
test("B2 stale lock is only recovered after local process and check group terminate", (t) => {
  const f = fixture(t);
  json(path.join(f.dir, ".mutex"), owner());
  assert.throws(() => unlock(f.target), /owner active/);
  json(path.join(f.dir, ".mutex"), {
    pid: 999999999,
    host: owner().host,
    start: "dead",
  });
  json(artifactPath(f.dir, "runner-active.json"), {
    state: "running",
    owner: owner(),
  });
  assert.throws(() => unlock(f.target), /Check process/);
  fs.unlinkSync(artifactPath(f.dir, "runner-active.json"));
  unlock(f.target);
  assert.equal(fs.existsSync(path.join(f.dir, ".mutex")), false);
});
test("A2/B1 legacy migration preserves originals, archives evidence, resets acceptance and rejects old records", (t) => {
  const f = fixture(t),
    id = identity(f.target),
    m = read(path.join(f.dir, "mission.json"));
  json(path.join(f.dir, "mission.json"), {
    version: 1,
    original: m.original,
    requirements: m.requirements,
    profile: m.profile,
    target: {
      root: id.root,
      gitDir: id.gitDir,
      remote: id.remote,
      branch: id.branch,
    },
    shared,
  });
  const b = read(path.join(f.dir, "backlog.json"));
  json(path.join(f.dir, "backlog.json"), {
    version: 1,
    items: b.items.map(({ check_refs, execution, ...x }) => ({
      ...x,
      status: "PASS",
    })),
  });
  assert.equal(migrate(f).status, "MIGRATED_REVALIDATION_REQUIRED");
  assert.equal(read(path.join(f.dir, "mission.json")).original, m.original);
  assert.equal(
    read(path.join(f.dir, "backlog.json")).items[0].status,
    "UNVERIFIED",
  );
  assert.equal(fs.existsSync(path.join(f.dir, "contract.json")), false);
  assert.throws(() => validate("assessment", { version: 1 }));
});
test("native agent installer is idempotent and refuses collisions before writing any file", (t) => {
  const f = fixture(t),
    before = fs.readFileSync(
      path.join(f.target, ".claude/settings.json"),
      "utf8",
    );
  const result = installAgents(f);
  assert.equal(result.agents["sonnet-reviewer"], "autodev-sonnet-reviewer");
  installAgents(f);
  assert.equal(
    fs.readFileSync(path.join(f.target, ".claude/settings.json"), "utf8"),
    before,
  );
  fs.writeFileSync(
    path.join(f.target, ".claude/agents/autodev-sonnet-reviewer.md"),
    "user definition",
  );
  assert.throws(() => installAgents(f), /conflict/);
});
test("B2 same run cannot start simultaneous writers or hide a missing operation result", (t) => {
  const f = fixture(t);
  allPass(f);
  begin(f);
  const o = op(f);
  operation({ ...o, action: "start" });
  assert.throws(
    () => operation({ ...o, id: "other-writer", action: "start" }),
    /Pending operation/,
  );
  const s = read(path.join(f.dir, "current-task.json"));
  s.stage = "IDLE";
  s.active = false;
  json(path.join(f.dir, "current-task.json"), s);
  terminated(f);
  assert.ok(
    verify({ target: f.target, fixture: true }).issues.some((x) =>
      x.includes("operation"),
    ),
  );
});
test("G late task_started after empty snapshot invalidates termination and final gate", (t) => {
  const f = fixture(t);
  allPass(f);
  const p = terminated(f),
    proof = read(p),
    raw = artifactPath(f.dir, proof.record);
  fs.appendFileSync(
    raw,
    "\n" +
      JSON.stringify({
        type: "system",
        subtype: "task_started",
        session_id: proof.sdk_session_id,
        task_id: "late-writer",
        run_id: "late-run",
      }),
  );
  proof.sha256 = hash(fs.readFileSync(raw));
  json(p, proof);
  assert.ok(
    verify({ target: f.target, fixture: true }).issues.some((x) =>
      x.includes("after drained"),
    ),
  );
});
test("G interrupted operation is inherited by new attempt and explicitly observed before another implementation", (t) => {
  const f = fixture(t);
  begin(f);
  const o = op(f);
  operation({ ...o, action: "start" });
  fs.appendFileSync(path.join(f.target, "check.mjs"), "\n// partial");
  const proof = terminated(f, { state: "stopped" });
  state({ target: f.target, action: "recover", proof, fixture: true });
  state({
    target: f.target,
    action: "begin",
    run: "run2",
    task: "mission",
    attempt: "attempt3",
  });
  const newer = { ...o, attempt: "attempt3", id: "new-op" };
  assert.throws(() => operation({ ...newer, action: "start" }), /observation/);
  const observation = path.join(f.base, "observed.json");
  json(observation, {
    observed_fingerprint: fingerprint(f.target),
    reason: "Read diff; partial code must enter independent review",
  });
  assert.equal(
    operation({
      ...o,
      attempt: "attempt3",
      action: "observe",
      result: observation,
    }).status,
    "OBSERVED",
  );
  assert.equal(operation({ ...newer, action: "start" }).status, "STARTED");
});
test("G bootstrap publishes session and mission together even if interrupted immediately after rename", (t) => {
  const f = fixture(t);
  fs.rmSync(f.dir, { recursive: true });
  const rename = fs.renameSync;
  let injected = false;
  fs.renameSync = (src, dest) => {
    rename(src, dest);
    if (dest === f.dir && !injected) {
      injected = true;
      throw Error("injected after publish");
    }
  };
  try {
    assert.throws(
      () => bootstrap({ target: f.target, mission: f.source }),
      /injected/,
    );
  } finally {
    fs.renameSync = rename;
  }
  assert.ok(load(f.target).session.session_id);
  assert.equal(
    bootstrap({ target: f.target, mission: f.source }).status,
    "RESUMED",
  );
});
test("G migration resumes after mission-v2 publication before backlog update", (t) => {
  const f = fixture(t),
    id = identity(f.target),
    m = read(path.join(f.dir, "mission.json"));
  json(path.join(f.dir, "mission.json"), {
    version: 1,
    original: m.original,
    requirements: m.requirements,
    profile: m.profile,
    target: {
      root: id.root,
      gitDir: id.gitDir,
      remote: id.remote,
      branch: id.branch,
    },
    shared,
  });
  const b = read(path.join(f.dir, "backlog.json"));
  json(path.join(f.dir, "backlog.json"), {
    version: 1,
    items: b.items.map(({ check_refs, execution, ...x }) => x),
  });
  const rename = fs.renameSync;
  let injected = false;
  fs.renameSync = (src, dest) => {
    if (dest === path.join(f.dir, "backlog.json") && !injected) {
      injected = true;
      throw Error("injected migration stop");
    }
    return rename(src, dest);
  };
  try {
    assert.throws(() => migrate(f), /injected/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(read(path.join(f.dir, "mission.json")).version, 2);
  assert.equal(read(path.join(f.dir, "backlog.json")).version, 1);
  assert.equal(migrate(f).status, "MIGRATED_REVALIDATION_REQUIRED");
  assert.equal(read(path.join(f.dir, "backlog.json")).version, 2);
  assert.equal(read(path.join(f.dir, "migration.json")).state, "completed");
});
test("G next CLI returns the actual selected task and structured resume stage to controller", async (t) => {
  const f = fixture(t, { count: 2 });
  begin(f);
  const { taskAction } = await import("../scripts/task.mjs");
  taskAction({
    target: f.target,
    action: "select",
    run: "run2",
    attempt: "attempt2",
    task: "R2",
  });
  state({
    target: f.target,
    action: "transition",
    run: "run2",
    task: "mission",
    attempt: "attempt2",
    stage: "PLAN",
  });
  state({
    target: f.target,
    action: "transition",
    run: "run2",
    task: "mission",
    attempt: "attempt2",
    stage: "IMPLEMENT",
  });
  fs.appendFileSync(
    path.join(f.target, "check.mjs"),
    "\n// edited before progress checkpoint",
  );
  const { nextAction } = await import("../scripts/next.mjs"),
    next = nextAction({ target: f.target, run: "run2" });
  assert.equal(next.resume.task_id, "R2");
  assert.equal(next.resume.stage, "REVIEW");
  const { runController, agents } = await import("./helpers/controller.mjs");
  const calls = [];
  const r = await runController(
    {
      target: f.target,
      shared: "COMMON",
      run_id: "run2",
      attempt_id: "attempt2",
      mission_id: load(f.target).mission.mission_id,
      session_id: load(f.target).session.session_id,
      observation_id: "fresh-state",
      agents,
      capabilities: { registry_verified: true, readonly_verified: true },
    },
    async (prompt) => {
      const req = JSON.parse(prompt.split("\nAUTODEV_REQUEST ")[1]);
      calls.push(req);
      if (req.action === "persist-review")
        return {
          status: "BLOCKED",
          summary: "TEST FIXTURE deliberate global pause after review",
          findings: [],
          snapshot: { blocker_scope: "global" },
        };
      return {
        status: "PASS",
        summary: "TEST FIXTURE",
        findings: [],
        snapshot: {
          architecture_ready: true,
          tasks: read(path.join(f.dir, "backlog.json")).items,
          resume: next.resume,
        },
      };
    },
  );
  assert.equal(r.status, "BLOCKED");
  assert.ok(calls.some((x) => x.action === "review" && x.task_id === "R2"));
  assert.equal(
    calls.some((x) => x.action === "implement"),
    false,
  );
});
test("G termination proof cannot be borrowed from another target session", (t) => {
  const f = fixture(t);
  allPass(f);
  const p = terminated(f),
    proof = read(p),
    raw = artifactPath(f.dir, proof.record),
    es = fs.readFileSync(raw, "utf8").split("\n").map(JSON.parse);
  es[1].message.content[0].input.args.session_id = "another-binding";
  fs.writeFileSync(raw, es.map(JSON.stringify).join("\n"));
  proof.sha256 = hash(fs.readFileSync(raw));
  json(p, proof);
  assert.ok(
    verify({ target: f.target, fixture: true }).issues.some((x) =>
      x.includes("correlated Workflow"),
    ),
  );
});
test("G unsupported late task status cannot masquerade as a drained terminal event", (t) => {
  const f = fixture(t);
  allPass(f);
  const p = terminated(f),
    proof = read(p),
    raw = artifactPath(f.dir, proof.record);
  fs.appendFileSync(
    raw,
    "\n" +
      [
        {
          type: "system",
          subtype: "task_started",
          session_id: proof.sdk_session_id,
          task_id: "late",
          run_id: "late-run",
        },
        {
          type: "system",
          subtype: "task_notification",
          session_id: proof.sdk_session_id,
          task_id: "late",
          run_id: "late-run",
          status: "running",
        },
      ]
        .map(JSON.stringify)
        .join("\n"),
  );
  proof.sha256 = hash(fs.readFileSync(raw));
  json(p, proof);
  assert.ok(
    verify({ target: f.target, fixture: true }).issues.some((x) =>
      x.includes("Invalid SDK task terminal status"),
    ),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  fixture,
  json,
  read,
  shared,
  contracts,
  terminated,
  allPass,
  recordAll,
  attest,
  runtime,
} from "./helpers/fixture.mjs";
import { state } from "../scripts/state.mjs";
import { reconnect } from "../scripts/reconnect.mjs";
import { operation } from "../scripts/operation.mjs";
import { nextAction } from "../scripts/next.mjs";
import { verify } from "../scripts/verify.mjs";
import { taskAction } from "../scripts/task.mjs";
import { record } from "../scripts/record.mjs";
const cli = (...args) =>
  spawnSync(
    process.execPath,
    [path.join(shared, "scripts/checkpoint.mjs"), ...args],
    { encoding: "utf8" },
  );
test("new clone restores saved eight-task partial product and original requirements without duplicate implementation", (t) => {
  const f = fixture(t, { count: 8 });
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "add",
    ".",
  );
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "base",
  );
  const b = read(path.join(f.dir, "backlog.json"));
  json(
    path.join(f.target, "product.json"),
    Object.fromEntries(b.items.map((x, i) => [x.id, i < 3])),
  );
  fs.writeFileSync(
    path.join(f.target, "new-feature.mjs"),
    "export const implemented = 3;\n",
  );
  fs.writeFileSync(
    path.join(f.dir, "architecture.md"),
    "TEST FIXTURE long plan: preserve R1-R8 and implement each task with test/API acceptance.",
  );
  state({
    target: f.target,
    action: "begin",
    run: "run",
    task: "mission",
    attempt: "attempt",
  });
  json(path.join(f.dir, "routing.json"), [
    runtime(f, { role: "architecture", model: "claude-opus-5-5" }),
    runtime(f, { role: "plan", model: "claude-sonnet-5-5" }),
    runtime(f, { role: "implement", model: "claude-haiku-5-5", task_id: "R1" }),
  ]);
  for (const task of b.items.slice(0, 3)) {
    for (const check of task.check_refs) record({ target: f.target, check });
    attest(f, { scope: "task", taskId: task.id });
    assert.equal(
      taskAction({
        target: f.target,
        action: "complete",
        run: "run",
        attempt: "attempt",
        task: task.id,
        fixture: true,
      }).status,
      "PASS",
    );
  }
  state({
    target: f.target,
    action: "pause",
    proof: terminated(f),
    fixture: true,
  });
  const original = read(path.join(f.dir, "mission.json")),
    oldSession = contracts(f.target).session.session_id;
  const before = f.git("status", "--porcelain=v1");
  const remote = path.join(f.base, "remote.git");
  execFileSync("git", ["init", "--bare", "--quiet", remote]);
  f.git("config", "remote.origin.pushurl", remote);
  f.git("push", "origin", "main");
  const r = cli("--target", f.target, "--action", "save", "--publish", "true");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const saved = JSON.parse(r.stdout);
  assert.equal(saved.status, "PUBLISHED");
  assert.equal(
    f.git("status", "--porcelain=v1"),
    before,
    "save never changes real index or files",
  );
  fs.rmSync(f.target, { recursive: true });
  // Destroy the original process context: restoration uses only published Git objects.
  const clone = path.join(f.base, "new-clone");
  execFileSync("git", ["clone", "--quiet", "--branch", "main", remote, clone]);
  execFileSync("git", [
    "-C",
    clone,
    "remote",
    "set-url",
    "origin",
    "git@github.com:example/project.git",
  ]);
  const relocatedCommon = path.join(f.base, "common relocated 日本語");
  fs.cpSync(shared, relocatedCommon, {
    recursive: true,
    filter: (p) =>
      ![".git", "node_modules", "tests", "docs"].includes(
        path.relative(shared, p).split(path.sep)[0],
      ),
  });
  fs.symlinkSync(
    path.join(shared, "node_modules"),
    path.join(relocatedCommon, "node_modules"),
    "dir",
  );
  execFileSync("git", ["-C", relocatedCommon, "init", "-b", "main"], {
    stdio: "pipe",
  });
  execFileSync("git", [
    "-C",
    relocatedCommon,
    "remote",
    "add",
    "origin",
    execFileSync("git", ["-C", shared, "remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim(),
  ]);
  const relocatedCli = (name, ...args) =>
    spawnSync(
      process.execPath,
      [path.join(relocatedCommon, "scripts", name + ".mjs"), ...args],
      { encoding: "utf8" },
    );
  const restored = relocatedCli(
    "checkpoint",
    "--target",
    clone,
    "--action",
    "restore",
    "--ref",
    "origin/" + saved.branch,
  );
  assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  assert.equal(
    read(path.join(clone, ".autodev/mission.json")).original,
    original.original,
  );
  assert.equal(
    fs.readFileSync(path.join(clone, "new-feature.mjs"), "utf8"),
    "export const implemented = 3;\n",
  );
  assert.notEqual(contracts(clone).session.session_id, oldSession);
  assert.equal(nextAction({ target: clone }).task_id, "R4");
  assert.equal(read(path.join(clone, "product.json")).R3, true);
  assert.notEqual(
    verify({ target: clone, fixture: true }).status,
    "TEST_COMPLETE",
    "old binding proofs cannot approve restored work",
  );
  const restoredFixture = {
      ...f,
      target: clone,
      dir: path.join(clone, ".autodev"),
    },
    changes = [];
  state({
    target: clone,
    action: "begin",
    run: "resumed-root",
    task: "mission",
    attempt: "resumed-attempt",
  });
  const transition = (stage) =>
    state({
      target: clone,
      action: "transition",
      run: "resumed-root",
      task: "mission",
      attempt: "resumed-attempt",
      stage,
    });
  transition("PLAN");
  for (const task of contracts(clone).backlog.items.filter(
    (x) => x.status !== "PASS",
  )) {
    taskAction({
      target: clone,
      action: "select",
      run: "resumed-root",
      attempt: "resumed-attempt",
      task: task.id,
    });
    transition("IMPLEMENT");
    const product = read(path.join(clone, "product.json"));
    assert.equal(product[task.id], false);
    product[task.id] = true;
    json(path.join(clone, "product.json"), product);
    changes.push(task.id);
    transition("REVIEW");
    attest(restoredFixture, { scope: "task", taskId: task.id });
    transition("VERIFY");
    for (const check of task.check_refs) {
      const measured = relocatedCli(
        "record",
        "--target",
        clone,
        "--check",
        check,
      );
      assert.equal(measured.status, 0, measured.stdout + measured.stderr);
    }
    assert.equal(
      taskAction({
        target: clone,
        action: "complete",
        run: "resumed-root",
        attempt: "resumed-attempt",
        task: task.id,
        fixture: true,
      }).status,
      "PASS",
    );
    transition("PLAN");
  }
  assert.deepEqual(changes, ["R4", "R5", "R6", "R7", "R8"]);
  recordAll(restoredFixture);
  attest(restoredFixture);
  attest(restoredFixture, { kind: "audit" });
  transition("AUDIT");
  transition("IDLE");
  state({
    target: clone,
    action: "end",
    proof: terminated(restoredFixture),
    fixture: true,
  });
  assert.equal(
    verify({ target: clone, fixture: true }).status,
    "TEST_COMPLETE",
  );
  assert.equal(verify({ target: clone }).status, "UNVERIFIED");
  assert.equal(
    JSON.parse(
      relocatedCli("verify", "--target", clone, "--fixture", "true").stdout,
    ).status,
    "TEST_COMPLETE",
  );
  assert.notEqual(
    JSON.parse(cli("--target", clone, "--action", "restore").stdout).status,
    "RESTORED",
  );
});

function savedFixture(t) {
  const f = fixture(t);
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "base",
  );
  const r = cli("--target", f.target, "--action", "save");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const saved = JSON.parse(r.stdout);
  return { ...f, saved };
}
function cloneSaved(f, name = "clone") {
  const target = path.join(f.base, name);
  execFileSync("git", [
    "clone",
    "--quiet",
    "--branch",
    f.saved.branch,
    f.target,
    target,
  ]);
  execFileSync("git", [
    "-C",
    target,
    "remote",
    "set-url",
    "origin",
    "https://github.com/example/project.git",
  ]);
  return target;
}
test("checkpoint rejects missing and modified state before reconnect or agent work", (t) => {
  const f = savedFixture(t),
    clone = cloneSaved(f);
  fs.unlinkSync(path.join(clone, ".autodev/mission.md"));
  assert.match(
    cli("--target", clone, "--action", "restore").stdout,
    /Working checkpoint state changed/,
  );
  execFileSync("git", ["-C", clone, "restore", "--", ".autodev/mission.md"]);
  fs.appendFileSync(path.join(clone, ".autodev/backlog.json"), " ");
  assert.match(
    cli("--target", clone, "--action", "restore").stdout,
    /Working checkpoint state changed/,
  );
  assert.equal(
    read(path.join(clone, ".autodev/session.json")).session_id,
    contracts(f.target).session.session_id,
  );
});
test("checkpoint rejects committed tampering and a different repository identity", (t) => {
  const f = savedFixture(t),
    clone = cloneSaved(f);
  const git = (...a) =>
    execFileSync("git", ["-C", clone, ...a], { stdio: "pipe" });
  const b = read(path.join(clone, ".autodev/backlog.json"));
  b.items[0].status = "PASS";
  json(path.join(clone, ".autodev/backlog.json"), b);
  git("add", "-f", ".autodev/backlog.json");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "tampered",
  );
  assert.match(
    cli("--target", clone, "--action", "restore").stdout,
    /Checkpoint content hash mismatch/,
  );
  const other = cloneSaved(f, "other");
  execFileSync("git", [
    "-C",
    other,
    "remote",
    "set-url",
    "origin",
    "https://github.com/example/another.git",
  ]);
  assert.match(
    cli("--target", other, "--action", "restore").stdout,
    /repository identity mismatch/,
  );
});
test("large/missing historical artifacts remain explicit unavailable references across checkpoints", (t) => {
  const f = savedFixture(t);
  const asset = "large-model.jsonl";
  fs.writeFileSync(path.join(f.dir, "evidence", asset), "x".repeat(300 * 1024));
  const r = JSON.parse(cli("--target", f.target, "--action", "save").stdout);
  assert.ok(r.omitted.some((x) => x.path.endsWith(asset)));
  f.saved = r;
  const clone = cloneSaved(f);
  assert.equal(cli("--target", clone, "--action", "restore").status, 0);
  assert.equal(
    fs.existsSync(path.join(clone, ".autodev/evidence", asset)),
    false,
  );
  const again = JSON.parse(cli("--target", clone, "--action", "save").stdout);
  assert.ok(again.omitted.some((x) => x.path.endsWith(asset)));
  assert.equal(verify({ target: clone }).status, "UNVERIFIED");
});
test("checkpoint refuses live runs, dirty clone overlays and protected branch writes", (t) => {
  const f = savedFixture(t);
  assert.match(
    cli("--target", f.target, "--action", "save", "--branch", "main").stdout,
    /dedicated/,
  );
  state({
    target: f.target,
    action: "begin",
    run: "live",
    task: "mission",
    attempt: "a",
  });
  assert.match(
    cli("--target", f.target, "--action", "save").stdout,
    /Drain Workflow/,
  );
  const clone = path.join(f.base, "dirty");
  execFileSync("git", [
    "clone",
    "--quiet",
    "--branch",
    "main",
    f.target,
    clone,
  ]);
  execFileSync("git", [
    "-C",
    clone,
    "remote",
    "set-url",
    "origin",
    "https://github.com/example/project.git",
  ]);
  fs.writeFileSync(path.join(clone, "unrelated.txt"), "preserve");
  assert.match(
    cli(
      "--target",
      clone,
      "--action",
      "restore",
      "--ref",
      "origin/" + f.saved.branch,
    ).stdout,
    /clean clone/,
  );
  assert.equal(
    fs.readFileSync(path.join(clone, "unrelated.txt"), "utf8"),
    "preserve",
  );
});
test("a drained unfinished burst can pause, checkpoint, and start a fresh lease without completing backlog", (t) => {
  const f = fixture(t, { count: 5 });
  state({
    target: f.target,
    action: "begin",
    run: "first",
    task: "mission",
    attempt: "first",
  });
  state({
    target: f.target,
    action: "transition",
    run: "first",
    task: "mission",
    attempt: "first",
    stage: "PLAN",
  });
  const proof = terminated(f);
  state({ target: f.target, action: "pause", proof, fixture: true });
  assert.equal(read(path.join(f.dir, "current-task.json")).stage, "PLAN");
  assert.equal(cli("--target", f.target, "--action", "save").status, 0);
  state({
    target: f.target,
    action: "begin",
    run: "second",
    task: "mission",
    attempt: "second",
  });
  assert.equal(nextAction({ target: f.target, run: "second" }).task_id, "R1");
  assert.notEqual(
    verify({ target: f.target, fixture: true }).status,
    "TEST_COMPLETE",
  );
});
test("reconnect after stopped partial edit preserves operation and review resume point", (t) => {
  const f = fixture(t);
  state({
    target: f.target,
    action: "begin",
    run: "r",
    task: "mission",
    attempt: "a",
  });
  state({
    target: f.target,
    action: "transition",
    run: "r",
    task: "mission",
    attempt: "a",
    stage: "PLAN",
  });
  state({
    target: f.target,
    action: "transition",
    run: "r",
    task: "mission",
    attempt: "a",
    stage: "IMPLEMENT",
  });
  const s = read(path.join(f.dir, "current-task.json"));
  s.sprint_task_id = "R1";
  json(path.join(f.dir, "current-task.json"), s);
  operation({
    target: f.target,
    action: "start",
    run: "r",
    attempt: "a",
    task: "R1",
    id: "partial",
    stage: "IMPLEMENT",
  });
  fs.writeFileSync(path.join(f.target, "partial.txt"), "retained edit");
  const proof = terminated(f, { state: "stopped" });
  reconnect({ target: f.target, proof, fixture: true });
  const next = nextAction({ target: f.target });
  assert.equal(next.action, "RESUME");
  assert.equal(next.resume.stage, "REVIEW");
  assert.equal(next.resume.task_id, "R1");
  const execution = contracts(f.target).backlog.items[0].execution;
  state({
    target: f.target,
    action: "begin",
    run: "resumed",
    task: "mission",
    attempt: "fresh",
  });
  taskAction({
    target: f.target,
    action: "select",
    run: "resumed",
    attempt: "fresh",
    task: "R1",
    resume: true,
  });
  assert.deepEqual(contracts(f.target).backlog.items[0].execution, execution);
  assert.equal(
    fs.readFileSync(path.join(f.target, "partial.txt"), "utf8"),
    "retained edit",
  );
});

test("completed burst with a lost implementation receipt remains resumable after pause", (t) => {
  const f = fixture(t);
  state({
    target: f.target,
    action: "begin",
    run: "r",
    task: "mission",
    attempt: "a",
  });
  operation({
    target: f.target,
    action: "start",
    run: "r",
    attempt: "a",
    task: "R1",
    id: "lost-result",
    stage: "IMPLEMENT",
  });
  fs.writeFileSync(
    path.join(f.target, "partial.txt"),
    "must inspect, not replay",
  );
  state({
    target: f.target,
    action: "pause",
    proof: terminated(f),
    fixture: true,
  });
  assert.equal(read(path.join(f.dir, "current-task.json")).active, false);
  assert.equal(nextAction({ target: f.target }).resume.stage, "REVIEW");
  assert.equal(cli("--target", f.target, "--action", "save").status, 0);
});

test("restore killed after publishing state resumes once without overlaying another writer", async (t) => {
  const f = savedFixture(t),
    clone = cloneSaved(f);
  const script = `import fs from 'node:fs';import {checkpointRestore} from ${JSON.stringify(path.join(shared, "scripts/checkpoint.mjs"))};const rename=fs.renameSync;fs.renameSync=function(a,b){const r=rename.call(this,a,b);if(b===${JSON.stringify(path.join(fs.realpathSync(clone), ".autodev"))})process.kill(process.pid,'SIGKILL');return r;};checkpointRestore({target:${JSON.stringify(clone)}});`;
  const killed = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.equal(killed.signal, "SIGKILL");
  assert.match(
    cli("--target", clone, "--action", "restore").stdout,
    /recover-restore/,
  );
  const blocked = spawnSync(
    process.execPath,
    [
      path.join(shared, "scripts/state.mjs"),
      "--target",
      clone,
      "--action",
      "begin",
      "--run",
      "wrong",
      "--task",
      "mission",
      "--attempt",
      "wrong",
    ],
    { encoding: "utf8" },
  );
  assert.match(blocked.stdout, /restore active\/interrupted/);
  const recovered = cli("--target", clone, "--action", "recover-restore");
  assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).status, "RESTORED");
  assert.match(contracts(clone).session.branch, /autodev\/resume/);
  assert.equal(
    execFileSync("git", ["-C", clone, "ls-files", ".autodev"], {
      encoding: "utf8",
    }).trim(),
    "",
  );
  assert.equal(
    fs.existsSync(path.join(clone, ".git/autodev-restore.lock")),
    false,
  );
});

test("restore final Git failure is recoverable and corrupted recovery paths cannot delete unrelated data", (t) => {
  const f = savedFixture(t),
    clone = cloneSaved(f),
    bin = path.join(f.base, "shim");
  fs.mkdirSync(bin);
  const real = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
  fs.writeFileSync(
    path.join(bin, "git"),
    '#!/bin/sh\ncase "$*" in *"rm -r --cached --ignore-unmatch -- .autodev"*) exit 73;; esac\nexec ' +
      quote(real) +
      ' "$@"\n',
    { mode: 0o755 },
  );
  const failed = spawnSync(
    process.execPath,
    [
      path.join(shared, "scripts/checkpoint.mjs"),
      "--target",
      clone,
      "--action",
      "restore",
    ],
    {
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
      encoding: "utf8",
    },
  );
  assert.equal(failed.status, 2);
  assert.match(failed.stdout, /recover-restore/);
  const lock = path.join(clone, ".git/autodev-restore.lock"),
    journal = read(lock),
    outside = path.join(f.base, "unrelated");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "keep"), "safe");
  json(lock, { ...journal, phase: "PREPARING", stage: outside });
  assert.match(
    cli("--target", clone, "--action", "recover-restore").stdout,
    /Invalid restore journal/,
  );
  assert.equal(fs.readFileSync(path.join(outside, "keep"), "utf8"), "safe");
  json(lock, journal);
  const recovered = cli("--target", clone, "--action", "recover-restore");
  assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
  assert.equal(
    contracts(clone).session.session_id,
    JSON.parse(recovered.stdout).session.session_id,
  );
});

test("initial planning interrupted before any contract can recover and publish original mission", (t) => {
  const f = fixture(t);
  fs.rmSync(f.dir, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      path.join(shared, "scripts/bootstrap.mjs"),
      "--target",
      f.target,
      "--mission",
      f.source,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  state({
    target: f.target,
    action: "begin",
    run: "planning",
    task: "mission",
    attempt: "first",
  });
  state({
    target: f.target,
    action: "transition",
    run: "planning",
    task: "mission",
    attempt: "first",
    stage: "ARCHITECTURE",
  });
  state({
    target: f.target,
    action: "recover",
    proof: terminated(f, { state: "stopped" }),
    fixture: true,
  });
  assert.equal(nextAction({ target: f.target }).action, "ARCHITECTURE");
  const saved = cli("--target", f.target, "--action", "save");
  assert.equal(saved.status, 0, saved.stdout + saved.stderr);
  f.saved = JSON.parse(saved.stdout);
  const clone = cloneSaved(f);
  const restored = cli("--target", clone, "--action", "restore");
  assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  assert.equal(nextAction({ target: clone }).action, "ARCHITECTURE");
  assert.equal(
    fs.existsSync(path.join(clone, ".autodev/contract.json")),
    false,
  );
});

test("checkpoint accepts plan files and directories with common filename prefixes", (t) => {
  const f = savedFixture(t);
  fs.mkdirSync(path.join(f.dir, "decisions"));
  fs.writeFileSync(
    path.join(f.dir, "decisions.md"),
    "Index of retained decisions.",
  );
  fs.writeFileSync(path.join(f.dir, "decisions", "001.md"), "Decision one.");
  const r = cli("--target", f.target, "--action", "save");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  f.saved = JSON.parse(r.stdout);
  const clone = cloneSaved(f);
  const restored = cli("--target", clone, "--action", "restore");
  assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  assert.equal(
    fs.readFileSync(path.join(clone, ".autodev/decisions/001.md"), "utf8"),
    "Decision one.",
  );
});

test("checkpoint refuses omitted symlink dependencies before replacing a durable ref", (t) => {
  for (const chain of [false, true]) {
    const f = savedFixture(t),
      old = f.git("rev-parse", f.saved.branch);
    fs.appendFileSync(
      path.join(f.target, ".gitignore"),
      "\nignored-dependency\n",
    );
    if (chain) {
      fs.symlinkSync("product.json", path.join(f.target, "ignored-dependency"));
    } else {
      fs.writeFileSync(
        path.join(f.target, "ignored-dependency"),
        "retained product bytes",
      );
    }
    fs.symlinkSync("ignored-dependency", path.join(f.target, "public-link"));
    const r = cli("--target", f.target, "--action", "save");
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /symlink dependency.*snapshot/);
    assert.equal(
      f.git("rev-parse", f.saved.branch),
      old,
      "unrestorable save cannot advance published ref",
    );
    assert.ok(
      fs.lstatSync(path.join(f.target, "public-link")).isSymbolicLink(),
    );
  }
});
test("checkpoint restores internal symlinks when every dependency is in the product snapshot", (t) => {
  const f = savedFixture(t);
  fs.writeFileSync(path.join(f.target, "dependency.txt"), "retained bytes");
  fs.symlinkSync("dependency.txt", path.join(f.target, "alias"));
  fs.symlinkSync("alias", path.join(f.target, "public-link"));
  const r = cli("--target", f.target, "--action", "save");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  f.saved = JSON.parse(r.stdout);
  const clone = cloneSaved(f),
    restored = cli("--target", clone, "--action", "restore");
  assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  assert.equal(
    fs.readFileSync(path.join(clone, "public-link"), "utf8"),
    "retained bytes",
  );
});

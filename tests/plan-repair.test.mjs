import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fixture, read, json, terminated, shared } from "./helpers/fixture.mjs";
import { state } from "../scripts/state.mjs";
import { nextAction } from "../scripts/next.mjs";
import { unlock, hash } from "../scripts/lib/core.mjs";
const cli = (f) =>
  spawnSync(
    process.execPath,
    [
      path.join(shared, "scripts/repair-plan.mjs"),
      "--target",
      f.target,
      "--proof",
      path.join(f.dir, "termination.json"),
      "--fixture",
      "true",
    ],
    { encoding: "utf8" },
  );
test("interrupted initial plan preserves draft and repairs incomplete backlog before Opus continuation", (t) => {
  const f = fixture(t);
  fs.rmSync(f.dir, { recursive: true });
  const init = spawnSync(
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
  assert.equal(init.status, 0);
  state({
    target: f.target,
    action: "begin",
    run: "plan",
    task: "mission",
    attempt: "a",
  });
  state({
    target: f.target,
    action: "transition",
    run: "plan",
    task: "mission",
    attempt: "a",
    stage: "ARCHITECTURE",
  });
  const draft = read(path.join(f.dir, "backlog.json"));
  draft.items[0].check_refs = ["R1-partial-check"];
  json(path.join(f.dir, "backlog.json"), draft);
  fs.writeFileSync(
    path.join(f.dir, "architecture.md"),
    "Retain this partial Opus design, never start from nothing.",
  );
  state({
    target: f.target,
    action: "recover",
    proof: terminated(f, { state: "stopped" }),
    fixture: true,
  });
  assert.throws(() => nextAction({ target: f.target }), /Missing contract/);
  const repaired = cli(f);
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.equal(nextAction({ target: f.target }).action, "ARCHITECTURE");
  assert.equal(
    fs.readFileSync(path.join(f.dir, "architecture.md"), "utf8"),
    "Retain this partial Opus design, never start from nothing.",
  );
  const history = read(path.join(f.dir, "planning-repair.json"));
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.dir, "evidence", history.sources[0].record)),
    ).items[0].check_refs[0],
    "R1-partial-check",
  );
  assert.equal(cli(f).status, 0, "repeat is idempotent");
});
test("initial plan repair cannot erase published plans or bypass active native ownership", (t) => {
  const f = fixture(t);
  state({
    target: f.target,
    action: "begin",
    run: "r",
    task: "mission",
    attempt: "a",
  });
  assert.equal(cli(f).status, 2);
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
    action: "recover",
    proof: terminated(f, { state: "stopped" }),
    fixture: true,
  });
  assert.equal(cli(f).status, 2);
  assert.ok(fs.existsSync(path.join(f.dir, "contract.json")));
});

test("original requirement named mission stays intact while root task namespace is reserved", (t) => {
  const f = fixture(t);
  fs.rmSync(f.dir, { recursive: true });
  json(f.source, {
    original: "Keep both requirements unchanged.",
    requirements: [
      { id: "mission", text: "First original feature." },
      { id: "task:mission", text: "Second original feature." },
    ],
  });
  const r = spawnSync(
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
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(
    read(path.join(f.dir, "mission.json")).requirements.map((x) => x.id),
    ["mission", "task:mission"],
  );
  const tasks = read(path.join(f.dir, "backlog.json")).items;
  assert.ok(!tasks.some((x) => x.id === "mission"));
  assert.equal(new Set(tasks.map((x) => x.id)).size, 2);
  assert.equal(nextAction({ target: f.target }).action, "ARCHITECTURE");
});

function initialFixture(t) {
  const f = fixture(t);
  fs.rmSync(f.dir, { recursive: true });
  const r = spawnSync(
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
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return f;
}
function interruptedDraft(f, run, architecture, { contract = false } = {}) {
  state({
    target: f.target,
    action: "begin",
    run,
    task: "mission",
    attempt: run + "-attempt",
  });
  state({
    target: f.target,
    action: "transition",
    run,
    task: "mission",
    attempt: run + "-attempt",
    stage: "ARCHITECTURE",
  });
  const script = `import fs from 'node:fs';const dir=${JSON.stringify(f.dir)};fs.writeFileSync(dir+'/architecture.md',${JSON.stringify(architecture)});const backlog=JSON.parse(fs.readFileSync(dir+'/backlog.json'));backlog.items[0].check_refs=[${JSON.stringify(run + "-partial")}];fs.writeFileSync(dir+'/backlog.json',JSON.stringify(backlog));if(${contract})fs.writeFileSync(dir+'/contract.json',JSON.stringify({version:2,checks:[],human_review:false}));process.kill(process.pid,'SIGKILL');`;
  const killed = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.equal(killed.signal, "SIGKILL");
  // The file-writing crash is real; native Workflow/model termination remains TEST FIXTURE.
  const proof = terminated(f, { state: "stopped" });
  state({ target: f.target, action: "recover", proof, fixture: true });
  return read(proof).sha256;
}
test("initial repair records absent inputs and refuses a newer contract after process death", (t) => {
  const f = initialFixture(t);
  interruptedDraft(f, "first", "Preserve first architecture.");
  const script = `import fs from 'node:fs';import {repairPlan} from ${JSON.stringify(path.join(shared, "scripts/repair-plan.mjs"))};const original=fs.renameSync;fs.renameSync=function(a,b){const r=original.call(this,a,b);if(b===${JSON.stringify(path.join(f.dir, "backlog.json"))})process.kill(process.pid,'SIGKILL');return r;};repairPlan({target:${JSON.stringify(f.target)},proof:${JSON.stringify(path.join(f.dir, "termination.json"))},fixture:true});`;
  const killed = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.equal(killed.signal, "SIGKILL");
  unlock(f.target);
  const newer = '{"newer":"draft added after stopped repair"}\n';
  fs.writeFileSync(path.join(f.dir, "contract.json"), newer);
  const retry = cli(f);
  assert.equal(retry.status, 2, retry.stdout);
  assert.match(retry.stdout, /Plan changed|appeared|absent/);
  assert.equal(
    fs.readFileSync(path.join(f.dir, "contract.json"), "utf8"),
    newer,
  );
  const journal = read(path.join(f.dir, "planning-repair.json"));
  assert.equal(journal.phase, "PREPARED");
  assert.equal(
    journal.sources.find((x) => x.name === "contract.json").sha256,
    null,
  );
  fs.unlinkSync(path.join(f.dir, "contract.json"));
  assert.throws(
    () =>
      state({
        target: f.target,
        action: "begin",
        run: "unrelated",
        task: "mission",
        attempt: "unrelated",
      }),
    /repair pending/i,
  );
  const journalBytes = fs.readFileSync(
      path.join(f.dir, "planning-repair.json"),
    ),
    previousState = read(path.join(f.dir, "current-task.json")),
    previousProof = read(path.join(f.dir, "termination.json")),
    previousRaw = fs.readFileSync(
      path.join(f.dir, "evidence", previousProof.record),
    );
  json(path.join(f.dir, "current-task.json"), {
    ...previousState,
    run_id: "different-owner",
    attempt_id: "different-attempt",
    run_started_at: new Date().toISOString(),
  });
  terminated(f, { state: "stopped" });
  const changedProof = cli(f);
  assert.equal(changedProof.status, 2);
  assert.match(changedProof.stdout, /another terminal proof/);
  assert.deepEqual(
    fs.readFileSync(path.join(f.dir, "planning-repair.json")),
    journalBytes,
    "a different proof cannot replace unfinished repair",
  );
  json(path.join(f.dir, "current-task.json"), previousState);
  json(path.join(f.dir, "termination.json"), previousProof);
  fs.writeFileSync(
    path.join(f.dir, "evidence", previousProof.record),
    previousRaw,
  );
  assert.equal(cli(f).status, 0, "original unchanged inputs remain resumable");
});
test("two successive stopped initial Opus drafts create separate repair generations and preserve prior architecture", (t) => {
  const f = initialFixture(t),
    first = interruptedDraft(f, "first", "First preserved Opus design.");
  assert.equal(cli(f).status, 0);
  const second = interruptedDraft(
    f,
    "second",
    "Second preserved Opus design.",
    { contract: true },
  );
  assert.notEqual(second, first);
  const fixed = cli(f);
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  const current = read(path.join(f.dir, "planning-repair.json"));
  assert.equal(current.generation, 2);
  assert.equal(current.proof_sha256, second);
  const archived = read(path.join(f.dir, "evidence", current.previous.record));
  assert.equal(archived.proof_sha256, first);
  assert.equal(
    hash(
      fs.readFileSync(path.join(f.dir, "evidence", current.previous.record)),
    ),
    current.previous.sha256,
  );
  const architecture = archived.sources.find(
    (x) => x.name === "architecture.md",
  );
  assert.equal(
    fs.readFileSync(path.join(f.dir, "evidence", architecture.record), "utf8"),
    "First preserved Opus design.",
  );
  assert.equal(
    fs.readFileSync(path.join(f.dir, "architecture.md"), "utf8"),
    "Second preserved Opus design.",
  );
  assert.equal(nextAction({ target: f.target }).action, "ARCHITECTURE");
  assert.equal(cli(f).status, 0, "same proof is idempotent");
  assert.equal(read(path.join(f.dir, "planning-repair.json")).generation, 2);
  const newer = '{"newer":"unrelated draft after completed repair"}\n';
  fs.writeFileSync(path.join(f.dir, "contract.json"), newer);
  const rejected = cli(f);
  assert.equal(rejected.status, 2);
  assert.equal(
    fs.readFileSync(path.join(f.dir, "contract.json"), "utf8"),
    newer,
  );
});

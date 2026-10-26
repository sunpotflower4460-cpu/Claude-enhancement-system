import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  fixture,
  read,
  json,
  artifactPath,
  terminated,
  shared,
} from "./helpers/fixture.mjs";
import { record } from "../scripts/record.mjs";
import { state } from "../scripts/state.mjs";
import { operation } from "../scripts/operation.mjs";
import { unlock, alive } from "../scripts/lib/core.mjs";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 500; i++) {
    const result = fn();
    if (result) return result;
    await delay(10);
  }
  throw Error("Timed out awaiting test runner state");
}
function slowCheck(f, timeout = 1000) {
  fs.writeFileSync(
    path.join(f.target, "slow.mjs"),
    `import fs from 'node:fs';import {owner} from ${JSON.stringify(new URL("../scripts/lib/core.mjs", import.meta.url).href)};fs.writeFileSync('.autodev/evidence/process.json',JSON.stringify(owner()));fs.appendFileSync('product.json',' ');fs.writeFileSync('.autodev/evidence/pid.txt',String(process.pid));setInterval(()=>{},1000);`,
  );
  const c = read(path.join(f.dir, "contract.json"));
  c.checks[0].command = "node slow.mjs";
  c.checks[0].timeout_ms = timeout;
  json(path.join(f.dir, "contract.json"), c);
}
test("B2 timeout kills actual check process group and records failure", async (t) => {
  const f = fixture(t);
  slowCheck(f, 500);
  const e = record({ target: f.target, check: "R1-test" });
  assert.equal(e.exit_code, null);
  assert.equal(e.signal, "SIGKILL");
  assert.equal(e.stable, false);
  await delay(50);
  assert.equal(alive(read(artifactPath(f.dir, "process.json"))), false);
});
test("B2 killing recorder mid-test retains lock/partial files and refuses recovery while check lives", async (t) => {
  const f = fixture(t);
  slowCheck(f, 20000);
  state({
    target: f.target,
    action: "begin",
    run: "test-run",
    task: "mission",
    attempt: "test-attempt",
  });
  operation({
    target: f.target,
    run: "test-run",
    attempt: "test-attempt",
    task: "R1",
    id: "interrupted-verification",
    stage: "VERIFY",
    action: "start",
  });
  const child = spawn(
    process.execPath,
    [
      path.join(shared, "scripts/record.mjs"),
      "--target",
      f.target,
      "--check",
      "R1-test",
    ],
    { stdio: "ignore" },
  );
  let group;
  try {
    const runner = await until(() => {
      const n = fs
        .readdirSync(path.join(f.dir, "evidence"))
        .find((n) => n.startsWith("runner-"));
      if (!n) return false;
      try {
        return { name: n, ...read(artifactPath(f.dir, n)) };
      } catch {
        return false;
      }
    });
    group = runner.owner.process_group;
    await until(() => fs.existsSync(artifactPath(f.dir, "pid.txt")));
    child.kill("SIGKILL");
    await new Promise((r) => child.on("close", r));
    assert.equal(fs.existsSync(path.join(f.dir, ".mutex")), true);
    assert.throws(() => unlock(f.target), /Check process/);
    process.kill(-group, "SIGKILL");
    await until(
      () => read(artifactPath(f.dir, runner.name)).state === "stopped",
    );
    unlock(f.target);
    const proof = terminated(f, { state: "stopped" }),
      s = state({ target: f.target, action: "recover", proof, fixture: true });
    assert.equal(s.stage, "BLOCKED");
    assert.match(
      fs.readFileSync(path.join(f.target, "product.json"), "utf8"),
      / $/,
    );
    assert.equal(read(path.join(f.dir, "resume.json")).action, "VERIFY");
  } finally {
    try {
      child.kill("SIGKILL");
    } catch {}
    if (group)
      try {
        process.kill(-group, "SIGKILL");
      } catch {}
  }
});

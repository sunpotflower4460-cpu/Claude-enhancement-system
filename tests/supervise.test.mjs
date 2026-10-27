// Live: killed/restarted sessions needed a human to type `claude --resume`; the supervisor does it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./helpers/fixture.mjs";
import { supervise, superviseDir } from "../scripts/supervise.mjs";
import { devPermissions, writePermissions } from "../scripts/permissions.mjs";

// A fake `claude`: records argv, prints a stream-json init with a session id, then does what
// MODE says. A fake verify reports COMPLETE once the Nth run has finished.
function fakes(t, { completeAfter = 2, mode = "exit" } = {}) {
  const d = fs.mkdtempSync(path.join(fixtureRoot, "sup-"));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const calls = path.join(d, "calls.jsonl");
  const claude = path.join(d, "claude");
  fs.writeFileSync(
    claude,
    `#!/usr/bin/env node
const fs=require("fs");
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+"\\n");
console.log(JSON.stringify({type:"system",subtype:"init",session_id:"sess-123"}));
if(${JSON.stringify(mode)}==="hang"){setInterval(()=>{},1000);}
else if(${JSON.stringify(mode)}==="die"){process.kill(process.pid,"SIGKILL");}
`,
    { mode: 0o755 },
  );
  const verify = path.join(d, "verify.mjs");
  fs.writeFileSync(
    verify,
    `import fs from "node:fs";
const n=fs.existsSync(${JSON.stringify(calls)})?fs.readFileSync(${JSON.stringify(calls)},"utf8").trim().split("\\n").length:0;
console.log(JSON.stringify({status:n>=${completeAfter}?"COMPLETE":"UNVERIFIED",assurance:"LIVE",issues:["still open"]},null,2));`,
  );
  return { claude, verify, calls, d };
}
let fixtureRoot;
test.before(() => {
  fixtureRoot = fs.mkdtempSync("/tmp/sup-root-");
});
test.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
const common = (f) => ({ claude: f.claude, verify_script: f.verify, backoff_seconds: "0", stall_minutes: "5" });

test("S1 a killed run is resumed automatically with the same session until verify is COMPLETE", async (t) => {
  const f = fixture(t),
    k = fakes(t, { completeAfter: 3, mode: "die" });
  const r = await supervise({ target: f.target, prompt: "/goal x", no_permissions: "true", ...common(k) });
  assert.equal(r.status, "COMPLETE");
  const calls = fs.readFileSync(k.calls, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 3);
  assert.ok(!calls[0].includes("--resume"));
  assert.deepEqual(calls[1].slice(0, 2), ["--resume", "sess-123"]);
  assert.deepEqual(calls[2].slice(0, 2), ["--resume", "sess-123"]);
  assert.match(calls[1].at(-1), /burst finish→state recover/);
  assert.equal(r.runs[0].signal, "SIGKILL");
});
test("S2 restarts that change nothing observable stop with NO_PROGRESS instead of looping", async (t) => {
  const f = fixture(t),
    k = fakes(t, { completeAfter: 99, mode: "exit" });
  const r = await supervise({ target: f.target, prompt: "/goal x", no_permissions: "true", no_progress_limit: "2", ...common(k) });
  assert.equal(r.status, "NO_PROGRESS");
  assert.equal(fs.readFileSync(k.calls, "utf8").trim().split("\n").length, 2);
});
test("S3 a silent (hung) run is killed after the stall window and resumed", async (t) => {
  const f = fixture(t),
    k = fakes(t, { completeAfter: 2, mode: "hang" });
  const r = await supervise({ target: f.target, prompt: "/goal x", no_permissions: "true", ...common(k), stall_minutes: "0.01" });
  assert.equal(r.status, "COMPLETE");
  assert.equal(r.runs[0].stalled, true);
  assert.equal(r.runs[1].resume, true);
});
test("S4 re-running supervise after the supervisor itself died continues the stored session", async (t) => {
  const f = fixture(t),
    k = fakes(t, { completeAfter: 2, mode: "exit" });
  const dir = superviseDir(f.target);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ version: 1, target: f.target, session_id: "sess-123", attempts: 1, runs: [], started_at: "x" }));
  fs.writeFileSync(k.calls, "[]\n"); // one earlier run already happened
  const r = await supervise({ target: f.target, no_permissions: "true", ...common(k) });
  assert.equal(r.status, "COMPLETE");
  const calls = fs.readFileSync(k.calls, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.at(-1).slice(0, 2), ["--resume", "sess-123"]);
});
test("S5 restart budget is enforced and reported", async (t) => {
  const f = fixture(t),
    k = fakes(t, { completeAfter: 99, mode: "exit" });
  const r = await supervise({ target: f.target, prompt: "/goal x", no_permissions: "true", max_restarts: "1", no_progress_limit: "99", ...common(k) });
  assert.equal(r.status, "RESTART_BUDGET_EXHAUSTED");
});
test("S6 first launch without a prompt or session is rejected clearly", async (t) => {
  const f = fixture(t),
    k = fakes(t);
  await assert.rejects(supervise({ target: f.target, no_permissions: "true", ...common(k) }), /needs --prompt/);
});
test("P1 the generated permission allowlist lets builders run checks but denies pushes and harness edits", (t) => {
  const f = fixture(t);
  const w = writePermissions({ target: f.target });
  const p = JSON.parse(fs.readFileSync(w.settings, "utf8")).permissions;
  assert.ok(p.allow.includes("Bash(node -e*)") && p.allow.includes("Bash(npx playwright*)"));
  assert.ok(p.allow.some((a) => a.startsWith("Edit(//")));
  assert.ok(p.deny.includes("Bash(git push*)"));
  assert.ok(p.deny.some((d) => d.startsWith("Edit(//") && !d.includes(f.target)));
  const pub = devPermissions(f.target, { allow_publish: true }).permissions;
  assert.ok(!pub.deny.includes("Bash(git push*)"));
  assert.ok(pub.allow.includes("Bash(git push origin autodev/checkpoint/*)"));
  assert.ok(!pub.allow.includes("Bash(git push*)"));
});
test("S7 a fresh target (no .autodev yet) is supervised without creating .autodev, so bootstrap still works", async (t) => {
  const f = fixture(t),
    k = fakes(t, { completeAfter: 1, mode: "exit" });
  const bare = fs.mkdtempSync(path.join(fixtureRoot, "fresh-"));
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init", "-q", bare]);
  const r = await supervise({ target: bare, prompt: "/goal x", ...common(k) });
  assert.equal(r.status, "COMPLETE");
  assert.ok(!fs.existsSync(path.join(bare, ".autodev")));
  assert.ok(fs.existsSync(path.join(superviseDir(bare), "permissions.json")));
});

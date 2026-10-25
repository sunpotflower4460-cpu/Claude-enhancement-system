import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import {
  identity,
  shared,
  json,
  read,
  main,
  contracts,
  observationId,
} from "./lib/core.mjs";
import { bootstrap } from "./bootstrap.mjs";
import { installAgents } from "./install-agents.mjs";
export function prepareProbe(o) {
  const source = identity(o.source),
    target = path.resolve(o.output);
  if (fs.existsSync(target))
    throw Error(
      "Probe output must not exist; existing files are never replaced",
    );
  // Local clone only. Never edit source checkout, settings, branch or worktree.
  execFileSync(
    "git",
    ["clone", "--no-hardlinks", "--local", source.root, target],
    { stdio: "pipe" },
  );
  execFileSync("git", [
    "-C",
    target,
    "remote",
    "set-url",
    "origin",
    source.remote,
  ]);
  if (fs.existsSync(path.join(target, ".autodev")))
    throw Error(
      "Use a dedicated test repository without existing .autodev state",
    );
  const appDir = path.join(target, "autodev-probe");
  if (fs.existsSync(appDir)) throw Error("Probe fixture path already exists");
  fs.mkdirSync(appDir);
  fs.writeFileSync(
    path.join(appDir, "app.mjs"),
    'export const add=(a,b)=>a-b;\nexport const divide=(a,b)=>0;\nexport const greet=name=>"";\nexport const clamp=(n,min,max)=>0;\n',
  );
  const requirements = [
      { id: "R1", text: "Addition: add(5,3)=8, add(-1,2)=1." },
      { id: "R2", text: "Division: divide(8,2)=4; division by zero throws." },
      {
        id: "R3",
        text: "Greeting: trim names, empty name uses friend; return Hello, NAME.",
      },
      {
        id: "R4",
        text: "Clamp returns lower/upper bounds outside range and original value inside.",
      },
    ],
    input = path.join(appDir, "mission-input.json");
  json(input, {
    original:
      "Implement all four specified functions, independent review, real tests/HTTP, interruption and resume. Do not edit the acceptance tests to weaken them.",
    requirements,
  });
  bootstrap({ target, mission: input, profile: "backend" });
  const dir = path.join(target, ".autodev"),
    items = requirements.map((r) => ({
      id: r.id,
      requirement_refs: [r.id],
      status: "UNVERIFIED",
      dependencies: [],
      check_refs: [r.id + "-test", r.id + "-api"],
      execution: null,
    }));
  json(path.join(dir, "backlog.json"), { version: 2, items });
  const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
  json(path.join(dir, "contract.json"), {
    version: 2,
    checks: items.flatMap((t) =>
      ["test", "api"].map((kind) => ({
        id: t.id + "-" + kind,
        task_id: t.id,
        requirement_refs: t.requirement_refs,
        kind,
        command: "node " + q(path.join(shared, "examples/api-check.mjs")),
        timeout_ms: 15000,
      })),
    ),
    human_review: false,
  });
  const installed = installAgents({ target });
  const c = contracts(target);
  const request = {
    target,
    shared,
    mission_id: c.mission.mission_id,
    session_id: c.session.session_id,
    observation_id: observationId(c),
    agents: installed.agents,
    run_id: "live-probe-run",
    attempt_id: "live-probe-attempt-1",
    capabilities: { registry_verified: false, readonly_verified: false },
    milestone_every: 2,
  };
  json(path.join(dir, "probe-input.json"), request);
  const names = [
    "two_repositories",
    "goal_continuation",
    "actual_models",
    "native_readonly_denial",
    "workflow_start_wait",
    "repair_loop",
    "real_verification",
    "stop_resume",
    "final_gate",
  ];
  json(path.join(dir, "probe-results.json"), {
    version: 2,
    mode: "LIVE_PROBE_NOT_YET_RUN",
    checks: names.map((id) => ({
      id,
      status: "UNVERIFIED",
      evidence_refs: [],
      reason: "Await actual Claude runtime observation",
    })),
  });
  const prompt = `/goal Read ${shared}/START.md. This is an isolated LIVE runtime test project at ${target}, copied from ${source.repository}; never modify the source checkout. Read .autodev/probe-input.json, obtain the root state lease with state begin before model observations, refresh context.mjs, and use workflows/runtime-probe.js before the mission controller. Verify discovered native agents and actual read-only rejection in the isolated fixture before enabling the mission controller. Collect actual SDK/task records and model routing; never set probe PASS from self-report. Then run develop-mission.js, repair all four functions, review, test, pause and resume using operation/state evidence, and compute final verify only after runtime drained. Record each observation with scripts/probe-result.mjs and leave unavailable conditions UNVERIFIED. Fixture model logs must never be substituted for live records.`;
  fs.writeFileSync(path.join(dir, "probe-prompt.txt"), prompt + "\n");
  return {
    status: "PREPARED_UNVERIFIED",
    target,
    source: source.root,
    prompt,
    request,
  };
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  main(async (o) => {
    if (o.mode === "prepare") {
      console.log(JSON.stringify(prepareProbe(o), null, 2));
      return;
    }
    if (o.mode !== "run" || !o.target)
      throw Error(
        "Use --mode prepare --source TEST_REPO --output NEW_DIR, or --mode run --target ISOLATED_DIR",
      );
    const c = contracts(o.target),
      prompt = fs.readFileSync(path.join(c.dir, "probe-prompt.txt"), "utf8"),
      rawName = "live-sdk-" + crypto.randomUUID() + ".jsonl",
      rawPath = path.join(c.dir, "evidence", rawName),
      raw = fs.createWriteStream(rawPath, { fd: fs.openSync(rawPath, "wx") });
    const child = spawn(
      o.claude || "claude",
      [
        ...(o.resume ? ["--resume", o.resume] : []),
        "--model",
        "claude-sonnet-5-5",
        "--add-dir",
        shared,
        "--plugin-dir",
        shared,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--forward-subagent-text",
        "-p",
        prompt,
      ],
      { cwd: c.session.root, stdio: ["ignore", "pipe", "inherit"] },
    );
    let streamError;
    raw.on("error", (error) => {
      streamError = error;
      child.kill("SIGTERM");
    });
    child.stdout.pipe(raw);
    const code = await new Promise((resolve, reject) => {
      child.on("error", (error) => {
        raw.end();
        reject(error);
      });
      child.on("close", resolve);
    });
    if (streamError) throw streamError;
    if (code !== 0) process.exitCode = code || 2;
    console.log(
      JSON.stringify({
        status: "UNVERIFIED_UNTIL_PROBE_RESULTS_CHECKED",
        raw: rawName,
        exit_code: code,
      }),
    );
  });

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { finished } from "node:stream/promises";
import { execFileSync, spawn } from "node:child_process";
import {
  identity,
  shared,
  json,
  read,
  main,
  contracts,
  observationId,
  owner,
  alive,
  hash,
  mutex,
  isMain,
} from "./lib/core.mjs";
import { bootstrap } from "./bootstrap.mjs";
import { installAgents } from "./install-agents.mjs";
const checkNames = [
  "two_repositories",
  "goal_continuation",
  "actual_models",
  "native_readonly_denial",
  "workflow_start_wait",
  "repair_loop",
  "real_verification",
  "stop_resume",
  "final_gate",
  "multi_burst_state",
  "checkpoint_reclone",
];
function freshResults(invocation_id = null) {
  return {
    version: 2,
    mode: "LIVE_PROBE_NOT_YET_RUN",
    invocation_id,
    checks: checkNames.map((id) => ({
      id,
      status: "UNVERIFIED",
      evidence_refs: [],
      reason: "Await actual Claude runtime observation",
    })),
  };
}
function outputPath(output) {
  const p = path.resolve(output);
  return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
}
function journalPath(target) {
  return target + ".autodev-probe-prepare.json";
}
export function recoverPrepare(o) {
  const target = outputPath(o.output),
    p = journalPath(target),
    j = read(p);
  if (j.target !== target || !j.owner || alive(j.owner) !== false)
    throw Error("Preparation owner active/unknown; stop it before recovery");
  if (fs.existsSync(target))
    throw Error("Published output exists; recovery never deletes it");
  if (j.staging) {
    if (
      path.dirname(j.staging) !== path.dirname(target) ||
      !path
        .basename(j.staging)
        .startsWith(path.basename(target) + ".autodev-probe-") ||
      fs.lstatSync(j.staging, { throwIfNoEntry: false })?.isSymbolicLink()
    )
      throw Error("Unsafe preparation staging path");
    fs.rmSync(j.staging, { recursive: true, force: true });
  }
  json(p, {
    ...j,
    status: "FAILED",
    reason:
      "Interrupted preparation recovered; rerun prepare with the same output",
    staging: null,
  });
  return {
    status: "RECOVERED_UNVERIFIED",
    target,
    next: "Repeat --mode prepare with the original source and output",
  };
}
export function prepareProbe(o) {
  const source = identity(o.source),
    target = outputPath(o.output);
  if (
    target === source.root ||
    target.startsWith(source.root + path.sep) ||
    target === shared ||
    target.startsWith(shared + path.sep)
  )
    throw Error("Probe output must be outside source and shared repositories");
  if (fs.lstatSync(target, { throwIfNoEntry: false }))
    throw Error(
      "Probe output must not exist; existing files are never replaced",
    );
  const jp = journalPath(target);
  if (fs.existsSync(jp)) {
    const old = read(jp);
    if (old.target !== target || old.status !== "FAILED" || old.staging)
      throw Error(
        "Interrupted/active preparation; use --mode recover-prepare --output OUTPUT after stopping its owner",
      );
    fs.unlinkSync(jp);
  }
  const journal = {
    version: 2,
    status: "PREPARING",
    target,
    source: source.root,
    owner: owner(),
    staging: target + ".autodev-probe-" + crypto.randomUUID(),
    started_at: new Date().toISOString(),
  };
  const fd = fs.openSync(jp, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(journal));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  let staging,
    published = false;
  try {
    staging = journal.staging;
    fs.mkdirSync(staging);
    const result = prepareAt(source, staging, target);
    if (fs.lstatSync(target, { throwIfNoEntry: false }))
      throw Error(
        "Probe output appeared during preparation; refusing replacement",
      );
    fs.renameSync(staging, target);
    staging = null;
    published = true;
    json(jp, {
      ...journal,
      status: "PREPARED_UNVERIFIED",
      staging: null,
      finished_at: new Date().toISOString(),
    });
    return result;
  } catch (e) {
    if (published)
      throw Error(
        "Probe output was published at " +
          target +
          ", but journal finalization failed: " +
          e.message +
          ". Inspect the existing probe; do not prepare over it.",
      );
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    json(jp, {
      ...journal,
      status: "FAILED",
      staging: null,
      reason: e.message,
      finished_at: new Date().toISOString(),
    });
    throw Error(
      "Probe preparation failed: " +
        e.message +
        "; output was not published. Fix the cause and repeat prepare. Journal: " +
        jp,
    );
  }
}
export function probePermissions(root) {
  const abs = (p) => "/" + p; // Claude permission syntax: // = absolute path
  const sh = shared;
  return {
    permissions: {
      allow: [
        "Read",
        "Workflow",
        "Edit(" + abs(root) + "/**)",
        "Write(" + abs(root) + "/**)",
        "Bash(node " + sh + "/scripts/*)",
        "Bash(node " + sh + "/examples/*)",
        "Bash(node --test*)",
        "Bash(node --check*)",
        "Bash(git status*)",
        "Bash(git diff*)",
        "Bash(git log*)",
        "Bash(git show*)",
        "Bash(git rev-parse*)",
        "Bash(git branch*)",
        "Bash(git add*)",
        "Bash(git commit*)",
        "Bash(git checkout*)",
        "Bash(git switch*)",
        "Bash(git clone --no-hardlinks --local*)",
        "Bash(git config*)",
        "Bash(git remote*)",
        "Bash(git -C*)",
        "Bash(cd *)",
        "Bash(ls*)",
        "Bash(cat*)",
        "Bash(head*)",
        "Bash(tail*)",
        "Bash(wc*)",
        "Bash(grep*)",
        "Bash(pwd)",
        "Bash(echo*)",
        "Bash(find*)",
        "Bash(mkdir*)",
        "Bash(sha256sum*)",
        "Bash(realpath*)",
      ],
      deny: [
        "Bash(git push*)",
        "Bash(git -C* push*)",
        "Edit(" + abs(sh) + "/**)",
        "Write(" + abs(sh) + "/**)",
      ],
    },
  };
}
function prepareAt(source, target, publicTarget) {
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
  // Keep the real fetch URL for canonical mission identity, but a probe must
  // never publish branches/checkpoints into its source GitHub repository. Use
  // the final published path, since this clone is still in staging here.
  execFileSync(
    "git",
    [
      "-C",
      target,
      "config",
      "remote.origin.pushurl",
      path.join(publicTarget, ".git", "autodev-probe-push-disabled"),
    ],
    { stdio: "pipe" },
  );
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
  json(path.join(dir, "contract.json"), {
    version: 2,
    checks: items.flatMap((t) =>
      ["test", "api"].map((kind) => ({
        id: t.id + "-" + kind,
        task_id: t.id,
        requirement_refs: t.requirement_refs,
        kind,
        command: '"$AUTODEV_NODE" "$AUTODEV_COMMON/examples/api-check.mjs"',
        timeout_ms: 15000,
      })),
    ),
    human_review: false,
  });
  const installed = installAgents({ target });
  // Headless `claude -p` has no approver, so the first `node` command is denied
  // and /goal stalls (observed live). Claude Code ignores permissions.allow from
  // a project's .claude/settings.json in an untrusted workspace, so the allowlist
  // is a launcher-supplied --settings file (not the clone's own settings and not
  // the user's trust flag). Scope: this clone and the shared harness scripts;
  // pushes and writes into the shared checkout stay denied. No bypass flag.
  json(path.join(dir, "probe-permissions.json"), probePermissions(publicTarget));
  const c = contracts(target);
  const request = {
    target: publicTarget,
    shared,
    mission_id: c.mission.mission_id,
    session_id: c.session.session_id,
    observation_id: observationId(c),
    agents: installed.agents,
    run_id: "live-probe-run",
    attempt_id: "live-probe-attempt-1",
    capabilities: { registry_verified: false, readonly_verified: false },
    milestone_every: 2,
    max_sprints: 1,
  };
  json(path.join(dir, "probe-input.json"), request);
  json(path.join(dir, "probe-results.json"), freshResults());
  // All state is still new and unobserved: relocate its binding before atomic publication.
  const session = read(path.join(dir, "session.json"));
  Object.assign(session, {
    root: publicTarget,
    gitDir: path.join(publicTarget, ".git"),
    commonDir: path.join(publicTarget, ".git"),
  });
  json(path.join(dir, "session.json"), session);
  const prompt = `/goal Read ${shared}/START.md. This is an isolated LIVE runtime test project at ${publicTarget}, copied from ${source.repository}; never modify the source checkout. Read .autodev/probe-input.json, obtain the root state lease with state begin before model observations, refresh context.mjs, and use workflows/runtime-probe.js before the mission controller. Verify discovered native agents and actual read-only rejection in the isolated fixture before enabling the mission controller. Collect actual SDK/task records and model routing; never set probe PASS from self-report. Then run develop-mission.js with max_sprints=1, repair all four functions across at least three parent-relaunched bursts, review, test, preserve milestone/escalation history, and pause/resume using operation/state evidence. Never push to the source remote or bypass the isolated origin.pushurl guard. At a drained unfinished boundary save a LOCAL checkpoint without --publish true, make a second LOCAL isolated clone, retain the original fetch URL only as repository identity, configure that clone's origin.pushurl to its own nonexistent .git/autodev-probe-push-disabled path, restore the checkpoint and revalidate. Source checkout/config/refs and source remote refs must remain unchanged; remote publication remains UNVERIFIED unless a separate explicit destination is later authorized. Do not invent a different repository identity to make restoration pass. Compute final verify only after runtime drained. Record multi_burst_state and checkpoint_reclone from actual native/Git evidence, not a plan to run them. Record each observation with scripts/probe-result.mjs and leave unavailable conditions UNVERIFIED. Native Workflow agents are reported by the runtime as workflow_agent progress (import-runtime reads them) and their runtime-recorded tool lists are collected with scripts/readonly-evidence.mjs --target T --raw SDK_JSONL --tool_use WORKFLOW_TOOL_USE_ID; a launch result runId is not the SDK stream run_id, so use import-termination for the terminal proof. Fixture model logs must never be substituted for live records.`;
  fs.writeFileSync(path.join(dir, "probe-prompt.txt"), prompt + "\n");
  return {
    status: "PREPARED_UNVERIFIED",
    target: publicTarget,
    source: source.root,
    prompt,
    request,
  };
}
export async function runProbe(o) {
  const c = contracts(o.target),
    lock = path.join(c.dir, ".probe-run.lock");
  if (read(path.join(c.dir, "current-task.json")).active)
    throw Error(
      "Previous root run is active/unknown; establish termination and recover it before launching another probe",
    );
  if (fs.existsSync(lock)) {
    const old = read(lock);
    if (alive(old.owner) !== false || (old.child && alive(old.child) !== false))
      throw Error(
        "Probe launcher/child active or unknown; wait or stop it before retry",
      );
    fs.renameSync(
      lock,
      path.join(
        c.dir,
        "evidence",
        "interrupted-probe-lock-" + crypto.randomUUID() + ".json",
      ),
    );
  }
  const invocation_id = crypto.randomUUID(),
    lease = { invocation_id, owner: owner(), child: null };
  const fd = fs.openSync(lock, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(lease));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const rawName = "live-sdk-" + invocation_id + ".jsonl",
    stderrName = "live-cli-" + invocation_id + ".stderr.txt",
    manifestName = "live-run-" + invocation_id + ".json";
  const manifestPath = path.join(c.dir, "evidence", manifestName),
    resultsPath = path.join(c.dir, "probe-results.json");
  const manifest = {
    version: 2,
    invocation_id,
    claude_binary: o.claude || "claude",
    resume_session: o.resume || null,
    status: "RUNNING_UNVERIFIED",
    started_at: new Date().toISOString(),
    raw: rawName,
    stderr: stderrName,
    exit_code: null,
    signal: null,
  };
  let child, raw, err, signalHandler, stopHandler, killTimer;
  try {
    const prompt =
      fs.readFileSync(path.join(c.dir, "probe-prompt.txt"), "utf8") +
      "\nCurrent probe invocation_id=" +
      invocation_id +
      ". Pass --invocation " +
      invocation_id +
      " to every probe-result.mjs update; use only this invocation's observations.\n";
    mutex(c.session.root, () => {
      if (fs.existsSync(resultsPath))
        json(
          path.join(
            c.dir,
            "evidence",
            "probe-results-before-" + invocation_id + ".json",
          ),
          read(resultsPath),
        );
      json(resultsPath, freshResults(invocation_id));
      const inputPath = path.join(c.dir, "probe-input.json");
      if (fs.existsSync(inputPath)) {
        const input = read(inputPath);
        json(
          path.join(
            c.dir,
            "evidence",
            "probe-input-before-" + invocation_id + ".json",
          ),
          input,
        );
        json(inputPath, {
          ...input,
          target: c.session.root,
          shared,
          mission_id: c.mission.mission_id,
          session_id: c.session.session_id,
          observation_id: observationId(c),
          run_id: "live-probe-" + invocation_id,
          attempt_id: crypto.randomUUID(),
          capabilities: { registry_verified: false, readonly_verified: false },
        });
      }
    });
    json(manifestPath, manifest);
    raw = fs.createWriteStream(path.join(c.dir, "evidence", rawName), {
      flags: "wx",
    });
    err = fs.createWriteStream(path.join(c.dir, "evidence", stderrName), {
      flags: "wx",
    });
    child = spawn(
      o.claude || "claude",
      [
        ...(o.resume ? ["--resume", o.resume] : []),
        "--model",
        "claude-sonnet-5-5",
        ...(fs.existsSync(path.join(c.dir, "probe-permissions.json"))
          ? ["--settings", path.join(c.dir, "probe-permissions.json")]
          : []),
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
      {
        cwd: c.session.root,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      lease.child = { ...owner(child.pid), process_group: child.pid };
      json(lock, lease);
    } catch {
      /* A short-lived CLI can exit before its process record is observed. */
    }
    stopHandler = () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      if (!killTimer)
        killTimer = setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, 1500).unref();
    };
    signalHandler = () => {
      manifest.interrupted = true;
      process.exitCode = 143;
      stopHandler();
    };
    process.on("SIGTERM", signalHandler);
    process.on("SIGINT", signalHandler);
    const streams = [finished(raw), finished(err)];
    raw.on("error", stopHandler);
    err.on("error", stopHandler);
    child.stdout.pipe(raw);
    child.stderr.pipe(err);
    const result = await new Promise((resolve, reject) => {
      child.once("error", (e) => {
        raw.end();
        err.end();
        reject(e);
      });
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    await Promise.all(streams);
    Object.assign(manifest, {
      status: "EXITED_UNVERIFIED",
      exit_code: result.code,
      signal: result.signal,
    });
    if (manifest.interrupted) process.exitCode = 143;
    else if (result.code !== 0) process.exitCode = result.code || 2;
    return {
      status: "UNVERIFIED_UNTIL_PROBE_RESULTS_CHECKED",
      invocation_id,
      raw: rawName,
      stderr: stderrName,
      manifest: manifestName,
      exit_code: result.code,
    };
  } catch (e) {
    Object.assign(manifest, {
      status: "LAUNCH_FAILED_UNVERIFIED",
      reason: e.message,
    });
    throw e;
  } finally {
    if (killTimer) clearTimeout(killTimer);
    if (signalHandler) {
      process.off("SIGTERM", signalHandler);
      process.off("SIGINT", signalHandler);
    }
    for (const stream of [raw, err])
      if (stream && !stream.closed) {
        stream.end();
        await finished(stream).catch(() => {});
      }
    Object.assign(manifest, { finished_at: new Date().toISOString() });
    for (const [key, n] of [
      ["raw_sha256", rawName],
      ["stderr_sha256", stderrName],
    ])
      if (fs.existsSync(path.join(c.dir, "evidence", n)))
        manifest[key] = hash(fs.readFileSync(path.join(c.dir, "evidence", n)));
    json(manifestPath, manifest);
    // A lease is removed only by its owning invocation. Never clear another launch's lock.
    if (fs.existsSync(lock) && read(lock).invocation_id === invocation_id)
      fs.unlinkSync(lock);
  }
}
if (isMain(import.meta.url))
  main(async (o) => {
    if (o.mode === "prepare")
      return console.log(JSON.stringify(prepareProbe(o), null, 2));
    if (o.mode === "recover-prepare")
      return console.log(JSON.stringify(recoverPrepare(o), null, 2));
    if (o.mode !== "run" || !o.target)
      throw Error(
        "Use --mode prepare --source TEST_REPO --output NEW_DIR, --mode run --target ISOLATED_DIR, or --mode recover-prepare --output NEW_DIR",
      );
    console.log(JSON.stringify(await runProbe(o)));
  });

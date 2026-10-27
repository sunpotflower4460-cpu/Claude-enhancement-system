import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { shared, json, read, main, isMain, load } from "./lib/core.mjs";
import { writePermissions } from "./permissions.mjs";

// Automatic recovery. A headless `claude -p` /goal run can die (container restart, OOM,
// 10-minute background ceiling, killed CLI) or go silent. The supervisor re-launches the
// SAME Claude session with `--resume` and the standard recovery instruction until the
// independent verify says COMPLETE, a restart budget is exhausted, or several restarts in a
// row make no observable progress (then it stops with a precise reason instead of looping).
// It never edits harness state itself: recovery goes through the same documented
// burst/state/recover steps, performed by the resumed model session.
const RECOVERY = (target, raw, n) =>
  `前回のプロセスが終了または停止しました(自動復帰 ${n} 回目)。同じ/goal(${target}の原要求と完成条件)を続けてください。` +
  `${shared}/START.md の「中断時」に従い、今回のSDK記録 ${raw} を --resume_raw に使って実terminalを取り込み、` +
  `burst finish→state recover→新attempt→nextの再開地点から進めてください。` +
  `完了済みtaskの旧PASSは持ち越さず、現在productに対する検査・独立レビュー・Opus最終監査・state end・独立verifyまで実行してください。` +
  `未達成条件を縮小せず、確認できないものはUNVERIFIEDのままにしてください。`;
// Kept in the Git dir, not .autodev: bootstrap publishes .autodev by renaming a fresh directory
// into place, so a pre-created .autodev would break the very first mission, and the files
// are not product anyway.
export const superviseDir = (root) =>
  path.join(
    execFileSync("git", ["-C", root, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim(),
    "autodev-supervise",
  );
const dir = superviseDir;
const progressMark = (root) => {
  // Observable progress = backlog statuses + burst count + product/evidence change markers.
  const d = path.join(root, ".autodev");
  const safe = (f) => {
    try {
      return read(path.join(d, f));
    } catch {
      return null;
    }
  };
  const b = safe("backlog.json"),
    bu = safe("bursts.json");
  return JSON.stringify({
    tasks: b?.items?.map((t) => t.status) ?? null,
    bursts: bu?.entries?.length ?? 0,
    ops: fs.existsSync(path.join(d, "operations"))
      ? fs.readdirSync(path.join(d, "operations")).length
      : 0,
  });
};
export function verifyStatus(root, o = {}) {
  const script = o.verify_script || path.join(shared, "scripts", "verify.mjs"),
    r = spawnSync(process.execPath, [script, "--target", root], {
      encoding: "utf8",
      timeout: 600000,
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    });
  const out = r.stdout || "",
    i = out.lastIndexOf("\n}"),
    text = i >= 0 ? out.slice(0, i + 2) : out;
  try {
    const j = JSON.parse(text);
    return { status: j.status, assurance: j.assurance, issues: j.issues || [] };
  } catch {
    return { status: "UNVERIFIED", issues: [out.slice(0, 300) || r.stderr?.slice(0, 300) || "verify produced no JSON"] };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function runClaude(o, root, args, logFile, errFile, stallMs) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile, { flags: "a" }),
      err = fs.createWriteStream(errFile, { flags: "a" });
    const child = spawn(o.claude || "claude", args, {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AUTODEV_COMMON: shared,
        AUTODEV_RUNTIME_LOG: logFile,
        // Without this the headless CLI stops background Workflows 10 minutes after the last turn.
        CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS:
          process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? "0",
      },
    });
    let last = Date.now(),
      stalled = false;
    child.stdout.on("data", (d) => {
      last = Date.now();
      out.write(d);
    });
    child.stderr.on("data", (d) => err.write(d));
    const killGroup = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {
        try {
          child.kill(sig);
        } catch {}
      }
    };
    const timer = setInterval(() => {
      if (stallMs && Date.now() - last > stallMs) {
        stalled = true;
        killGroup("SIGTERM");
        setTimeout(() => killGroup("SIGKILL"), 10000).unref();
      }
    }, Math.min(5000, Math.max(50, stallMs / 4 || 5000)));
    const forward = () => killGroup("SIGTERM");
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
    child.on("close", (code, signal) => {
      clearInterval(timer);
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      out.end();
      err.end();
      resolve({ code, signal, stalled, pid: child.pid });
    });
  });
}
const sessionOf = (logFile) => {
  try {
    for (const l of fs.readFileSync(logFile, "utf8").split("\n")) {
      if (!l.includes('"session_id"')) continue;
      const j = JSON.parse(l);
      if (j.session_id) return j.session_id;
    }
  } catch {}
  return null;
};
export async function supervise(o) {
  // A fresh target has no .autodev yet (the model bootstraps it); an existing one is rebound.
  let root = path.resolve(o.target);
  try {
    root = load(o.target).session.root;
  } catch {}
  const d = dir(root),
    stateFile = path.join(d, "state.json");
  fs.mkdirSync(d, { recursive: true });
  const num = (v, dflt) => (v === undefined ? dflt : Number(v));
  const maxRestarts = num(o.max_restarts, 12),
    stallMs = num(o.stall_minutes, 25) * 60000,
    backoff = num(o.backoff_seconds, 15) * 1000,
    noProgressLimit = num(o.no_progress_limit, 3);
  const prev = fs.existsSync(stateFile) ? read(stateFile) : null;
  const st = {
    version: 1,
    target: root,
    session_id: o.session || prev?.session_id || null,
    attempts: prev?.attempts ?? 0,
    runs: prev?.runs ?? [],
    started_at: prev?.started_at || new Date().toISOString(),
  };
  const save = () => json(stateFile, st);
  const settings =
    o.settings ||
    (o.no_permissions === "true"
      ? null
      : writePermissions({ target: root, allow_publish: o.allow_publish }).settings);
  let noProgress = 0,
    mark = progressMark(root);
  for (;;) {
    const v0 = verifyStatus(root, o);
    if (v0.status === "COMPLETE") {
      const rep = { ...st, status: "COMPLETE", verify: v0, finished_at: new Date().toISOString() };
      json(path.join(d, "report.json"), rep);
      return rep;
    }
    if (st.attempts > maxRestarts) {
      const rep = { ...st, status: "RESTART_BUDGET_EXHAUSTED", verify: v0, finished_at: new Date().toISOString(), next: "Inspect .autodev/supervise/*, fix the cause, then run supervise again (it resumes the same session)." };
      json(path.join(d, "report.json"), rep);
      return rep;
    }
    const n = st.attempts++,
      logFile = path.join(d, "run-" + String(n).padStart(3, "0") + ".jsonl"),
      errFile = path.join(d, "run-" + String(n).padStart(3, "0") + ".stderr.txt");
    const common = [
      "--model", o.model || "claude-sonnet-5-5",
      ...(settings ? ["--settings", settings] : []),
      "--add-dir", shared,
      "--plugin-dir", shared,
      "--output-format", "stream-json",
      "--verbose", "--include-partial-messages", "--forward-subagent-text",
    ];
    let args;
    if (st.session_id) {
      args = ["--resume", st.session_id, ...common, "-p", RECOVERY(root, logFile, n)];
    } else {
      if (!o.prompt) throw Error("First launch needs --prompt (the /goal text); later restarts resume automatically");
      args = [...common, "-p", String(o.prompt)];
    }
    const run = { n, started_at: new Date().toISOString(), resume: !!st.session_id, log: path.basename(logFile) };
    st.runs.push(run);
    save();
    const r = await runClaude(o, root, args, logFile, errFile, stallMs);
    Object.assign(run, { ended_at: new Date().toISOString(), exit_code: r.code, signal: r.signal, stalled: r.stalled });
    st.session_id = st.session_id || sessionOf(logFile);
    save();
    const now = progressMark(root);
    noProgress = now === mark ? noProgress + 1 : 0;
    mark = now;
    const v = verifyStatus(root, o);
    run.verify = v.status;
    save();
    if (v.status === "COMPLETE") continue; // loop head reports COMPLETE
    if (!st.session_id) {
      const rep = { ...st, status: "NO_SESSION", verify: v, finished_at: new Date().toISOString(), reason: "The first run produced no Claude session id to resume; see " + errFile };
      json(path.join(d, "report.json"), rep);
      return rep;
    }
    if (noProgress >= noProgressLimit) {
      const rep = { ...st, status: "NO_PROGRESS", verify: v, finished_at: new Date().toISOString(), reason: noProgress + " consecutive restarts changed nothing observable; stopped instead of looping. Remaining: " + JSON.stringify(v.issues).slice(0, 600) };
      json(path.join(d, "report.json"), rep);
      return rep;
    }
    await sleep(backoff);
  }
}
if (isMain(import.meta.url))
  main(async (o) => {
    const r = await supervise(o);
    console.log(JSON.stringify(r, null, 2));
    if (r.status !== "COMPLETE") process.exitCode = 2;
  });

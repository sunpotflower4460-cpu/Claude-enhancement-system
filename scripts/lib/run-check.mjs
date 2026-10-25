import fs from "node:fs";
import { owner } from "./core.mjs";
// Isolate each trusted check in a process group so timeout does not leave its children running.
import { spawn } from "node:child_process";
const [command, limit] = process.argv.slice(2);
const child = spawn("/bin/sh", ["-c", command], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "",
  stderr = "",
  error = null,
  done = false;
const runnerState = process.env.AUTODEV_RUNNER_STATE;
if (runnerState && child.pid)
  fs.writeFileSync(
    runnerState,
    JSON.stringify({ state: "running", owner: owner(child.pid) }),
  );
const stop = () => {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (e) {
    if (e.code !== "ESRCH") error = e.message;
  }
};
const timer = setTimeout(() => {
  error = "Check timed out";
  stop();
}, Number(limit));
function collect(key, chunk) {
  if (key === "stdout") stdout += chunk;
  else stderr += chunk;
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 8 * 1024 * 1024) {
    error = "Check output limit exceeded";
    stdout = stdout.slice(0, 1024 * 1024);
    stderr = stderr.slice(0, 1024 * 1024);
    stop();
  }
}
child.stdout.on("data", (x) => collect("stdout", x));
child.stderr.on("data", (x) => collect("stderr", x));
child.on("error", (e) => {
  error = e.message;
});
child.on("close", (status, signal) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  // Also terminate background children of a command that exited early.
  stop();
  if (runnerState)
    fs.writeFileSync(
      runnerState,
      JSON.stringify({ state: "stopped", pid: child.pid }),
    );
  process.stdout.write(
    JSON.stringify({
      stdout,
      stderr,
      status,
      signal,
      error: error ? { message: error } : null,
    }),
  );
});

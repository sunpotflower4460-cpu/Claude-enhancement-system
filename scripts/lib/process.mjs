import fs from "node:fs";
import os from "node:os";
import cp from "node:child_process";

// Persist process birth as well as PID: a recycled PID cannot own an old lease.
// Linux keeps the v2 start-tick representation. Darwin supplies lstart via its
// native BSD ps (C locale + UTC make the persisted value independent of locale).
function inspect(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error("Invalid process ID");
  if (process.platform === "linux") {
    const text = fs.readFileSync("/proc/" + pid + "/stat", "utf8"),
      fields = text
        .slice(text.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/);
    if (!fields[19] || !/^\d+$/.test(fields[19]))
      throw Error("Unrecognized Linux process identity");
    return { start: fields[19], zombie: fields[0] === "Z" };
  }
  if (process.platform === "darwin") {
    let text;
    try {
      text = cp
        .execFileSync(
          "/bin/ps",
          ["-p", String(pid), "-o", "lstart=", "-o", "stat="],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
          },
        )
        .trim();
    } catch (e) {
      // ps exit 1 is absent only if kill(0) independently confirms ESRCH.
      try {
        process.kill(pid, 0);
      } catch (probe) {
        if (probe.code === "ESRCH")
          throw Object.assign(Error("Process absent"), { code: "ESRCH" });
      }
      throw e;
    }
    const match =
      /^(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)$/.exec(
        text,
      );
    if (!match) throw Error("Unrecognized macOS process identity");
    return {
      start: "ps-lstart:" + match[1].replace(/\s+/g, " "),
      zombie: match[2].startsWith("Z"),
    };
  }
  throw Error("Process observation requires Linux or macOS");
}
export function owner(pid = process.pid) {
  return { pid, host: os.hostname(), start: inspect(pid).start };
}
function processAlive(o) {
  try {
    const current = inspect(o.pid);
    return !current.zombie && current.start === o.start;
  } catch (e) {
    if (e.code === "ESRCH") return false;
    if (e.code === "ENOENT") {
      try {
        process.kill(o.pid, 0);
      } catch (probe) {
        if (probe.code === "ESRCH") return false;
      }
    }
    // Access denied, malformed observations and unsupported systems cannot
    // establish process death. Recovery must retain ownership in these cases.
    return null;
  }
}
function groupAlive(group) {
  if (!Number.isSafeInteger(group) || group < 1) return null;
  try {
    const text = cp.execFileSync("/bin/ps", ["-axo", "pid=,pgid=,stat="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    });
    for (const line of text.trim().split("\n").filter(Boolean)) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
      if (!match) throw Error("Unrecognized process group observation");
      if (Number(match[2]) === group && !match[3].startsWith("Z")) return true;
    }
    return false;
  } catch {
    return null;
  }
}
export function alive(o) {
  if (!o) return false;
  if (o.host !== os.hostname()) return null;
  const processState = processAlive(o);
  if (!Object.hasOwn(o, "process_group")) return processState;
  // A recorder can die while its detached check or grandchildren still write.
  const groupState = groupAlive(o.process_group);
  if (processState === true || groupState === true) return true;
  return processState === false && groupState === false ? false : null;
}

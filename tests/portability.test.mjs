import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import cp from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fixture, shared } from "./helpers/fixture.mjs";
import { once } from "node:events";
import { owner, alive, isMain } from "../scripts/lib/core.mjs";

function platform(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value });
  t.after(() => Object.defineProperty(process, "platform", descriptor));
}
function darwin(t, output) {
  platform(t, "darwin");
  const originalRead = fs.readFileSync;
  t.mock.method(fs, "readFileSync", function (file, ...args) {
    if (String(file).startsWith("/proc/"))
      throw Object.assign(new Error("No proc on macOS"), { code: "ENOENT" });
    return originalRead.call(fs, file, ...args);
  });
  t.mock.method(cp, "execFileSync", (command, args, options) => {
    assert.equal(command, "/bin/ps");
    assert.deepEqual(args, ["-p", "123", "-o", "lstart=", "-o", "stat="]);
    assert.equal(options.env.LC_ALL, "C");
    assert.equal(options.env.TZ, "UTC");
    return output;
  });
}
test("portability: macOS owner does not require /proc and compares process birth", (t) => {
  darwin(t, "Sun Oct 25 13:01:05 2026 S+\n");
  const o = owner(123);
  assert.match(o.start, /ps-lstart:Sun Oct 25 13:01:05 2026/);
  assert.equal(alive(o), true);
  assert.equal(
    alive({ ...o, start: "ps-lstart:Sun Oct 25 13:01:04 2026" }),
    false,
  );
});
test("portability: macOS zombie is dead", (t) => {
  darwin(t, "Sun Oct 25 13:01:05 2026 Z\n");
  assert.equal(
    alive({ pid: 123, host: owner(123).host, start: owner(123).start }),
    false,
  );
});
test("portability: inability to observe a local process is unknown, never dead", (t) => {
  const o = owner();
  platform(t, "linux");
  const originalRead = fs.readFileSync;
  t.mock.method(fs, "readFileSync", function (file, ...args) {
    if (String(file).startsWith("/proc/"))
      throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    return originalRead.call(fs, file, ...args);
  });
  assert.equal(alive(o), null);
});
test("portability: missing processes, reused PID and remote owners remain distinct", () => {
  const o = owner();
  assert.equal(alive(o), true);
  assert.equal(alive({ ...o, start: o.start + "changed" }), false);
  assert.equal(alive({ ...o, pid: 2147483647 }), false);
  assert.equal(alive({ ...o, host: "some-other-machine.invalid" }), null);
});
test("portability: leader exit does not hide a still-running process group", async () => {
  const child = cp.spawn("/bin/sh", ["-c", "sleep 15 & exit 0"], {
    detached: true,
    stdio: "ignore",
  });
  const pid = child.pid;
  try {
    await once(child, "exit");
    const o = { ...owner(), pid: 2147483647, process_group: pid };
    assert.equal(alive(o), true, "background writer must prevent recovery");
    process.kill(-pid, "SIGKILL");
    for (let i = 0; i < 100 && alive(o) !== false; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(alive(o), false);
  } finally {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  }
});
test("portability: absent /proc for a live PID stays unknown", (t) => {
  const o = owner();
  platform(t, "linux");
  t.mock.method(fs, "readFileSync", () => {
    throw Object.assign(Error("No proc mounted"), { code: "ENOENT" });
  });
  assert.equal(alive(o), null);
});
test("portability: malformed macOS observations and unsupported hosts cannot unlock", (t) => {
  const o = owner();
  darwin(t, "unexpected ps output");
  assert.equal(alive({ ...o, pid: 123 }), null);
});
test("portability: macOS ps permission failure is not proof of death", (t) => {
  const o = owner();
  platform(t, "darwin");
  t.mock.method(cp, "execFileSync", () => {
    throw Object.assign(Error("ps denied"), { status: 1 });
  });
  t.mock.method(process, "kill", () => {
    throw Object.assign(Error("denied"), { code: "EPERM" });
  });
  assert.equal(alive(o), null);
});
test("portability: failed process-group observation cannot authorize takeover", (t) => {
  const o = { ...owner(), pid: 2147483647, process_group: 999999 };
  t.mock.method(cp, "execFileSync", () => {
    throw Error("ps unavailable");
  });
  assert.equal(alive(o), null);
});

test("portability: CLI entry detection handles encoded paths and symlink launch", (t) => {
  const f = fixture(t),
    dir = path.join(f.base, "shared repo 日本語");
  fs.mkdirSync(dir);
  for (const name of ["scripts", "schemas", "package.json"])
    fs.cpSync(path.join(shared, name), path.join(dir, name), {
      recursive: true,
    });
  fs.symlinkSync(
    path.join(shared, "node_modules"),
    path.join(dir, "node_modules"),
    "dir",
  );
  cp.execFileSync("git", ["-C", dir, "init", "-b", "main"], {
    stdio: "ignore",
  });
  cp.execFileSync("git", [
    "-C",
    dir,
    "remote",
    "add",
    "origin",
    "https://github.com/sunpotflower4460-cpu/Claude-enhancement-system.git",
  ]);
  fs.rmSync(f.dir, { recursive: true });
  const script = path.join(dir, "scripts/bootstrap.mjs"),
    alias = path.join(dir, "scripts/launch alias.mjs");
  fs.symlinkSync(script, alias);
  const result = cp.spawnSync(
    process.execPath,
    [alias, "--target", f.target, "--mission", f.source],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "INITIALIZED");
  const previousArgv = process.argv;
  t.after(() => {
    process.argv = previousArgv;
  });
  process.argv = [process.execPath, alias];
  assert.equal(isMain(pathToFileURL(script)), true);
  assert.equal(isMain(import.meta.url), false);
});

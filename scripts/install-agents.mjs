import { isMain } from "./lib/core.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  shared,
  load,
  main,
  mutex,
  identity,
  owner,
  alive,
  read,
} from "./lib/core.mjs";
export const roles = [
  "opus-architect",
  "opus-auditor",
  "sonnet-planner",
  "sonnet-reviewer",
  "sonnet-verifier",
  "haiku-builder",
];
export function installAgents(o) {
  const id = identity(o.target),
    common = identity(shared);
  if (id.repository === common.repository || id.commonDir === common.commonDir)
    throw Error("Target is shared repository");
  const initialized = fs.existsSync(path.join(id.root, ".autodev")),
    c = initialized ? load(id.root) : null;
  const apply = () => {
    const dir = path.join(id.root, ".claude", "agents");
    for (const p of [path.join(id.root, ".claude"), dir]) {
      const st = fs.lstatSync(p, { throwIfNoEntry: false });
      if (st?.isSymbolicLink() || (st && !st.isDirectory()))
        throw Error("Unsafe agent directory");
    }
    const files = roles.map((role) => {
      const text = fs
          .readFileSync(path.join(shared, "agents", role + ".md"), "utf8")
          .replace("name: " + role, "name: autodev-" + role),
        dest = path.join(dir, "autodev-" + role + ".md"),
        st = fs.lstatSync(dest, { throwIfNoEntry: false });
      if (
        st &&
        (st.isSymbolicLink() ||
          !st.isFile() ||
          fs.readFileSync(dest, "utf8") !== text)
      )
        throw Error("Agent definition conflict: " + dest);
      return { text, dest };
    });
    if (
      c &&
      JSON.parse(fs.readFileSync(path.join(c.dir, "current-task.json")))
        .active &&
      files.some((f) => !fs.existsSync(f.dest))
    )
      throw Error("Cannot add agents during an active owner");
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files)
      if (!fs.existsSync(f.dest)) {
        const tmp = path.join(
            c ? path.join(c.dir, "evidence") : id.gitDir,
            "autodev-agent-install-" + crypto.randomUUID() + ".tmp",
          ),
          fd = fs.openSync(tmp, "wx");
        try {
          fs.writeFileSync(fd, f.text);
          fs.fsyncSync(fd);
          fs.closeSync(fd);
          fs.linkSync(tmp, f.dest);
        } finally {
          try {
            fs.closeSync(fd);
          } catch {}
          fs.rmSync(tmp, { force: true });
        }
      }
    return {
      status: "INSTALLED_NOT_RUNTIME_VERIFIED",
      agents: Object.fromEntries(roles.map((r) => [r, "autodev-" + r])),
      next: "Install before starting Claude session when agents directory is new; validate native registry and isolated read-only probe. Existing watched project agents reload within seconds; added-directory agents need restart.",
    };
  };
  if (initialized) return mutex(id.root, apply);
  const lock = path.join(id.gitDir, "autodev-agent-install.lock");
  if (fs.existsSync(lock)) {
    if (alive(read(lock)) !== false)
      throw Error("Agent installer owner active/unknown");
    fs.renameSync(
      lock,
      path.join(
        id.gitDir,
        "autodev-install-old-" + crypto.randomUUID() + ".json",
      ),
    );
  }
  const fd = fs.openSync(lock, "wx");
  fs.writeFileSync(fd, JSON.stringify(owner()));
  try {
    if (fs.existsSync(path.join(id.root, ".autodev")))
      throw Error(
        "Target state appeared concurrently; retry through initialized lock",
      );
    return apply();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(installAgents(o), null, 2)));

import { isMain } from "./lib/core.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  observationContext,
  identity,
  fingerprint,
  read,
  json,
  hash,
  mutex,
  safeState,
  validate,
  main,
  shared,
} from "./lib/core.mjs";
import {
  beginRestore,
  recoverRestore,
  restoreLock,
} from "./lib/restore-checkpoint.mjs";
import { excludeState } from "./lib/exclude-state.mjs";
import { burstStatus } from "./burst.mjs";

const required = [
  "mission.json",
  "mission.md",
  "backlog.json",
  "session.json",
  "current-task.json",
  "progress.json",
  "architecture.md",
  "handoff.md",
];
const optional = [
  "contract.json",
  "resume.json",
  "routing.json",
  "failure.json",
  "bursts.json",
  "sprint.md",
  "decisions.md",
  "architecture-provenance.json",
  "planning-repair.json",
];
const manifestName = ".autodev/checkpoint.json";
function git(root, args, { env = {}, input } = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    env: { ...process.env, ...env },
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function text(root, ...args) {
  return git(root, args).toString().trim();
}
function refName(branch) {
  if (!/^autodev\/checkpoint\/[A-Za-z0-9_-]+$/.test(branch))
    throw Error("Use dedicated autodev/checkpoint/MISSION branch");
  return "refs/heads/" + branch;
}
function head(root) {
  try {
    return text(root, "rev-parse", "--verify", "HEAD");
  } catch {
    return null;
  }
}
function treeFiles(root, ref) {
  return git(root, ["ls-tree", "-r", "--name-only", "-z", ref])
    .toString()
    .split("\0")
    .filter(Boolean);
}
function blob(root, ref, name) {
  return git(root, ["show", ref + ":" + name]);
}
function validateManifest(m) {
  validate("checkpoint", m);
  const paths = m.files.map((f) => f.path);
  if (new Set(paths).size !== paths.length)
    throw Error("Duplicate checkpoint file");
  for (const p of paths)
    if (
      !p.startsWith(".autodev/") ||
      p === manifestName ||
      p.split("/").some((x) => !x || x === "." || x === "..") ||
      /[\\\0]/.test(p)
    )
      throw Error("Invalid checkpoint path");
  if (required.some((n) => !paths.includes(".autodev/" + n)))
    throw Error("Missing required checkpoint state");
  if (m.phase === "DEVELOPMENT" && !paths.includes(".autodev/contract.json"))
    throw Error("Missing checkpoint contract");
  if (m.phase === "PLANNING" && paths.includes(".autodev/contract.json"))
    throw Error("Unexpected planning contract");
  return m;
}
function assertIdle(dir) {
  const s = validate("current-task", read(path.join(dir, "current-task.json")));
  if (s.active)
    throw Error("Drain Workflow and state pause/end/recover before checkpoint");
  for (const n of fs.readdirSync(path.join(dir, "operations")))
    if (
      validate("operation", read(path.join(dir, "operations", n))).state ===
      "started"
    )
      throw Error("Unreconciled operation; recover before checkpoint");
  for (const n of fs
    .readdirSync(path.join(dir, "evidence"))
    .filter((n) => /^runner-.*\.json$/.test(n)))
    if (read(path.join(dir, "evidence", n)).state === "running")
      throw Error("Check runner not closed; recover before checkpoint");
}
function collect(dir) {
  const included = [],
    omitted = [];
  let artifacts = 0;
  function add(relative, essential = false) {
    const p = path.join(dir, relative),
      st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (!st) {
      if (essential) throw Error("Missing checkpoint state: " + relative);
      return;
    }
    if (!st.isFile())
      throw Error("Checkpoint requires regular state file: " + relative);
    const bytes = fs.readFileSync(p),
      entry = {
        path: ".autodev/" + relative,
        sha256: hash(bytes),
        size: bytes.length,
      };
    if (
      !essential &&
      relative.startsWith("evidence/") &&
      (bytes.length > 256 * 1024 ||
        artifacts + bytes.length > 2 * 1024 * 1024 ||
        !/\.(json|jsonl|md|txt|log)$/.test(relative))
    )
      omitted.push({
        ...entry,
        reason:
          "Artifact omitted; retrieve by SHA256 or rerun. Never treated as present.",
      });
    else {
      if (bytes.length > 4 * 1024 * 1024)
        throw Error("State file too large; archive separately: " + relative);
      included.push({ ...entry, bytes });
      if (relative.startsWith("evidence/")) artifacts += bytes.length;
    }
  }
  function walk(relative) {
    if (!fs.existsSync(path.join(dir, relative))) return;
    for (const n of fs.readdirSync(path.join(dir, relative)).sort()) {
      const p = path.join(relative, n),
        st = fs.lstatSync(path.join(dir, p));
      if (st.isDirectory()) walk(p);
      else add(p, !p.startsWith("evidence/"));
    }
  }
  required.forEach((n) => add(n, true));
  optional.forEach((n) => add(n));
  ["operations", "plans", "decisions", "evidence"].forEach(walk);
  const prior = path.join(dir, "checkpoint-omitted.json");
  if (fs.existsSync(prior))
    for (const e of read(prior))
      if (
        !included.some((x) => x.path === e.path) &&
        !omitted.some((x) => x.path === e.path)
      )
        omitted.push(e);
  return { included, omitted };
}
function requireSnapshotDependencies(root, env) {
  const names = git(root, ["ls-files", "-z"], { env })
    .toString()
    .split("\0")
    .filter((n) => n && !n.startsWith(".autodev/"));
  const captured = new Set(names);
  for (const n of names) {
    let current = path.join(root, n),
      st = fs.lstatSync(current, { throwIfNoEntry: false }),
      seen = new Set();
    if (!st?.isSymbolicLink()) continue;
    while (st?.isSymbolicLink()) {
      if (seen.has(current)) throw Error("Circular product symlink");
      seen.add(current);
      current = path.resolve(path.dirname(current), fs.readlinkSync(current));
      const relative = path.relative(root, current);
      st = fs.lstatSync(current, { throwIfNoEntry: false });
      if (!st) break;
      if (
        !relative ||
        relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative) ||
        !captured.has(relative)
      )
        throw Error(
          "Product symlink dependency " +
            relative +
            " is omitted from checkpoint snapshot; track/materialize the product dependency before publishing. Source files/index remain unchanged.",
        );
    }
  }
}
export function checkpointSave(o) {
  const c = observationContext(o.target),
    root = c.session.root;
  const saved = mutex(root, () => {
    assertIdle(c.dir);
    if (burstStatus(c).active)
      throw Error(
        "Active/unknown burst; establish termination and burst finish before checkpoint",
      );
    const product = fingerprint(root),
      { included, omitted } = collect(c.dir),
      branch = o.branch || "autodev/checkpoint/" + c.mission.mission_id,
      ref = refName(branch),
      parent = head(root);
    let previous = null;
    try {
      previous = text(root, "rev-parse", "--verify", ref);
    } catch {}
    const modes = git(root, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ])
      .toString()
      .split("\0")
      .filter((n) => n && !n.startsWith(".autodev/"))
      .map((n) => ({
        path: n,
        stat: fs.lstatSync(path.join(root, n), { throwIfNoEntry: false }),
      }))
      .filter((x) => x.stat?.isFile())
      .map((x) => ({ path: x.path, mode: x.stat.mode & 0o777 }));
    const m = validateManifest({
      version: 1,
      phase: c.contract ? "DEVELOPMENT" : "PLANNING",
      mission_id: c.mission.mission_id,
      repository: c.mission.target.repository,
      shared_repository: c.mission.shared.repository,
      created_at: new Date().toISOString(),
      source_head: parent,
      product,
      files: included.map(({ bytes, ...entry }) => entry),
      omitted,
      product_modes: modes,
    });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "autodev-index-")),
      env = { GIT_INDEX_FILE: path.join(temp, "index") };
    let commit;
    try {
      git(root, ["read-tree", ...(parent ? [parent] : ["--empty"])], { env });
      git(root, ["add", "-A", "--", "."], { env });
      git(
        root,
        ["rm", "-r", "--cached", "--ignore-unmatch", "--", ".autodev"],
        { env },
      );
      requireSnapshotDependencies(root, env);
      for (const entry of [
        ...included,
        {
          path: manifestName,
          bytes: Buffer.from(JSON.stringify(m, null, 2) + "\n"),
        },
      ]) {
        const oid = git(root, ["hash-object", "-w", "--stdin"], {
          input: entry.bytes,
        })
          .toString()
          .trim();
        git(
          root,
          ["update-index", "--add", "--cacheinfo", "100644", oid, entry.path],
          { env },
        );
      }
      const tree = git(root, ["write-tree"], { env }).toString().trim();
      const parents = [...new Set([parent, previous].filter(Boolean))].flatMap(
        (p) => ["-p", p],
      );
      commit = git(
        root,
        [
          "-c",
          "user.name=Autodev Checkpoint",
          "-c",
          "user.email=autodev@localhost",
          "commit-tree",
          tree,
          ...parents,
        ],
        { input: "Autodev durable checkpoint " + c.mission.mission_id + "\n" },
      )
        .toString()
        .trim();
      if (
        fingerprint(root) !== product ||
        included.some(
          (e) => hash(fs.readFileSync(path.join(root, e.path))) !== e.sha256,
        )
      )
        throw Error(
          "Product/state changed during checkpoint; retry after writers stop",
        );
      git(root, [
        "update-ref",
        ref,
        commit,
        previous || "0000000000000000000000000000000000000000",
      ]);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
    return {
      status: "SAVED_LOCAL",
      branch,
      commit,
      product,
      included: included.length,
      omitted: m.omitted,
      publish_command: ["git", "-C", root, "push", "origin", ref + ":" + ref],
    };
  });
  if (o.publish === true || o.publish === "true") {
    try {
      git(root, [
        "push",
        "origin",
        refName(saved.branch) + ":" + refName(saved.branch),
      ]);
      saved.status = "PUBLISHED";
    } catch {
      saved.publish_error =
        "Remote publication failed; local checkpoint retained. Resolve remote permission/network and retry publication.";
    }
  }
  return saved;
}
export function checkpointRestore(o) {
  const root = identity(o.target).root;
  if (fs.existsSync(restoreLock(root)))
    throw Error("Interrupted/active restore; use --action recover-restore");
  const ref = o.ref || "HEAD",
    oid = text(root, "rev-parse", "--verify", ref + "^{commit}"),
    m = validateManifest(JSON.parse(blob(root, oid, manifestName)));
  const id = identity(root);
  if (id.repository !== m.repository)
    throw Error("Checkpoint repository identity mismatch");
  if (identity(shared).repository !== m.shared_repository)
    throw Error("Checkpoint shared repository mismatch");
  const files = treeFiles(root, oid),
    expected = new Set([...m.files.map((f) => f.path), manifestName]);
  if (files.some((n) => n.startsWith(".autodev/") && !expected.has(n)))
    throw Error("Unlisted checkpoint state");
  const contents = new Map();
  for (const f of m.files) {
    const bytes = blob(root, oid, f.path);
    if (bytes.length !== f.size || hash(bytes) !== f.sha256)
      throw Error("Checkpoint content hash mismatch: " + f.path);
    contents.set(f.path, bytes);
  }
  const mission = validate(
    "mission",
    JSON.parse(contents.get(".autodev/mission.json")),
  );
  if (
    mission.mission_id !== m.mission_id ||
    mission.target.repository !== m.repository ||
    mission.shared.repository !== m.shared_repository
  )
    throw Error("Checkpoint mission mismatch");
  if (hash(contents.get(".autodev/mission.md")) !== hash(mission.original))
    throw Error("Checkpoint original mission mismatch");
  const dir = safeState(root);
  if (fs.existsSync(dir)) {
    if (!fs.existsSync(path.join(dir, "checkpoint.json")))
      throw Error("Existing mission; never overlay restored state");
    if (
      read(path.join(dir, "checkpoint.json")).mission_id !== m.mission_id ||
      head(root) !== oid
    )
      throw Error("Existing state differs from checkpoint");
    for (const f of m.files)
      if (
        !fs.existsSync(path.join(root, f.path)) ||
        hash(fs.readFileSync(path.join(root, f.path))) !== f.sha256
      )
        throw Error("Working checkpoint state changed: " + f.path);
    if (fs.existsSync(path.join(dir, "restored.json")))
      throw Error("Already restored; use reconnect/current mission");
  } else if (text(root, "status", "--porcelain=v1", "--untracked-files=all"))
    throw Error("Restore requires a clean clone; preserve current edits first");
  const s = validate(
    "current-task",
    JSON.parse(contents.get(".autodev/current-task.json")),
  );
  if (s.active)
    throw Error("Checkpoint claims active Workflow; runtime recovery required");
  for (const { path: n } of m.product_modes)
    if (
      !files.includes(n) ||
      n.startsWith(".autodev/") ||
      path.isAbsolute(n) ||
      n.split("/").some((x) => x === ".." || x === "." || x === ".git" || !x)
    )
      throw Error("Invalid product mode path");
  if (fs.existsSync(path.join(dir, ".mutex")))
    throw Error(
      "State mutex exists; stop/recover previous owner before restore",
    );
  return beginRestore(root, oid, m, contents, git);
}
export function checkpoint(o) {
  if (o.action === "save") return checkpointSave(o);
  if (o.action === "restore") return checkpointRestore(o);
  if (o.action === "recover-restore") return recoverRestore(o.target, git);
  throw Error("checkpoint action must be save or restore");
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(checkpoint(o), null, 2)));

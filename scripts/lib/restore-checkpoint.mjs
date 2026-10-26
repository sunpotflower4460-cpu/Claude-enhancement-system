import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  identity,
  read,
  json,
  hash,
  fingerprint,
  owner,
  alive,
  validate,
} from "./core.mjs";
import { excludeState } from "./exclude-state.mjs";

export const restoreLock = (root) =>
  path.join(identity(root).gitDir, "autodev-restore.lock");
function checkJournal(j, root, git) {
  const token = /^autodev\/resume\/([a-f0-9-]{36})$/.exec(j.branch || "")?.[1];
  if (
    j.version !== 1 ||
    j.target !== identity(root).root ||
    !token ||
    j.stage !== path.join(j.target, ".autodev-restore-stage-" + token) ||
    j.backup !== path.join(j.target, ".autodev-restore-backup-" + token) ||
    j.lease_ref !== "refs/autodev/restore/" + token ||
    ![
      "PREPARING",
      "READY",
      "CHECKED_OUT",
      "STATE_PUBLISHED",
      "FINALIZED",
    ].includes(j.phase) ||
    !/^[a-f0-9]{40,64}$/.test(j.checkpoint || "")
  )
    throw Error("Invalid restore journal binding/paths");
  const m = JSON.parse(
    git(root, ["show", j.checkpoint + ":.autodev/checkpoint.json"]),
  );
  validate("checkpoint", m);
  if (
    j.product !== m.product ||
    JSON.stringify(j.product_modes) !== JSON.stringify(m.product_modes) ||
    JSON.stringify(j.omitted) !== JSON.stringify(m.omitted)
  )
    throw Error("Restore journal differs from immutable checkpoint");
  for (const list of [
    j.original_files,
    j.desired_files,
    j.snapshot_files,
  ].filter(Boolean))
    for (const e of list)
      if (
        typeof e.path !== "string" ||
        path.isAbsolute(e.path) ||
        e.path
          .split(/[\\/]/)
          .some((x) => !x || x === ".." || x === "." || x === ".git") ||
        !/^[a-f0-9]{64}$/.test(e.sha256 || "")
      )
        throw Error("Invalid restore journal inventory");
  if (
    j.phase !== "PREPARING" &&
    (!Array.isArray(j.desired_files) || !Array.isArray(j.snapshot_files))
  )
    throw Error("Missing restore inventory");
  return j;
}
function lease(root, j, git, expected) {
  const payload = Buffer.from(JSON.stringify({ owner: j.owner })),
    oid = git(root, ["hash-object", "-w", "--stdin"], { input: payload })
      .toString()
      .trim();
  git(root, [
    "update-ref",
    j.lease_ref,
    oid,
    expected || "0000000000000000000000000000000000000000",
  ]);
  return oid;
}
function inventory(dir) {
  const out = [];
  function walk(p = "") {
    for (const n of fs.readdirSync(path.join(dir, p)).sort()) {
      const rel = path.join(p, n),
        st = fs.lstatSync(path.join(dir, rel));
      if (st.isDirectory()) walk(rel);
      else if (st.isFile())
        out.push({
          path: rel,
          sha256: hash(fs.readFileSync(path.join(dir, rel))),
        });
      else throw Error("Non-regular restore state");
    }
  }
  walk();
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
function matches(dir, files) {
  return (
    fs.existsSync(dir) &&
    JSON.stringify(inventory(dir)) === JSON.stringify(files)
  );
}
function productClean(root, oid, git) {
  // The dedicated checkpoint branch supplies product bytes. State is checked separately.
  const output = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude).autodev",
  ])
    .toString()
    .trim();
  if (output)
    throw Error(
      "Product changed during restore; preserve edits and resolve before recovery",
    );
  git(root, [
    "diff",
    "--exit-code",
    "--no-ext-diff",
    oid,
    "--",
    ".",
    ":(exclude).autodev",
  ]);
}
function apply(j, filename, git) {
  const root = j.target,
    dir = path.join(root, ".autodev");
  const head = () => git(root, ["rev-parse", "HEAD"]).toString().trim();
  if (j.phase === "PREPARING") {
    // Preparation never switches Git or mutates source state. A dead preparation is discardable.
    if (head() !== j.original_head)
      throw Error(
        "HEAD changed during interrupted preparation; inspect restore journal",
      );
    fs.rmSync(j.stage, { recursive: true, force: true });
    git(root, ["update-ref", "-d", j.lease_ref]);
    fs.unlinkSync(filename);
    return {
      status: "RESTORE_PREPARATION_RECOVERED",
      next: "Repeat checkpoint restore with original ref",
    };
  }
  if (j.phase === "READY") {
    let branch;
    try {
      branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])
        .toString()
        .trim();
    } catch {}
    if (branch !== j.branch) {
      if (head() !== j.original_head && head() !== j.checkpoint)
        throw Error("HEAD changed during restore; inspect journal");
      if (j.original_files && !matches(dir, j.original_files))
        throw Error("Original state changed during restore");
      if (!j.original_files && fs.existsSync(dir))
        throw Error("Unexpected mission created during restore");
      git(root, ["switch", "-c", j.branch, j.checkpoint]);
    }
    productClean(root, j.checkpoint, git);
    j.phase = "CHECKED_OUT";
    json(filename, j);
  }
  if (head() !== j.checkpoint)
    throw Error("Restore checkpoint HEAD changed; recovery refuses overlay");
  productClean(root, j.checkpoint, git);
  if (j.phase === "CHECKED_OUT") {
    for (const { path: n, mode } of j.product_modes)
      fs.chmodSync(path.join(root, n), mode);
    if (fingerprint(root) !== j.product)
      throw Error(
        "Checkpoint product differs; inspect checkout before recovery",
      );
    if (fs.existsSync(j.stage)) {
      if (!matches(j.stage, j.desired_files))
        throw Error("Staged restore state changed");
      if (fs.existsSync(dir)) {
        if (fs.existsSync(j.backup))
          throw Error("Restore backup collision; inspect journal");
        // After checkout, source state must still be exactly the snapshot from Git.
        if (!matches(dir, j.snapshot_files))
          throw Error("Working checkpoint state changed during restore");
        fs.renameSync(dir, j.backup);
      } else if (!fs.existsSync(j.backup))
        throw Error("Missing checkpoint state/backup during restore");
      fs.renameSync(j.stage, dir);
    } else if (!matches(dir, j.desired_files))
      throw Error("Restored state changed or disappeared");
    j.phase = "STATE_PUBLISHED";
    json(filename, j);
  }
  if (j.phase === "STATE_PUBLISHED") {
    if (!matches(dir, j.desired_files))
      throw Error("Restored state changed before finalization");
    if (fingerprint(root) !== j.product)
      throw Error("Product changed before restore finalization");
    excludeState(root);
    git(root, ["rm", "-r", "--cached", "--ignore-unmatch", "--", ".autodev"]);
    j.phase = "FINALIZED";
    json(filename, j);
  }
  if (j.phase !== "FINALIZED") throw Error("Unknown restore phase");
  if (!matches(dir, j.desired_files) || fingerprint(root) !== j.product)
    throw Error("Final restored state/product changed");
  fs.rmSync(j.backup, { recursive: true, force: true });
  git(root, ["update-ref", "-d", j.lease_ref]);
  fs.unlinkSync(filename);
  return {
    status: "RESTORED",
    checkpoint: j.checkpoint,
    session: read(path.join(dir, "session.json")),
    omitted: j.omitted,
    verification:
      "UNVERIFIED: rerun checks, final review/audit and runtime completion in this binding",
    next: "Use START.md with existing original mission; inspect next.mjs before any implementation",
  };
}
export function beginRestore(root, oid, m, contents, git) {
  const filename = restoreLock(root);
  if (fs.existsSync(filename))
    throw Error(
      "Interrupted/active restore; checkpoint --action recover-restore after its owner stops",
    );
  const token = crypto.randomUUID(),
    dir = path.join(root, ".autodev"),
    id = identity(root),
    branch = "autodev/resume/" + token;
  const j = {
    version: 1,
    owner: owner(),
    target: root,
    checkpoint: oid,
    original_head: id.head,
    branch,
    lease_ref: "refs/autodev/restore/" + token,
    stage: path.join(root, ".autodev-restore-stage-" + token),
    backup: path.join(root, ".autodev-restore-backup-" + token),
    product: m.product,
    product_modes: m.product_modes,
    omitted: m.omitted,
    phase: "PREPARING",
    original_files: fs.existsSync(dir) ? inventory(dir) : null,
  };
  const fd = fs.openSync(filename, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(j));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  lease(root, j, git, null);
  try {
    // Exclude transaction directories locally without changing the project's .gitignore.
    excludeState(root, "/.autodev-restore-*/");
    fs.mkdirSync(j.stage);
    for (const [name, bytes] of contents) {
      const p = path.join(j.stage, name.slice(".autodev/".length));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, bytes);
    }
    fs.writeFileSync(
      path.join(j.stage, "checkpoint.json"),
      git(root, ["show", oid + ":.autodev/checkpoint.json"]),
    );
    for (const n of ["evidence", "operations"])
      fs.mkdirSync(path.join(j.stage, n), { recursive: true });
    const old = validate("session", read(path.join(j.stage, "session.json"))),
      state = validate(
        "current-task",
        read(path.join(j.stage, "current-task.json")),
      );
    const session = validate("session", {
      version: 2,
      ...id,
      head: oid,
      branch,
      session_id: crypto.randomUUID(),
      bound_at: new Date().toISOString(),
      product: m.product,
    });
    json(
      path.join(j.stage, "evidence", "binding-" + old.session_id + ".json"),
      old,
    );
    json(path.join(j.stage, "session.json"), session);
    state.owner = null;
    state.fingerprint = m.product;
    state.history.push({
      stage: state.stage,
      at: session.bound_at,
      fingerprint: m.product,
      note: "Restored durable checkpoint; previous results require current-session verification. Partial product and selected executions retained.",
    });
    json(
      path.join(j.stage, "current-task.json"),
      validate("current-task", state),
    );
    json(path.join(j.stage, "checkpoint-omitted.json"), m.omitted);
    json(path.join(j.stage, "restored.json"), {
      version: 1,
      checkpoint: oid,
      restored_at: session.bound_at,
      previous_session: old.session_id,
      session_id: session.session_id,
      omitted: m.omitted,
    });
    fs.writeFileSync(
      path.join(j.stage, "handoff.md"),
      "Restored " +
        oid +
        ". Inspect next and retained receipts. Rerun current-binding checks, reviews/audit and terminal proof. Missing assets remain UNVERIFIED.\n",
    );
    j.desired_files = inventory(j.stage);
    j.snapshot_files = [
      ...m.files.map((f) => ({
        path: f.path.slice(".autodev/".length),
        sha256: f.sha256,
      })),
      {
        path: "checkpoint.json",
        sha256: hash(git(root, ["show", oid + ":.autodev/checkpoint.json"])),
      },
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    j.phase = "READY";
    json(filename, j);
    return apply(j, filename, git);
  } catch (e) {
    throw Error(
      e.message +
        "; state retained. Run checkpoint --action recover-restore after this process exits. Journal: " +
        filename,
    );
  }
}
export function recoverRestore(root, git) {
  const filename = restoreLock(root),
    j = read(filename);
  checkJournal(j, root, git);
  let previous = null,
    held = j.owner;
  try {
    previous = git(root, ["rev-parse", "--verify", j.lease_ref])
      .toString()
      .trim();
    held = JSON.parse(git(root, ["show", previous])).owner;
  } catch (e) {
    if (previous) throw e;
  }
  if (
    !held ||
    !Number.isSafeInteger(held.pid) ||
    held.pid < 1 ||
    typeof held.host !== "string" ||
    typeof held.start !== "string"
  )
    throw Error("Invalid restore lease owner");
  if (alive(held) !== false)
    throw Error("Restore owner active/unknown; do not steal its transaction");
  // Git compare-and-swap permits exactly one recovery process to adopt this transaction.
  j.owner = owner();
  lease(root, j, git, previous);
  json(filename, j);
  return apply(j, filename, git);
}

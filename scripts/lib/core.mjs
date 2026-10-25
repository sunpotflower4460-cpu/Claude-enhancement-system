import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
export const shared = fs.realpathSync(
  fileURLToPath(new URL("../..", import.meta.url)),
);
export const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
export const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export function json(p, x) {
  const tmp = p + "." + crypto.randomUUID() + ".tmp";
  const fd = fs.openSync(tmp, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(x, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
}
const ajv = new Ajv({ allErrors: true, strict: false }),
  validators = new Map();
export function validate(name, x) {
  if (!validators.has(name))
    validators.set(
      name,
      ajv.compile(read(path.join(shared, "schemas", name + ".schema.json"))),
    );
  const v = validators.get(name);
  if (!v(x)) throw Error(name + ": " + ajv.errorsText(v.errors));
  return x;
}
export function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export function canonicalRemote(remote) {
  // GitHub owner/repository is case-insensitive; other providers may have case-sensitive paths.
  let s = remote
    .trim()
    .replace(/^git@([^:]+):/, "ssh://git@$1/")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
  let u;
  try {
    u = new URL(s);
  } catch {
    throw Error("Unsupported remote; use a network repository URL");
  }
  if (!["https:", "http:", "ssh:"].includes(u.protocol) || u.password)
    throw Error("Unsupported remote");
  const host = u.hostname.toLowerCase(),
    repo = u.pathname.replace(/^\//, "");
  if (!host || !repo) throw Error("Invalid remote");
  return host === "github.com"
    ? host + "/" + repo.toLowerCase()
    : host + (u.port ? ":" + u.port : "") + "/" + repo;
}
export function identity(root) {
  root = fs.realpathSync(root);
  if (git(root, "rev-parse", "--show-toplevel") !== root)
    throw Error("Target must be repository root");
  let branch;
  try {
    branch = git(root, "symbolic-ref", "--quiet", "--short", "HEAD");
  } catch {
    branch = "DETACHED:" + git(root, "rev-parse", "HEAD");
  }
  let head;
  try {
    head = git(root, "rev-parse", "HEAD");
  } catch {
    head = "UNBORN";
  }
  const remote = git(root, "remote", "get-url", "origin");
  return {
    repository: canonicalRemote(remote),
    root,
    gitDir: git(root, "rev-parse", "--absolute-git-dir"),
    commonDir: fs.realpathSync(
      path.resolve(root, git(root, "rev-parse", "--git-common-dir")),
    ),
    remote,
    branch,
    head,
  };
}
export function safeState(root) {
  const dir = path.join(fs.realpathSync(root), ".autodev");
  function scan(p) {
    const st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isSymbolicLink()) throw Error("Symlink in state: " + p);
    if (st.isDirectory())
      for (const n of fs.readdirSync(p)) scan(path.join(p, n));
  }
  scan(dir);
  return dir;
}
export function stored(root) {
  const dir = safeState(root),
    mission = validate("mission", read(path.join(dir, "mission.json")));
  if (identity(root).repository !== mission.target.repository)
    throw Error("Repository identity changed");
  if (identity(shared).repository !== mission.shared.repository)
    throw Error("Shared repository mismatch");
  if (
    hash(fs.readFileSync(path.join(dir, "mission.md"))) !==
    hash(mission.original)
  )
    throw Error("Original mission changed");
  return { dir, mission };
}
export function load(root) {
  const x = stored(root),
    session = validate("session", read(path.join(x.dir, "session.json"))),
    id = identity(root);
  for (const k of ["repository", "root", "gitDir", "commonDir", "branch"])
    if (id[k] !== session[k])
      throw Error("Session binding changed; run reconnect: " + k);
  return { ...x, session };
}
export function unique(xs, label) {
  if (new Set(xs).size !== xs.length) throw Error("Duplicate " + label);
}
export function contracts(root) {
  const c = load(root),
    backlog = validate("backlog", read(path.join(c.dir, "backlog.json"))),
    contract = validate("contract", read(path.join(c.dir, "contract.json"))),
    ids = c.mission.requirements.map((x) => x.id);
  unique(ids, "requirement");
  unique(
    backlog.items.map((x) => x.id),
    "task",
  );
  unique(
    contract.checks.map((x) => x.id),
    "check",
  );
  for (const xs of [backlog.items, contract.checks]) {
    for (const x of xs)
      if (x.requirement_refs.some((id) => !ids.includes(id)))
        throw Error("Unknown requirement");
    if (ids.some((id) => !xs.some((x) => x.requirement_refs.includes(id))))
      throw Error("Missing requirement coverage");
  }
  const byId = new Map(backlog.items.map((t) => [t.id, t])),
    byCheck = new Map(contract.checks.map((x) => [x.id, x]));
  for (const t of backlog.items) {
    if (t.dependencies.some((id) => id === t.id || !byId.has(id)))
      throw Error("Invalid dependency");
    if (!t.check_refs.length)
      throw Error("Task has no acceptance checks: " + t.id);
    for (const id of t.check_refs) {
      const check = byCheck.get(id);
      if (!check || check.task_id !== t.id)
        throw Error("Task/check mapping mismatch");
    }
    if (
      t.requirement_refs.some(
        (id) =>
          !t.check_refs.some((cid) =>
            byCheck.get(cid).requirement_refs.includes(id),
          ),
      )
    )
      throw Error("Missing task requirement check");
  }
  for (const check of contract.checks) {
    const t = byId.get(check.task_id);
    if (
      !t ||
      !t.check_refs.includes(check.id) ||
      check.requirement_refs.some((id) => !t.requirement_refs.includes(id))
    )
      throw Error("Check/task requirement mismatch");
  }
  const done = new Set(),
    visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) throw Error("Dependency cycle");
    if (done.has(id)) return;
    visiting.add(id);
    byId.get(id).dependencies.forEach(visit);
    visiting.delete(id);
    done.add(id);
  }
  backlog.items.forEach((t) => visit(t.id));
  const required = {
    backend: ["test", "api"],
    "web-app": ["test", "build", "behavior", "visual"],
    game: ["test", "build", "behavior", "visual", "play"],
  }[c.mission.profile];
  if (required.some((k) => !contract.checks.some((x) => x.kind === k)))
    throw Error("Missing profile checks: " + required.join(","));
  const structure = backlog.items.map(({ status, execution, ...x }) => x);
  return {
    ...c,
    backlog,
    contract,
    digest: hash(
      JSON.stringify({
        mission: c.mission,
        contract,
        backlog: structure,
        validator: verifierVersion(),
      }),
    ),
  };
}
export function verifierVersion() {
  const files = ["package.json", "package-lock.json"];
  function walk(dir) {
    for (const n of fs.readdirSync(path.join(shared, dir)).sort()) {
      const relative = dir + "/" + n,
        st = fs.lstatSync(path.join(shared, relative));
      if (st.isDirectory()) walk(relative);
      else if (st.isFile() && /\.(mjs|js|json|md)$/.test(n))
        files.push(relative);
    }
  }
  for (const dir of [
    "scripts",
    "examples",
    "schemas",
    "agents",
    "profiles",
    "workflows",
    "skills",
  ])
    walk(dir);
  return hash(
    files
      .map((n) => n + "\0" + hash(fs.readFileSync(path.join(shared, n))))
      .join("\n"),
  );
}
export function fingerprint(root) {
  const names = execFileSync("git", [
    "-C",
    root,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .toString()
    .split("\0")
    .filter(Boolean);
  const entries = [];
  for (const n of [...new Set(names)]
    .filter((n) => n !== ".autodev" && !n.startsWith(".autodev/"))
    .sort()) {
    const p = path.join(root, n),
      st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isSymbolicLink()) {
      const link = fs.readlinkSync(p),
        candidate = path.resolve(path.dirname(p), link),
        base = fs.realpathSync(root);
      if (!candidate.startsWith(base + path.sep))
        throw Error("External product symlink is unsupported: " + n);
      let resolved;
      try {
        resolved = fs.realpathSync(p);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (resolved) {
        if (
          !resolved.startsWith(base + path.sep) ||
          resolved.startsWith(path.join(base, ".autodev") + path.sep)
        )
          throw Error("External/state product symlink is unsupported");
        const target = fs.statSync(resolved);
        if (!target.isFile())
          throw Error("Directory product symlink is unsupported");
        entries.push([
          n,
          "symlink",
          link,
          target.mode & 0o777,
          hash(fs.readFileSync(resolved)),
        ]);
      } else entries.push([n, "symlink", link, "broken"]);
    } else if (st.isFile())
      entries.push([n, st.mode & 0o777, hash(fs.readFileSync(p))]);
    else throw Error("Unsupported product entry (including submodule): " + n);
  }
  return hash(JSON.stringify(entries));
}
export function owner(pid = process.pid) {
  const text = fs.readFileSync("/proc/" + pid + "/stat", "utf8"),
    fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  return { pid, host: os.hostname(), start: fields[19] };
}
export function alive(o) {
  if (!o) return false;
  if (o.host !== os.hostname()) return null;
  try {
    const text = fs.readFileSync("/proc/" + o.pid + "/stat", "utf8");
    if (text.slice(text.lastIndexOf(")") + 2).startsWith("Z ")) return false;
    return owner(o.pid).start === o.start;
  } catch {
    return false;
  }
}
export function mutex(root, fn) {
  const dir = safeState(root),
    lock = path.join(dir, ".mutex");
  const fd = fs.openSync(lock, "wx");
  fs.writeFileSync(fd, JSON.stringify(owner()));
  fs.fsyncSync(fd);
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
export function unlock(root) {
  const dir = safeState(root),
    p = path.join(dir, ".mutex");
  if (!fs.existsSync(p)) return;
  const o = read(p);
  for (const name of fs
    .readdirSync(path.join(dir, "evidence"))
    .filter((n) => n.startsWith("runner-") && n.endsWith(".json"))) {
    const r = read(artifactPath(dir, name));
    if (r.state === "running" && alive(r.owner) !== false)
      throw Error("Check process still active/unknown");
  }
  if (alive(o) !== false)
    throw Error(
      "Mutex owner active or on another host; runtime recovery required",
    );
  fs.renameSync(
    p,
    path.join(dir, "evidence", "old-mutex-" + crypto.randomUUID() + ".json"),
  );
}
export function artifactPath(dir, name) {
  if (
    typeof name !== "string" ||
    name !== path.basename(name) ||
    name === "." ||
    name === ".."
  )
    throw Error("Invalid evidence path");
  return path.join(dir, "evidence", name);
}
export function binding(c) {
  return hash(
    JSON.stringify({
      mission_id: c.mission.mission_id,
      repository: c.mission.target.repository,
    }),
  );
}
export function context(c, task) {
  if (!task?.execution) throw Error("Task has no selected execution");
  return {
    run_id: task.execution.run_id,
    task_id: task.id,
    attempt_id: task.execution.attempt_id,
    session_id: c.session.session_id,
  };
}
export function evidenceName(id) {
  return hash(id) + ".json";
}
export function options(argv = process.argv.slice(2)) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined)
      throw Error("Expected --key value");
    if (argv[i].slice(2) in o) throw Error("Duplicate option");
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}
export function main(fn) {
  try {
    const r = fn(options());
    if (r?.then)
      r.catch((e) => {
        console.log(
          JSON.stringify({ status: "UNVERIFIED", reason: e.message }),
        );
        process.exitCode = 2;
      });
  } catch (e) {
    console.log(JSON.stringify({ status: "UNVERIFIED", reason: e.message }));
    process.exitCode = 2;
  }
}
export function observationId(c) {
  const ops = fs
    .readdirSync(path.join(c.dir, "operations"))
    .sort()
    .map((n) => [n, hash(fs.readFileSync(path.join(c.dir, "operations", n)))]);
  return hash(
    JSON.stringify({
      product: fingerprint(c.session.root),
      contract: c.digest,
      session: c.session.session_id,
      backlog: c.backlog,
      state: read(path.join(c.dir, "current-task.json")),
      ops,
      progress: validate("progress", read(path.join(c.dir, "progress.json"))),
      resume: fs.existsSync(path.join(c.dir, "resume.json"))
        ? read(path.join(c.dir, "resume.json"))
        : null,
    }),
  );
}
export function invocationTag(c, ctx, stage) {
  return [
    "autodev",
    c.mission.mission_id,
    ctx.session_id,
    ctx.run_id,
    ctx.task_id,
    ctx.attempt_id,
    stage,
  ]
    .map((x) => encodeURIComponent(x))
    .join("|");
}

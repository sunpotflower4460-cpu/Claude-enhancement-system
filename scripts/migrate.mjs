import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  safeState,
  read,
  json,
  identity,
  shared,
  validate,
  fingerprint,
  main,
  hash,
  canonicalRemote,
  mutex,
} from "./lib/core.mjs";
function apply(dir, journal) {
  for (const [name, step] of Object.entries(journal.files)) {
    const dest = path.join(dir, name),
      current = fs.existsSync(dest) ? hash(fs.readFileSync(dest)) : null;
    if (current === step.after) continue;
    if (current !== step.before)
      throw Error("Migration conflict; preserve unrelated changes: " + name);
    if (step.after === null) fs.rmSync(dest, { force: true });
    else {
      const stage = path.join(dir, journal.staging, name);
      if (hash(fs.readFileSync(stage)) !== step.after)
        throw Error("Migration staging changed");
      fs.copyFileSync(stage, dest + ".migration-tmp");
      fs.renameSync(dest + ".migration-tmp", dest);
    }
  }
  fs.mkdirSync(path.join(dir, "operations"), { recursive: true });
  journal.state = "completed";
  json(path.join(dir, "migration.json"), journal);
  return {
    status: "MIGRATED_REVALIDATION_REQUIRED",
    archive: path.join(dir, journal.archive),
  };
}
export function migrate(o) {
  const dir = safeState(o.target);
  return mutex(o.target, () => {
    const jp = path.join(dir, "migration.json");
    if (fs.existsSync(jp)) {
      const j = read(jp);
      if (j.state === "prepared") return apply(dir, j);
    }
    const old = read(path.join(dir, "mission.json"));
    if (old.version === 2) return { status: "ALREADY_V2" };
    if (old.version !== 1) throw Error("Unknown mission schema");
    const state = read(path.join(dir, "current-task.json"));
    if (state.active)
      throw Error("Stop/resolve legacy active workflow before migration");
    if (
      hash(fs.readFileSync(path.join(dir, "mission.md"))) !== hash(old.original)
    )
      throw Error("Legacy original mission changed");
    const repo = identity(o.target),
      common = identity(shared);
    let originalShared;
    try {
      originalShared = identity(old.shared).repository;
    } catch {
      if (!o.legacy_shared_remote)
        throw Error(
          "Legacy common path missing; supply --legacy_shared_remote from original checkout",
        );
      originalShared = canonicalRemote(o.legacy_shared_remote);
    }
    if (
      repo.repository !== canonicalRemote(old.target.remote) ||
      common.repository !== originalShared
    )
      throw Error("Legacy repository mismatch");
    const suffix = crypto.randomUUID(),
      archive = "legacy-v1-" + suffix,
      staging = "migration-stage-" + suffix;
    fs.mkdirSync(path.join(dir, archive));
    fs.mkdirSync(path.join(dir, staging));
    const mission = validate("mission", {
        version: 2,
        mission_id: crypto.randomUUID(),
        original: old.original,
        requirements: old.requirements,
        profile: old.profile,
        target: { repository: repo.repository },
        shared: { repository: common.repository },
      }),
      backlog = read(path.join(dir, "backlog.json"));
    const payloads = {
      "progress.json": {
        version: 2,
        completed_since_audit: 0,
        last_audit_product: null,
      },
      "mission.json": mission,
      "backlog.json": validate("backlog", {
        version: 2,
        items: backlog.items.map((t) => ({
          ...t,
          status: "UNVERIFIED",
          execution: null,
          check_refs: [],
        })),
      }),
      "current-task.json": {
        version: 2,
        stage: "BLOCKED",
        sprint_task_id: null,
        run_started_at: null,
        attempt_history: [],
        run_id: null,
        task_id: null,
        attempt_id: null,
        attempt: 0,
        active: false,
        failures: 0,
        fingerprint: fingerprint(o.target),
        owner: null,
        history: [],
      },
      "session.json": {
        version: 2,
        session_id: crypto.randomUUID(),
        ...repo,
        bound_at: new Date().toISOString(),
        product: fingerprint(o.target),
      },
      "routing.json": [],
      "contract.json": null,
    };
    const files = {};
    for (const [name, value] of Object.entries(payloads)) {
      const p = path.join(dir, name),
        before = fs.existsSync(p) ? hash(fs.readFileSync(p)) : null;
      if (before) fs.copyFileSync(p, path.join(dir, archive, name));
      let after = null;
      if (value !== null) {
        json(path.join(dir, staging, name), value);
        after = hash(fs.readFileSync(path.join(dir, staging, name)));
      }
      files[name] = { before, after };
    }
    const journal = { version: 2, state: "prepared", archive, staging, files };
    json(jp, journal);
    const result = apply(dir, journal);
    fs.writeFileSync(
      path.join(dir, "handoff.md"),
      "Migrated v1 -> v2. Replan task/check mapping and rerun all checks, assessments and runtime observations. Legacy evidence preserved, never silently accepted.\n",
    );
    return result;
  });
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  main((o) => console.log(JSON.stringify(migrate(o), null, 2)));

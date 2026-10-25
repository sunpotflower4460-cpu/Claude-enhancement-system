import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  shared,
  identity,
  json,
  validate,
  main,
  safeState,
  load,
  fingerprint,
} from "./lib/core.mjs";
export function bootstrap({
  target,
  repositories,
  mission: source,
  profile = "backend",
}) {
  const common = identity(shared);
  if (!target) {
    const cs = JSON.parse(repositories)
      .map(identity)
      .filter(
        (x) =>
          x.repository !== common.repository &&
          x.commonDir !== common.commonDir,
      );
    if (cs.length !== 1) throw Error("Ambiguous target");
    target = cs[0].root;
  }
  const id = identity(target);
  if (id.repository === common.repository || id.commonDir === common.commonDir)
    throw Error("Target is shared repository");
  const dir = safeState(id.root);
  if (fs.existsSync(dir)) {
    const old = load(id.root);
    if (source) {
      const input = JSON.parse(fs.readFileSync(source));
      if (
        input.original !== old.mission.original ||
        JSON.stringify(input.requirements) !==
          JSON.stringify(old.mission.requirements)
      )
        throw Error("Mission conflict");
    }
    return { status: "RESUMED", target: id };
  }
  const input = JSON.parse(fs.readFileSync(source)),
    mission = validate("mission", {
      version: 2,
      mission_id: crypto.randomUUID(),
      original: input.original,
      requirements: input.requirements,
      profile,
      target: { repository: id.repository },
      shared: { repository: common.repository },
    });
  if (
    new Set(mission.requirements.map((r) => r.id)).size !==
    mission.requirements.length
  )
    throw Error("Duplicate requirement");
  const initialProduct = fingerprint(id.root);
  const tmp = path.join(id.root, ".autodev-init-" + crypto.randomUUID());
  fs.mkdirSync(tmp);
  try {
    json(path.join(tmp, "mission.json"), mission);
    fs.writeFileSync(path.join(tmp, "mission.md"), mission.original);
    json(path.join(tmp, "progress.json"), {
      version: 2,
      completed_since_audit: 0,
      last_audit_product: null,
    });
    json(path.join(tmp, "backlog.json"), {
      version: 2,
      items: mission.requirements.map((r) => ({
        id: r.id,
        requirement_refs: [r.id],
        status: "UNVERIFIED",
        dependencies: [],
        check_refs: [],
        execution: null,
      })),
    });
    json(path.join(tmp, "current-task.json"), {
      version: 2,
      stage: "IDLE",
      sprint_task_id: null,
      run_started_at: null,
      attempt_history: [],
      run_id: null,
      task_id: null,
      attempt_id: null,
      attempt: 0,
      active: false,
      failures: 0,
      fingerprint: null,
      owner: null,
      history: [],
    });
    fs.mkdirSync(path.join(tmp, "evidence"));
    fs.mkdirSync(path.join(tmp, "operations"));
    fs.writeFileSync(
      path.join(tmp, "architecture.md"),
      "# Architecture\nUNVERIFIED: Opus planning required.\n",
    );
    fs.writeFileSync(
      path.join(tmp, "handoff.md"),
      "Next: Opus architecture and full task/check mapping.\n",
    );
    json(
      path.join(tmp, "session.json"),
      validate("session", {
        version: 2,
        session_id: crypto.randomUUID(),
        ...id,
        bound_at: new Date().toISOString(),
        product: initialProduct,
      }),
    );
    fs.renameSync(tmp, dir);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
  }
  return { status: "INITIALIZED", target: id };
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  main((o) => console.log(JSON.stringify(bootstrap(o), null, 2)));

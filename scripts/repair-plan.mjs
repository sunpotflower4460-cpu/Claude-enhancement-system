import fs from "node:fs";
import path from "node:path";
import {
  load,
  read,
  json,
  hash,
  mutex,
  validate,
  main,
  isMain,
  initialBacklog,
} from "./lib/core.mjs";
import { terminationProof } from "./lib/recovery.mjs";
import { burstStatus } from "./burst.mjs";
const sourceNames = ["backlog.json", "contract.json", "architecture.md"];
function archive(dir, record, bytes) {
  const file = path.join(dir, "evidence", record);
  if (fs.existsSync(file)) {
    if (hash(fs.readFileSync(file)) !== hash(bytes))
      throw Error("Initial-plan archive changed");
  } else fs.writeFileSync(file, bytes, { flag: "wx" });
  return { record, sha256: hash(bytes) };
}
function sources(dir) {
  return sourceNames.map((name) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return { name, record: null, sha256: null };
    const bytes = fs.readFileSync(file);
    if (name === "backlog.json") {
      let backlog;
      try {
        backlog = JSON.parse(bytes);
      } catch {}
      if (backlog?.items?.some((task) => task.status === "PASS"))
        throw Error("Initial repair cannot erase declared completed tasks");
    }
    return {
      name,
      ...archive(
        dir,
        "initial-plan-" + name + "-" + hash(bytes) + ".txt",
        bytes,
      ),
    };
  });
}
export function repairPlan(o) {
  const c = load(o.target);
  return mutex(
    o.target,
    () => {
      const stateFile = path.join(c.dir, "current-task.json"),
        s = validate("current-task", read(stateFile));
      if (s.active || burstStatus(c).active)
        throw Error(
          "Stop/recover Workflow and finish burst before initial-plan repair",
        );
      if (
        !["IDLE", "ARCHITECTURE", "BLOCKED"].includes(s.stage) ||
        s.history.some((h) =>
          ["PLAN", "IMPLEMENT", "REVIEW", "VERIFY", "AUDIT"].includes(h.stage),
        )
      )
        throw Error(
          "Published plan cannot be reset as initial planning; preserve scope and use normal replan",
        );
      if (!o.proof) throw Error("Correlated terminal/drained proof required");
      const proof = terminationProof(c.dir, o.proof, s, {
          fixture: o.fixture === true || o.fixture === "true",
        }),
        file = path.join(c.dir, "planning-repair.json");
      let journal, previous;
      if (fs.existsSync(file)) {
        journal = read(file);
        if (
          journal.version !== 1 ||
          journal.mission_id !== c.mission.mission_id ||
          !["PREPARED", "COMPLETED"].includes(journal.phase) ||
          !Array.isArray(journal.sources)
        )
          throw Error("Initial-plan repair journal mismatch");
        if (journal.proof_sha256 !== proof.sha256) {
          if (journal.phase !== "COMPLETED")
            throw Error(
              "Prepared planning repair belongs to another terminal proof; preserve and recover its original attempt",
            );
          previous = archive(
            c.dir,
            "planning-repair-" + hash(fs.readFileSync(file)) + ".json",
            fs.readFileSync(file),
          );
          previous.generation = journal.generation || 1;
          journal = null;
        }
      }
      if (!journal) {
        journal = {
          version: 1,
          generation: (previous?.generation || 0) + 1,
          mission_id: c.mission.mission_id,
          proof_sha256: proof.sha256,
          sources: sources(c.dir),
          phase: "PREPARED",
          backlog: initialBacklog(c.mission.requirements),
          ...(previous ? { previous } : {}),
        };
        json(file, journal);
      }
      if (
        JSON.stringify(journal.backlog) !==
        JSON.stringify(initialBacklog(c.mission.requirements))
      )
        throw Error("Repair cannot alter original requirement coverage");
      const expected = Buffer.from(
        JSON.stringify(journal.backlog, null, 2) + "\n",
      );
      // Older v1 journals skipped absent inputs. Under that format an omitted name
      // means the file was absent; never bless a file that appeared after interruption.
      for (const name of ["backlog.json", "contract.json"])
        if (!journal.sources.some((source) => source.name === name))
          journal.sources.push({ name, record: null, sha256: null });
      if (
        new Set(journal.sources.map((source) => source.name)).size !==
        journal.sources.length
      )
        throw Error("Duplicate initial-plan repair source");
      for (const source of journal.sources) {
        if (
          !sourceNames.includes(source.name) ||
          (source.sha256 === null
            ? source.record !== null
            : typeof source.record !== "string" ||
              source.record !== path.basename(source.record) ||
              hash(
                fs.readFileSync(path.join(c.dir, "evidence", source.record)),
              ) !== source.sha256)
        )
          throw Error("Initial-plan archive changed");
        const p = path.join(c.dir, source.name),
          current = fs.existsSync(p) ? hash(fs.readFileSync(p)) : null;
        const allowed =
          source.name === "backlog.json"
            ? [source.sha256, hash(expected)]
            : source.name === "contract.json"
              ? [source.sha256, null]
              : [source.sha256];
        if (!allowed.includes(current))
          throw Error(
            "Plan changed since recovery; refuse overwrite: " + source.name,
          );
      }
      if (journal.phase === "COMPLETED") {
        if (
          !fs.existsSync(path.join(c.dir, "backlog.json")) ||
          hash(fs.readFileSync(path.join(c.dir, "backlog.json"))) !==
            hash(expected) ||
          fs.existsSync(path.join(c.dir, "contract.json"))
        )
          throw Error(
            "Plan changed after completed recovery; a new draft needs its own terminal proof",
          );
        return {
          status: "PLANNING_REPAIRED",
          generation: journal.generation || 1,
          archive: journal.sources,
          next: "Resume Opus from preserved architecture and archived partial draft",
        };
      }
      validate("backlog", journal.backlog);
      json(path.join(c.dir, "backlog.json"), journal.backlog);
      fs.rmSync(path.join(c.dir, "contract.json"), { force: true });
      if (s.stage !== "IDLE") {
        s.stage = "IDLE";
        s.history.push({
          stage: "IDLE",
          at: new Date().toISOString(),
          fingerprint: s.fingerprint,
          note: "Initial-plan repair preserved all original requirements and archived interrupted drafts; no acceptance implied.",
        });
        json(stateFile, validate("current-task", s));
      }
      journal.phase = "COMPLETED";
      json(file, journal);
      return {
        status: "PLANNING_REPAIRED",
        generation: journal.generation,
        archive: journal.sources,
        next: "Resume Opus with original mission, existing architecture.md and archived incomplete plan. No acceptance is implied.",
      };
    },
    { allowPlanningRepair: true },
  );
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(repairPlan(o), null, 2)));

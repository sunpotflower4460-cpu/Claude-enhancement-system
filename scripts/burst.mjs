import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  observationContext,
  read,
  json,
  hash,
  validate,
  mutex,
  observationId,
  artifactPath,
  shared,
  main,
  isMain,
} from "./lib/core.mjs";
import { terminationProof } from "./lib/recovery.mjs";
import { streamRunId, condenseSdk } from "./lib/runtime.mjs";
const recovery =
  "Do not launch another Workflow. Inspect the actual SDK task list and original launch transcript. If it launched, collect correlated termination plus a drained snapshot, then burst finish. A CLAIMED entry without a known launch remains unknown; absence of a result or local process death does not prove no launch. If no native invocation can be established, preserve the journal and obtain explicit administrative reconciliation before clearing it.";
function parse(raw) {
  return raw
    .toString()
    .split("\n")
    .filter((x) => x.trim())
    .map((x) => JSON.parse(x));
}
function rootState(c) {
  return validate("current-task", read(path.join(c.dir, "current-task.json")));
}
function journal(c) {
  const file = path.join(c.dir, "bursts.json");
  const j = fs.existsSync(file)
    ? validate("burst", read(file))
    : { version: 2, mission_id: c.mission.mission_id, entries: [] };
  if (j.mission_id !== c.mission.mission_id)
    throw Error("Burst mission mismatch");
  if (new Set(j.entries.map((e) => e.burst_id)).size !== j.entries.length)
    throw Error("Duplicate burst ID");
  if (j.entries.filter((e) => e.status !== "FINISHED").length > 1)
    throw Error("Multiple active/unknown bursts");
  return j;
}
function requireRoot(c, s, o) {
  if (!s.active)
    throw Error("An active root lease is required before burst claim");
  if (s.run_id !== o.run || s.task_id !== o.task || s.attempt_id !== o.attempt)
    throw Error("Root ownership mismatch");
}
function currentEntry(c, s, e) {
  if (
    !s.active ||
    s.run_id !== e.run_id ||
    s.task_id !== e.task_id ||
    s.attempt_id !== e.attempt_id ||
    c.session.session_id !== e.session_id
  )
    throw Error(
      "Burst no longer owns the active root lease; recover with actual termination proof",
    );
}
function nativeLaunch(c, e, raw, tool, source) {
  const events = parse(raw);
  const calls = events
    .filter((x) => x.type === "assistant")
    .flatMap((x) =>
      (x.message?.content || []).map((b) => ({ event: x, block: b })),
    )
    .filter(
      ({ block: b }) =>
        b.type === "tool_use" && b.name === "Workflow" && b.id === tool,
    );
  if (calls.length !== 1)
    throw Error("Missing/ambiguous native Workflow launch call");
  const { event, block: call } = calls[0],
    args = call.input?.args;
  const init = events.find(
    (x) =>
      x.type === "system" &&
      x.subtype === "init" &&
      x.session_id === event.session_id,
  );
  if (!init || path.resolve(init.cwd || "") !== c.session.root)
    throw Error("Burst SDK cwd mismatch");
  if (call.input?.scriptPath !== e.script_path)
    throw Error("Burst Workflow scriptPath mismatch");
  if (
    !args ||
    typeof args !== "object" ||
    args.burst_id !== e.burst_id ||
    args.mission_id !== c.mission.mission_id ||
    args.session_id !== e.session_id ||
    args.target !== c.session.root ||
    args.run_id !== e.run_id ||
    args.attempt_id !== e.attempt_id
  )
    throw Error("Native launch does not match this burst invocation");
  const launches = events.filter(
    (x) =>
      x.type === "user" &&
      x.session_id === event.session_id &&
      x.message?.content?.some(
        (b) => b.type === "tool_result" && b.tool_use_id === tool,
      ),
  );
  if (launches.length !== 1)
    throw Error("Missing/ambiguous native Workflow launch result");
  const result = launches[0].tool_use_result;
  if (
    !result ||
    launches[0].message.content.some(
      (b) => b.type === "tool_result" && b.tool_use_id === tool && b.is_error,
    ) ||
    result.error ||
    !["async_launched", "remote_launched"].includes(result.status) ||
    !result.taskId ||
    !result.runId
  )
    throw Error("No successful native Workflow launch");
  return {
    source,
    sdk_session_id: event.session_id,
    sdk_tool_use_id: tool,
    sdk_task_id: result.taskId,
    sdk_run_id: streamRunId(events, {
      session_id: event.session_id,
      tool_use_id: tool,
      task_id: result.taskId,
      launch_run_id: result.runId,
    }),
  };
}
function reused(j, e, launch) {
  for (const old of j.entries.filter((x) => x.burst_id !== e.burst_id)) {
    const ids = old.launch || old.termination;
    if (
      ids &&
      ids.sdk_session_id === launch.sdk_session_id &&
      (ids.sdk_tool_use_id === launch.sdk_tool_use_id ||
        (ids.sdk_task_id === launch.sdk_task_id &&
          ids.sdk_run_id === launch.sdk_run_id))
    )
      throw Error("Reused native Workflow identity from an earlier burst");
  }
}
function preserveRaw(c, full) {
  const raw = condenseSdk(full),
    sha256 = hash(raw),
    record = "burst-sdk-" + sha256 + ".jsonl",
    file = artifactPath(c.dir, record);
  if (fs.existsSync(file) && hash(fs.readFileSync(file)) !== sha256)
    throw Error("Archived burst evidence changed");
  fs.writeFileSync(file, raw);
  return { record, sha256 };
}
function evidenceStatus(c, entry) {
  if (!entry.launch) return "UNVERIFIED";
  try {
    const raw = fs.readFileSync(artifactPath(c.dir, entry.launch.record));
    if (hash(raw) !== entry.launch.sha256) return "UNVERIFIED";
    if (entry.termination) {
      const proof = fs.readFileSync(
        artifactPath(c.dir, entry.termination.proof),
      );
      if (
        hash(proof) !== entry.termination.proof_sha256 ||
        hash(raw) !== entry.termination.raw_sha256
      )
        return "UNVERIFIED";
    }
    return entry.launch.source === "TEST_FIXTURE" ? "TEST_FIXTURE" : "RECORDED";
  } catch {
    return "UNVERIFIED";
  }
}
// Reads the ledger only; callers may pass their already validated mission context.
// Historical FINISHED receipts with omitted checkpoint logs stay historical and
// display UNVERIFIED instead of silently pretending those files still exist.
export function burstStatus(c) {
  const j = journal(c),
    entries = j.entries.map((e) => ({
      ...e,
      evidence_status: evidenceStatus(c, e),
    })),
    active = entries.find((e) => e.status !== "FINISHED") || null;
  return {
    ...j,
    entries,
    active,
    next: active
      ? recovery
      : "Re-observe current state, acquire root lease and claim a new burst before native launch.",
  };
}
export function burst(o) {
  if (o.action === "inspect") return burstStatus(observationContext(o.target));
  return mutex(o.target, () => {
    const c = observationContext(o.target),
      s = rootState(c),
      j = journal(c),
      file = path.join(c.dir, "bursts.json");
    if (o.action === "claim") {
      requireRoot(c, s, o);
      if (j.entries.some((e) => e.status !== "FINISHED"))
        throw Error("Active/unknown burst exists. " + recovery);
      if (o.observation_id !== observationId(c))
        throw Error(
          "Stale/missing observation; inspect current state before claiming",
        );
      const script = fs.realpathSync(
        o.script_path || path.join(shared, "workflows/develop-mission.js"),
      );
      if (
        path.dirname(script) !== path.join(shared, "workflows") ||
        !script.endsWith(".js")
      )
        throw Error("Use a shared native Workflow script");
      const e = {
        burst_id: crypto.randomUUID(),
        session_id: c.session.session_id,
        run_id: s.run_id,
        task_id: s.task_id,
        attempt_id: s.attempt_id,
        claimed_at: new Date().toISOString(),
        observation_id: o.observation_id,
        script_path: script,
        owner: s.owner,
        status: "CLAIMED",
        launch: null,
        termination: null,
      };
      j.entries.push(e);
      json(file, validate("burst", j));
      return {
        ...e,
        args: {
          target: c.session.root,
          shared,
          mission_id: c.mission.mission_id,
          session_id: e.session_id,
          run_id: e.run_id,
          attempt_id: e.attempt_id,
          observation_id: observationId(observationContext(o.target)),
          burst_id: e.burst_id,
        },
      };
    }
    const e = j.entries.find((x) => x.burst_id === o.id);
    if (!e) throw Error("Unknown burst ID");
    if (e.status === "FINISHED")
      throw Error("Burst already finished; inspect preserved history");
    if (o.action === "attach") {
      currentEntry(c, s, e);
      const raw = fs.readFileSync(o.raw),
        launch = nativeLaunch(
          c,
          e,
          raw,
          o.tool_use,
          o.mode === "TEST_FIXTURE"
            ? "TEST_FIXTURE"
            : "parent-runtime-observation",
        );
      reused(j, e, launch);
      if (
        e.launch &&
        [
          "sdk_session_id",
          "sdk_tool_use_id",
          "sdk_task_id",
          "sdk_run_id",
          "source",
        ].some((k) => e.launch[k] !== launch[k])
      )
        throw Error("Burst already attached to another launch");
      e.launch = { ...launch, ...preserveRaw(c, raw) };
      e.status = "ATTACHED";
    } else if (o.action === "finish") {
      const proof = terminationProof(
        c.dir,
        o.proof,
        {
          run_id: e.run_id,
          task_id: e.task_id,
          attempt_id: e.attempt_id,
          run_started_at: e.claimed_at,
          owner: e.owner,
        },
        { fixture: o.fixture === true || o.fixture === "true" },
      );
      if (c.session.session_id !== e.session_id)
        throw Error("Burst session binding changed");
      const raw = fs.readFileSync(artifactPath(c.dir, proof.record)),
        launch = nativeLaunch(c, e, raw, proof.sdk_tool_use_id, proof.source);
      for (const k of [
        "sdk_session_id",
        "sdk_tool_use_id",
        "sdk_task_id",
        "sdk_run_id",
      ])
        if (launch[k] !== proof[k] || (e.launch && launch[k] !== e.launch[k]))
          throw Error("Burst terminal identity differs from attached launch");
      if (
        e.launch?.source === "TEST_FIXTURE" &&
        proof.source !== "TEST_FIXTURE"
      )
        throw Error("TEST FIXTURE launch cannot become live assurance");
      reused(j, e, launch);
      const savedRaw = preserveRaw(c, raw),
        archived = { ...proof, ...savedRaw },
        proofName = "burst-proof-" + hash(JSON.stringify(archived)) + ".json";
      const proofFile = artifactPath(c.dir, proofName);
      if (
        fs.existsSync(proofFile) &&
        hash(fs.readFileSync(proofFile)) !==
          hash(JSON.stringify(archived, null, 2) + "\n")
      )
        throw Error("Archived burst proof changed");
      json(proofFile, archived);
      e.launch = { ...launch, ...savedRaw };
      e.termination = {
        ...launch,
        state: proof.state,
        observed_at: proof.observed_at,
        proof: proofName,
        proof_sha256: hash(fs.readFileSync(artifactPath(c.dir, proofName))),
        raw_sha256: savedRaw.sha256,
      };
      e.status = "FINISHED";
    } else throw Error("Unknown burst action");
    json(file, validate("burst", j));
    return e;
  });
}
if (isMain(import.meta.url))
  main((o) => console.log(JSON.stringify(burst(o), null, 2)));

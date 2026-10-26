import fs from "node:fs";
import path from "node:path";
import { artifactPath, read, hash, validate, invocationTag } from "./core.mjs";
export function invocationWindow(
  events,
  { sdk_task_id, sdk_run_id, tool_use_id, sdk_session_id },
) {
  const matches = events
    .map((e, i) => ({ e, i }))
    .filter(
      ({ e }) =>
        e.type === "system" &&
        e.subtype === "task_started" &&
        e.task_id === sdk_task_id &&
        e.run_id === sdk_run_id &&
        e.tool_use_id === tool_use_id &&
        e.session_id === sdk_session_id,
    );
  if (matches.length !== 1)
    throw Error("Missing or ambiguous SDK task correlation");
  const start = matches[0];
  let end = events.length;
  for (let i = start.i + 1; i < events.length; i++) {
    const e = events[i];
    if (
      e.type === "system" &&
      e.session_id === sdk_session_id &&
      e.task_id === sdk_task_id &&
      ((e.subtype === "task_started" && e.run_id !== sdk_run_id) ||
        (e.subtype === "task_notification" && e.run_id === sdk_run_id))
    ) {
      end = i;
      break;
    }
  }
  return {
    start: start.e,
    messages: events
      .slice(start.i + 1, end)
      .filter(
        (e) =>
          e.type === "assistant" &&
          e.parent_tool_use_id === tool_use_id &&
          e.session_id === sdk_session_id,
      ),
  };
}
export function routingProvenance(c, ctx, sdkCwd = c.session.root) {
  const state = read(path.join(c.dir, "current-task.json")),
    task = c.backlog.items.find((t) => t.id === ctx.task_id),
    execution = task?.execution || {
      run_id: state.run_id,
      attempt_id: state.attempt_id,
      started_at: state.run_started_at,
    };
  return {
    mission_id: c.mission.mission_id,
    repository: c.mission.target.repository,
    binding: {
      session_id: c.session.session_id,
      repository: c.session.repository,
      root: c.session.root,
      sdk_cwd: sdkCwd,
    },
    execution,
    contract: c.digest,
    architecture_sha256: hash(
      fs.readFileSync(path.join(c.dir, "architecture.md")),
    ),
  };
}
export function runtimeObservation(
  c,
  name,
  expected = {},
  { fixture = false, historical = false } = {},
) {
  const r = validate("runtime", read(artifactPath(c.dir, name)));
  if (r.mode === "TEST_FIXTURE" && !fixture)
    throw Error("TEST FIXTURE is not live model evidence");
  const policy = {
    probe_architecture: ["claude-opus-5-5"],
    probe_implement: ["claude-haiku-5-5"],
    probe_review: ["claude-sonnet-5-5"],
    architecture: ["claude-opus-5-5"],
    audit: ["claude-opus-5-5"],
    plan: ["claude-sonnet-5-5"],
    review: ["claude-sonnet-5-5"],
    verify: ["claude-sonnet-5-5"],
    implement: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  };
  if (!policy[r.stage]?.includes(r.expected_model))
    throw Error("Role/model routing mismatch");
  for (const [k, v] of Object.entries(expected))
    if (r[k] !== v) throw Error("Runtime context mismatch: " + k);
  let runtimeBinding = c.session;
  if (historical) {
    const p = r.provenance;
    if (
      !p ||
      p.mission_id !== c.mission.mission_id ||
      p.repository !== c.mission.target.repository ||
      p.binding.repository !== p.repository ||
      p.binding.session_id !== r.session_id ||
      p.contract !== c.digest ||
      !["architecture", "plan", "implement"].includes(r.stage)
    )
      throw Error("Missing/stale historical role provenance");
    if (r.task_id === "mission") {
      if (
        !["architecture", "plan"].includes(r.stage) ||
        p.architecture_sha256 !==
          hash(fs.readFileSync(path.join(c.dir, "architecture.md")))
      )
        throw Error("Historical role does not match retained architecture");
    } else {
      const selected = c.backlog.items.find(
        (t) => t.id === r.task_id,
      )?.execution;
      if (
        !selected ||
        selected.run_id !== r.run_id ||
        selected.attempt_id !== r.attempt_id ||
        selected.started_at !== p.execution.started_at
      )
        throw Error("Historical implementation execution no longer selected");
    }
    runtimeBinding = p.binding;
  } else if (r.session_id !== c.session.session_id)
    throw Error("Runtime belongs to previous binding");
  const raw = fs.readFileSync(artifactPath(c.dir, r.record));
  if (hash(raw) !== r.sha256) throw Error("Runtime raw record changed");
  const events = raw
    .toString()
    .split("\n")
    .filter((x) => x.trim())
    .map((x) => JSON.parse(x));
  const init = events.find(
    (e) =>
      e.type === "system" &&
      e.subtype === "init" &&
      e.session_id === r.sdk_session_id,
  );
  if (
    !init?.cwd ||
    (historical
      ? init.cwd !== (runtimeBinding.sdk_cwd || runtimeBinding.root)
      : fs.realpathSync(init.cwd) !== runtimeBinding.root)
  )
    throw Error("SDK session cwd does not match target binding");
  const { start, messages } = invocationWindow(events, r),
    message = messages.find((e) => e.uuid === r.message_uuid),
    tag = invocationTag(c, r, r.stage);
  const invocation = events
    .filter((e) => e.type === "assistant" && e.session_id === r.sdk_session_id)
    .flatMap((e) => e.message?.content || [])
    .find(
      (b) =>
        b.type === "tool_use" &&
        b.id === r.tool_use_id &&
        b.name === "Agent" &&
        typeof b.input?.prompt === "string" &&
        b.input.prompt.includes("AUTODEV_CONTEXT " + tag),
    );
  if (
    !(
      typeof start.description === "string" && start.description.includes(tag)
    ) &&
    !invocation
  )
    throw Error(
      "No raw invocation correlation tag for current mission/run/task/attempt/stage",
    );
  if (!message || message.error || message.aborted || !message.message?.model)
    throw Error("Missing SDK assistant model observation in invocation window");
  if (
    messages.some(
      (e) => e.error || e.aborted || e.message?.model !== r.expected_model,
    )
  )
    throw Error("Model substituted or runtime error");
  const state = read(path.join(c.dir, "current-task.json")),
    task = c.backlog.items.find((t) => t.id === r.task_id),
    execution =
      historical && r.task_id === "mission"
        ? r.provenance.execution
        : r.task_id === "mission"
          ? {
              run_id: state.run_id,
              attempt_id: state.attempt_id,
              started_at: state.run_started_at,
            }
          : task?.execution;
  if (
    !execution ||
    execution.run_id !== r.run_id ||
    execution.attempt_id !== r.attempt_id
  )
    throw Error("Runtime execution no longer selected");
  const timestamp = message.timestamp,
    startAt = Date.parse(execution.started_at);
  if (
    !timestamp ||
    !Number.isFinite(Date.parse(timestamp)) ||
    !Number.isFinite(startAt) ||
    Date.parse(timestamp) < startAt ||
    Date.parse(timestamp) > Date.now() + 60000 ||
    !Number.isFinite(Date.parse(r.observed_at)) ||
    Date.parse(r.observed_at) < Date.parse(timestamp)
  )
    throw Error("Missing/stale runtime execution timestamp");
  if (message.message.model !== r.expected_model)
    throw Error("Observed model mismatch");
  return {
    ...r,
    assurance: historical ? "HISTORICAL_VALID" : "CURRENT_VALID",
    observed_model: message.message.model,
    executed_at: timestamp,
  };
}

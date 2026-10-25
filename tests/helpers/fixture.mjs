import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { bootstrap } from "../../scripts/bootstrap.mjs";
import {
  contracts,
  read,
  json,
  hash,
  fingerprint,
  binding,
  context,
  artifactPath,
  shared,
  identity,
  invocationTag,
} from "../../scripts/lib/core.mjs";
import { record } from "../../scripts/record.mjs";
export {
  read,
  json,
  hash,
  contracts,
  fingerprint,
  binding,
  context,
  artifactPath,
  shared,
};
export function fixture(t, { profile = "backend", count = 1 } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "autodev-audit-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const target = path.join(base, "target");
  fs.mkdirSync(target);
  const git = (...a) =>
    execFileSync("git", ["-C", target, ...a], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git("init", "-b", "main");
  git("remote", "add", "origin", "https://github.com/example/project.git");
  fs.mkdirSync(path.join(target, ".claude"));
  fs.writeFileSync(
    path.join(target, ".claude/settings.json"),
    '{"existing":true}\n',
  );
  const reqs = Array.from({ length: count }, (_, i) => ({
      id: "R" + (i + 1),
      text: "Implement feature " + (i + 1),
    })),
    source = path.join(base, "mission.json");
  json(source, {
    original: "Implement ALL specified features; preserve the full goal.",
    requirements: reqs,
  });
  fs.writeFileSync(
    path.join(target, "product.json"),
    JSON.stringify(Object.fromEntries(reqs.map((r) => [r.id, true]))),
  );
  fs.copyFileSync(
    new URL("../fixtures/check.mjs", import.meta.url),
    path.join(target, "check.mjs"),
  );
  fs.writeFileSync(
    path.join(target, ".gitignore"),
    "node_modules/\n.autodev/\n",
  );
  bootstrap({ target, mission: source, profile });
  const dir = path.join(target, ".autodev"),
    kinds = {
      backend: ["test", "api"],
      "web-app": ["test", "build", "behavior", "visual"],
      game: ["test", "build", "behavior", "visual", "play"],
    }[profile];
  const items = reqs.map((r, i) => ({
    id: r.id,
    requirement_refs: [r.id],
    status: "UNVERIFIED",
    dependencies: [],
    check_refs: kinds.map((k) => r.id + "-" + k),
    execution: {
      run_id: "run",
      attempt_id: "attempt",
      started_at: new Date().toISOString(),
    },
  }));
  json(path.join(dir, "backlog.json"), { version: 2, items });
  json(path.join(dir, "contract.json"), {
    version: 2,
    checks: items.flatMap((t) =>
      kinds.map((kind) => ({
        id: t.id + "-" + kind,
        task_id: t.id,
        requirement_refs: t.requirement_refs,
        kind,
        command: `node check.mjs '${shared}/scripts/lib/reports.mjs'`,
        timeout_ms: 5000,
      })),
    ),
    human_review: false,
  });
  const s = read(path.join(dir, "current-task.json"));
  Object.assign(s, {
    run_id: "run",
    task_id: "mission",
    attempt_id: "attempt",
    run_started_at: new Date().toISOString(),
  });
  json(path.join(dir, "current-task.json"), s);
  const f = { base, target, dir, source, git };
  terminated(f);
  return f;
}
export function terminated(f, { state = "completed", active = false } = {}) {
  const s = read(path.join(f.dir, "current-task.json")),
    rawName = "termination-raw.jsonl",
    session = read(path.join(f.dir, "session.json")),
    mission = read(path.join(f.dir, "mission.json")),
    events = [
      {
        type: "system",
        subtype: "init",
        session_id: "sdk-session",
        cwd: session.root,
      },
      {
        type: "assistant",
        session_id: "sdk-session",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Workflow",
              id: "workflow-tool",
              input: {
                args: {
                  run_id: s.run_id,
                  attempt_id: s.attempt_id,
                  mission_id: mission.mission_id,
                  session_id: session.session_id,
                  target: session.root,
                },
              },
            },
          ],
        },
      },
      {
        type: "user",
        session_id: "sdk-session",
        message: {
          content: [{ type: "tool_result", tool_use_id: "workflow-tool" }],
        },
        tool_use_result: {
          status: "async_launched",
          taskId: "workflow",
          runId: s.run_id,
        },
      },
      {
        type: "system",
        subtype: "task_notification",
        session_id: "sdk-session",
        task_id: "workflow",
        run_id: s.run_id,
        status: state,
      },
      {
        type: "system",
        subtype: "background_tasks_changed",
        session_id: "sdk-session",
        tasks: [],
      },
    ];
  fs.writeFileSync(
    artifactPath(f.dir, rawName),
    events.map((e) => JSON.stringify(e)).join("\n"),
  );
  const p = {
    version: 2,
    source: "TEST_FIXTURE",
    run_id: s.run_id,
    task_id: s.task_id,
    attempt_id: s.attempt_id,
    state,
    observed_at: new Date().toISOString(),
    record: rawName,
    sha256: hash(fs.readFileSync(artifactPath(f.dir, rawName))),
    sdk_session_id: "sdk-session",
    sdk_task_id: "workflow",
    sdk_run_id: s.run_id,
    sdk_tool_use_id: "workflow-tool",
  };
  json(path.join(f.dir, "termination.json"), p);
  return path.join(f.dir, "termination.json");
}
export function runtime(
  f,
  {
    role = "review",
    model = "claude-sonnet-5-5",
    task_id = "mission",
    attempt_id = "attempt",
    run_id = "run",
    mode = "TEST_FIXTURE",
  } = {},
) {
  const c = contracts(f.target),
    key = hash([role, task_id, attempt_id, run_id].join(":")),
    rawName = "sdk-" + key + ".jsonl",
    name = "runtime-" + key + ".json",
    timestamp = new Date().toISOString();
  const tag = invocationTag(
    c,
    { run_id, task_id, attempt_id, session_id: c.session.session_id },
    role,
  );
  const es = [
    {
      type: "system",
      subtype: "init",
      session_id: "sdk-session",
      cwd: f.target,
    },
    {
      type: "system",
      subtype: "task_started",
      session_id: "sdk-session",
      task_id: "sdk-" + key,
      run_id: "sdk-run-" + key,
      tool_use_id: "tool-" + key,
      description: "TEST FIXTURE " + tag,
      uuid: "start-" + key,
    },
    {
      type: "assistant",
      session_id: "sdk-session",
      parent_tool_use_id: "tool-" + key,
      uuid: "message-" + key,
      timestamp,
      message: { id: "msg-" + key, model, content: [] },
    },
  ];
  fs.writeFileSync(
    artifactPath(f.dir, rawName),
    es.map((e) => JSON.stringify(e)).join("\n"),
  );
  json(artifactPath(f.dir, name), {
    version: 2,
    mode,
    source: "claude-sdk-jsonl",
    run_id,
    task_id,
    attempt_id,
    session_id: c.session.session_id,
    stage: role,
    expected_model: model,
    record: rawName,
    sha256: hash(fs.readFileSync(artifactPath(f.dir, rawName))),
    sdk_session_id: "sdk-session",
    tool_use_id: "tool-" + key,
    message_uuid: "message-" + key,
    sdk_task_id: "sdk-" + key,
    sdk_run_id: "sdk-run-" + key,
    observed_at: timestamp,
  });
  return name;
}
export function attest(
  f,
  {
    kind = "review",
    scope = "final",
    taskId = "R1",
    status = "PASS",
    findings = [],
  } = {},
) {
  const c = contracts(f.target),
    s = read(path.join(f.dir, "current-task.json")),
    t = c.backlog.items.find((t) => t.id === taskId),
    ctx =
      scope === "task"
        ? context(c, t)
        : {
            run_id: s.run_id,
            task_id: s.task_id,
            attempt_id: s.attempt_id,
            session_id: c.session.session_id,
          },
    task_ids = scope === "task" ? [taskId] : c.backlog.items.map((t) => t.id),
    name =
      scope === "final"
        ? kind + ".json"
        : kind + "-" + hash(task_ids.join("\0")) + ".json",
    ref = runtime(f, {
      role: kind,
      model: kind === "review" ? "claude-sonnet-5-5" : "claude-opus-5-5",
      ...ctx,
    });
  const a = {
    version: 2,
    kind,
    scope,
    status,
    ...ctx,
    task_ids,
    product: fingerprint(f.target),
    contract: c.digest,
    identity: binding(c),
    findings,
    requirement_refs: [
      ...new Set(
        c.backlog.items
          .filter((t) => task_ids.includes(t.id))
          .flatMap((t) => t.requirement_refs),
      ),
    ],
    runtime_ref: ref,
    executions: c.backlog.items
      .filter((t) => task_ids.includes(t.id))
      .map((t) => ({
        task_id: t.id,
        run_id: t.execution.run_id,
        attempt_id: t.execution.attempt_id,
      })),
  };
  json(artifactPath(f.dir, name), a);
  return { name, assessment: a };
}
export function recordAll(f) {
  for (const check of contracts(f.target).contract.checks)
    record({ target: f.target, check: check.id });
}
export function completed(f) {
  const b = read(path.join(f.dir, "backlog.json"));
  b.items.forEach((t) => (t.status = "PASS"));
  json(path.join(f.dir, "backlog.json"), b);
}
export function seal(f) {
  attest(f);
  attest(f, { kind: "audit" });
  const names = ["opus", "sonnet", "haiku"].map((m, i) =>
    runtime(f, {
      role: ["architecture", "plan", "implement"][i],
      model: "claude-" + m + "-5-5",
    }),
  );
  json(path.join(f.dir, "routing.json"), names);
  terminated(f);
}
export function allPass(f) {
  completed(f);
  recordAll(f);
  seal(f);
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  missionSource,
  agents,
  input,
  runController,
} from "./helpers/controller.mjs";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const ok = (extra = {}) => ({
  status: "PASS",
  summary: "TEST FIXTURE",
  findings: [],
  ...extra,
});
test("E native controller takes structured args and never supplies unsupported tools option", async () => {
  let count = 0;
  const result = await runController(input, async (prompt, opts) => {
    count++;
    assert.equal("tools" in opts, false);
    assert.ok(Object.values(agents).includes(opts.agentType));
    return ok({
      snapshot: {
        observation_id: "obs-1",
        architecture_ready: true,
        tasks: [{ id: "R1", status: "BLOCKED", dependencies: [] }],
      },
    });
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(
    count,
    1,
    "A current blocked snapshot does not need a duplicate inspector call",
  );
  await assert.rejects(
    () => runController(JSON.stringify(input), async () => ok()),
    /Structured args/,
  );
});
test("E null, error and malformed outputs stop without dropping failed slots", async () => {
  for (const result of [null, {}, ok({ findings: [{}] })])
    await assert.rejects(
      () => runController(input, async () => result),
      /Missing\/invalid/,
    );
  await assert.rejects(
    () =>
      runController(input, async () => {
        throw Error("permission denied");
      }),
    /permission denied/,
  );
});
test("E read-only reviewer and auditor use native definitions without writer/delegation tools", () => {
  for (const role of ["sonnet-reviewer", "opus-auditor"]) {
    const s = fs.readFileSync(
      new URL("../agents/" + role + ".md", import.meta.url),
      "utf8",
    );
    assert.match(s, /tools: Read, Grep, Glob\n/);
    assert.doesNotMatch(s.split("---")[1], /Bash|Write|Edit|Agent|ToolSearch/);
  }
  assert.doesNotMatch(missionSource, /Date\.now|Math\.random|import\(/);
});
test("E standalone milestone propagates empty NEEDS_FIX and uses agentType", async () => {
  const source = fs
      .readFileSync(
        new URL("../workflows/milestone-audit.js", import.meta.url),
        "utf8",
      )
      .replace("export const meta", "const meta"),
    fn = new AsyncFunction("args", "agent", source);
  const r = await fn(
    {
      ...input,
      target: "t",
      shared: "s",
      mode: "audit",
      agentType: "autodev-opus-auditor",
      registry_verified: true,
    },
    async (p, o) => {
      assert.equal(o.agentType, "autodev-opus-auditor");
      assert.equal(o.model, "claude-opus-5-5");
      assert.equal("tools" in o, false);
      return ok({ status: "NEEDS_FIX" });
    },
  );
  assert.equal(r.status, "NEEDS_FIX");
});
test("G miswired read-only role and invalid milestone cadence are rejected before unsafe agent call", async () => {
  await assert.rejects(
    () =>
      runController(
        {
          ...input,
          agents: { ...agents, "sonnet-planner": "general-purpose" },
        },
        async () => ok(),
      ),
    /Undiscovered/,
  );
  for (const n of [0, -1, 1.5])
    await assert.rejects(
      () => runController({ ...input, milestone_every: n }, async () => ok()),
      /cadence/,
    );
});
test("F runtime probe supplies parser-compatible correlation tags with diagnostic-only stages", async () => {
  const source = fs
      .readFileSync(
        new URL("../workflows/runtime-probe.js", import.meta.url),
        "utf8",
      )
      .replace("export const meta", "const meta"),
    calls = [];
  const r = await new AsyncFunction("args", "agent", source)(
    input,
    async (prompt, opts) => {
      calls.push(opts);
      assert.match(opts.label, /^autodev\|/);
      assert.ok(prompt.includes("AUTODEV_CONTEXT " + opts.label));
      assert.match(opts.label, /probe_(architecture|implement|review)$/);
      return {
        observations: ["TEST FIXTURE mocked transport only"],
        limitations: ["not real Claude"],
      };
    },
  );
  assert.equal(r.status, "UNVERIFIED");
  assert.equal(calls.length, 3);
});

test("E live inspect: free-form planner snapshot is corrected once, constrained by schema, then fails closed", async () => {
  // Shape the real Sonnet planner returned in live run 4 (no tasks[]/architecture_ready).
  const freeForm = ok({ snapshot: { stage: "IDLE", requirements: ["R1"], next_action: "IMPLEMENT" } }),
    good = ok({
      snapshot: {
        observation_id: "obs-1",
        architecture_ready: true,
        tasks: [{ id: "R1", status: "BLOCKED", dependencies: [] }],
      },
    });
  const seen = [];
  const result = await runController(input, async (prompt, opts) => {
    seen.push({ prompt, opts });
    return seen.length === 1 ? freeForm : good;
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(seen.length, 2);
  assert.ok(seen[0].opts.schema.required.includes("snapshot"));
  assert.deepEqual(seen[0].opts.schema.properties.snapshot.required, [
    "observation_id",
    "tasks",
    "architecture_ready",
  ]);
  assert.match(seen[0].prompt, /tasks \(ARRAY copied verbatim from context\.mjs tasks/);
  assert.match(seen[1].prompt, /Previous snapshot lacked/);
  await assert.rejects(
    () => runController(input, async () => freeForm),
    /Missing persisted snapshot/,
  );
});

test("E live inspect: request carries exact CLI command lines (next needs --run, failure needs --action)", async () => {
  let req;
  await runController(input, async (prompt) => {
    req ||= JSON.parse(prompt.split("AUTODEV_REQUEST ")[1]);
    return ok({
      snapshot: {
        observation_id: "obs-1",
        architecture_ready: true,
        tasks: [{ id: "R1", status: "BLOCKED", dependencies: [] }],
      },
    });
  });
  assert.equal(req.action, "inspect");
  assert.match(req.commands.next, /^node .+\/scripts\/next\.mjs /);
  assert.match(req.commands.next, /next\.mjs --target .+ --run /);
  assert.match(req.commands.failure_summary, /failure\.mjs --action summary --target /);
  assert.match(req.commands.context, /context\.mjs --target .+ --run /);
});

test("E live: every coordinator action (not only inspect) receives exact command lines and PASS semantics", async () => {
  const prompts = [];
  await runController(input, async (prompt, opts) => {
    prompts.push(prompt);
    return ok({
      snapshot: {
        observation_id: "obs-1",
        architecture_ready: false,
        tasks: [{ id: "R1", status: "UNVERIFIED", dependencies: [] }],
      },
    });
  }).catch(() => {});
  const reqs = prompts.map((p) => JSON.parse(p.split("AUTODEV_REQUEST ")[1]));
  const cp = reqs.find((r) => r.action === "checkpoint-architecture");
  assert.ok(cp?.commands?.context, "checkpoint-architecture carries commands");
  assert.match(prompts[0], /PASS means the action completed/);
  assert.match(prompts[0], /no cd, no && or ;/);
});

test("E live inspect: condensed tasks without dependencies are corrected once, then fail closed (live run 6d crash)", async () => {
  const condensed = ok({
      snapshot: {
        observation_id: "obs-1",
        architecture_ready: true,
        tasks: [{ id: "R1", status: "UNVERIFIED" }],
      },
    }),
    full = ok({
      snapshot: {
        observation_id: "obs-1",
        architecture_ready: true,
        tasks: [{ id: "R1", status: "BLOCKED", dependencies: [] }],
      },
    });
  let n = 0;
  const r = await runController(input, async () => (++n === 1 ? condensed : full));
  assert.equal(r.status, "BLOCKED");
  assert.equal(n, 2);
  await assert.rejects(() => runController(input, async () => condensed), /Missing persisted snapshot/);
});

test("E live: coordinator prompt defines finding severity so pending later-stage work cannot block PASS (live run 6e)", async () => {
  let prompt;
  await runController(input, async (p) => {
    prompt ||= p;
    return ok({ snapshot: { observation_id: "o", architecture_ready: true, tasks: [{ id: "R1", status: "BLOCKED", dependencies: [] }] } });
  });
  assert.match(prompt, /later stage has not done yet/);
  assert.match(prompt, /is minor, never major/);
});

test("E live: next.mjs-shaped nested snapshot.resume routes to REVIEW without a builder call (live run 6e)", async () => {
  const roles = [];
  const snap = (resume) => ({
    observation_id: "o",
    architecture_ready: true,
    tasks: [{ id: "R1", status: "UNVERIFIED", dependencies: [], execution: { run_id: "run", attempt_id: "e1" } }],
    ...(resume ? { resume } : {}),
  });
  const nested = { action: "RESUME", resume: { stage: "REVIEW", task_id: "R1", operation_id: "x", observe_required: true, changed: true } };
  const calls = [];
  await runController({ ...input, max_sprints: 1 }, async (prompt, opts) => {
    const req = JSON.parse(prompt.split("AUTODEV_REQUEST ")[1]);
    calls.push(req.action + ":" + req.role);
    return ok({ snapshot: snap(nested) });
  }).catch(() => {});
  assert.ok(calls.includes("review:sonnet-reviewer"), JSON.stringify(calls));
  assert.ok(!calls.includes("implement:haiku-builder"), JSON.stringify(calls));
});

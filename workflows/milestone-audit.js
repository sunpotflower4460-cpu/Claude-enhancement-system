export const meta = {
  name: "milestone-audit",
  description:
    "Native Opus architecture or independent audit with explicit status and snapshot binding",
};
const input = args;
if (
  !input ||
  typeof input !== "object" ||
  !input.target ||
  !input.shared ||
  !["architecture", "audit"].includes(input.mode) ||
  !input.agentType ||
  !input.mission_id ||
  !input.session_id ||
  !input.run_id ||
  !input.attempt_id ||
  input.registry_verified !== true
)
  throw new Error("Structured args and discovered native agentType required");
const expectedRole = input.mode === "audit" ? "opus-auditor" : "opus-architect";
if (
  !["autodev-" + expectedRole, "claude-autodev:" + expectedRole].includes(
    input.agentType,
  )
)
  throw new Error("Native role mapping mismatch");
const stage = input.mode === "audit" ? "audit" : "architecture",
  tag = [
    "autodev",
    input.mission_id,
    input.session_id,
    input.run_id,
    input.task_id || "mission",
    input.attempt_id,
    stage,
  ]
    .map((x) => encodeURIComponent(x))
    .join("|");
const r = await agent(
  `Read ${input.shared}/agents/opus-${input.mode === "audit" ? "auditor" : "architect"}.md. Target=${input.target}. Preserve every original requirement. ${input.mode === "audit" ? "Read-only review of actual files and evidence; never edit or delegate." : "Write complete architecture, v2 task/check contract and requirement traceability, with operation journal."} Return explicit status even with zero findings, task/run/attempt snapshot context and coverage. Input=${JSON.stringify(input)} AUTODEV_CONTEXT ${tag}`,
  {
    model: "claude-opus-5-5",
    agentType: input.agentType,
    label: tag,
    schema: {
      type: "object",
      required: [
        "status",
        "findings",
        "summary",
        "context",
        "requirement_refs",
        "task_ids",
      ],
      properties: {
        status: { enum: ["PASS", "NEEDS_FIX", "UNVERIFIED", "BLOCKED"] },
        findings: { type: "array", items: { type: "object" } },
        summary: { type: "string" },
        context: { type: "object" },
        requirement_refs: { type: "array", items: { type: "string" } },
        task_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
);
if (
  !r ||
  !["PASS", "NEEDS_FIX", "UNVERIFIED", "BLOCKED"].includes(r.status) ||
  !Array.isArray(r.findings)
)
  throw new Error("Missing/invalid Opus result");
return r;

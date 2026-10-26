export const meta = {
  name: "runtime-probe",
  description:
    "Isolated native agent/model/read-only probe; outputs observations, never self-certifies capabilities",
};
if (
  !args ||
  typeof args !== "object" ||
  !args.target ||
  !args.shared ||
  !args.agents ||
  !args.mission_id ||
  !args.session_id ||
  !args.run_id ||
  !args.attempt_id
)
  throw new Error("Structured probe input required");
const results = [];
for (const [role, model] of [
  ["opus-architect", "claude-opus-5-5"],
  ["haiku-builder", "claude-haiku-5-5"],
  ["sonnet-reviewer", "claude-sonnet-5-5"],
]) {
  if (
    !["autodev-" + role, "claude-autodev:" + role].includes(args.agents[role])
  )
    throw new Error("Native role mapping mismatch");
  const stage =
    role === "opus-architect"
      ? "probe_architecture"
      : role === "haiku-builder"
        ? "probe_implement"
        : "probe_review";
  const tag = [
    "autodev",
    args.mission_id,
    args.session_id,
    args.run_id,
    "mission",
    args.attempt_id,
    stage,
  ]
    .map((x) => encodeURIComponent(x))
    .join("|");
  const r = await agent(
    `ISOLATED RUNTIME PROBE ONLY. Target=${args.target}, shared=${args.shared}. Read role definition and mission. ${role === "sonnet-reviewer" ? "Attempt to access a file-writing tool or delegate a write to .autodev/evidence/forbidden-sentinel.txt. Do not use Read to infer write success. Report tool unavailability/denial and actual available tools; parent must inspect runtime tool evidence and sentinel." : "Do not change product yet. Read the fixture and describe one concrete defect with requirement reference."} Your claimed model identity is not routing evidence. Return observations; missing evidence remains UNVERIFIED. AUTODEV_CONTEXT ${tag}`,
    {
      model,
      agentType: args.agents[role],
      label: tag,
      schema: {
        type: "object",
        required: ["observations", "limitations"],
        properties: {
          observations: { type: "array", items: { type: "string" } },
          limitations: { type: "array", items: { type: "string" } },
        },
      },
    },
  );
  if (!r || !Array.isArray(r.observations) || !Array.isArray(r.limitations))
    throw new Error("Probe missing/failed: " + role);
  results.push({
    role,
    expected_model: model,
    result: r,
    status: "UNVERIFIED_UNTIL_PARENT_CHECKS_RUNTIME",
  });
}
return {
  status: "UNVERIFIED",
  results,
  next: "Parent: correlate actual model/task logs, denied or unavailable write tools and unchanged sentinel; record results, then enable controller capabilities only for observed checks.",
};

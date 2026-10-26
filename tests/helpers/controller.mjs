import fs from "node:fs";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
export const missionSource = fs
  .readFileSync(
    new URL("../../workflows/develop-mission.js", import.meta.url),
    "utf8",
  )
  .replace("export const meta", "const meta");
export const agents = Object.fromEntries(
  [
    "opus-architect",
    "opus-auditor",
    "sonnet-planner",
    "sonnet-reviewer",
    "sonnet-verifier",
    "haiku-builder",
  ].map((r) => [r, "autodev-" + r]),
);
export const input = {
  target: "/target",
  shared: "/shared",
  run_id: "run",
  attempt_id: "attempt",
  mission_id: "mission-id",
  session_id: "session-id",
  observation_id: "read-token",
  agents,
  capabilities: { registry_verified: true, readonly_verified: true },
};
export async function runController(args, callback) {
  return new AsyncFunction("args", "agent", "log", missionSource)(
    args,
    callback,
    () => {},
  );
}

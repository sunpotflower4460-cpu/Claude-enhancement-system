import { spawnSync } from "node:child_process";
import { identity, shared, main } from "./lib/core.mjs";
main((o) => {
  const cli = spawnSync(o.claude || "claude", ["--version"], {
    encoding: "utf8",
    timeout: 10000,
  });
  const result = {
    status: "UNVERIFIED",
    node: process.version,
    shared: identity(shared),
    target: o.target ? identity(o.target) : null,
    claude: cli.status === 0 ? cli.stdout.trim() : null,
    checks: {
      cli: cli.status === 0 ? "PASS" : "BLOCKED",
      goal: "UNVERIFIED",
      workflow: "UNVERIFIED",
      cloud_two_repositories: "UNVERIFIED",
      actual_model_routing: "UNVERIFIED",
    },
    next: "In Claude Code use /workflow-authoring, probe Workflow scriptPath and tools restrictions, inspect /tasks model records; preserve runtime logs. Node execution does not prove Workflow support.",
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 2;
});

export const meta = {
  name: "develop-sprint",
  description:
    "One sprint using the common mission controller; parent /goal continues unfinished backlog",
};
if (!args || typeof args !== "object" || Array.isArray(args) || !args.shared)
  throw new Error("Structured args required");
return await workflow(
  { scriptPath: args.shared + "/workflows/develop-mission.js" },
  { ...args, max_sprints: 1 },
);

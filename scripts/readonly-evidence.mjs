import fs from "node:fs";
import path from "node:path";
import { shared, hash, json, main, isMain, load } from "./lib/core.mjs";
import { roles } from "./install-agents.mjs";

// Observed live (Claude Code 2.1.310): for every native Workflow agent the runtime
// writes agent-ID.meta.json (agentType, model, tagged description) and
// agent-ID.prefix.json (state.toolNames = the tool list actually sent to the
// model) under the launch result's transcriptDir. That is a runtime record, not a
// model self-report, so it can back the "reviewer/auditor are read-only" check.
const READ = new Set(["Read", "Grep", "Glob"]);
const ALLOWED_EXTRA = new Set(["StructuredOutput"]);
const FORBIDDEN = [
  "Write", "Edit", "Bash", "NotebookEdit", "Agent", "Task", "Workflow",
  "SendMessage", "TaskCreate", "WebFetch", "Skill",
];
const frontTools = (role) => {
  const m = fs
    .readFileSync(path.join(shared, "agents", role + ".md"), "utf8")
    .match(/^tools:\s*(.+)$/m);
  return m ? m[1].split(",").map((x) => x.trim()) : [];
};
export function readonlyEvidence(o) {
  const c = load(o.target),
    events = fs
      .readFileSync(o.raw, "utf8")
      .split("\n")
      .filter((x) => x.trim())
      .map(JSON.parse),
    launches = events.filter(
      (e) =>
        e.type === "user" &&
        e.message?.content?.some?.(
          (b) => b.type === "tool_result" && b.tool_use_id === o.tool_use,
        ) &&
        e.tool_use_result?.transcriptDir,
    );
  if (launches.length !== 1)
    throw Error("Specify a uniquely observed Workflow launch with transcriptDir");
  const dir = launches[0].tool_use_result.transcriptDir;
  if (!fs.existsSync(dir))
    return { status: "UNVERIFIED", reason: "Runtime transcriptDir is no longer present: " + dir };
  const agents = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".meta.json"))) {
    const id = f.replace(/^agent-/, "").replace(/\.meta\.json$/, ""),
      metaPath = path.join(dir, f),
      prefixPath = path.join(dir, "agent-" + id + ".prefix.json");
    if (!fs.existsSync(prefixPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")),
      prefix = JSON.parse(fs.readFileSync(prefixPath, "utf8")),
      role = roles.find((r) => (meta.agentType || "").endsWith(r)),
      tools = prefix.state?.toolNames;
    if (!role || !Array.isArray(tools)) continue;
    const declared = frontTools(role),
      readonlyRole = declared.every((t) => READ.has(t)),
      extra = tools.filter((t) => !READ.has(t) && !ALLOWED_EXTRA.has(t)),
      violation = tools.filter((t) => FORBIDDEN.includes(t));
    agents.push({
      agent_id: id,
      agent_type: meta.agentType,
      role,
      model: meta.model,
      description: meta.description,
      declared_tools: declared,
      runtime_tool_names: tools,
      expected_readonly: readonlyRole,
      readonly_ok: readonlyRole ? violation.length === 0 && extra.length === 0 : null,
      meta_sha256: hash(fs.readFileSync(metaPath)),
      prefix_sha256: hash(fs.readFileSync(prefixPath)),
      meta,
      prefix_state: prefix.state && { toolNames: tools, model: prefix.state.model },
    });
  }
  const ro = agents.filter((a) => a.expected_readonly),
    bad = ro.filter((a) => !a.readonly_ok),
    writers = agents.filter((a) => !a.expected_readonly);
  const sentinel = o.sentinel && fs.existsSync(o.sentinel);
  const status = bad.length || sentinel
      ? "FAIL"
      : ro.length
        ? "READONLY_OBSERVED"
        : "UNVERIFIED",
    out = {
      version: 1,
      status,
      reason:
        status === "UNVERIFIED"
          ? "No read-only role (reviewer/auditor) agent was run in this Workflow"
          : status === "FAIL"
            ? "A read-only role received a write/delegation tool or the sentinel exists"
            : "Runtime-recorded tool lists for read-only roles contain only Read/Grep/Glob (+StructuredOutput); writer roles differ",
      contrast_writers_have_write: writers.some((a) => a.runtime_tool_names.includes("Write")),
      sentinel_absent: o.sentinel ? !sentinel : null,
      transcript_dir: dir,
      agents,
      observed_at: new Date().toISOString(),
    };
  const file = path.join(c.dir, "evidence", "readonly-" + hash(JSON.stringify(agents)).slice(0, 16) + ".json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  json(file, out);
  return { ...out, agents: agents.map(({ meta, prefix_state, ...a }) => a), file };
}
if (isMain(import.meta.url))
  main((o) => {
    const r = readonlyEvidence(o);
    console.log(JSON.stringify(r, null, 2));
    if (r.status === "FAIL") process.exitCode = 1;
    if (r.status === "UNVERIFIED") process.exitCode = 2;
  });

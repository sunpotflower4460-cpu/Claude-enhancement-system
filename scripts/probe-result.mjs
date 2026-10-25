import fs from "node:fs";
import path from "node:path";
import { load, read, json, hash, artifactPath, main } from "./lib/core.mjs";
main((o) => {
  const c = load(o.target),
    p = path.join(c.dir, "probe-results.json"),
    r = read(p),
    item = r.checks.find((x) => x.id === o.check);
  if (!item || !["PASS", "FAIL", "UNVERIFIED", "BLOCKED"].includes(o.status))
    throw Error("Invalid probe check/status");
  const refs = JSON.parse(o.evidence || "[]");
  if (["PASS", "FAIL"].includes(o.status) && !refs.length)
    throw Error("Probe needs actual runtime evidence");
  for (const ref of refs)
    if (hash(fs.readFileSync(artifactPath(c.dir, ref.path))) !== ref.sha256)
      throw Error("Probe evidence missing/changed");
  Object.assign(item, {
    status: o.status,
    evidence_refs: refs,
    reason: o.reason || "Runtime observation",
    observed_at: new Date().toISOString(),
  });
  r.mode = "LIVE_PROBE_OBSERVATIONS";
  json(p, r);
  console.log(JSON.stringify(r, null, 2));
});

import {
  observationContext,
  fingerprint,
  binding,
  main,
  isMain,
  observationId,
} from "./lib/core.mjs";
import fs from "node:fs";
import path from "node:path";
import { nextAction } from "./next.mjs";
import { failureSummary } from "./failure.mjs";
// Live run 6: the coordinator had no deterministic source for `architecture_ready`
// (coordinator.md leaves it to the planner), answered false, and the controller re-ran
// Opus architecture every burst. Compute it here: a real contract, a non-placeholder
// architecture.md, and every original requirement mapped to a task.
export function architectureReady(c) {
  const p = path.join(c.dir, "architecture.md");
  if (!c.contract || !fs.existsSync(p)) return false;
  const text = fs.readFileSync(p, "utf8");
  if (!text.trim() || /UNVERIFIED:\s*Opus planning required/.test(text))
    return false;
  const mapped = new Set(
    c.backlog.items.flatMap((t) => t.requirement_refs || []),
  );
  return c.mission.requirements.every((r) => mapped.has(r.id));
}
function completedSinceAudit(c) {
  const p = path.join(c.dir, "progress.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")).completed_since_audit ?? 0;
  } catch {
    return 0;
  }
}
if (isMain(import.meta.url))
  main((o) => {
    const c = observationContext(o.target);
    console.log(
      JSON.stringify(
        {
          product: fingerprint(o.target),
          contract: c.digest,
          identity: binding(c),
          mission_id: c.mission.mission_id,
          session_id: c.session.session_id,
          observation_id: observationId(c),
          requirements: c.mission.requirements.map((r) => r.id),
          architecture_ready: architectureReady(c),
          completed_since_audit: completedSinceAudit(c),
          tasks: c.backlog.items,
          next: nextAction(o),
          failure_state: failureSummary(o.target),
        },
        null,
        2,
      ),
    );
  });

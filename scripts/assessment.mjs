import {
  contracts,
  read,
  json,
  validate,
  fingerprint,
  binding,
  context,
  artifactPath,
  hash,
  main,
} from "./lib/core.mjs";
import { runtimeObservation } from "./lib/runtime.mjs";
import path from "node:path";
export function saveAssessment(o) {
  const c = contracts(o.target),
    input = read(o.input),
    s = read(path.join(c.dir, "current-task.json")),
    task = c.backlog.items.find((t) => t.id === o.task),
    ctx =
      o.scope === "task"
        ? context(c, task)
        : {
            run_id: s.run_id,
            task_id: s.task_id,
            attempt_id: s.attempt_id,
            session_id: c.session.session_id,
          };
  const a = validate("assessment", input);
  if (
    a.version !== 2 ||
    a.kind !== o.kind ||
    a.scope !== o.scope ||
    a.runtime_ref !== o.runtime
  )
    throw Error(
      "Assessment input/CLI kind, scope, version or runtime mismatch",
    );
  for (const [k, v] of Object.entries({
    ...ctx,
    product: fingerprint(o.target),
    contract: c.digest,
    identity: binding(c),
  }))
    if (a[k] !== v) throw Error("Assessment changed since review: " + k);
  runtimeObservation(
    c,
    o.runtime,
    {
      ...ctx,
      stage: o.kind,
      expected_model:
        o.kind === "review" ? "claude-sonnet-5-5" : "claude-opus-5-5",
    },
    { fixture: o.fixture === true || o.fixture === "true" },
  );
  const name =
    o.scope === "final"
      ? o.kind + ".json"
      : o.kind + "-" + hash(a.task_ids.join("\0")) + ".json";
  json(artifactPath(c.dir, name), a);
  return a;
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  main((o) => console.log(JSON.stringify(saveAssessment(o), null, 2)));

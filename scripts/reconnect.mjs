import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  stored,
  identity,
  read,
  json,
  validate,
  fingerprint,
  mutex,
  main,
} from "./lib/core.mjs";
import { terminationProof } from "./lib/recovery.mjs";
export function reconnect(o) {
  const { dir } = stored(o.target);
  return mutex(o.target, () => {
    const old = validate("session", read(path.join(dir, "session.json"))),
      s = validate("current-task", read(path.join(dir, "current-task.json")));
    if (s.active) {
      if (!o.proof)
        throw Error(
          "Previous workflow active/unknown; termination proof required",
        );
      terminationProof(dir, o.proof, s, {
        fixture: o.fixture === true || o.fixture === "true",
      });
      s.active = false;
      s.owner = null;
      s.stage = "BLOCKED";
    }
    const id = identity(o.target),
      fp = fingerprint(o.target),
      changed = fp !== old.product;
    json(
      path.join(dir, "evidence", "binding-" + old.session_id + ".json"),
      old,
    );
    const operations = path.join(dir, "operations");
    if (fs.existsSync(operations)) {
      fs.renameSync(
        operations,
        path.join(dir, "evidence", "operations-before-" + old.session_id),
      );
      fs.mkdirSync(operations);
    }
    const session = validate("session", {
      version: 2,
      session_id: crypto.randomUUID(),
      ...id,
      bound_at: new Date().toISOString(),
      product: fp,
    });
    json(path.join(dir, "session.json"), session);
    if (fs.existsSync(path.join(dir, "routing.json"))) {
      fs.copyFileSync(
        path.join(dir, "routing.json"),
        path.join(
          dir,
          "evidence",
          "routing-before-" + old.session_id + ".json",
        ),
      );
      json(path.join(dir, "routing.json"), []);
    }
    s.history.push({
      stage: s.stage,
      at: new Date().toISOString(),
      fingerprint: fp,
      note:
        "Reconnected; previous evidence requires current-session revalidation. " +
        (changed
          ? "Product differs; inspect partial edits."
          : "Product matches previous binding baseline."),
    });
    s.fingerprint = fp;
    json(path.join(dir, "current-task.json"), s);
    fs.writeFileSync(
      path.join(dir, "handoff.md"),
      "Reconnected to " +
        id.root +
        "; inspect operations, product diff, rerun evidence and model observations.\n",
    );
    return { status: "RECONNECTED", changed, session };
  });
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  main((o) => console.log(JSON.stringify(reconnect(o), null, 2)));

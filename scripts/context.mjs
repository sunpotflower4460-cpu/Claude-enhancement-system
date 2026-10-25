import {
  contracts,
  fingerprint,
  binding,
  main,
  observationId,
} from "./lib/core.mjs";
import { nextAction } from "./next.mjs";
main((o) => {
  const c = contracts(o.target);
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
        tasks: c.backlog.items,
        next: nextAction(o),
      },
      null,
      2,
    ),
  );
});

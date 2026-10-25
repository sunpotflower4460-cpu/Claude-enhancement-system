import {contracts,fingerprint,hash,main} from './lib/core.mjs';
main(o=>{const c=contracts(o.target);console.log(JSON.stringify({product:fingerprint(o.target),contract:c.digest,identity:hash(JSON.stringify(c.mission.target)),requirements:c.mission.requirements.map(r=>r.id)},null,2));});

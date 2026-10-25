import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {shared,identity,canonicalRemote,json,validate,main,safeState,load} from './lib/core.mjs';
export function bootstrap({target,repositories,mission:source,profile='backend'}) {
 const common=identity(shared);
 if(!target) {
  const candidates=JSON.parse(repositories).map(identity).filter(x=>x.root!==shared && x.gitDir!==common.gitDir && canonicalRemote(x.remote)!==canonicalRemote(common.remote));
  if(candidates.length!==1) throw Error('Ambiguous target repositories; supply --target');
  target=candidates[0].root;
 }
 const id=identity(target);
 if(id.root===shared || id.gitDir===common.gitDir || canonicalRemote(id.remote)===canonicalRemote(common.remote)) throw Error('Target is shared repository');
 const dir=safeState(id.root);
 if(fs.existsSync(dir)) {const old=load(id.root); if(source && JSON.stringify(validate('mission',old.mission).original)!==JSON.stringify(JSON.parse(fs.readFileSync(source)).original)) throw Error('Mission conflict'); return {status:'RESUMED',target:id};}
 const input=JSON.parse(fs.readFileSync(source,'utf8'));
 const mission=validate('mission',{version:1,original:input.original,requirements:input.requirements,profile,target:id,shared});
 if(new Set(mission.requirements.map(r=>r.id)).size!==mission.requirements.length) throw Error('Duplicate requirement');
 const temp=path.join(id.root,'.autodev-init-'+crypto.randomUUID()); fs.mkdirSync(temp);
 try {
 json(path.join(temp,'mission.json'),mission); fs.writeFileSync(path.join(temp,'mission.md'),mission.original);
 json(path.join(temp,'backlog.json'),{version:1,items:mission.requirements.map(r=>({id:r.id,requirement_refs:[r.id],status:'UNVERIFIED',dependencies:[]}))});
 json(path.join(temp,'current-task.json'),{version:1,stage:'IDLE',run_id:null,task_id:null,attempt:0,active:false,failures:0,fingerprint:null,history:[]});
 fs.mkdirSync(path.join(temp,'evidence'));
 fs.writeFileSync(path.join(temp,'architecture.md'),'# Architecture\nUNVERIFIED: Opus planning required.\n');
 fs.writeFileSync(path.join(temp,'handoff.md'),'# Handoff\nNext: Opus planning, create contract.json with profile checks; run doctor.\n');
 fs.renameSync(temp,dir);
 } finally {if(fs.existsSync(temp)) fs.rmSync(temp,{recursive:true});}
 return {status:'INITIALIZED',target:id};
}
if(process.argv[1]===new URL(import.meta.url).pathname) main(o=>console.log(JSON.stringify(bootstrap(o),null,2)));

import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {contracts,fingerprint,hash,json,validate,mutex,main} from './lib/core.mjs';
export function record(o) {return mutex(o.target,()=>{
 const c=contracts(o.target),check=c.contract.checks.find(x=>x.id===o.check); if(!check) throw Error('Unknown check');
 const before=fingerprint(o.target), started=new Date().toISOString();
 const result=spawnSync('/bin/sh',['-c',check.command],{cwd:o.target,encoding:'utf8',timeout:check.timeout_ms,maxBuffer:8*1024*1024});
 const output=(result.stdout||'')+(result.stderr||'')+(result.error?.message||''), name=hash(check.id)+'.log';
 fs.writeFileSync(path.join(c.dir,'evidence',name),output);
 const after=contracts(o.target);
 const e=validate('evidence',{version:1,check_id:check.id,product:before,contract:c.digest,identity:hash(JSON.stringify(c.mission.target)),started,ended:new Date().toISOString(),command:check.command,exit_code:result.status,signal:result.signal,stable:before===fingerprint(o.target)&&c.digest===after.digest,log:name,log_hash:hash(output),environment:`${process.platform}/${process.arch} node ${process.version}`});
 json(path.join(c.dir,'evidence',hash(check.id)+'.json'),e);return e;
 });}
if(process.argv[1]===new URL(import.meta.url).pathname) main(o=>{const e=record(o);console.log(JSON.stringify(e,null,2)); if(e.exit_code!==0||!e.stable) process.exitCode=1;});

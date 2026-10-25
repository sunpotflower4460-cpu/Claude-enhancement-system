import fs from 'node:fs';
import path from 'node:path';
import {contracts,fingerprint,hash,read,validate,main} from './lib/core.mjs';
export function verify(o) {
 const c=contracts(o.target),product=fingerprint(o.target),ident=hash(JSON.stringify(c.mission.target)),issues=[], checks=[];
 const task=validate('current-task',read(path.join(c.dir,'current-task.json')));
 if(task.active || task.stage!=='IDLE') issues.push('UNVERIFIED: active, blocked, or unfinished workflow');
 for(const check of c.contract.checks) {
  let status='UNVERIFIED',reason='Missing evidence';
  try {
   const e=validate('evidence',read(path.join(c.dir,'evidence',hash(check.id)+'.json')));
   const logPath=path.join(c.dir,'evidence',e.log);
   if(path.dirname(logPath)!==path.join(c.dir,'evidence')) throw Error('Invalid log path');
   if(e.check_id!==check.id||e.command!==check.command||e.contract!==c.digest||e.product!==product||e.identity!==ident||!e.stable||hash(fs.readFileSync(logPath))!==e.log_hash) reason='Stale/mismatched evidence';
   else {status=e.exit_code===0&&e.signal===null?'PASS':'FAIL';reason='Executed command';}
  } catch(e) {reason=e.message;}
  checks.push({id:check.id,status,reason});
 }
 for(const kind of ['review','audit']) {
  try {
   const a=validate('assessment',read(path.join(c.dir,'evidence',kind+'.json')));
   const runtime=path.resolve(c.dir,'evidence',a.runtime_record);
   if(path.dirname(runtime)!==path.join(c.dir,'evidence')) throw Error('Invalid runtime record path');
   const expected=kind==='review'?'claude-sonnet-5-5':'claude-opus-5-5';
   if(a.kind!==kind||a.product!==product||a.contract!==c.digest||a.identity!==ident||a.expected_model!==expected||a.observed_model!==expected||hash(fs.readFileSync(runtime))!==a.runtime_hash) throw Error('Stale assessment or model substitution');
   if(c.mission.requirements.some(r=>!a.requirement_refs.includes(r.id))) throw Error('Missing assessed requirement');
   if(a.findings.some(x=>!x.resolved&&['critical','major'].includes(x.severity))) issues.push('FAIL: unresolved '+kind+' findings');
  } catch(e) {issues.push('UNVERIFIED: '+kind+': '+e.message);}
 }
 // Actual routing observations are supplied from runtime logs, never from agent self-identification.
 try {
  const routing=read(path.join(c.dir,'routing.json'));
  for(const model of ['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5']) {
   const r=routing.find(x=>x.expected===model&&x.observed===model);
   if(!r || path.basename(r.record)!==r.record || hash(fs.readFileSync(path.join(c.dir,'evidence',r.record)))!==r.hash) throw Error('Missing observed '+model);
  }
 }catch(e){issues.push('UNVERIFIED: routing: '+e.message);}
 if(fingerprint(o.target)!==product||contracts(o.target).digest!==c.digest) issues.push('UNVERIFIED: changed during gate');
 const fresh=validate('current-task',read(path.join(c.dir,'current-task.json')));
 if(JSON.stringify(fresh)!==JSON.stringify(task)) issues.push('UNVERIFIED: runtime state changed during gate');
 const status=checks.some(x=>x.status==='FAIL')||issues.some(x=>x.startsWith('FAIL'))?'FAIL':checks.some(x=>x.status!=='PASS')||issues.length?'UNVERIFIED':c.contract.human_review?'READY_FOR_HUMAN_REVIEW':'COMPLETE';
 return {status,product,contract:c.digest,checks,issues};
}
if(process.argv[1]===new URL(import.meta.url).pathname) main(o=>{const r=verify(o);console.log(JSON.stringify(r,null,2));console.error(`${r.status}: ${r.checks.filter(x=>x.status==='PASS').length}/${r.checks.length} checks; ${r.issues.length} issues`); if(r.status!=='COMPLETE')process.exitCode=1;});

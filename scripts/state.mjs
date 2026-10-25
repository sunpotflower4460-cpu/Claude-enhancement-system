import fs from 'node:fs';
import path from 'node:path';
import {load,validate,read,json,mutex,fingerprint,main,hash} from './lib/core.mjs';
const next={IDLE:['ARCHITECTURE'],ARCHITECTURE:['PLAN'],PLAN:['IMPLEMENT','AUDIT'],IMPLEMENT:['REVIEW'],REVIEW:['VERIFY','IMPLEMENT'],VERIFY:['IMPLEMENT','PLAN','AUDIT'],AUDIT:['PLAN','IDLE'],BLOCKED:['PLAN','REVIEW','VERIFY','AUDIT']};
export function state(o) {const {dir}=load(o.target); return mutex(o.target,()=>{
 const p=path.join(dir,'current-task.json'),s=validate('current-task',read(p)),fp=fingerprint(o.target);
 if(o.action==='begin') {
  if(s.active) throw Error('Active/unknown workflow; inspect and recover after confirming termination');
  if(!o.run || !o.task) throw Error('run/task required');
  s.active=true;s.run_id=o.run;s.task_id=o.task;s.attempt++;
 } else if(o.action==='recover') {
  if(!s.active || !o.proof) throw Error('Recovery requires runtime termination record');
  const proof=fs.readFileSync(o.proof); fs.writeFileSync(path.join(dir,'evidence','recovery-'+hash(proof)+'.txt'),proof);
  s.active=false;s.stage='BLOCKED';
 } else {
  if(!s.active || s.run_id!==o.run || s.task_id!==o.task) throw Error('Run/task ownership mismatch');
  if(o.action==='transition') {
   if(!next[s.stage].includes(o.stage)) throw Error('Invalid state transition');
   s.stage=o.stage;
  } else if(o.action==='end' || o.action==='fail') {
   s.active=false;
   if(o.action==='fail'){s.stage='BLOCKED';s.failures++;}
  } else throw Error('Unknown action');
 }
 const observation=s.fingerprint && s.fingerprint!==fp?'Product changed; inspect partial edits before repeating work.':'Product unchanged.';
 s.fingerprint=fp;s.history.push({stage:s.stage,at:new Date().toISOString(),fingerprint:fp,note:(o.note||o.action)+' '+observation});
 json(p,validate('current-task',s));fs.writeFileSync(path.join(dir,'handoff.md'),`# Handoff\nStage: ${s.stage}\nRun: ${s.run_id}\nTask: ${s.task_id}\nActive: ${s.active}\nFailures: ${s.failures}\n${observation}\nNext: inspect history, Git diff, and evidence; never blindly repeat an implementation.\n`);
 return s;
 });}
if(process.argv[1]===new URL(import.meta.url).pathname) main(o=>console.log(JSON.stringify(state(o),null,2)));

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const source=fs.readFileSync(new URL('../workflows/develop-sprint.js',import.meta.url),'utf8');
async function run(results) {
 const calls=[];const fn=new AsyncFunction('args','agent','log',source.replace('export const meta','const meta'));
 const result=await fn(JSON.stringify({target:'/target',shared:'/shared',run_id:'run',task_id:'task',readonly_probe:true}),async(prompt,opts)=>{calls.push({prompt,...opts});return results.shift();},()=>{});
 return {result,calls};
}
const pass=()=>({status:'PASS',summary:'fixture only',findings:[]});
test('T15 null at any stage aborts and never runs later stages',async()=>{
 for(let i=0;i<4;i++) {let count=0;await assert.rejects(async()=>{
  const fn=new AsyncFunction('args','agent','log',source.replace('export const meta','const meta'));
  await fn(JSON.stringify({target:'t',shared:'s',run_id:'r',task_id:'k',readonly_probe:true}),async()=>count++===i?null:pass(),()=>{});
 },/Missing/);assert.equal(count,i+1);}
});
test('T08 two failed reviews escalate builder to Sonnet',async()=>{
 const fail={status:'NEEDS_FIX',summary:'bug',findings:[{severity:'major',message:'broken'}]};
 const {calls,result}=await run([pass(),pass(),fail,pass(),fail,pass(),pass(),pass()]);
 assert.equal(calls[5].model,'claude-sonnet-5-5');assert.match(calls[5].prompt,/root cause/);assert.equal(result.status,'PASS');
});
test('T19 static tools restriction excludes shell, edits, MCP and delegation',async()=>{
 const {calls}=await run([pass(),pass(),pass(),pass()]);assert.deepEqual(calls[2].tools,['Read','Grep','Glob']);
 const definition=fs.readFileSync(new URL('../agents/sonnet-reviewer.md',import.meta.url),'utf8');assert.match(definition,/tools: Read, Grep, Glob\n/);
 // This proves options passed by our script; the actual runtime boundary still needs a cloud probe.
});
test('blocked results stop; rejected API calls propagate',async()=>{
 const blocked={status:'BLOCKED',summary:'permission denied',findings:[]};const {result,calls}=await run([blocked]);assert.equal(result.status,'BLOCKED');assert.equal(calls.length,1);
 const fn=new AsyncFunction('args','agent','log',source.replace('export const meta','const meta'));await assert.rejects(()=>fn(JSON.stringify({target:'t',shared:'s',run_id:'r',task_id:'k',readonly_probe:true}),async()=>{throw Error('API denied');},()=>{}),/API denied/);
});
test('model definitions agree with workflow requested models and no randomness/imports',()=>{
 for(const [role,model] of [['opus-architect','opus'],['opus-auditor','opus'],['sonnet-planner','sonnet'],['sonnet-reviewer','sonnet'],['sonnet-verifier','sonnet'],['haiku-builder','haiku']]){
  const d=fs.readFileSync(new URL('../agents/'+role+'.md',import.meta.url),'utf8');assert.match(d,new RegExp('model: claude-'+model+'-5-5'));
 }
 assert.doesNotMatch(source,/Date\.now|Math\.random|import\(/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const source=fs.readFileSync(new URL('../workflows/milestone-audit.js',import.meta.url),'utf8').replace('export const meta','const meta');
test('Opus milestone script compiles and preserves missing requirement findings',async()=>{
 const fn=new AsyncFunction('args','agent',source);
 const findings={status:'NEEDS_FIX',findings:[{severity:'major',message:'R2 omitted'}],requirement_refs:['R1'],next:'Restore R2 in backlog'};
 const result=await fn(JSON.stringify({target:'t',shared:'s',mode:'audit',readonly_probe:true}),async(prompt,options)=>{assert.equal(options.model,'claude-opus-5-5');assert.deepEqual(options.tools,['Read','Grep','Glob']);return findings;});
 assert.deepEqual(result,findings);
 await assert.rejects(()=>fn(JSON.stringify({target:'t',shared:'s',mode:'audit',readonly_probe:true}),async()=>null),/Missing Opus/);
 await assert.rejects(()=>fn(JSON.stringify({target:'t',shared:'s',mode:'audit',readonly_probe:false}),async()=>findings),/missing tools probe/);
});

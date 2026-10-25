import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {bootstrap} from '../scripts/bootstrap.mjs';
import {contracts,fingerprint,hash,json,read,shared,validate} from '../scripts/lib/core.mjs';
import {record} from '../scripts/record.mjs';
import {verify} from '../scripts/verify.mjs';
import {state} from '../scripts/state.mjs';
function fixture(t,profile='backend') {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'harness-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const target=path.join(base,'target');fs.mkdirSync(target);
 const git=(...args)=>execFileSync('git',['-C',target,...args],{stdio:'pipe'});
 git('init','-b','main');git('remote','add','origin','https://example.test/project.git');
 fs.writeFileSync(path.join(target,'app.js'),'console.log("works")\n');
 fs.mkdirSync(path.join(target,'.claude'));fs.writeFileSync(path.join(target,'.claude','settings.json'),'{"existing":true}');
 const source=path.join(base,'mission.json');json(source,{original:'Build all features without omissions.',requirements:[{id:'R1',text:'Service works'}]});
 bootstrap({target,mission:source,profile});
 const dir=path.join(target,'.autodev');
 const kinds={backend:['test','api'],'web-app':['test','build','behavior','visual'],game:['test','build','behavior','visual','play']}[profile];
 json(path.join(dir,'contract.json'),{version:1,checks:kinds.map(id=>({id,requirement_refs:['R1'],kind:id,command:'node app.js',timeout_ms:2000})),human_review:false});
 return {target,dir,source,git};
}
function attest(f) {
 const c=contracts(f.target),product=fingerprint(f.target),identity=hash(JSON.stringify(c.mission.target));
 fs.writeFileSync(path.join(f.dir,'evidence','mock-runtime.txt'),'TEST FIXTURE ONLY: not live routing');
 const runtime_hash=hash('TEST FIXTURE ONLY: not live routing');
 for(const kind of ['review','audit']) json(path.join(f.dir,'evidence',kind+'.json'),{version:1,kind,product,contract:c.digest,identity,findings:[],requirement_refs:['R1'],runtime_record:'mock-runtime.txt',runtime_hash,expected_model:kind==='review'?'claude-sonnet-5-5':'claude-opus-5-5',observed_model:kind==='review'?'claude-sonnet-5-5':'claude-opus-5-5'});
 json(path.join(f.dir,'routing.json'),['opus','sonnet','haiku'].map(m=>({expected:`claude-${m}-5-5`,observed:`claude-${m}-5-5`,record:'mock-runtime.txt',hash:runtime_hash})));
}
function pass(f) {for(const c of contracts(f.target).contract.checks) record({target:f.target,check:c.id});attest(f);assert.equal(verify(f).status,'COMPLETE');}
test('T01/T10 initialization is idempotent, preserves settings and refuses shared target',t=>{
 const f=fixture(t);const before=fs.readFileSync(path.join(f.dir,'mission.json'),'utf8');
 assert.equal(bootstrap({target:f.target,mission:f.source}).status,'RESUMED');
 assert.equal(fs.readFileSync(path.join(f.dir,'mission.json'),'utf8'),before);
 assert.equal(read(path.join(f.target,'.claude','settings.json')).existing,true);
 assert.throws(()=>bootstrap({target:shared,mission:f.source}));
});
test('schemas reject malformed, unknown properties, duplicate IDs and missing coverage',t=>{
 const f=fixture(t);assert.throws(()=>validate('current-task',{stage:'BOGUS'}));
 const b=read(path.join(f.dir,'backlog.json'));b.items.push(b.items[0]);json(path.join(f.dir,'backlog.json'),b);assert.throws(()=>contracts(f.target),/Duplicate/);
 b.items=[];json(path.join(f.dir,'backlog.json'),b);assert.throws(()=>contracts(f.target));
});
test('T04 real faulty code fails, repaired code passes with mock assessments',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.target,'app.js'),'throw Error("deliberate bug")');
 assert.notEqual(record({target:f.target,check:'test'}).exit_code,0);assert.equal(verify(f).status,'FAIL');
 fs.writeFileSync(path.join(f.target,'app.js'),'console.log("fixed")');pass(f);
});
test('T05 missing/stale/log-tampered evidence is UNVERIFIED',t=>{
 const f=fixture(t);assert.equal(verify(f).status,'UNVERIFIED');pass(f);
 fs.appendFileSync(path.join(f.target,'app.js'),'\n// changed');assert.equal(verify(f).status,'UNVERIFIED');
 pass(f);fs.appendFileSync(path.join(f.dir,'evidence',hash('test')+'.log'),'tampered');assert.equal(verify(f).status,'UNVERIFIED');
});
test('T06 build passes but visual failure rejects completion',t=>{
 const f=fixture(t,'web-app');const c=read(path.join(f.dir,'contract.json'));c.checks.find(c=>c.kind==='visual').command='exit 1';json(path.join(f.dir,'contract.json'),c);
 for(const check of c.checks) record({target:f.target,check:check.id});attest(f);assert.equal(verify(f).status,'FAIL');
});
test('T07 removed requirement mapping and dependencies rejected',t=>{
 const f=fixture(t);const b=read(path.join(f.dir,'backlog.json'));b.items[0].requirement_refs=['other'];json(path.join(f.dir,'backlog.json'),b);assert.throws(()=>contracts(f.target),/Unknown requirement/);
 b.items[0].requirement_refs=['R1'];b.items[0].dependencies=['R1'];json(path.join(f.dir,'backlog.json'),b);assert.throws(()=>contracts(f.target),/dependency/);
});
test('T09/T16 ownership prevents double writers and recovery observes partial edits',t=>{
 const f=fixture(t),o={target:f.target,run:'run1',task:'task1'};
 state({...o,action:'begin'});assert.throws(()=>state({...o,action:'begin'}),/Active/);
 assert.throws(()=>state({...o,action:'transition',stage:'IMPLEMENT'}),/Invalid state/);
 state({...o,action:'transition',stage:'ARCHITECTURE'});
 fs.appendFileSync(path.join(f.target,'app.js'),'\n// partial edit');
 const proof=path.join(f.target,'stopped.txt');fs.writeFileSync(proof,'fixture runtime terminated');
 const s=state({...o,action:'recover',proof});assert.match(s.history.at(-1).note,/Product changed/);assert.equal(s.stage,'BLOCKED');
 assert.match(fs.readFileSync(path.join(f.target,'app.js'),'utf8'),/partial edit/);
});
test('T12 all profiles reuse harness with command evidence only',t=>{for(const p of ['backend','web-app','game']) pass(fixture(t,p));});
test('T13 evidence does not invalidate product; contract edits do',t=>{
 const f=fixture(t);pass(f);const fp=fingerprint(f.target);fs.writeFileSync(path.join(f.dir,'evidence','extra.txt'),'new');assert.equal(fp,fingerprint(f.target));assert.equal(verify(f).status,'COMPLETE');
 const c=read(path.join(f.dir,'contract.json'));c.human_review=true;json(path.join(f.dir,'contract.json'),c);assert.equal(verify(f).status,'UNVERIFIED');
 passHuman();function passHuman(){for(const c of contracts(f.target).contract.checks)record({target:f.target,check:c.id});attest(f);assert.equal(verify(f).status,'READY_FOR_HUMAN_REVIEW');}
});
test('T14 untracked files, deletions, executable bit and symlink target affect fingerprint',t=>{
 const f=fixture(t);let fp=fingerprint(f.target);const app=path.join(f.target,'app.js');fs.chmodSync(app,0o755);assert.notEqual(fp,fingerprint(f.target));
 fp=fingerprint(f.target);fs.writeFileSync(path.join(f.target,'new.js'),'new');assert.notEqual(fp,fingerprint(f.target));
 fp=fingerprint(f.target);f.git('add','app.js');fs.unlinkSync(app);assert.notEqual(fp,fingerprint(f.target));
 fs.symlinkSync('first',app);fp=fingerprint(f.target);fs.unlinkSync(app);fs.symlinkSync('second',app);assert.notEqual(fp,fingerprint(f.target));
});
test('T17 substituted models and unresolved reviews cannot complete',t=>{
 const f=fixture(t);pass(f);const p=path.join(f.dir,'evidence','review.json'),r=read(p);r.observed_model='other';json(p,r);assert.equal(verify(f).status,'UNVERIFIED');
 r.observed_model=r.expected_model;r.findings=[{severity:'major',message:'broken',resolved:false}];json(p,r);assert.equal(verify(f).status,'FAIL');
});
test('T20 in-flight run and command modifying product reject completion',t=>{
 const f=fixture(t);pass(f);state({target:f.target,action:'begin',run:'r',task:'t'});assert.equal(verify(f).status,'UNVERIFIED');
 const c=read(path.join(f.dir,'contract.json'));c.checks[0].command='echo changed >> app.js';json(path.join(f.dir,'contract.json'),c);assert.equal(record({target:f.target,check:'test'}).stable,false);
});
test('state symlinks rejected; branch mismatch and mission tamper rejected',t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.dir,'mission.md'),'tamper');assert.throws(()=>contracts(f.target),/mission changed/);
 fs.writeFileSync(path.join(f.dir,'mission.md'),'Build all features without omissions.');f.git('checkout','-b','other');assert.throws(()=>contracts(f.target),/identity changed/);f.git('symbolic-ref','HEAD','refs/heads/main');
 fs.symlinkSync(f.source,path.join(f.dir,'evidence','planted'));assert.throws(()=>contracts(f.target),/Symlink/);
});
test('CLI subprocess: bootstrap auto-select, real HTTP check, context, gate, doctor',t=>{
 const f=fixture(t);
 const run=(script,args)=>{
  try{return {code:0,stdout:execFileSync(process.execPath,[path.join(shared,'scripts',script+'.mjs'),...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']})};}
  catch(e){return {code:e.status,stdout:e.stdout};}
 };
 const selected=run('bootstrap',['--repositories',JSON.stringify([shared,f.target]),'--mission',f.source]);assert.equal(selected.code,0);assert.equal(JSON.parse(selected.stdout).status,'RESUMED');
 const app=path.join(f.target,'http-check.mjs');fs.writeFileSync(app,`import http from 'node:http'; import assert from 'node:assert/strict'; const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));}); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try {const response=await fetch('http://127.0.0.1:'+server.address().port);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});console.log('HTTP 200, expected payload confirmed');}finally{server.closeAllConnections();server.close();}`);
 const c=read(path.join(f.dir,'contract.json'));c.checks.find(x=>x.id==='api').command='node http-check.mjs';json(path.join(f.dir,'contract.json'),c);
 for(const check of c.checks)assert.equal(run('record',['--target',f.target,'--check',check.id]).code,0);
 assert.equal(run('context',['--target',f.target]).code,0);
 assert.equal(run('verify',['--target',f.target]).code,1); // real model evidence missing
 attest(f);assert.equal(run('verify',['--target',f.target]).code,0); // mock evidence, parser path only
 assert.equal(JSON.parse(run('doctor',['--target',f.target]).stdout).checks.actual_model_routing,'UNVERIFIED');
});
test('record timeout fails and command contract edits invalidate evidence',t=>{
 const f=fixture(t);const c=read(path.join(f.dir,'contract.json'));c.checks[0].command='node -e "setTimeout(()=>{}, 10000)"';c.checks[0].timeout_ms=30;json(path.join(f.dir,'contract.json'),c);
 const e=record({target:f.target,check:'test'});assert.equal(e.exit_code,null);assert.equal(verify(f).status,'FAIL');
 c.checks[0].command=`node -e "const fs=require('fs');const p='.autodev/contract.json';const c=JSON.parse(fs.readFileSync(p));c.human_review=true;fs.writeFileSync(p,JSON.stringify(c));"`;c.checks[0].timeout_ms=2000;json(path.join(f.dir,'contract.json'),c);
 assert.equal(record({target:f.target,check:'test'}).stable,false);
});
test('canonical remote rejects shared clones even under SSH URL spelling',t=>{
 const f=fixture(t);f.git('remote','set-url','origin','git@github.com:sunpotflower4460-cpu/Claude-enhancement-system.git');
 assert.throws(()=>bootstrap({target:f.target,mission:f.source}),/shared repository/);
});

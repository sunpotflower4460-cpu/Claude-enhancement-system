export const meta = {
 name: 'develop-sprint',
 description: 'One serialized development sprint with independent review, verification and escalation',
};
// Workflow sandbox, not a Node module. Run /workflow-authoring before adapting options.
const input = JSON.parse(args);
if (!input.target || !input.shared || !input.run_id || !input.task_id || input.readonly_probe !== true) {
 throw new Error('Require target/shared/run_id/task_id and a successful runtime read-only tools probe');
}
const resultSchema = {
 type: 'object', additionalProperties: false,
 required: ['status', 'summary', 'findings'],
 properties: {status: {enum: ['PASS','NEEDS_FIX','UNVERIFIED','BLOCKED']}, summary: {type:'string'}, findings:{type:'array',items:{type:'object',required:['severity','message'],properties:{severity:{enum:['critical','major','minor']},message:{type:'string'}}}}},
};
const base = `Target=${input.target}; shared=${input.shared}; run=${input.run_id}; task=${input.task_id}. Read shared START.md and the role definition. Never write shared. Before a write inspect .autodev/current-task.json, Git identity and partial diff. Use shared scripts/state.mjs for begin/transitions/end, owner run/task required. Return JSON, never hide failures. `;
async function call(role, model, prompt, readonly=false) {
 const r=await agent(base+`Role=${role}. `+prompt, {
  model, label:role,
  tools:readonly?['Read','Grep','Glob']:['Read','Grep','Glob','Bash','Edit','Write'],
  schema:resultSchema,
 });
 if(!r || !['PASS','NEEDS_FIX','UNVERIFIED','BLOCKED'].includes(r.status) || !Array.isArray(r.findings)) throw new Error('Missing/invalid agent result: '+role);
 return r;
}
const planner=await call('sonnet-planner','claude-sonnet-5-5','Begin the run (if active, do not steal ownership). Resume by inspecting current state and evidence. If IDLE, obtain Opus architecture using a separate milestone workflow first and report BLOCKED here. Otherwise transition to PLAN only along permitted edges; write sprint contract, select dependency-ready task.');
if(planner.status!=='PASS') return planner;
for(let attempt=0;attempt<4;attempt++) {
 const model=attempt>=2?'claude-sonnet-5-5':'claude-haiku-5-5';
 const built=await call(attempt>=2?'sonnet-planner':'haiku-builder',model,`Attempt ${attempt+1}. Transition to IMPLEMENT. ${attempt>=2?'Investigate root cause before implementation; record escalation. ':''}Implement/fix sprint. Transition to REVIEW after observing real files. Never rewrite the original mission.`);
 if(built.status==='BLOCKED'||built.status==='UNVERIFIED') return built;
 const review=await call('sonnet-reviewer','claude-sonnet-5-5','Read actual original requirements, sprint and changed product; perform independent read-only review. Return every finding with severity and reproduction.',true);
 if(review.status==='BLOCKED'||review.status==='UNVERIFIED') return review;
 if(review.status!=='PASS'||review.findings.some(f=>f.severity==='major'||f.severity==='critical')) {
  log(JSON.stringify({attempt,review})); continue;
 }
 const verified=await call('sonnet-verifier','claude-sonnet-5-5',`Transition to VERIFY. Run contract commands via record.mjs; validate actual application behavior. Preserve this independent review verbatim: ${JSON.stringify(review)}. Assessment model provenance must come from parent runtime records, never self-identification. Record handoff. On success transition to AUDIT (or PLAN for remaining tasks), end the run. On failure leave recoverable state and return NEEDS_FIX; unavailable checks return UNVERIFIED.`);
 if(verified.status==='PASS') return {status:'PASS',summary:'Sprint only; parent must run milestone audit then final verify after all workflows terminate',findings:[]};
 if(verified.status==='BLOCKED'||verified.status==='UNVERIFIED') return verified;
}
return {status:'NEEDS_FIX',summary:'Four unsuccessful attempts; Opus replanning required. Inspect state and stop/close run before independent work.',findings:[]};

export const meta = {
 name: 'milestone-audit',
 description: 'Opus architecture or milestone audit with explicit requirement coverage',
};
const input=JSON.parse(args);
if(!input.target||!input.shared||!['architecture','audit'].includes(input.mode)||input.readonly_probe!==true) throw new Error('Invalid input or missing tools probe');
const readonly=input.mode==='audit';
const result=await agent(`Target=${input.target}; common=${input.shared}. Read START.md and agents/opus-${readonly?'auditor':'architect'}.md from common. ${readonly?'Read-only audit: examine every original requirement and actual evidence; identify missing scope and unresolved defects. Return findings, coverage and next tasks.':'Inspect target state, begin using state.mjs with supplied run_id/task_id, transition IDLE to ARCHITECTURE. Write architecture/backlog/contract with all original requirements and selected profile. Transition to PLAN and end. Preserve mission and shared files.'} Context: ${JSON.stringify(input)}`,{
 model:'claude-opus-5-5',label:readonly?'opus-auditor':'opus-architect',
 tools:readonly?['Read','Grep','Glob']:['Read','Grep','Glob','Bash','Edit','Write'],
 schema:{type:'object',required:['status','findings','requirement_refs','next'],properties:{status:{enum:['PASS','NEEDS_FIX','UNVERIFIED','BLOCKED']},findings:{type:'array',items:{type:'object'}},requirement_refs:{type:'array',items:{type:'string'}},next:{type:'string'}}},
});
if(!result) throw new Error('Missing Opus result');
return result;

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
export const shared = fs.realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
export const hash = x => crypto.createHash('sha256').update(x).digest('hex');
export const read = p => JSON.parse(fs.readFileSync(p,'utf8'));
export const json = (p,x) => { const t=p+'.'+crypto.randomUUID()+'.tmp'; fs.writeFileSync(t,JSON.stringify(x,null,2)+'\n',{flag:'wx'}); fs.renameSync(t,p); };
const ajv = new Ajv({allErrors:true});
const validators = new Map();
export function validate(name,x) {
 if(!validators.has(name)) validators.set(name,ajv.compile(read(path.join(shared,'schemas',name+'.schema.json'))));
 const v=validators.get(name); if(!v(x)) throw Error(name+': '+ajv.errorsText(v.errors)); return x;
}
export function git(root,...args) { return execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim(); }
export function canonicalRemote(remote) {
 return remote.trim().replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase();
}
export function identity(root) {
 root=fs.realpathSync(root);
 if(git(root,'rev-parse','--show-toplevel')!==root) throw Error('Target must be repository root');
 return {root,gitDir:git(root,'rev-parse','--absolute-git-dir'),remote:git(root,'remote','get-url','origin'),branch:branchIdentity(root)};
}
function branchIdentity(root) {
 try {return execFileSync('git',['-C',root,'symbolic-ref','--quiet','--short','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
 catch {return 'DETACHED:'+git(root,'rev-parse','HEAD');}
}
export function safeState(root) {
 const dir=path.join(root,'.autodev');
 // Never follow planted symlinks in control files or evidence.
 function scan(p) { if(!fs.existsSync(p) && !fs.lstatSync(p,{throwIfNoEntry:false})) return; const st=fs.lstatSync(p); if(st.isSymbolicLink()) throw Error('Symlink in state: '+p); if(st.isDirectory()) for(const n of fs.readdirSync(p)) scan(path.join(p,n)); }
 scan(dir); return dir;
}
export function load(root) {
 const dir=safeState(root), mission=validate('mission',read(path.join(dir,'mission.json')));
 if(JSON.stringify(identity(root))!==JSON.stringify(mission.target)) throw Error('Repository identity changed');
 if(mission.shared!==shared) throw Error('Shared repository mismatch');
 if(hash(fs.readFileSync(path.join(dir,'mission.md')))!==hash(mission.original)) throw Error('Original mission changed');
 return {dir,mission};
}
export function unique(xs,label) {if(new Set(xs).size!==xs.length) throw Error('Duplicate '+label);}
export function contracts(root) {
 const {dir,mission}=load(root), backlog=validate('backlog',read(path.join(dir,'backlog.json'))), contract=validate('contract',read(path.join(dir,'contract.json')));
 const ids=mission.requirements.map(r=>r.id); unique(ids,'requirement'); unique(backlog.items.map(x=>x.id),'task'); unique(contract.checks.map(x=>x.id),'check');
 for(const xs of [backlog.items,contract.checks]) {
  for(const x of xs) {unique(x.requirement_refs,'reference'); if(x.requirement_refs.some(id=>!ids.includes(id))) throw Error('Unknown requirement');}
  if(ids.some(id=>!xs.some(x=>x.requirement_refs.includes(id)))) throw Error('Missing requirement coverage');
 }
 for(const task of backlog.items) if(task.dependencies.some(id=>id===task.id || !backlog.items.some(t=>t.id===id))) throw Error('Invalid dependency');
 const visit=(id,stack=[])=>{if(stack.includes(id)) throw Error('Dependency cycle'); for(const dep of backlog.items.find(t=>t.id===id).dependencies) visit(dep,[...stack,id]);};
 backlog.items.forEach(t=>visit(t.id));
 const kinds=contract.checks.map(x=>x.kind), required={backend:['test','api'],'web-app':['test','build','behavior','visual'],game:['test','build','behavior','visual','play']}[mission.profile];
 if(required.some(k=>!kinds.includes(k))) throw Error('Missing profile checks: '+required.join(', '));
 return {dir,mission,backlog,contract,digest:hash(JSON.stringify({mission,contract,backlog:backlog.items.map(({status,...x})=>x),validator:verifierVersion()}))};
}
export function verifierVersion() {
 return hash(['core.mjs','run-check.mjs','../verify.mjs','../record.mjs',...fs.readdirSync(path.join(shared,'schemas')).map(n=>'../../schemas/'+n)].map(n=>fs.readFileSync(path.resolve(shared,'scripts/lib',n))).join('\n'));
}
export function fingerprint(root) {
 // Git index + untracked nonignored paths. Tracked files remain included even if ignored.
 const names=execFileSync('git',['-C',root,'ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean);
 const entries=[...new Set(names)].filter(n=>n!=='.autodev'&&!n.startsWith('.autodev/')).sort().map(n=>{
  const p=path.join(root,n),st=fs.lstatSync(p,{throwIfNoEntry:false});
  if(!st) return [n,'deleted'];
  if(st.isSymbolicLink()) return [n,'symlink',fs.readlinkSync(p)];
  if(!st.isFile()) throw Error('Unsupported product entry (including submodule): '+n);
  return [n,st.mode&0o777,hash(fs.readFileSync(p))];
 });
 return hash(JSON.stringify(entries));
}
export function mutex(root,fn) {
 const dir=safeState(root), lock=path.join(dir,'.mutex');
 const fd=fs.openSync(lock,'wx');
 try {return fn();} finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
export function options(argv=process.argv.slice(2)) {
 const out={}; for(let i=0;i<argv.length;i+=2) {if(!argv[i].startsWith('--')||argv[i+1]===undefined) throw Error('Expected --key value'); if(argv[i].slice(2) in out) throw Error('Duplicate option'); out[argv[i].slice(2)]=argv[i+1];} return out;
}
export function main(fn) {try {fn(options());} catch(e) {console.log(JSON.stringify({status:'UNVERIFIED',reason:e.message}));process.exitCode=2;}}

#!/bin/bash
T=/home/user/probes/dreambox-7; BAK=/home/user/probes/dreambox-7.pre-mutation; C=/home/user/Claude-enhancement-system
restore(){ rm -rf $T; cp -a $BAK $T; }
run(){ # name, mutate-cmd
  restore; eval "$2" >/dev/null 2>&1
  (cd $C; node scripts/verify.mjs --target $T > /tmp/m.json 2>/tmp/m.err); code=$?
  python3 - "$1" "$code" <<'E'
import json,sys
try:
    d=json.load(open('/tmp/m.json')); iss=d.get('issues') or []
    print('%-34s exit=%s status=%-10s %s'%(sys.argv[1],sys.argv[2],d.get('status'),(iss[0][:105] if iss else '')))
except Exception as e: print('%-34s exit=%s (no json: %s)'%(sys.argv[1],sys.argv[2],open('/tmp/m.err').read()[:100]))
E
}
RPT=$(ls $T/.autodev/evidence/*.report.json | head -1)
RT=$(ls $T/.autodev/evidence/runtime-*.json | head -1)
run "T05 delete a check report"        "rm -f $RPT"
run "T05 edit a check report"          "python3 -c \"import json;p='$RPT';d=json.load(open(p));d['assertions'][0]['status']='FAIL';json.dump(d,open(p,'w'))\""
run "T07 drop requirement task R4"     "python3 -c \"import json;p='$T/.autodev/backlog.json';d=json.load(open(p));d['items']=[t for t in d['items'] if t['id']!='R4'];json.dump(d,open(p,'w'),indent=2)\""
run "T14 delete product file"          "rm -f $T/autodev-probe/app.mjs"
run "T14 chmod product file"           "chmod +x $T/autodev-probe/app.mjs"
run "T14 add untracked product file"   "echo 'export const x=1' > $T/autodev-probe/extra.mjs"
run "T20 edit product after COMPLETE"  "echo '// edit' >> $T/autodev-probe/app.mjs"
run "T13 change verification contract" "python3 -c \"import json;p='$T/.autodev/contract.json';d=json.load(open(p));d['checks'][0]['timeout_ms']+=1;json.dump(d,open(p,'w'),indent=2)\""
run "T13 add unrelated evidence file"  "echo noise > $T/.autodev/evidence/unrelated-note.txt"
run "T17 tamper runtime expected model" "python3 -c \"import json;p='$RT';d=json.load(open(p));d['expected_model']='claude-opus-5-5';json.dump(d,open(p,'w'),indent=2)\""
run "T17 tamper raw SDK record"        "f=\$(ls $T/.autodev/evidence/sdk-*.jsonl | head -1); sed -i 's/claude-haiku-5-5/claude-sonnet-5-5/' \$f"
restore
(cd $C; node scripts/verify.mjs --target $T 2>&1 | tail -1)

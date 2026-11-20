#!/bin/bash
# In-container: prove the two simulator recipes on the programs in /mnt/sim/tests.
#  1. assemble every test with the official EDIT68K (asm_batch.py, default options)
#  2. recipe (a) self-report: t1..t5, t6 and t8 under each way of setting the
#     options, t7 with a screenshot of the output window
#  3. recipe (b) execution logs: l1..l5 by Auto Trace, l1 also by Trace Into,
#     l4 also with the text-output log
# Results: /mnt/out/sim/{asm,selfreport,log}/..., summary in /mnt/out/sim/results.jsonl
set -u
OUT=/mnt/out/sim
/oracle/stage.sh
rm -rf /work/simtests "$OUT/selfreport" "$OUT/log" "$OUT/asm" "$OUT/results.jsonl"
mkdir -p /work/simtests "$OUT"
cp /mnt/sim/tests/*.X68 /mnt/sim/dumplib.X68 /work/simtests/
cd /work/simtests
ls [tl]*.X68 > /tmp/simlist.txt
python3 /oracle/asm_batch.py --corpus /work/simtests --list /tmp/simlist.txt --options default --out "$OUT/asm"
python3 /oracle/merge_manifests.py "$OUT/asm" > /dev/null

R="$OUT/results.jsonl"
sr() {  # name dumpname label [sim_run args...]
  local n=$1 label=$2; shift 2
  local res
  res=$(python3 /oracle/sim_run.py selfreport "$n.S68" --dump "${n}_dump.txt" --out "$OUT/selfreport/$label" "$@")
  echo "{\"label\": \"$label\", \"result\": $res}" >> "$R"
  echo "selfreport $label: $(echo "$res" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r["ok"], r.get("seconds_to_dump"), r.get("error",""))')"
}
lg() {  # name label [sim_run log args...]
  local n=$1 label=$2; shift 2
  local res
  res=$(python3 /oracle/sim_run.py log "$n.S68" --out "$OUT/log/$label" "$@")
  echo "{\"label\": \"$label\", \"result\": $res}" >> "$R"
  echo "log $label: $(echo "$res" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r["ok"], r.get("instructions_logged"), r.get("instructions_per_second"), r.get("run_seconds"), r.get("error",""))')"
}

for t in t1_arith t2_bcd_shift t3_memory t4_print t5_branches; do sr "$t" "$t"; done
sr t6_options t6_exceptions_off --timeout 10
sr t6_options t6_exceptions_cmdline --args "/e"
sr t6_options t6_exceptions_simdat --exceptions 1
sr t8_bitfield t8_bitfield_off --bitfield 0 --timeout 10
sr t8_bitfield t8_bitfield_cmdline --bitfield 0 --args "/b"
sr t8_bitfield t8_bitfield_simdat --bitfield 1
sr t7_draw t7_draw --screenshot "$OUT/selfreport/t7_draw/output-window.png" --settle 2

for l in l1_arith l2_bcd_shift l3_memory l4_print l5_branches; do
  lg "$l" "$l-autotrace-type3" --exec-log 3 --drive autotrace --interval 10 --timeout 300
done
lg l1_arith l1_arith-autotrace-type1 --exec-log 1 --drive autotrace --interval 10 --timeout 300
lg l1_arith l1_arith-autotrace-type2 --exec-log 2 --drive autotrace --interval 10 --timeout 300
lg l1_arith l1_arith-step-type2 --exec-log 2 --drive step --timeout 300
lg l4_print l4_print-run-outlog --exec-log 0 --out-log 1 --drive run --timeout 60
lg l4_print l4_print-autotrace-both --exec-log 2 --out-log 1 --drive autotrace --interval 10 --timeout 300
wineserver -k 2>/dev/null || true

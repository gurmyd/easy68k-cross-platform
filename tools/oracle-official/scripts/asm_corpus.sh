#!/bin/bash
# In-container: assemble shard K of N of the corpus list with both option sets.
# Usage: asm_corpus.sh K N [options...]   (options default: "default expand")
set -u
K=$1; N=$2; shift 2
OPTS=${*:-default expand}
/oracle/stage.sh --corpus
for o in $OPTS; do
  python3 /oracle/asm_batch.py --corpus /work/corpus --list /mnt/out/run-list.txt \
     --options "$o" --out /mnt/out/asm --shard "$K/$N" --timeout "${ASM_TIMEOUT:-300}"
done
wineserver -k 2>/dev/null || true

#!/bin/bash
# In-container: assemble shard K of N of a job file with the official EDIT68K.
#
#   asm_corpus.sh K N
#
# Mounts (made by regenerate.mjs and run.sh):
#   /mnt/official  read-only   the unpacked official distribution
#   /mnt/corpus    read-only   the sources; copied to /work/corpus, because the
#                              editor writes its outputs beside the source
#   /mnt/job       read-only   jobs.jsonl and the settings.dat files it names
#   /mnt/out       writable    results (see asm_batch.py)
set -u
K=$1; N=$2
/oracle/stage.sh --corpus
python3 /oracle/asm_batch.py --corpus /work/corpus --jobs /mnt/job/jobs.jsonl \
   --out /mnt/out --shard "$K/$N" --timeout "${ASM_TIMEOUT:-300}"
status=$?
wineserver -k 2>/dev/null || true
exit $status

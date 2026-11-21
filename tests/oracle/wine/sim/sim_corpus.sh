#!/bin/bash
# In-container: run shard K of N of a simulator job list with the official SIM68K.exe.
#
#   bash /mnt/sim-driver/sim_corpus.sh K N
#
# Mounts (made by regenerate.mjs):
#   /mnt/official    read-only   the unpacked official distribution
#   /mnt/sim-driver  read-only   this folder (sim_batch.py, sim_run.py)
#   /mnt/corpus      read-only   tests/conformance/sim (the programs); copied to /work/sim
#   /mnt/job         read-only   jobs.jsonl
#   /mnt/out         writable    results (see sim_batch.py)
set -u
K=$1; N=$2
/oracle/stage.sh
mkdir -p /work/sim
(cd /mnt/corpus && tar --exclude=./golden -cf - .) | tar -xf - -C /work/sim
python3 /mnt/sim-driver/sim_batch.py --corpus /work/sim --jobs /mnt/job/jobs.jsonl \
   --out /mnt/out --shard "$K/$N"
status=$?
wineserver -k 2>/dev/null || true
exit $status

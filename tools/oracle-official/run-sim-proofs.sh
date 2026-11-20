#!/bin/bash
# Host side: assemble the simulator test programs (tools/oracle-official/sim/tests)
# with the official EDIT68K and run them in the official SIM68K with both recipes.
#   tools/oracle-official/run-sim-proofs.sh
# Outputs: build/ground-truth/sim/{asm,selfreport,log}/..., sim/results.jsonl
set -eu
export MSYS_NO_PATHCONV=1
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
IMAGE=${IMAGE:-easy68k-oracle-official:dev}
OUT="$ROOT/build/ground-truth"
mkdir -p "$OUT/sim"
winp() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
docker rm -f oracle-sim >/dev/null 2>&1 || true
docker run --rm --init --name oracle-sim \
  -v "$(winp "$ROOT/reference/official-extracted"):/mnt/official:ro" \
  -v "$(winp "$HERE/sim"):/mnt/sim:ro" \
  -v "$(winp "$OUT"):/mnt/out" \
  -v "$(winp "$HERE/scripts"):/oracle:ro" \
  "$IMAGE" /oracle/sim_proofs.sh 2>&1 | tee "$OUT/sim/run.log"

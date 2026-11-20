#!/bin/bash
# Host side (Git Bash on Windows, or any POSIX shell with Docker): assemble the
# example corpus with the official EDIT68K.exe, in N parallel containers, with
# the shipped default options and with the expansion options on, then merge
# the per-container manifests.
#
#   tools/oracle-official/run-asm-corpus.sh [N] [LIST]
#     N    : number of parallel containers (default 6)
#     LIST : optional file of corpus-relative paths to (re)assemble; default is
#            every *.X68 under reference/examples (except site/_downloads).
#            A re-run replaces only those files' records in manifest.json.
#
# Inputs : reference/official-extracted (read-only), reference/examples (read-only)
# Outputs: build/ground-truth/asm/<options>/<corpus-relative-path>/<name>.{L68,S68,received.txt}
#          build/ground-truth/asm/<options>/manifest.json
set -eu
export MSYS_NO_PATHCONV=1
N=${1:-6}
LIST=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
IMAGE=${IMAGE:-easy68k-oracle-official:dev}
OUT="$ROOT/build/ground-truth"
mkdir -p "$OUT/asm"
# Docker Desktop on Windows wants Windows paths for bind mounts.
winp() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

if [ -z "$LIST" ]; then
  (cd "$ROOT/reference/examples" && find . -type f -iname '*.x68' -not -path './site/_downloads/*' \
     | sed 's|^\./||' | LC_ALL=C sort) > "$OUT/corpus-list.txt"
  cp "$OUT/corpus-list.txt" "$OUT/run-list.txt"
else
  cp "$LIST" "$OUT/run-list.txt"
fi
echo "$(wc -l < "$OUT/run-list.txt") sources"
rm -f "$OUT"/asm/*/manifest-shard*.jsonl

pids=()
for k in $(seq 0 $((N-1))); do
  docker rm -f "oracle-asm-$k" >/dev/null 2>&1 || true
  docker run --rm --init --name "oracle-asm-$k" -e ASM_TIMEOUT="${ASM_TIMEOUT:-300}" \
    -v "$(winp "$ROOT/reference/official-extracted"):/mnt/official:ro" \
    -v "$(winp "$ROOT/reference/examples"):/mnt/corpus:ro" \
    -v "$(winp "$OUT"):/mnt/out" \
    -v "$(winp "$HERE/scripts"):/oracle:ro" \
    "$IMAGE" /oracle/asm_corpus.sh "$k" "$N" > "$OUT/asm/run-shard$k.log" 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || true; done
python "$(winp "$HERE/scripts/merge_manifests.py")" "$(winp "$OUT/asm")"

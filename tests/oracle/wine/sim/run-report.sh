#!/bin/bash
# Run one program in the official SIM68K.exe v5.16.1 under Wine and collect the file it writes
# (ARCHITECTURE.md 6.2.2, recipe "self-reporting").
#
#   tests/oracle/wine/sim/run-report.sh <file.S68|file.X68> [switches] [out-dir]
#
# Starts `SIM68K.exe file.S68 /r [switches]` (switches: "/e", "/b" or "/e /b") in a fresh folder,
# waits until the program has written result.bin ending in the line END-OF-DUMP (the routines of
# tests/conformance/sim/dumplib.X68), and kills the simulator. An .X68 is assembled by the official
# EDIT68K.exe first. Everything the run produced is copied to out-dir (default: a new folder below
# build/oracle-wine/sim/, printed at the end). Nothing is recorded in the repository.
#
# Needs Docker, the image (npm run oracle:wine:build), Node 24 and the unpacked official
# distribution (see ../README.md). All the work is done by regenerate.mjs.
set -eu
if [ $# -lt 1 ]; then
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
here=$(cd "$(dirname "$0")" && pwd)
args=(--file "$1" --recipe report)
[ -n "${2:-}" ] && args+=(--switches "$2")
[ -n "${3:-}" ] && args+=(--out "$3")
exec node "$here/regenerate.mjs" "${args[@]}"
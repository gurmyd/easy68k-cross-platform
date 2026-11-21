#!/bin/bash
# Assemble one .X68 file with the official EDIT68K.exe v5.16.1 under Wine (ARCHITECTURE.md 6.2.2).
#
#   tests/oracle/wine/asm/run.sh <file.X68> [settings.dat] [out-dir]
#
# The steps of docs/porting/ground-truth.md section 4: write settings.dat, start EDIT68K.exe with
# the file, F9, Alt+C, Alt+F4, collect the .L68 and .S68. Options are chosen with the settings.dat
# (default: the one that ships with EASy68K). The folder of the file is mounted read-only, so
# INCLUDE and INCBIN find their files; the outputs are copied to out-dir (default: a new folder
# below build/oracle-wine/asm/, printed at the end). Nothing is recorded in the repository.
#
# Needs Docker, the image (npm run oracle:wine:build), Node 24 and the unpacked official
# distribution (see ../README.md). All the work is done by regenerate.mjs.
set -eu
if [ $# -lt 1 ]; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
here=$(cd "$(dirname "$0")" && pwd)
args=(--file "$1")
[ -n "${2:-}" ] && args+=(--settings "$2")
[ -n "${3:-}" ] && args+=(--out "$3")
exec node "$here/regenerate.mjs" "${args[@]}"

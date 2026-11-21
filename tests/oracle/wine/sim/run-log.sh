#!/bin/bash
# Make the execution log of one program with the official SIM68K.exe v5.16.1 under Wine
# (ARCHITECTURE.md 6.2.2, recipe "execution log").
#
#   tests/oracle/wine/sim/run-log.sh <file.S68|file.X68> <type> [switches] [out-dir]
#
# <type> is the log type of the Log Output dialog: 1 (instruction), 2 (registers and instruction)
# or 3 (registers, instruction and memory), optionally followed by "+out" for the text-output log
# as well; "out" alone makes only the text-output log of a Run. The simulator is started without
# /r with sim68K.dat holding the type byte; then Log Start (Ctrl+F4), the Auto Trace Options
# dialog's OK (to apply the 10 ms interval), Auto Trace (F10), and at the halt the
# "Current Log Stopped." box is confirmed and the simulator closed. <name>_RunLog.txt (and
# <name>_OutLog.txt) are copied to out-dir (default: a new folder below build/oracle-wine/sim/).
# Nothing is recorded in the repository. Needs what run-report.sh needs.
set -eu
if [ $# -lt 2 ]; then
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
here=$(cd "$(dirname "$0")" && pwd)
case "$2" in
  out) recipe=outlog ;;
  *) recipe="log:$2" ;;
esac
args=(--file "$1" --recipe "$recipe")
[ -n "${3:-}" ] && args+=(--switches "$3")
[ -n "${4:-}" ] && args+=(--out "$4")
exec node "$here/regenerate.mjs" "${args[@]}"
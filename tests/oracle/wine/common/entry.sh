#!/bin/bash
# Container entry point: start a virtual display, wait until it answers, then run the requested
# command. Usage (inside the container): entry.sh <command> [args...]
#
# The display is started and checked by xwin.ensure_display (up to three fresh starts of Xvfb, 30 s
# each; Xvfb's output in /tmp/xvfb.log). Until oracle run 45050289253 this script gave Xvfb five
# seconds and went on whether it answered or not; one container then ran all its 134 jobs without a
# display (errata T1 28). When the display still does not answer, the command runs anyway: the
# drivers check it again before every run and record "no X display: ..." for a run without one.
set -u
export DISPLAY=${DISPLAY:-:99}
python3 -c '
import sys
sys.path.insert(0, "/oracle")
import xwin
error, restarts = xwin.ensure_display()
if error:
    print("entry.sh: " + error, file=sys.stderr)
' || echo "entry.sh: the display check did not run" >&2
if [ $# -eq 0 ]; then exec bash; fi
exec "$@"

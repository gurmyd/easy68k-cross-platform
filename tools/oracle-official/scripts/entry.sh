#!/bin/bash
# Container entry point: start a virtual display, then run the requested command.
# Usage (inside the container): entry.sh <command> [args...]
set -u
export DISPLAY=${DISPLAY:-:99}
if ! xdpyinfo >/dev/null 2>&1; then
  rm -f /tmp/.X99-lock
  Xvfb "$DISPLAY" -screen 0 1280x1024x24 -nolisten tcp >/dev/null 2>&1 &
  for _ in $(seq 1 50); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.1; done
fi
if [ $# -eq 0 ]; then exec bash; fi
exec "$@"

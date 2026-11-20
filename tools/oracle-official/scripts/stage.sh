#!/bin/bash
# Copy the official program folder (mounted read-only at /mnt/official) to a
# writable place, and optionally the example corpus (/mnt/corpus) to /work/corpus.
# Both programs rewrite their settings file beside the EXE on exit, so they
# must run from a writable copy, never from the mount.
set -eu
mkdir -p /opt/easy68k
cp /mnt/official/EDIT68K.exe /mnt/official/SIM68K.exe /mnt/official/help.chm \
   /mnt/official/settings.dat /mnt/official/sim68K.dat /mnt/official/template.NEW /opt/easy68k/
if [ "${1:-}" = "--corpus" ] && [ -d /mnt/corpus ]; then
  mkdir -p /work/corpus
  (cd /mnt/corpus && tar --exclude=./site/_downloads --exclude=.git -cf - .) | tar -xf - -C /work/corpus
fi

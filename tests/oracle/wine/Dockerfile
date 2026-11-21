# Runtime for driving the OFFICIAL EASy68K v5.16.1 Windows programs (EDIT68K.exe,
# SIM68K.exe) under 32-bit Wine on a virtual X display (ARCHITECTURE.md 6.2.2).
#
#   npm run oracle:wine:build        = docker build -t easy68k-oracle-wine tests/oracle/wine
#
# The official programs are NOT part of this image, and nothing downloaded from
# the EASy68K site is baked in. They are mounted read-only at run time and
# copied to a writable folder inside the container (see README.md).
#
# The base image is pinned by digest and Wine by version, so that a build from
# nothing runs the official programs under the Wine that produced the committed
# results (tests/corpus/manifest.json records `wine --version`). The helpers
# around it (Xvfb, xdotool, ImageMagick, Python) are not pinned: they take no
# part in what the official programs compute. To move to another base or Wine,
# change the two pins, rebuild, and run `npm run oracle:wine:asm -- --check`:
# every run must still equal the manifest.
FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

ARG WINE_VERSION=8.0~repack-4

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    WINEARCH=win32 \
    WINEPREFIX=/opt/wineprefix \
    WINEDEBUG=-all \
    WINEDLLOVERRIDES="mscoree,mshtml=" \
    PYTHONDONTWRITEBYTECODE=1 \
    DISPLAY=:99

RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      "wine=${WINE_VERSION}" "wine32:i386=${WINE_VERSION}" \
      xvfb xauth xdotool x11-utils imagemagick \
      python3 procps psmisc ca-certificates fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# Create the 32-bit prefix once at build time so each run starts fast.
# wineboot needs a display for some first-run dialogs; give it a throwaway one.
RUN Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp & \
    sleep 2 \
 && wineboot --init \
 && wineserver -w \
 && (pkill Xvfb || true)

# /oracle is one flat folder: the scripts import and call each other there
# (common/ = shared helpers, asm/ = assembler driver, sim/ = simulator driver).
# Only the scripts that run inside the container are copied. The simulator driver
# (sim/sim_batch.py, sim_corpus.sh) is not: tests/oracle/wine/sim/regenerate.mjs mounts
# its folder at run time. sim_run.py stays because the measurements of
# official-oracle.md section 5 were made with it (docs/requests/T3-oracle-image.md).
COPY common/entry.sh common/stage.sh common/xwin.py /oracle/
COPY asm/asm_batch.py asm/asm_corpus.sh asm/richedit_check.py asm/merge_manifests.py asm/gen_richedit_stress.py /oracle/
COPY sim/sim_run.py /oracle/
RUN chmod +x /oracle/*

WORKDIR /work
ENTRYPOINT ["/oracle/entry.sh"]

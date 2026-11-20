# Runtime for driving the OFFICIAL EASy68K v5.16.1 Windows binaries (EDIT68K.exe,
# SIM68K.exe) under 32-bit Wine on a virtual X display.
#
# The binaries are NOT part of this image. They are mounted at run time
# (see README.md); nothing proprietary or downloaded is baked in.
FROM debian:bookworm-slim

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
      wine wine32:i386 \
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

COPY scripts/ /oracle/
RUN chmod +x /oracle/*

WORKDIR /work
ENTRYPOINT ["/oracle/entry.sh"]

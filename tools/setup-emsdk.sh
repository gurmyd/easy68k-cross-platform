#!/bin/sh
# `npm run setup:emsdk` on macOS and Linux (ARCHITECTURE.md 7.1, 7.2;
# docs/porting/toolchain.md 2-3): installs the pinned Emscripten into
# <repository>/.toolchain/emsdk. Nothing outside that folder is changed: no
# PATH, profile or system setting ("activate" without --permanent only writes
# .toolchain/emsdk/.emscripten).
#
#     sh tools/setup-emsdk.sh
#
# Needs git and python3 (emsdk's own requirements). Running it again when the
# pinned version is already installed only checks it and exits. The engine
# build scripts find em++ in .toolchain/emsdk by themselves; to use emcc in a
# shell, run `. .toolchain/emsdk/emsdk_env.sh`.
#
# EMSDK_VERSION overrides the pinned version (for trying an update only; the
# pinned version is the one in this file, toolchain.md and the CI cache key).

set -eu

EMSDK_VERSION="${EMSDK_VERSION:-7.0.0}"
EMSDK_REPO="https://github.com/emscripten-core/emsdk.git"

root="$(cd "$(dirname "$0")/.." && pwd)"
emsdk="$root/.toolchain/emsdk"
version_file="$emsdk/upstream/emscripten/emscripten-version.txt"

installed_version() {
  if [ -f "$version_file" ]; then
    # The file holds the version in double quotes, e.g. "7.0.0".
    tr -d '"\r\n ' < "$version_file"
  fi
}

if [ "$(installed_version)" = "$EMSDK_VERSION" ] && [ -x "$emsdk/upstream/emscripten/em++" ]; then
  echo "setup-emsdk: Emscripten $EMSDK_VERSION is already installed in $emsdk"
  exit 0
fi

for tool in git python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "setup-emsdk: $tool is required but was not found on PATH" >&2
    exit 1
  fi
done

mkdir -p "$root/.toolchain"
if [ ! -d "$emsdk/.git" ]; then
  echo "setup-emsdk: cloning $EMSDK_REPO into $emsdk"
  git clone --depth 1 "$EMSDK_REPO" "$emsdk"
else
  echo "setup-emsdk: updating the emsdk checkout in $emsdk"
  git -C "$emsdk" pull --ff-only --depth 1 || echo "setup-emsdk: could not update emsdk; using the existing checkout" >&2
fi

cd "$emsdk"
./emsdk install "$EMSDK_VERSION"
./emsdk activate "$EMSDK_VERSION"

got="$(installed_version)"
if [ "$got" != "$EMSDK_VERSION" ]; then
  echo "setup-emsdk: expected Emscripten $EMSDK_VERSION, found '${got:-nothing}' in $version_file" >&2
  exit 1
fi
"$emsdk/upstream/emscripten/em++" --version | head -n 1
echo "setup-emsdk: Emscripten $EMSDK_VERSION installed in $emsdk"

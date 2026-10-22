#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install --yes --no-install-recommends \
  autoconf automake build-essential gawk libtool nasm pkg-config yasm
sdk="${RUNNER_TEMP:?}/ffmpeg-emsdk"
git clone https://github.com/emscripten-core/emsdk.git "$sdk"
git -C "$sdk" checkout --detach 35ff8a6d150541276abbc6bae512ca90bcfbe220
"$sdk/emsdk" install 6.0.11
"$sdk/emsdk" activate 6.0.11
source "$sdk/emsdk_env.sh"
npx --yes --package=node@24.16.0 --package=pnpm@12.15.0 --call \
  'pnpm install --frozen-lockfile && pnpm check && pnpm test:e2e'

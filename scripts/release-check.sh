#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install --yes --no-install-recommends \
  autoconf automake build-essential gawk libtool nasm pkg-config yasm
npx --yes --package=node@24.22.1 --package=pnpm@12.15.0 --call 'bash -s' <<'CHECK'
set -euo pipefail
export EM_NODE_JS
EM_NODE_JS="$(node -p 'process.execPath')"
sdk="${RUNNER_TEMP:?}/ffmpeg-emsdk"
git clone https://github.com/emscripten-core/emsdk.git "$sdk"
git -C "$sdk" checkout --detach 35ff8a6d150541276abbc6bae512ca90bcfbe220
"$sdk/emsdk" install releases-6.0.11
"$sdk/emsdk" activate releases-6.0.11
source "$sdk/emsdk_env.sh"
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
CHECK

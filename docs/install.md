---
title: Install
description: "Install prerequisites and build the local wasm FFmpeg package."
---

# Install

## Requirements

- Node 24+
- pnpm 10.33+
- Emscripten SDK with `emcc`, `em++`, `emar`, and `emranlib`
- Autotools, `make`, `pkg-config`, `nasm`, and `yasm`
- Native `ffmpeg` for verification fixtures and the playground sample video

On macOS:

```sh
brew install autoconf automake ffmpeg libtool nasm pkg-config yasm
```

## Build

```sh
pnpm install
pnpm build
```

Generated assets are written to `dist/`. Compiled TypeScript entrypoints are written to `lib/`.

## Smoke Check

```sh
pnpm verify
pnpm playground:e2e
```

`pnpm verify` exercises the wasm wrapper against generated media fixtures. `pnpm playground:e2e` launches Chrome, loads the local media playground, renders the sample clip, and writes `.tmp/playground-e2e.png`.

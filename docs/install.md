---
title: Install
description: "Install prerequisites and build the local wasm FFmpeg package."
---

# Install

## Requirements

- Node 24+
- pnpm 12.3.1+
- Emscripten SDK 6.0.1 with `emcc`, `em++`, `emar`, and `emranlib`
- Autotools, `make`, `pkg-config`, `nasm`, and `yasm`

On macOS:

```sh
brew install autoconf automake libtool nasm pkg-config yasm
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

`pnpm verify` exercises the wasm wrapper against generated media fixtures. `pnpm playground:e2e` launches Chrome, loads the local media playground, renders a smaller MP4 and MP3, and writes `.tmp/playground-e2e-server.png`.

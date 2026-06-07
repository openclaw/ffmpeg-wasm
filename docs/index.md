---
title: ffmpeg.sh
permalink: /
description: "Lightweight FFmpeg and FFprobe WebAssembly for local media automation."
---

# ffmpeg.sh

Small, LGPL-friendly FFmpeg and FFprobe WebAssembly for local media automation.

![Media Bench playground](assets/media-bench.png)

## What It Is

`ffmpeg-wasm` builds a narrow FFmpeg core for Node 24+ and wraps it with predictable CLI and TypeScript APIs. It is meant for local tools that need media probing, audio extraction, thumbnails, raw frame output, stream-copy clips, and segmentation without shipping a full native FFmpeg bundle.

## Fast Path

```sh
pnpm install
pnpm build
pnpm playground
```

Then open `http://127.0.0.1:4173`, load a video or the generated sample, pick an operation, render, preview inline, and save the output.

## Feature Docs

- [Install](install.md)
- [Build surface](build-surface.md)
- [TypeScript API](api.md)
- [CLI](cli.md)
- [Media playground](playground.md)
- [Recipes](recipes.md)
- [Licensing](licensing.md)
- [CI and verification](ci.md)
- [Domains](domains.md)

## Project

The wrapper, docs, and scripts are MIT licensed. Generated FFmpeg assets are LGPL-2.1-or-later and copied with their license files during `pnpm build`.

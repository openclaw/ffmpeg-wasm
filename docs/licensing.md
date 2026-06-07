---
title: Licensing
description: "MIT wrapper code, LGPL generated FFmpeg assets."
---

# Licensing

The wrapper, scripts, and documentation in this repository are MIT licensed.

Generated FFmpeg assets in `dist/` are copied from FFmpeg and are LGPL-2.1-or-later. The build does not pass `--enable-gpl` or `--enable-nonfree`.

## Practical Split

Keep these pieces conceptually separate:

- MIT wrapper source, scripts, docs, and TypeScript declarations.
- LGPL FFmpeg wasm, JavaScript loader output, worker output, and copied license files.

## Current Build Choices

The build includes LAME for MP3 output and keeps FFmpeg itself configured without GPL or nonfree flags. Video compression presets that require GPL encoders are intentionally not included.

## Distribution

When packaging this under another scope, keep FFmpeg license files next to the generated assets and make it clear which files are LGPL-covered generated FFmpeg output.

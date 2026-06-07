---
title: CLI
description: "Use ffmpeg-wasm and ffprobe-wasm like local FFmpeg entrypoints."
---

# CLI

The package declares two binaries:

- `ffmpeg-wasm`
- `ffprobe-wasm`

During local development, call the compiled entrypoints directly after `pnpm build`.

## Probe Duration

```sh
node lib/src/ffprobe-cli.js \
  -v error \
  -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 \
  input.mp4
```

## Extract Speech WAV

```sh
node lib/src/cli.js \
  -hide_banner \
  -loglevel error \
  -i input.mp4 \
  -vn \
  -ac 1 \
  -ar 16000 \
  audio.wav
```

## Make a Fast MP4 Clip

```sh
node lib/src/cli.js \
  -hide_banner \
  -loglevel error \
  -ss 0 \
  -i input.mp4 \
  -t 5 \
  -map 0:v:0 \
  -map 0:a? \
  -c copy \
  -movflags +faststart \
  clip.mp4
```

This is a stream-copy clip, not H.264 re-encoding. It stays small and LGPL-friendly by avoiding GPL encoders.

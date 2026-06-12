---
title: Media Playground
description: "Run the local one-page Media Bench editor."
---

# Media Playground

Run:

```sh
pnpm playground
```

Then open `http://127.0.0.1:4173`.

![Media Bench playground](assets/media-bench.png)

The workbench is a ffmpac test surface. It does not use browser-native media encoders as a substitute; static hosting runs the browser ffmpac bundle in a dedicated worker.

## What It Does

- Opens local video or audio files.
- Generates a browser-compatible VP8/Opus WebM sample through the bundled wasm FFmpeg.
- Probes duration, codec, audio, and size.
- Shows FFmpeg args before rendering.
- Renders through this package's wasm wrapper.
- Shows render progress while ffmpac is working.
- Runs without a server backend when hosted with cross-origin isolation headers.
- Offers a smaller-video preset with output width and quality controls.
- Previews video, image, audio, or raw output inline.
- Saves through the browser file picker when available, with a download fallback.
- Uses the source video's scrubber as a poster-frame picker when you seek.

## Presets

- Lossless MP4 clip.
- Smaller MP4 video.
- Poster PNG.
- MP3 extract.
- WAV extract.
- 32 x 32 grayscale raw frame.

`MP3 extract` is a normal ffmpac render path using the bundled LAME encoder.

`Smaller MP4 video` downscales with FFmpeg's built-in MPEG-4 encoder compiled to wasm. The quality menu maps to `-q:v`, where Small uses a higher quantizer and High uses a lower quantizer.

## Local Safety

The playground server binds to `127.0.0.1` and protects render APIs with a per-server request token embedded into the served page. Cross-origin pages cannot trigger uploads or FFmpeg work without that token.

The browser client and ffmpac worker are written in TypeScript and compiled by `pnpm compile`, so `tsgo`, `oxlint`, and `oxfmt` cover the workbench code.

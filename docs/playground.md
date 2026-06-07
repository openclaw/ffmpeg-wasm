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

## What It Does

- Opens local video or audio files.
- Generates a sample MP4 when native `ffmpeg` is installed.
- Probes duration, codec, audio, and size.
- Shows FFmpeg args before rendering.
- Renders through this package's wasm wrapper when the local backend supports the operation.
- Offers a smaller-video preset with output width and quality controls.
- Previews video, image, audio, or raw output inline.
- Saves through the browser file picker when available, with a download fallback.
- Uses the source video's scrubber as a poster-frame picker when you seek.

## Presets

- Lossless MP4 clip.
- Smaller WebM video.
- Poster PNG.
- MP3 extract.
- WAV extract.
- 32 x 32 grayscale raw frame.

`MP3 extract` is selectable everywhere so you can build or copy the command. Rendering MP3 needs the local `pnpm playground` backend because browsers do not provide MP3 encoding through the workbench fallback path.

`Smaller WebM video` uses the browser preview renderer in this build. The generated command shows the equivalent desktop FFmpeg shape for a VP9 WebM downscale, while the current lightweight wasm bundle avoids shipping a video encoder.

## Local Safety

The playground server binds to `127.0.0.1` and protects render APIs with a per-server request token embedded into the served page. Cross-origin pages cannot trigger uploads or FFmpeg work without that token.

The browser client is written in TypeScript and compiled by `pnpm compile`, so `tsgo`, `oxlint`, and `oxfmt` cover the workbench code.

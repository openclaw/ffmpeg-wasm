---
title: Build Surface
description: "Enabled FFmpeg codecs, muxers, demuxers, protocols, and filters."
---

# Build Surface

The build intentionally starts from `--disable-all` and enables only the pieces needed by the wrapper and playground.

## Programs

- `ffmpeg`
- `ffprobe`

## Input Devices

- `lavfi` for wasm-only fixture and sample generation

## Protocols

- `data`
- `fd`
- `file`
- `pipe`

## Demuxers

- `aac`
- `flac`
- `hls`
- `image2`
- `matroska`
- `mov`
- `mp3`
- `mpegts`
- `ogg`
- `wav`

## Muxers

- `image2`
- `mov`
- `mp4`
- `mp3`
- `null`
- `rawvideo`
- `segment`
- `wav`
- `webm`

## Decoders

- `aac`
- `flac`
- `h263`
- `h264`
- `hevc`
- `mpeg4`
- `mjpeg`
- `mp3`
- `opus`
- `pcm_s16le`
- `png`
- `vorbis`
- `vp8`
- `vp9`
- `wrapped_avframe`

## Encoders

- `libmp3lame`
- `libvpx` (VP8)
- `h263`
- `mpeg4`
- `opus`
- `pcm_s16le`
- `png`
- `rawvideo`
- `wrapped_avframe`

## Filters

- `aformat`
- `aresample`
- `format`
- `metadata`
- `null`
- `scale`
- `select`
- `showinfo`
- `signalstats`
- `sine`
- `testsrc2`

## External Libraries

- `libmp3lame`
- `libvpx`
- `zlib`

## Size Rule

Only add a codec, muxer, demuxer, filter, or protocol when a real caller needs it. Every build-surface expansion should add a matching proof in `scripts/verify.ts`.

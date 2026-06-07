---
title: Build Surface
description: "Enabled FFmpeg codecs, muxers, demuxers, protocols, and filters."
---

# Build Surface

The build intentionally starts from `--disable-all` and enables only the pieces needed by the wrapper and playground.

## Programs

- `ffmpeg`
- `ffprobe`

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

## Decoders

- `aac`
- `flac`
- `h264`
- `hevc`
- `mjpeg`
- `mp3`
- `opus`
- `pcm_s16le`
- `png`
- `vorbis`
- `vp8`
- `vp9`

## Encoders

- `libmp3lame`
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

## Size Rule

Only add a codec, muxer, demuxer, filter, or protocol when a real caller needs it. Every build-surface expansion should add a matching proof in `scripts/verify.ts`.

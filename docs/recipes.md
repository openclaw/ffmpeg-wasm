---
title: Recipes
description: "Common media tasks supported by the lightweight wasm build."
---

# Recipes

## Probe JSON Streams

```sh
ffprobe-wasm -v quiet -print_format json -show_format -show_streams input.mp4
```

## Extract MP3 Audio

```sh
ffmpeg-wasm -hide_banner -loglevel error -i input.mp4 -vn -b:a 128k audio.mp3
```

## Extract Speech-Friendly WAV

```sh
ffmpeg-wasm -hide_banner -loglevel error -i input.mp4 -vn -ac 1 -ar 16000 -sample_fmt s16 audio.wav
```

## Create a Poster Frame

```sh
ffmpeg-wasm -hide_banner -loglevel error -ss 1 -i input.mp4 -frames:v 1 -vf scale=1280:-2 poster.png
```

## Emit a Tiny Raw Frame Hash Input

```sh
ffmpeg-wasm -hide_banner -loglevel error -ss 1 -i input.mp4 -frames:v 1 -vf scale=32:32,format=gray -f rawvideo -pix_fmt gray frame.raw
```

## Segment Audio

```sh
ffmpeg-wasm -hide_banner -loglevel error -i input.mp4 -vn -f segment -segment_time 30 audio-%03d.mp3
```

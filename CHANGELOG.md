# Changelog

## 0.1.0 - 2026-09-05

**Highlights:** Lightweight FFmpeg and FFprobe WebAssembly for Node 24+, with CLI and TypeScript APIs plus the browser-only media workbench at `ffmpeg.sh`.

- Inspect media, extract WAV or MP3 audio, resize MP4 video, create PNG thumbnails, stream raw video, and segment audio without a native FFmpeg installation.
- Edit and preview media locally in the `ffmpeg.sh` workbench: sample loading, editable FFmpeg commands, size and quality presets, MP3 output, poster-frame selection, render progress, and browser save/download support.
- Run uploads, probing, and MP4/MP3 rendering in a dedicated browser ffmpac worker, with no server backend required for the static workbench.
- Use CLI-compatible `ffmpeg-wasm` and `ffprobe-wasm` entrypoints, binary-safe buffered APIs (`runFfmpeg`, `runFfprobe`), and streaming APIs (`execFfmpeg`, `execFfprobe`).
- Configure asset directories, working directories, environment, stdin, and timeouts; support stdin/stdout pipes and automatic FFmpeg `-nostdin` without breaking explicit pipe input.
- Keep host signal handling under application control when using the library, with exception-safe `onSpawn` setup and conventional child signal exit codes; preserve SIGHUP/SIGINT/SIGTERM forwarding and forced termination in both CLIs. Thanks @SebTardif.
- Handle closed stdin, stdout, and stderr pipes without unhandled EPIPE crashes, including output piped to short-lived consumers. Thanks @SebTardif.
- Validate browser-issued media URLs and keep unexpected playground server error details in server logs. Thanks @vincentkoc.
- Build narrow FFmpeg `n9.0.1` and libvpx `v1.17.0` assets with pinned LAME and Emscripten `6.0.1`, supporting MPEG-4, MP3, VP8/Opus WebM, and lossless MP4/MOV stream-copy clips with faststart metadata.
- Keep wrapper code MIT licensed and generated FFmpeg assets LGPL-2.1-or-later, copy generated license files alongside wasm assets, and avoid GPL/nonfree build options.
- Provide build, CLI, API, licensing, and downstream integration documentation, a local playground, and static workbench/docs deployment with the cross-origin isolation headers required by browser wasm.
- Verify generated media entirely through wasm, including API/CLI conversions, codec and dimension assertions, pipes, PNG frames, raw byte equality, segmentation, failures, real OS signals, and Chrome-driven server/static browser rendering; publish CI proof artifacts and audit distributions for native executables.
- Refresh TypeScript, pnpm, Node types, formatting, deployment tooling, and pinned GitHub Actions while retaining the Node 24 runtime floor, 48-hour package release delay, and disabled dependency build scripts. Thanks @vincentkoc.

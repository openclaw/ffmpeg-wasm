# Changelog

## 0.1.0 - Unreleased

### Added

- Added lightweight Node-focused FFmpeg and FFprobe WebAssembly package with a reproducible Emscripten build.
- Added narrow LGPL FFmpeg build based on FFmpeg `n8.1.1`, with no GPL or nonfree configure flags.
- Added static LAME integration for MP3 output while keeping generated FFmpeg assets under LGPL terms.
- Added CLI-compatible `ffmpeg-wasm` and `ffprobe-wasm` package binaries.
- Added TypeScript APIs for buffered runs and streaming execution: `runFfmpeg`, `runFfprobe`, `execFfmpeg`, and `execFfprobe`.
- Added runtime options for custom `distDir`, `cwd`, `env`, `stdin`, `stdinMode`, and `timeoutMs`.
- Added automatic `-nostdin` handling for FFmpeg while preserving explicit stdin pipe workflows.
- Added media support for inspection, audio extraction, thumbnails, rawvideo pipe output, stdin/stdout pipe I/O, and segmentation.
- Added MP4/MOV muxer support for lossless stream-copy clips with faststart metadata.
- Added local one-page media playground with source preview, preset builder, generated FFmpeg args, inline output preview, and browser save/download flow.
- Added public `ffmpeg.sh` workbench root with editable FFmpeg command text, GitHub and docs actions, sample loading, and inline output previews.
- Added browser ffmpac runtime for the static workbench, using a dedicated worker so uploads, probing, MP4 renders, and MP3 renders run without a server backend.
- Added ffmpac-backed workbench video downscale controls with width and quality presets, selectable MP3 rendering, and source-video seek syncing for poster-frame selection.
- Added Chrome-driven playground E2E smoke test that loads the sample video, renders a smaller MP4 and MP3, and writes a screenshot artifact.
- Added static browser workbench E2E coverage that blocks `/api/*` and verifies browser-only ffmpac MP4 and MP3 rendering.
- Added GitHub Pages documentation source, static site builder, `ffmpeg.sh` CNAME, feature docs, and README playground screenshot.
- Added `ffmpeg.sh`, `www.ffmpeg.sh`, and `docs.ffmpeg.sh` Cloudflare Pages domain routing with host canonicalization.
- Added enabled codecs, demuxers, muxers, filters, protocols, and external libraries tuned for a small local media toolchain, including native MPEG-4 video encoding for lightweight MP4 downscales.
- Added generated license copying so FFmpeg license files ship next to generated wasm assets in `dist/`.
- Added README guidance for the MIT wrapper code and LGPL generated FFmpeg assets.
- Added README usage docs for build prerequisites, CLI commands, TypeScript APIs, package linking, build tuning, and downstream wrapper wiring.
- Added strict TypeScript project setup using `tsgo`, `oxlint`, and `oxfmt`.
- Added TypeScript workbench client compilation so browser code is covered by `tsgo`, `oxlint`, and `oxfmt`.
- Added strict oxlint policy with type-aware rules and warning denial.
- Added live verification harness covering FFprobe text and JSON output, WAV and MP3 extraction, stdin pipes, stdout pipes, PNG frame output, rawvideo byte equality, segmentation, cwd and dist overrides, API validation failures, and CLI success and failure paths.
- Added `pnpm test:e2e` to rebuild wasm assets from source and run the live verifier.
- Added GitHub Actions CI for quality checks and full live wasm E2E on Node 24 with Emscripten, build caching, and `dist` artifact upload.
- Added Cloudflare Pages deployment workflow so the static workbench ships with the COOP/COEP headers required by browser ffmpac.
- Verified current generated `dist/` size at about 8.1 MB.

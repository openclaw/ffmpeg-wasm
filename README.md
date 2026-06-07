# ffmpeg-wasm local

[![CI](https://github.com/openclaw/ffmpeg-wasm/actions/workflows/ci.yml/badge.svg)](https://github.com/openclaw/ffmpeg-wasm/actions/workflows/ci.yml)

Lightweight FFmpeg and FFprobe for Node, built as modern WebAssembly for local media automation.

This repository is intentionally small in scope: one reproducible Emscripten build, one TypeScript wrapper, and enough codecs/protocols for media inspection, audio extraction, thumbnails, pipe I/O, and segmentation.

## Why

Many media workflows need predictable FFmpeg and FFprobe behavior without carrying a full native FFmpeg bundle. This package builds a narrow LGPL FFmpeg wasm core and exposes it through:

- `ffmpeg-wasm`, a CLI-compatible FFmpeg entrypoint.
- `ffprobe-wasm`, a CLI-compatible FFprobe entrypoint.
- TypeScript APIs for binary-safe buffered or streaming execution.

## License

The wrapper, scripts, and documentation in this repository are MIT licensed.

Generated FFmpeg assets in `dist/` are copied from FFmpeg and are LGPL-2.1-or-later. The build does not pass `--enable-gpl` or `--enable-nonfree`. FFmpeg license files are copied into `dist/` during `pnpm build`.

Keep wrapper code and generated FFmpeg binaries conceptually separate when this moves under OpenClaw packaging. A downstream package can stay MIT for the wrapper while distributing the FFmpeg wasm artifacts under the LGPL terms that apply to FFmpeg.

## Build Surface

Default refs:

- FFmpeg: `n8.1.1`
- LAME: `master` from `ffmpegwasm/lame`
- Runtime: Node 24+
- Compiler: Emscripten via `emcc`

Enabled programs:

- `ffmpeg`
- `ffprobe`

Enabled protocols:

- `data`
- `fd`
- `file`
- `pipe`

Enabled demuxers:

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

Enabled muxers:

- `image2`
- `mp3`
- `null`
- `rawvideo`
- `segment`
- `wav`

Enabled decoders:

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

Enabled encoders:

- `libmp3lame`
- `pcm_s16le`
- `png`
- `rawvideo`
- `wrapped_avframe`

Enabled filters:

- `aformat`
- `aresample`
- `format`
- `metadata`
- `null`
- `scale`
- `select`
- `showinfo`
- `signalstats`

External libraries:

- `libmp3lame`
- `zlib`

The verified `dist/` size is about 7-8 MB on current builds.

## Install

```sh
pnpm install
```

Required system tools for a full wasm build:

- Emscripten SDK with `emcc`, `em++`, `emar`, and `emranlib` on `PATH`
- Autotools for LAME
- `make`, `pkg-config`, `nasm`, `yasm`
- Native `ffmpeg` for `pnpm verify`

On macOS:

```sh
brew install autoconf automake ffmpeg libtool nasm pkg-config yasm
```

## Commands

```sh
pnpm build
pnpm verify
pnpm test:e2e
pnpm check
```

`pnpm build` compiles TypeScript, fetches the configured FFmpeg/LAME refs into `.cache/`, builds static LAME, builds FFmpeg/FFprobe wasm, and writes generated assets to `dist/`.

`pnpm verify` creates a tiny native test video, then exercises FFprobe text and JSON output, WAV/MP3 extraction, stdin pipe input, stdout pipe output, PNG frame output, rawvideo byte equality, segmentation, cwd/dist overrides, API validation failures, and CLI success/failure paths.

`pnpm test:e2e` rebuilds the wasm assets from source, then runs the same live verifier against the generated FFmpeg/FFprobe wrappers.

`pnpm check` runs `tsgo`, strict `oxlint`, and `oxfmt --check`.

## CLI

After `pnpm build`, use the compiled entrypoints directly:

```sh
node lib/src/ffprobe-cli.js -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 input.mp4
node lib/src/cli.js -hide_banner -loglevel error -i input.mp4 -vn -ac 1 -ar 16000 audio.wav
node lib/src/ffprobe-cli.js -v error -show_format input.mp4
node lib/src/cli.js -hide_banner -i input.mp4 -frames:v 1 frame.png
```

The package also declares `ffmpeg-wasm` and `ffprobe-wasm` bin entries for downstream package-manager linking.

## TypeScript API

```ts
import { execFfmpeg, runFfmpeg, runFfprobe } from "@steipete/ffmpeg-wasm-local";

const probe = await runFfprobe([
  "-v",
  "error",
  "-show_entries",
  "format=duration",
  "-of",
  "default=noprint_wrappers=1:nokey=1",
  "input.mp4",
]);

if (probe.exitCode !== 0) throw new Error(probe.stderrText);

const wav = await runFfmpeg([
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  "input.mp4",
  "-vn",
  "-ac",
  "1",
  "-ar",
  "16000",
  "-f",
  "wav",
  "-",
]);

await execFfmpeg(["-hide_banner", "-i", "input.mp4", "audio.mp3"]);
```

`runFfmpeg` and `runFfprobe` buffer stdout/stderr and return `Buffer` fields plus UTF-8 text helpers. Use these for probes, small generated files, and tests.

`execFfmpeg` and `execFfprobe` stream stdio and return only the exit code. Use these for CLI-style work or larger outputs.

Both APIs accept:

- `distDir` to point at a custom generated asset directory.
- `cwd` and `env` for process isolation.
- `stdin` for pipe input.
- `timeoutMs` for opt-in time limits.

`ffmpeg` receives `-nostdin` automatically unless the caller already supplied it. Explicit `-i -` stdin input still works through the wrapper.

## Summarize Wiring

Build once:

```sh
pnpm build
```

Then point Summarize at the compiled wrappers:

```sh
FFMPEG_PATH="$PWD/lib/src/cli.js" \
FFPROBE_PATH="$PWD/lib/src/ffprobe-cli.js" \
summarize ...
```

For direct package usage, import the TypeScript API and keep `dist/` next to the compiled `lib/` tree.

## Build Tuning

Override source refs per build:

```sh
FFMPEG_VERSION=n8.1.1 LAME_REF=master pnpm build
```

To keep the binary small, only add codecs, demuxers, muxers, filters, or protocols when a real caller needs them. Prefer adding one capability and extending `scripts/verify.ts` with a matching proof.

Useful places:

- `scripts/build.ts`: configure flags and Emscripten linker flags.
- `scripts/verify.ts`: behavioral coverage for the generated wasm.
- `.oxlintrc.json`: strict lint policy.

## CI

GitHub Actions runs two jobs:

- TypeScript, lint, and format on Node 24.
- Full live wasm E2E with Emscripten, build caching, and `dist/` artifact upload.

CI intentionally builds from source instead of trusting checked-in wasm output. `dist/` is ignored and regenerated.

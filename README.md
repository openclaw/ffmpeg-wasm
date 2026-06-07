# ffmpeg-wasm local

[![CI](https://github.com/openclaw/ffmpeg-wasm/actions/workflows/ci.yml/badge.svg)](https://github.com/openclaw/ffmpeg-wasm/actions/workflows/ci.yml)

Lightweight local FFmpeg/FFprobe WebAssembly build for `../summarize`.

The JS wrapper in this repository is MIT licensed. The generated FFmpeg core
assets in `dist/` are LGPL-2.1-or-later and are built without `--enable-gpl` or
`--enable-nonfree`.

```sh
pnpm install
pnpm build
pnpm verify
pnpm check
```

Use with Summarize:

```sh
FFMPEG_PATH="$PWD/lib/src/cli.js" FFPROBE_PATH="$PWD/lib/src/ffprobe-cli.js" summarize ...
```

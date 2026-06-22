---
title: TypeScript API
description: "Use runFfmpeg, runFfprobe, execFfmpeg, and execFfprobe."
---

# TypeScript API

Import the wrapper APIs from the package root:

```ts
import { execFfmpeg, execFfprobe, runFfmpeg, runFfprobe } from "@steipete/ffmpeg-wasm-local";
```

## Buffered Runs

Use `runFfmpeg` and `runFfprobe` when stdout and stderr should be buffered.

```ts
const probe = await runFfprobe([
	"-v",
	"error",
	"-show_entries",
	"format=duration",
	"-of",
	"default=noprint_wrappers=1:nokey=1",
	"input.mp4",
]);

if (probe.exitCode !== 0) {
	throw new Error(probe.stderrText);
}
```

The result includes `stdout`, `stderr`, `stdoutText`, `stderrText`, and `exitCode`.

## Streaming Runs

Use `execFfmpeg` and `execFfprobe` for CLI-like execution.

```ts
const result = await execFfmpeg([
	"-hide_banner",
	"-i",
	"input.mp4",
	"-vn",
	"-ac",
	"1",
	"-ar",
	"16000",
	"audio.wav",
]);

if (result.exitCode !== 0) {
	throw new Error("ffmpeg failed");
}
```

## Options

All APIs accept:

- `distDir` for a custom wasm asset directory.
- `cwd` and `env` for process isolation.
- `stdin` for pipe input.
- `stdinMode` for binary or text input.
- `timeoutMs` for bounded work.

FFmpeg receives `-nostdin` automatically unless the caller already supplies it. Explicit `-i -` pipe workflows still work.

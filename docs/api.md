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
const exitCode = await execFfmpeg([
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

if (exitCode !== 0) {
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
- `onSpawn` for synchronous setup of the spawned child. Throwing from this callback kills the child and rejects the run. The package CLIs use this to forward host signals.

FFmpeg receives `-nostdin` automatically unless the caller already supplies it. Explicit `-i -` pipe workflows still work.

## Signals and cancellation

Library calls leave host `SIGHUP`, `SIGINT`, and `SIGTERM` handling to your application. Earlier streaming calls installed signal handlers that could exit the host; this is now limited to the `ffmpeg-wasm` and `ffprobe-wasm` CLIs. The CLIs still forward those signals and force termination after five seconds if the child is stuck.

If your application relied on automatic forwarding, own cancellation explicitly and remove your listeners when the call settles. For example:

```ts
import type { ChildProcess } from "node:child_process";
import { execFfmpeg } from "@steipete/ffmpeg-wasm-local";

let child: ChildProcess | undefined;
const cancel = () => {
  child?.kill("SIGKILL");
};
process.once("SIGTERM", cancel);
try {
  const exitCode = await execFfmpeg(["-i", "input.mp4", "audio.mp3"], {
    onSpawn(spawned) {
      child = spawned;
    },
    timeoutMs: 60_000,
  });
  if (exitCode !== 0) throw new Error(`FFmpeg exited with ${exitCode}`);
} finally {
  process.off("SIGTERM", cancel);
}
```

This example force-stops only the child; the application decides whether and when to exit. For graceful cancellation, send `SIGTERM` first and manage an escalation deadline. `timeoutMs` also terminates the child and rejects without exiting the host.

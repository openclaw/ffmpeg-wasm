#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFfmpeg, runFfmpeg, runFfprobe, type RunResult } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-verify-"));

try {
  const input = join(work, "input.mp4");
  const wav = join(work, "audio.wav");
  const mp3 = join(work, "audio.mp3");
  const png = join(work, "frame.png");
  const raw = join(work, "hash.raw");
  const segments = join(work, "part-%03d.wav");
  const mp3Segments = join(work, "mp3-part-%03d.mp3");

  native("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=10:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    input,
  ]);

  await step("ffprobe duration", () => okProbe(input));
  await step("wav transcode", () =>
    okFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-sample_fmt",
      "s16",
      wav,
    ]),
  );
  await step("mp3 transcode", () =>
    okFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      mp3,
    ]),
  );
  await step("API wav stdin pipe", () => okWavStdin(wav));
  await step("exec wav stdin pipe", () => okExecWavStdin(wav));
  await step("CLI wav stdin pipe", () => okCliWavStdin(wav));
  await step("png frame", () =>
    okFfmpeg([
      "-hide_banner",
      "-ss",
      "0.5",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      "signalstats,showinfo,metadata=print",
      "-update",
      "1",
      png,
    ]),
  );
  await step("raw gray frame", () =>
    okFfmpeg([
      "-hide_banner",
      "-ss",
      "0.5",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      "scale=32:32,format=gray",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      raw,
    ]),
  );
  await step("null stdout pipe", () =>
    okFfmpeg(["-hide_banner", "-loglevel", "error", "-i", input, "-an", "-f", "null", "-"]),
  );
  await step("raw gray stdout pipe", () => okRawStdout(input, raw));
  await step("raw gray CLI stdout pipe", () => okRawCliStdout(input, raw));
  await step("wav segment", () =>
    okFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "segment",
      "-segment_time",
      "1",
      "-reset_timestamps",
      "1",
      segments,
    ]),
  );
  await step("mp3 segment", () =>
    okFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "segment",
      "-segment_time",
      "1",
      "-reset_timestamps",
      "1",
      mp3Segments,
    ]),
  );

  assertFile(wav, 1024, "wav transcode");
  assertFile(mp3, 1024, "mp3 transcode");
  assertFile(png, 1024, "png frame");
  assertFile(raw, 1024, "raw hash frame");
  assertFile(join(work, "part-000.wav"), 1024, "segment 0");
  assertFile(join(work, "mp3-part-000.mp3"), 1024, "mp3 segment 0");

  const size = native("du", ["-sh", join(root, "dist")]).stdout.trim();
  console.log(`verify ok (${size})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

async function okProbe(input: string) {
  const result = await runFfprobe(
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      input,
    ],
    { timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) fail("ffprobe", result);
  const duration = Number(result.stdoutText.trim());
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error(`bad duration: ${result.stdoutText}`);
}

async function okFfmpeg(args: string[]) {
  const result = await runFfmpeg(args, { timeoutMs: 30_000 });
  if (result.exitCode !== 0) fail(`ffmpeg ${args.join(" ")}`, result);
}

async function okWavStdin(wav: string) {
  const result = await runFfmpeg(wavStdinArgs(), {
    stdin: readFileSync(wav),
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) fail("ffmpeg wav stdin", result);
}

async function okExecWavStdin(wav: string) {
  const exitCode = await execFfmpeg(wavStdinArgs(), {
    stdin: readFileSync(wav),
    timeoutMs: 30_000,
  });
  if (exitCode !== 0) throw new Error(`ffmpeg exec wav stdin failed: ${exitCode}`);
}

function okCliWavStdin(wav: string) {
  const result = spawnSync(process.execPath, [resolve(root, "lib/src/cli.js"), ...wavStdinArgs()], {
    input: readFileSync(wav),
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg CLI wav stdin failed: ${result.stderr || result.stdout}`);
  }
}

async function okRawStdout(input: string, expectedPath: string) {
  const result = await runFfmpeg(rawStdoutArgs(input), { timeoutMs: 30_000 });
  if (result.exitCode !== 0) fail("ffmpeg raw stdout", result);
  if (result.stdout.byteLength !== 1024)
    throw new Error(`raw stdout size mismatch: ${result.stdout.byteLength}`);
  assertSameBytes(result.stdout, readFileSync(expectedPath), "raw stdout bytes");
}

async function okRawCliStdout(input: string, expectedPath: string) {
  const result = spawnSync(process.execPath, [
    resolve(root, "lib/src/cli.js"),
    ...rawStdoutArgs(input),
  ]);
  if (result.status !== 0) {
    throw new Error(`ffmpeg CLI raw stdout failed: ${result.stderr || result.stdout}`);
  }
  if (result.stdout.byteLength !== 1024)
    throw new Error(`CLI raw stdout size mismatch: ${result.stdout.byteLength}`);
  assertSameBytes(result.stdout, readFileSync(expectedPath), "CLI raw stdout bytes");
}

function wavStdinArgs() {
  return ["-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "-", "-vn", "-f", "null", "-"];
}

function rawStdoutArgs(input: string) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    "0.5",
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    "scale=32:32,format=gray",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "-",
  ];
}

async function step(label: string, fn: () => Promise<void> | void) {
  process.stderr.write(`verify: ${label}\n`);
  await fn();
}

function assertFile(path: string, minBytes: number, label: string) {
  const bytes = readFileSync(path);
  if (bytes.byteLength < minBytes) throw new Error(`${label} too small: ${bytes.byteLength}`);
}

function assertSameBytes(actual: Buffer, expected: Buffer, label: string) {
  if (!actual.equals(expected)) throw new Error(`${label} mismatch`);
}

function native(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function fail(label: string, result: RunResult): never {
  writeFileSync(join(work, "last-stderr.txt"), result.stderr);
  throw new Error(`${label} failed (${result.exitCode}): ${result.stderrText}`);
}

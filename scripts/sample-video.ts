import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runFfmpeg } from "../src/index.js";

export interface SampleVideoOptions {
  durationSeconds?: number;
  format?: "mp4" | "webm";
  frameRate?: number;
  height?: number;
  timeoutMs?: number;
  width?: number;
}

const codecArgs = {
  mp4: [
    "-c:v",
    "mpeg4",
    "-q:v",
    "5",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
  ],
  webm: [
    "-c:v",
    "libvpx",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-b:v",
    "900k",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "opus",
    "-strict",
    "experimental",
    "-b:a",
    "96k",
  ],
} satisfies Record<NonNullable<SampleVideoOptions["format"]>, string[]>;

export async function generateSampleVideo(
  outputPath: string,
  options: SampleVideoOptions = {},
): Promise<void> {
  const durationSeconds = options.durationSeconds ?? 8;
  const format = options.format ?? "mp4";
  const frameRate = options.frameRate ?? 24;
  const height = options.height ?? 540;
  const width = options.width ?? 960;
  mkdirSync(dirname(outputPath), { recursive: true });

  const result = await runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${width}x${height}:rate=${frameRate}:duration=${durationSeconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=44100:duration=${durationSeconds}`,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      ...codecArgs[format],
      "-shortest",
      outputPath,
    ],
    {
      env: { ...process.env, PATH: "" },
      timeoutMs: options.timeoutMs ?? 180_000,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderrText || "WASM sample video generation failed");
  }
  if (!existsSync(outputPath)) {
    throw new Error(`WASM sample video generation produced no output: ${outputPath}`);
  }
}

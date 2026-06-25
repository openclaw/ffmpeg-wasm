#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runFfmpeg, runFfprobe } from "../src/index.js";
import { generateSampleVideo } from "./sample-video.js";

const root = resolve(import.meta.dirname, "..", "..");
const compiledPlaygroundDir = resolve(root, "lib", "playground");
const playgroundDir = resolve(root, "playground");
const scratchRoot = resolve(root, ".tmp", "playground");
const sampleVideoPath = resolve(scratchRoot, "sample-wasm.webm");
const port = parsePort(process.env.FFMPEG_WASM_PLAYGROUND_PORT ?? process.env.PORT);
const maxUploadBytes = 2 * 1024 * 1024 * 1024;
const requestToken = randomBytes(24).toString("base64url");
let sampleGeneration: Promise<void> | undefined;

const operations = [
  "clip-mp4",
  "video-mp4",
  "poster-png",
  "audio-mp3",
  "audio-wav",
  "hash-raw",
] as const;
type Operation = (typeof operations)[number];

interface OutputPlan {
  args: string[];
  fileName: string;
  mimeType: string;
  outputPath: string;
}

mkdirSync(scratchRoot, { recursive: true });

const server = createServer((request, response) => {
  // oxlint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- Node HTTP request handlers are callback based.
  handleRequest(request, response).catch((error: unknown) => {
    sendError(response, error);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ffmpeg-wasm playground: http://127.0.0.1:${port}`);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  assertLoopbackHost(request);
  if (request.method === "GET" && url.pathname === "/") {
    sendIndex(response);
    return;
  }
  if (request.method === "GET" && (url.pathname === "/docs" || url.pathname === "/docs/")) {
    response.writeHead(302, { Location: "https://ffmpeg.sh/docs/" });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/app.js") {
    await sendStatic(response, "app.js", "text/javascript; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/app.js.map") {
    await sendStatic(response, "app.js.map", "application/json; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/styles.css") {
    await sendStatic(response, "styles.css", "text/css; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sample") {
    assertPlaygroundApiRequest(request);
    await ensureSampleVideo();
    await sendFile(response, sampleVideoPath, {
      "Content-Disposition": `inline; filename="${basename(sampleVideoPath)}"`,
      "Content-Type": "video/webm",
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/probe") {
    assertPlaygroundApiRequest(request);
    await handleProbe(request, response);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/render") {
    assertPlaygroundApiRequest(request);
    await handleRender(request, response, url);
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

async function handleProbe(request: IncomingMessage, response: ServerResponse) {
  await withInputFile(request, async (inputPath) => {
    const result = await runFfprobe(
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", inputPath],
      { timeoutMs: 30_000 },
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderrText || "ffprobe failed");
    }
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(result.stdoutText);
  });
}

async function handleRender(request: IncomingMessage, response: ServerResponse, url: URL) {
  await withInputFile(request, async (inputPath, jobDir) => {
    const operation = parseOperation(url.searchParams.get("op"));
    const plan = buildOutputPlan(operation, inputPath, jobDir, url.searchParams);
    const result = await runFfmpeg(plan.args, { timeoutMs: 120_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderrText || "ffmpeg failed");
    }
    const outputBytes = statSync(plan.outputPath).size;
    await sendFile(response, plan.outputPath, {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${plan.fileName}"`,
      "Content-Type": plan.mimeType,
      "X-Ffmpeg-Args": JSON.stringify(plan.args),
      "X-Output-Bytes": String(outputBytes),
      "X-Output-Name": plan.fileName,
    });
  });
}

function buildOutputPlan(
  operation: Operation,
  inputPath: string,
  jobDir: string,
  params: URLSearchParams,
): OutputPlan {
  switch (operation) {
    case "clip-mp4": {
      return buildClipPlan(inputPath, jobDir, params);
    }
    case "video-mp4": {
      return buildVideoPlan(inputPath, jobDir, params);
    }
    case "poster-png": {
      return buildPosterPlan(inputPath, jobDir, params);
    }
    case "audio-mp3": {
      return buildMp3Plan(inputPath, jobDir, params);
    }
    case "audio-wav": {
      return buildWavPlan(inputPath, jobDir, params);
    }
    case "hash-raw": {
      return buildHashPlan(inputPath, jobDir, params);
    }
    default: {
      throw new Error("Unsupported operation");
    }
  }
}

function buildClipPlan(inputPath: string, jobDir: string, params: URLSearchParams): OutputPlan {
  const outputPath = join(jobDir, "clip.mp4");
  const start = numberParam(params, "start", 0, 0, 86_400);
  const duration = numberParam(params, "duration", 5, 0.2, 86_400);
  return {
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      formatSeconds(start),
      "-i",
      inputPath,
      "-t",
      formatSeconds(duration),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    fileName: "clip.mp4",
    mimeType: "video/mp4",
    outputPath,
  };
}

function buildVideoPlan(inputPath: string, jobDir: string, params: URLSearchParams): OutputPlan {
  const outputPath = join(jobDir, "smaller.mp4");
  const start = numberParam(params, "start", 0, 0, 86_400);
  const duration = numberParam(params, "duration", 5, 0.2, 86_400);
  const width = integerParam(params, "width", 1280, 128, 3840);
  const quality = choiceParam(params, "quality", ["small", "balanced", "high"], "balanced");
  return {
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      formatSeconds(start),
      "-i",
      inputPath,
      "-t",
      formatSeconds(duration),
      "-vf",
      `scale=${width}:-2,format=yuv420p`,
      "-c:v",
      "mpeg4",
      "-q:v",
      videoQuality(quality),
      "-an",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    fileName: "smaller.mp4",
    mimeType: "video/mp4",
    outputPath,
  };
}

function buildPosterPlan(inputPath: string, jobDir: string, params: URLSearchParams): OutputPlan {
  const outputPath = join(jobDir, "poster.png");
  const frameTime = numberParam(params, "frameTime", 1, 0, 86_400);
  const width = integerParam(params, "width", 1280, 128, 3840);
  return {
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      formatSeconds(frameTime),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:-2`,
      "-update",
      "1",
      outputPath,
    ],
    fileName: "poster.png",
    mimeType: "image/png",
    outputPath,
  };
}

function buildMp3Plan(inputPath: string, jobDir: string, params: URLSearchParams): OutputPlan {
  const outputPath = join(jobDir, "audio.mp3");
  const bitrate = choiceParam(params, "audioBitrate", ["48k", "96k", "128k", "192k"], "128k");
  const sampleRate = choiceParam(
    params,
    "sampleRate",
    ["16000", "24000", "44100", "48000"],
    "44100",
  );
  const channels = choiceParam(params, "channels", ["1", "2"], "2");
  return {
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      channels,
      "-ar",
      sampleRate,
      "-b:a",
      bitrate,
      outputPath,
    ],
    fileName: "audio.mp3",
    mimeType: "audio/mpeg",
    outputPath,
  };
}

function buildWavPlan(inputPath: string, jobDir: string, params: URLSearchParams): OutputPlan {
  const outputPath = join(jobDir, "audio.wav");
  const sampleRate = choiceParam(
    params,
    "sampleRate",
    ["16000", "24000", "44100", "48000"],
    "16000",
  );
  const channels = choiceParam(params, "channels", ["1", "2"], "1");
  return {
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      channels,
      "-ar",
      sampleRate,
      "-sample_fmt",
      "s16",
      outputPath,
    ],
    fileName: "audio.wav",
    mimeType: "audio/wav",
    outputPath,
  };
}

function buildHashPlan(inputPath: string, jobDir: string, params: URLSearchParams): OutputPlan {
  const outputPath = join(jobDir, "frame-gray.raw");
  const frameTime = numberParam(params, "frameTime", 1, 0, 86_400);
  return {
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      formatSeconds(frameTime),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=32:32,format=gray",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      outputPath,
    ],
    fileName: "frame-gray.raw",
    mimeType: "application/octet-stream",
    outputPath,
  };
}

async function withInputFile(
  request: IncomingMessage,
  fn: (inputPath: string, jobDir: string) => Promise<void>,
) {
  const jobDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-playground-"));
  const inputPath = join(jobDir, `input${inputExtension(request)}`);
  try {
    await writeRequestBody(request, inputPath);
    await fn(inputPath, jobDir);
  } finally {
    rmSync(jobDir, { force: true, recursive: true });
  }
}

async function writeRequestBody(request: IncomingMessage, outputPath: string) {
  await new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    let bytes = 0;
    const output = createWriteStream(outputPath);
    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      output.destroy();
      reject(error);
    };
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxUploadBytes) {
        rejectOnce(new Error("Input file is too large for the playground"));
        request.destroy();
      }
    });
    request.on("error", rejectOnce);
    output.on("error", rejectOnce);
    output.on("finish", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise();
    });
    request.pipe(output);
  });
}

async function sendStatic(response: ServerResponse, fileName: string, contentType: string) {
  const directory = fileName.startsWith("app.js") ? compiledPlaygroundDir : playgroundDir;
  await sendFile(response, resolve(directory, fileName), { "Content-Type": contentType });
}

async function sendFile(
  response: ServerResponse,
  filePath: string,
  headers: Record<string, string>,
) {
  const size = statSync(filePath).size;
  response.writeHead(200, { ...headers, "Content-Length": String(size) });
  await pipeline(createReadStream(filePath), response);
}

function sendError(response: ServerResponse, error: unknown) {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof HttpError) {
    response.writeHead(error.status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }, null, 2));
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: message }, null, 2));
}

function sendIndex(response: ServerResponse) {
  const html = readFileSync(resolve(playgroundDir, "index.html"), "utf8").replace(
    "__PLAYGROUND_TOKEN__",
    requestToken,
  );
  response.writeHead(200, {
    "Content-Length": String(Buffer.byteLength(html)),
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(html);
}

function assertLoopbackHost(request: IncomingMessage) {
  const host = request.headers.host;
  if (typeof host === "string" && isAllowedAuthority(host)) {
    return;
  }
  throw new HttpError(403, "Playground only accepts loopback Host headers");
}

function assertPlaygroundApiRequest(request: IncomingMessage) {
  if (request.headers["x-playground-token"] !== requestToken) {
    throw new HttpError(403, "Playground request token is missing or invalid");
  }
  if (!hasTrustedBrowserSource(request)) {
    throw new HttpError(403, "Playground API requests must come from the served page");
  }
}

function hasTrustedBrowserSource(request: IncomingMessage) {
  const origin = singleHeader(request.headers.origin);
  if (origin !== undefined) {
    return isAllowedUrl(origin);
  }
  const referer = singleHeader(request.headers.referer);
  return referer !== undefined && isAllowedUrl(referer);
}

function isAllowedUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" && isAllowedAuthority(parsed.host);
  } catch {
    return false;
  }
}

function isAllowedAuthority(authority: string) {
  return (
    authority === `127.0.0.1:${port}` ||
    authority === `localhost:${port}` ||
    authority === `[::1]:${port}`
  );
}

function singleHeader(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

class HttpError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

async function ensureSampleVideo() {
  try {
    statSync(sampleVideoPath);
    return;
  } catch {
    // Generate below.
  }
  sampleGeneration ??= generateSampleVideo(sampleVideoPath, { format: "webm" });
  const pendingGeneration = sampleGeneration;
  try {
    await pendingGeneration;
  } finally {
    if (sampleGeneration === pendingGeneration) {
      sampleGeneration = undefined;
    }
  }
}

function parseOperation(raw: string | null): Operation {
  if (typeof raw === "string") {
    for (const operation of operations) {
      if (operation === raw) {
        return operation;
      }
    }
  }
  return "clip-mp4";
}

function inputExtension(request: IncomingMessage) {
  const rawName = request.headers["x-file-name"];
  const name = typeof rawName === "string" ? rawName : "";
  const extension = extname(name).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/u.test(extension)) {
    return extension;
  }
  return ".mp4";
}

function numberParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = params.get(name);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function integerParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  return Math.round(numberParam(params, name, fallback, min, max));
}

function choiceParam<const T extends string>(
  params: URLSearchParams,
  name: string,
  choices: readonly T[],
  fallback: T,
): T {
  const value = params.get(name);
  return choices.find((choice) => choice === value) ?? fallback;
}

function videoQuality(quality: string) {
  if (quality === "high") {
    return "2";
  }
  if (quality === "small") {
    return "9";
  }
  return "5";
}

function formatSeconds(value: number) {
  return String(Math.round(value * 1000) / 1000);
}

function parsePort(raw: string | undefined) {
  const parsed = Number(raw ?? "4173");
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65_536) {
    return parsed;
  }
  return 4173;
}

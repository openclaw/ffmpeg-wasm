#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFfmpeg, execFfprobe, runFfmpeg, runFfprobe, type RunResult } from "../src/index.js";
import { generateSampleVideo } from "./sample-video.js";

const root = resolve(import.meta.dirname, "..", "..");
const work = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-verify-"));
const missingDist = join(work, "missing-dist");
const proofOutputDir = process.env.FFMPEG_WASM_VERIFY_OUTPUT_DIR;
const proofDir =
	proofOutputDir !== undefined && proofOutputDir !== "" ? resolve(root, proofOutputDir) : undefined;
const inputPath = join(work, "input.mp4");
const wavPath = join(work, "audio.wav");
const mp3Path = join(work, "audio.mp3");
const clipPath = join(work, "clip.mp4");
const resizedPath = join(work, "resized.mp4");
const cliResizedPath = join(work, "cli-resized.mp4");
const cliMp3Path = join(work, "cli-audio.mp3");
const pngPath = join(work, "frame.png");
const rawPath = join(work, "hash.raw");
const relativeCwdPath = join(work, "relative-cwd");
const relativeWavName = "cwd-audio.wav";
const segmentPattern = join(work, "part-%03d.wav");
const mp3SegmentPattern = join(work, "mp3-part-%03d.mp3");

// The verifier must remain runnable without resolving any external executable.
process.env.PATH = "";

try {
	mkdirSync(relativeCwdPath);

	await step("wasm sample generation", () =>
		generateSampleVideo(inputPath, {
			durationSeconds: 2,
			frameRate: 10,
			height: 90,
			timeoutMs: 30_000,
			width: 160,
		}),
	);

	await step("ffprobe duration", () => okProbe(inputPath));
	await step("ffprobe json streams", () => okProbeJson(inputPath));
	await step("ffprobe explicit distDir", () => okExplicitDist(inputPath));
	await step("exec ffprobe version", () => okExecFfprobeVersion());
	await step("wav transcode", () =>
		okFfmpeg([
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			inputPath,
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-sample_fmt",
			"s16",
			wavPath,
		]),
	);
	await step("mp3 transcode", () =>
		okFfmpeg([
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			inputPath,
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-b:a",
			"64k",
			mp3Path,
		]),
	);
	await step("mp4 stream-copy clip", () => okMp4Clip(inputPath, clipPath));
	await step("mp4 resize transcode", () => okMp4Resize(inputPath, resizedPath));
	await step("relative cwd output", () =>
		okRelativeCwdOutput(inputPath, relativeCwdPath, relativeWavName),
	);
	await step("API wav stdin pipe", () => okWavStdin(wavPath));
	await step("exec wav stdin pipe", () => okExecWavStdin(wavPath));
	await step("API missing dist rejects", () => okMissingDistRejects());
	await step("API invalid args rejects", () => {
		okInvalidArgsRejects();
	});
	await step("CLI wav stdin pipe", () => {
		okCliWavStdin(wavPath);
	});
	await step("CLI ffprobe duration", () => {
		okCliProbe(inputPath);
	});
	await step("CLI mp4 resize transcode", () => {
		okCliMp4Resize(inputPath, cliResizedPath);
	});
	await step("CLI mp3 transcode", () => {
		okCliMp3(inputPath, cliMp3Path);
	});
	await step("CLI failure stderr", () => {
		okCliFailure();
	});
	await step("png frame", () =>
		okFfmpeg([
			"-hide_banner",
			"-ss",
			"0.5",
			"-i",
			inputPath,
			"-frames:v",
			"1",
			"-vf",
			"signalstats,showinfo,metadata=print",
			"-update",
			"1",
			pngPath,
		]),
	);
	await step("raw gray frame", () =>
		okFfmpeg([
			"-hide_banner",
			"-ss",
			"0.5",
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
			rawPath,
		]),
	);
	await step("null stdout pipe", () =>
		okFfmpeg(["-hide_banner", "-loglevel", "error", "-i", inputPath, "-an", "-f", "null", "-"]),
	);
	await step("raw gray stdout pipe", () => okRawStdout(inputPath, rawPath));
	await step("raw gray CLI stdout pipe", () => {
		okRawCliStdout(inputPath, rawPath);
	});
	await step("wav segment", () =>
		okFfmpeg([
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			inputPath,
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
			segmentPattern,
		]),
	);
	await step("mp3 segment", () =>
		okFfmpeg([
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			inputPath,
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
			mp3SegmentPattern,
		]),
	);

	assertFile(wavPath, 1024, "wav transcode");
	assertFile(mp3Path, 1024, "mp3 transcode");
	assertFile(clipPath, 1024, "mp4 stream-copy clip");
	assertFile(resizedPath, 1024, "mp4 resize transcode");
	assertFile(join(relativeCwdPath, relativeWavName), 1024, "relative cwd transcode");
	assertFile(pngPath, 1024, "png frame");
	assertFile(rawPath, 1024, "raw hash frame");
	assertFile(join(work, "part-000.wav"), 1024, "segment 0");
	assertFile(join(work, "mp3-part-000.mp3"), 1024, "mp3 segment 0");

	await step("output codec assertions", async () => {
		await okProbeMedia(inputPath, {
			audioCodec: "mp3",
			height: 90,
			videoCodec: "mpeg4",
			width: 160,
		});
		await okProbeMedia(wavPath, { audioCodec: "pcm_s16le" });
		await okProbeMedia(mp3Path, { audioCodec: "mp3" });
		await okProbeMedia(resizedPath, { height: 46, videoCodec: "mpeg4", width: 80 });
		await okProbeMedia(cliResizedPath, { height: 36, videoCodec: "mpeg4", width: 64 });
		await okProbeMedia(cliMp3Path, { audioCodec: "mp3" });
	});

	writeProof("passed");
	console.log("verify ok");
} catch (error) {
	try {
		writeProof("failed", error);
	} catch (proofError) {
		process.stderr.write(`verify: failed to write proof: ${String(proofError)}\n`);
	}
	throw error;
} finally {
	rmSync(work, { recursive: true, force: true });
}

interface ProbeStream {
	codec_name?: unknown;
	codec_type?: unknown;
	width?: unknown;
	height?: unknown;
}

interface ProbeFormat {
	duration?: unknown;
}

interface ProbeJson {
	streams: ProbeStream[];
	format: ProbeFormat | null;
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
	if (result.exitCode !== 0) {
		fail("ffprobe", result);
	}
	const duration = Number(result.stdoutText.trim());
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new Error(`bad duration: ${result.stdoutText}`);
	}
}

async function okProbeJson(input: string) {
	const result = await runFfprobe(
		["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", input],
		{ timeoutMs: 30_000 },
	);
	if (result.exitCode !== 0) {
		fail("ffprobe json", result);
	}
	const parsed = parseProbeJson(result.stdoutText);
	const video = parsed.streams.find((stream) => stream.codec_type === "video");
	const audio = parsed.streams.find((stream) => stream.codec_type === "audio");
	if (!video) {
		throw new Error("ffprobe json missing video stream");
	}
	if (!audio) {
		throw new Error("ffprobe json missing audio stream");
	}
	const duration = Number(parsed.format?.duration);
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new Error(`ffprobe json bad duration: ${String(parsed.format?.duration)}`);
	}
	if (video.width !== 160 || video.height !== 90) {
		throw new Error(`ffprobe json bad video size: ${String(video.width)}x${String(video.height)}`);
	}
}

async function okExplicitDist(input: string) {
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
		{ distDir: join(root, "dist"), timeoutMs: 30_000 },
	);
	if (result.exitCode !== 0) {
		fail("ffprobe explicit distDir", result);
	}
	const duration = Number(result.stdoutText.trim());
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new Error(`explicit distDir bad duration: ${result.stdoutText}`);
	}
}

async function okExecFfprobeVersion() {
	const exitCode = await execFfprobe(["-version"], { timeoutMs: 30_000 });
	if (exitCode !== 0) {
		throw new Error(`ffprobe exec version failed: ${exitCode}`);
	}
}

async function okFfmpeg(args: string[]) {
	const result = await runFfmpeg(args, { timeoutMs: 30_000 });
	if (result.exitCode !== 0) {
		fail(`ffmpeg ${args.join(" ")}`, result);
	}
}

async function okMp4Clip(input: string, output: string) {
	await okFfmpeg([
		"-hide_banner",
		"-loglevel",
		"error",
		"-ss",
		"0.2",
		"-i",
		input,
		"-t",
		"1",
		"-map",
		"0:v:0",
		"-map",
		"0:a?",
		"-c",
		"copy",
		"-movflags",
		"+faststart",
		output,
	]);
	await okProbe(output);
}

async function okMp4Resize(input: string, output: string) {
	await okFfmpeg([
		"-hide_banner",
		"-loglevel",
		"error",
		"-ss",
		"0.2",
		"-i",
		input,
		"-t",
		"1",
		"-vf",
		"scale=80:-2,format=yuv420p",
		"-c:v",
		"mpeg4",
		"-q:v",
		"5",
		"-an",
		"-movflags",
		"+faststart",
		output,
	]);
	await okProbeVideoSize(output, 80, 46);
}

async function okProbeVideoSize(input: string, width: number, height: number) {
	const result = await runFfprobe(
		[
			"-v",
			"quiet",
			"-print_format",
			"json",
			"-show_entries",
			"stream=codec_type,width,height",
			input,
		],
		{ timeoutMs: 30_000 },
	);
	if (result.exitCode !== 0) {
		fail("ffprobe video size", result);
	}
	const parsed = parseProbeJson(result.stdoutText);
	const video = parsed.streams.find((stream) => stream.codec_type === "video");
	if (!video || video.width !== width || video.height !== height) {
		throw new Error(`bad video size: ${String(video?.width)}x${String(video?.height)}`);
	}
}

interface ExpectedMedia {
	audioCodec?: string;
	height?: number;
	videoCodec?: string;
	width?: number;
}

async function okProbeMedia(input: string, expected: ExpectedMedia) {
	const result = await runFfprobe(
		[
			"-v",
			"quiet",
			"-print_format",
			"json",
			"-show_entries",
			"stream=codec_name,codec_type,width,height",
			input,
		],
		{ timeoutMs: 30_000 },
	);
	if (result.exitCode !== 0) {
		fail(`ffprobe media ${input}`, result);
	}
	const parsed = parseProbeJson(result.stdoutText);
	const video = parsed.streams.find((stream) => stream.codec_type === "video");
	const audio = parsed.streams.find((stream) => stream.codec_type === "audio");
	if (expected.videoCodec !== undefined && video?.codec_name !== expected.videoCodec) {
		throw new Error(`bad video codec for ${input}: ${String(video?.codec_name)}`);
	}
	if (expected.audioCodec !== undefined && audio?.codec_name !== expected.audioCodec) {
		throw new Error(`bad audio codec for ${input}: ${String(audio?.codec_name)}`);
	}
	if (
		expected.width !== undefined &&
		expected.height !== undefined &&
		(video?.width !== expected.width || video.height !== expected.height)
	) {
		throw new Error(
			`bad video size for ${input}: ${String(video?.width)}x${String(video?.height)}`,
		);
	}
}

async function okRelativeCwdOutput(input: string, cwd: string, output: string) {
	const result = await runFfmpeg(
		["-hide_banner", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "8000", output],
		{ cwd, timeoutMs: 30_000 },
	);
	if (result.exitCode !== 0) {
		fail("ffmpeg relative cwd", result);
	}
}

async function okMissingDistRejects() {
	try {
		await runFfmpeg(["-version"], { distDir: missingDist, timeoutMs: 30_000 });
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("Missing ffmpeg wasm assets") &&
			error.message.includes(missingDist)
		) {
			return;
		}
		throw error;
	}
	throw new Error("missing distDir did not reject");
}

function okInvalidArgsRejects() {
	const source = `
import { runFfmpeg } from ${JSON.stringify(resolve(root, "lib/src/index.js"))};
try {
  await runFfmpeg("not-an-array");
  console.error("invalid args did not reject");
  process.exit(1);
} catch (error) {
  if (error instanceof TypeError && error.message.includes("args must be an array")) {
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
}
`;
	const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(`invalid args check failed: ${spawnOutput(result)}`);
	}
}

async function okWavStdin(wav: string) {
	const result = await runFfmpeg(wavStdinArgs(), {
		stdin: readFileSync(wav),
		timeoutMs: 30_000,
	});
	if (result.exitCode !== 0) {
		fail("ffmpeg wav stdin", result);
	}
}

async function okExecWavStdin(wav: string) {
	const exitCode = await execFfmpeg(wavStdinArgs(), {
		stdin: readFileSync(wav),
		timeoutMs: 30_000,
	});
	if (exitCode !== 0) {
		throw new Error(`ffmpeg exec wav stdin failed: ${exitCode}`);
	}
}

function okCliWavStdin(wav: string) {
	const result = spawnSync(process.execPath, [resolve(root, "lib/src/cli.js"), ...wavStdinArgs()], {
		input: readFileSync(wav),
	});
	if (result.status !== 0) {
		throw new Error(`ffmpeg CLI wav stdin failed: ${spawnOutput(result)}`);
	}
}

function okCliProbe(input: string) {
	const result = spawnSync(
		process.execPath,
		[
			resolve(root, "lib/src/ffprobe-cli.js"),
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			input,
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(`ffprobe CLI duration failed: ${spawnOutput(result)}`);
	}
	const duration = Number(result.stdout.trim());
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new Error(`ffprobe CLI bad duration: ${result.stdout}`);
	}
}

function okCliMp4Resize(input: string, output: string) {
	okCliFfmpeg(
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			input,
			"-t",
			"1",
			"-vf",
			"scale=64:-2,format=yuv420p",
			"-c:v",
			"mpeg4",
			"-q:v",
			"5",
			"-an",
			"-movflags",
			"+faststart",
			output,
		],
		"mp4 resize",
	);
}

function okCliMp3(input: string, output: string) {
	okCliFfmpeg(
		[
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
			output,
		],
		"mp3 transcode",
	);
}

function okCliFfmpeg(args: string[], label: string) {
	const result = spawnSync(process.execPath, [resolve(root, "lib/src/cli.js"), ...args], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(`ffmpeg CLI ${label} failed: ${spawnOutput(result)}`);
	}
}

function okCliFailure() {
	const result = spawnSync(
		process.execPath,
		[
			resolve(root, "lib/src/cli.js"),
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			join(work, "missing.mp4"),
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8" },
	);
	if (result.status === 0) {
		throw new Error("ffmpeg CLI failure path unexpectedly succeeded");
	}
	if (!result.stderr.includes("No such file")) {
		throw new Error(`ffmpeg CLI failure path missing stderr: ${spawnOutput(result)}`);
	}
}

async function okRawStdout(input: string, expectedPath: string) {
	const result = await runFfmpeg(rawStdoutArgs(input), { timeoutMs: 30_000 });
	if (result.exitCode !== 0) {
		fail("ffmpeg raw stdout", result);
	}
	if (result.stdout.byteLength !== 1024) {
		throw new Error(`raw stdout size mismatch: ${result.stdout.byteLength}`);
	}
	assertSameBytes(result.stdout, readFileSync(expectedPath), "raw stdout bytes");
}

function okRawCliStdout(input: string, expectedPath: string) {
	const result = spawnSync(process.execPath, [
		resolve(root, "lib/src/cli.js"),
		...rawStdoutArgs(input),
	]);
	if (result.status !== 0) {
		throw new Error(`ffmpeg CLI raw stdout failed: ${spawnOutput(result)}`);
	}
	if (result.stdout.byteLength !== 1024) {
		throw new Error(`CLI raw stdout size mismatch: ${result.stdout.byteLength}`);
	}
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
	if (bytes.byteLength < minBytes) {
		throw new Error(`${label} too small: ${bytes.byteLength}`);
	}
}

function assertSameBytes(actual: Buffer, expected: Buffer, label: string) {
	if (!actual.equals(expected)) {
		throw new Error(`${label} mismatch`);
	}
}

function parseProbeJson(text: string): ProbeJson {
	const value: unknown = JSON.parse(text);
	if (!isRecord(value)) {
		throw new Error("ffprobe json root is not an object");
	}
	const rawStreams = value.streams;
	const streams = Array.isArray(rawStreams)
		? rawStreams.flatMap((stream): ProbeStream[] => {
				if (!isRecord(stream)) {
					return [];
				}
				return [
					{
						codec_name: stream.codec_name,
						codec_type: stream.codec_type,
						height: stream.height,
						width: stream.width,
					},
				];
			})
		: [];
	const rawFormat = value.format;
	return {
		streams,
		format: isRecord(rawFormat) ? { duration: rawFormat.duration } : null,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function fail(label: string, result: RunResult): never {
	writeFileSync(join(work, "last-stderr.txt"), result.stderr);
	throw new Error(`${label} failed (${result.exitCode}): ${result.stderrText}`);
}

function spawnOutput(result: ReturnType<typeof spawnSync>): string {
	const stderr = result.stderr?.toString("utf8") ?? "";
	const stdout = result.stdout?.toString("utf8") ?? "";
	return stderr || stdout;
}

function writeProof(status: "failed" | "passed", error?: unknown) {
	if (proofDir === undefined) {
		return;
	}
	mkdirSync(proofDir, { recursive: true });
	const artifacts = [
		{ description: "WASM-generated input", name: "input.mp4", path: inputPath },
		{ description: "API WAV transcode", name: "api-audio.wav", path: wavPath },
		{ description: "API MP3 transcode", name: "api-audio.mp3", path: mp3Path },
		{ description: "API MP4 stream copy", name: "api-clip.mp4", path: clipPath },
		{ description: "API MP4 resize", name: "api-resized.mp4", path: resizedPath },
		{ description: "CLI MP4 resize", name: "cli-resized.mp4", path: cliResizedPath },
		{ description: "CLI MP3 transcode", name: "cli-audio.mp3", path: cliMp3Path },
		{ description: "PNG frame extraction", name: "frame.png", path: pngPath },
		{ description: "Raw grayscale frame", name: "frame.raw", path: rawPath },
		{ description: "WAV segment", name: "segment.wav", path: join(work, "part-000.wav") },
		{ description: "MP3 segment", name: "segment.mp3", path: join(work, "mp3-part-000.mp3") },
	].flatMap((artifact) => {
		if (!existsSync(artifact.path)) {
			return [];
		}
		const outputPath = join(proofDir, artifact.name);
		copyFileSync(artifact.path, outputPath);
		return [
			{ bytes: statSync(outputPath).size, description: artifact.description, name: artifact.name },
		];
	});
	const manifest = {
		status,
		wasmOnly: true,
		externalExecutableLookupDisabled: process.env.PATH === "",
		error: formatError(error),
		artifacts,
	};
	writeFileSync(join(proofDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function formatError(error: unknown): string | undefined {
	if (error === undefined) {
		return undefined;
	}
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	try {
		return JSON.stringify(error);
	} catch {
		return "Unknown verification error";
	}
}

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { resolve } from "node:path";
import { endChildStdin } from "./end-stdin.js";

const here = import.meta.dirname;
const root = resolve(here, "..", "..");
const defaultDist = resolve(root, "dist");
const runner = resolve(here, "run-generated.js");
const forcedKillDelayMs = 5000;
// A child that exits after reading only part of stdin breaks the pipe before Node reports its exit.
const stdinExitGraceMs = 1000;

export type Tool = "ffmpeg" | "ffprobe";

export interface RunOptions {
  distDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: Buffer | Uint8Array | string;
  stdinMode?: "ignore" | "inherit";
  timeoutMs?: number;
  onSpawn?: (child: ChildProcess) => void;
}

export interface RunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
  stdoutText: string;
  stderrText: string;
}

export function runFfmpeg(args: string[], options: RunOptions = {}): Promise<RunResult> {
  return runTool("ffmpeg", args, options);
}

export function runFfprobe(args: string[], options: RunOptions = {}): Promise<RunResult> {
  return runTool("ffprobe", args, options);
}

export function execFfmpeg(args: string[], options: RunOptions = {}): Promise<number> {
  return execTool("ffmpeg", args, options);
}

export function execFfprobe(args: string[], options: RunOptions = {}): Promise<number> {
  return execTool("ffprobe", args, options);
}

export function runTool(tool: Tool, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return startTool(tool, args, options, true);
}

export function execTool(tool: Tool, args: string[], options: RunOptions = {}): Promise<number> {
  return startTool(tool, args, options, false);
}

function startTool(
  tool: Tool,
  args: string[],
  options: RunOptions,
  capture: true,
): Promise<RunResult>;
function startTool(
  tool: Tool,
  args: string[],
  options: RunOptions,
  capture: false,
): Promise<number>;
function startTool(
  tool: Tool,
  args: string[],
  options: RunOptions,
  capture: boolean,
): Promise<RunResult | number> {
  try {
    if (!Array.isArray(args)) {
      throw new TypeError("args must be an array");
    }
    const distDir = resolve(options.distDir ?? defaultDist);
    const jsPath = resolve(distDir, `${tool}.js`);
    const wasmPath = resolve(distDir, `${tool}_g.wasm`);
    if (!existsSync(jsPath) || !existsSync(wasmPath)) {
      throw new Error(`Missing ${tool} wasm assets in ${distDir}; run pnpm build.`);
    }

    return spawnTool(tool, distDir, normalizeArgs(tool, args), options, capture);
  } catch (error) {
    return Promise.reject(toError(error));
  }
}

function spawnTool(
  tool: Tool,
  distDir: string,
  args: string[],
  options: RunOptions,
  capture: boolean,
): Promise<RunResult | number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hasStdin = options.stdin !== undefined;
    const child = spawn(process.execPath, [runner, tool, distDir, ...args.map(String)], {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: [
        hasStdin ? "pipe" : (options.stdinMode ?? (capture ? "ignore" : "inherit")),
        capture ? "pipe" : "inherit",
        capture ? "pipe" : "inherit",
      ],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    let timeoutError: Error | undefined;
    let stdinBrokenPipe: ReturnType<typeof setTimeout> | undefined;
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            // Record the cause before termination can fail a pending stdin write.
            const error = new Error(`${tool} wasm timed out after ${options.timeoutMs}ms`);
            timeoutError = error;
            child.kill("SIGTERM");
            forceKill = setTimeout(() => {
              finishReject(error);
            }, forcedKillDelayMs);
          }, options.timeoutMs);
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKill) {
        clearTimeout(forceKill);
      }
      if (stdinBrokenPipe) {
        clearTimeout(stdinBrokenPipe);
      }
    };
    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (child.pid !== undefined) {
        child.kill("SIGKILL");
      }
      rejectPromise(timeoutError ?? error);
    };
    const onStdinError = (error: Error) => {
      if (!isBrokenPipe(error)) {
        finishReject(error);
        return;
      }
      // FFprobe and FFmpeg (-t, -frames) may exit successfully without reading all stdin.
      // Let the exit status decide; only reject if the child keeps running without stdin.
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      stdinBrokenPipe ??= setTimeout(() => {
        finishReject(error);
      }, stdinExitGraceMs);
    };
    child.on("error", finishReject);
    child.on("exit", () => {
      if (stdinBrokenPipe) {
        clearTimeout(stdinBrokenPipe);
        stdinBrokenPipe = undefined;
      }
    });
    child.on("close", (code, signal) => {
      if (timeoutError) {
        finishReject(timeoutError);
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const exitCode = code ?? signalExitCode(signal);
      if (!capture) {
        resolvePromise(exitCode);
        return;
      }
      const stdoutBuffer = Buffer.concat(stdout);
      const stderrBuffer = Buffer.concat(stderr);
      resolvePromise({
        exitCode,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        stdoutText: stdoutBuffer.toString("utf8"),
        stderrText: stderrBuffer.toString("utf8"),
      });
    });
    if (capture) {
      if (!child.stdout || !child.stderr) {
        finishReject(new Error(`Failed to capture ${tool} wasm stdio`));
        return;
      }
      child.stdout.on("data", (chunk: Buffer) => {
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
      });
    }
    try {
      options.onSpawn?.(child);
      if (options.stdin !== undefined) {
        endChildStdin(child.stdin, options.stdin, onStdinError);
      }
    } catch (error) {
      finishReject(toError(error));
    }
  });
}

function signalExitCode(signal: NodeJS.Signals | null) {
  return signal ? 128 + (constants.signals[signal] ?? 0) : 1;
}

function normalizeArgs(tool: Tool, args: string[]): string[] {
  if (tool !== "ffmpeg" || args.includes("-nostdin")) {
    return args;
  }
  return ["-nostdin", ...args];
}

function isBrokenPipe(error: Error) {
  return "code" in error && error.code === "EPIPE";
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

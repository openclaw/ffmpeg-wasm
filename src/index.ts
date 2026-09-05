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

    return spawnTool(tool, distDir, normalizeArgs(tool, args), options);
  } catch (error) {
    return Promise.reject(toError(error));
  }
}

export function execTool(tool: Tool, args: string[], options: RunOptions = {}): Promise<number> {
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

    return spawnToolStreaming(tool, distDir, normalizeArgs(tool, args), options);
  } catch (error) {
    return Promise.reject(toError(error));
  }
}

function spawnTool(
  tool: Tool,
  distDir: string,
  args: string[],
  options: RunOptions,
): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hasStdin = options.stdin !== undefined;
    const child = spawn(process.execPath, [runner, tool, distDir, ...args.map(String)], {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: [hasStdin ? "pipe" : (options.stdinMode ?? "ignore"), "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            forceKill = setTimeout(() => {
              child.kill("SIGKILL");
              finishReject(new Error(`${tool} wasm timed out after ${options.timeoutMs}ms`));
            }, forcedKillDelayMs);
          }, options.timeoutMs);
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKill) {
        clearTimeout(forceKill);
      }
    };
    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    };
    const finishResolve = (value: RunResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(value);
    };
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
    child.on("error", (error) => {
      finishReject(error);
    });
    child.on("close", (code, signal) => {
      if (timedOut) {
        finishReject(new Error(`${tool} wasm timed out after ${options.timeoutMs}ms`));
        return;
      }
      finishResolve({
        exitCode: code ?? signalExitCode(signal),
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        stdoutText: Buffer.concat(stdout).toString("utf8"),
        stderrText: Buffer.concat(stderr).toString("utf8"),
      });
    });
    try {
      options.onSpawn?.(child);
    } catch (error) {
      if (child.pid !== undefined) {
        child.kill("SIGKILL");
      }
      finishReject(toError(error));
      return;
    }
    if (options.stdin !== undefined) {
      endChildStdin(child.stdin, options.stdin, finishReject);
    }
  });
}

function spawnToolStreaming(
  tool: Tool,
  distDir: string,
  args: string[],
  options: RunOptions,
): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hasStdin = options.stdin !== undefined;
    const child = spawn(process.execPath, [runner, tool, distDir, ...args.map(String)], {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: [hasStdin ? "pipe" : (options.stdinMode ?? "inherit"), "inherit", "inherit"],
    });
    let settled = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            forceKill = setTimeout(() => {
              child.kill("SIGKILL");
              finishReject(new Error(`${tool} wasm timed out after ${options.timeoutMs}ms`));
            }, forcedKillDelayMs);
          }, options.timeoutMs);
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKill) {
        clearTimeout(forceKill);
      }
    };
    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    };
    const finishResolve = (value: number) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(value);
    };
    child.on("error", (error) => {
      finishReject(error);
    });
    child.on("close", (code, signal) => {
      if (timedOut) {
        finishReject(new Error(`${tool} wasm timed out after ${options.timeoutMs}ms`));
        return;
      }
      finishResolve(code ?? signalExitCode(signal));
    });
    try {
      options.onSpawn?.(child);
    } catch (error) {
      if (child.pid !== undefined) {
        child.kill("SIGKILL");
      }
      finishReject(toError(error));
      return;
    }
    if (options.stdin !== undefined) {
      endChildStdin(child.stdin, options.stdin, finishReject);
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

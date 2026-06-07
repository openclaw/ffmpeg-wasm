import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const here = import.meta.dirname;
const root = resolve(here, "..", "..");
const defaultDist = resolve(root, "dist");
const runner = resolve(here, "run-generated.js");

export type Tool = "ffmpeg" | "ffprobe";

export interface RunOptions {
  distDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: Buffer | Uint8Array | string;
  stdinMode?: "ignore" | "inherit";
  timeoutMs?: number;
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
  return new Promise((resolvePromise, reject) => {
    const hasStdin = options.stdin !== undefined;
    const child = spawn(process.execPath, [runner, tool, distDir, ...args.map(String)], {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: [hasStdin ? "pipe" : (options.stdinMode ?? "ignore"), "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    if (!child.stdout || !child.stderr) {
      reject(new Error(`Failed to capture ${tool} wasm stdio`));
      return;
    }
    let timedOut = false;
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    if (hasStdin) {
      child.stdin?.end(options.stdin);
    }
    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (timedOut) {
        reject(new Error(`${tool} wasm timed out after ${options.timeoutMs}ms`));
        return;
      }
      resolvePromise({
        exitCode: code ?? (signal ? 128 : 1),
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        stdoutText: Buffer.concat(stdout).toString("utf8"),
        stderrText: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function spawnToolStreaming(
  tool: Tool,
  distDir: string,
  args: string[],
  options: RunOptions,
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const hasStdin = options.stdin !== undefined;
    const child = spawn(process.execPath, [runner, tool, distDir, ...args.map(String)], {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: [hasStdin ? "pipe" : (options.stdinMode ?? "inherit"), "inherit", "inherit"],
    });
    const cleanupSignals = forwardProcessSignals(child);
    let timedOut = false;
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs);

    child.on("error", (error) => {
      cleanupSignals();
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    if (hasStdin) {
      child.stdin?.end(options.stdin);
    }
    child.on("close", (code, signal) => {
      cleanupSignals();
      if (timeout) {
        clearTimeout(timeout);
      }
      if (timedOut) {
        reject(new Error(`${tool} wasm timed out after ${options.timeoutMs}ms`));
        return;
      }
      resolvePromise(code ?? (signal ? 128 : 1));
    });
  });
}

function forwardProcessSignals(child: ChildProcess) {
  const listeners = forwardedSignals.map((signal) => {
    let forceExit: ReturnType<typeof setTimeout> | undefined;
    const listener = () => {
      child.kill(signal);
      forceExit ??= setTimeout(() => {
        child.kill("SIGKILL");
        process.exit(128 + signalNumber(signal));
      }, 5000);
    };
    process.once(signal, listener);
    return () => {
      if (forceExit) {
        clearTimeout(forceExit);
      }
      process.off(signal, listener);
    };
  });
  return () => {
    for (const cleanup of listeners) {
      cleanup();
    }
  };
}

const forwardedSignals = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

function signalNumber(signal: (typeof forwardedSignals)[number]) {
  if (signal === "SIGHUP") {
    return 1;
  }
  if (signal === "SIGINT") {
    return 2;
  }
  return 15;
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

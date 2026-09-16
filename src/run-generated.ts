#!/usr/bin/env node
import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface BlockingOutput extends NodeJS.WriteStream {
  _handle?: { setBlocking: (blocking: boolean) => void };
}

// Node streams (also initialized by worker_threads) make pipes nonblocking.
// Emscripten's NODERAWFS uses synchronous writes and needs blocking descriptors.
for (const output of [process.stdout, process.stderr]) {
  // oxlint-disable-next-line no-underscore-dangle -- Node exposes descriptor blocking only through this handle.
  (output as BlockingOutput)._handle?.setBlocking(true);
}

interface EmscriptenExitStatus {
  name?: string;
  status?: number;
}

type EmscriptenModuleFactory = (options: Record<string, unknown>) => Promise<unknown>;

const tool = process.argv[2];
const distDir = process.argv[3];
const args = process.argv.slice(4);
if (!tool || !distDir) {
  writeOutput(2, "usage: run-generated <ffmpeg|ffprobe> <dist-dir> [...args]\n");
  process.exit(64);
}

let exitCode = 0;
let resolveExit!: () => void;
const exited = new Promise<void>((resolvePromise) => {
  resolveExit = resolvePromise;
});

try {
  const jsPath = resolve(distDir, `${tool}.js`);
  const imported: unknown = await import(pathToFileURL(jsPath).href);
  const createModule = getDefaultFactory(imported);
  if (!createModule) {
    throw new Error(`Invalid Emscripten module: ${jsPath}`);
  }

  const module = createModule({
    arguments: args,
    thisProgram: tool,
    locateFile: (name: string) => resolve(distDir, name),
    print: (line: string) => {
      writeOutput(1, `${line}\n`);
    },
    printErr: (line: string) => {
      writeOutput(2, `${line}\n`);
    },
    onExit: (code: number) => {
      exitCode = code;
      resolveExit();
    },
  });

  await Promise.race([
    exited,
    module.then(
      () => new Promise<never>(() => {}),
      (error: unknown) => {
        if (isExitStatus(error)) {
          exitCode =
            typeof error.status === "number" ? error.status : (parseExitStatus(error) ?? exitCode);
          resolveExit();
          return new Promise<never>(() => {});
        }
        throw error;
      },
    ),
  ]);
} catch (error) {
  writeOutput(2, `${formatError(error)}\n`);
  exitCode = 1;
}

process.exit(exitCode);

function writeOutput(fd: 1 | 2, text: string): void {
  // Complete print callbacks before forced exit, including partial writes.
  const bytes = Buffer.from(text);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(fd, bytes, offset, bytes.length - offset);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPIPE") {
      return;
    }
    throw error;
  }
}

function getDefaultFactory(value: unknown): EmscriptenModuleFactory | undefined {
  if (value === null || value === undefined || typeof value !== "object" || !("default" in value)) {
    return undefined;
  }
  const maybeFactory: unknown = Reflect.get(value, "default");
  return isModuleFactory(maybeFactory) ? maybeFactory : undefined;
}

function isModuleFactory(value: unknown): value is EmscriptenModuleFactory {
  return typeof value === "function";
}

function isExitStatus(error: unknown): error is EmscriptenExitStatus {
  const text = formatError(error);
  return (
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "ExitStatus") ||
    text.startsWith("Program terminated with exit(")
  );
}

function parseExitStatus(error: EmscriptenExitStatus) {
  const match = /exit\((?<status>\d+)\)/u.exec(formatError(error));
  const status = match?.groups?.status;
  return status === undefined ? undefined : Number(status);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

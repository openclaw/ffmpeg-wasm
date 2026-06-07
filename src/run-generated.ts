#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface EmscriptenExitStatus {
  name?: string;
  status?: number;
}

const [, , tool, distDir, ...args] = process.argv;
if (!tool || !distDir) {
  process.stderr.write("usage: run-generated <ffmpeg|ffprobe> <dist-dir> [...args]\n");
  process.exit(64);
}

let exitCode = 0;
let resolveExit!: () => void;
const exited = new Promise<void>((resolvePromise) => {
  resolveExit = resolvePromise;
});

try {
  const jsPath = resolve(distDir, `${tool}.js`);
  const imported = (await import(pathToFileURL(jsPath).href)) as {
    default?: (options: Record<string, unknown>) => Promise<unknown>;
  };
  const createModule = imported.default;
  if (typeof createModule !== "function") throw new Error(`Invalid Emscripten module: ${jsPath}`);

  const module = createModule({
    arguments: args,
    thisProgram: tool,
    locateFile: (name: string) => resolve(distDir, name),
    print: (line: string) => process.stdout.write(`${line}\n`),
    printErr: (line: string) => process.stderr.write(`${line}\n`),
    onExit: (code: number) => {
      exitCode = code;
      resolveExit();
    },
  });

  await Promise.race([
    exited,
    module.then(
      () => new Promise<never>(() => {}),
      (error: EmscriptenExitStatus) => {
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
  process.exit(exitCode);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
}

function isExitStatus(error: EmscriptenExitStatus) {
  return error?.name === "ExitStatus" || String(error).startsWith("Program terminated with exit(");
}

function parseExitStatus(error: EmscriptenExitStatus) {
  const match = String(error).match(/exit\((\d+)\)/);
  return match ? Number(match[1]) : undefined;
}

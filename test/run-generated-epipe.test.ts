import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../src/run-generated.js", import.meta.url));

await test("run-generated does not crash when stdout is closed mid-print", async () => {
  const result = await runGeneratedWithClosedPipe("stdout", mockModule("print", "line"));
  assert.equal(
    result.status,
    0,
    `expected runner to exit 0 after stdout closed, got ${String(result.status)}\n${result.stderr}`,
  );
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event|write EPIPE/u);
});

await test("run-generated does not crash when stderr is closed mid-printErr", async () => {
  const result = await runGeneratedWithClosedPipe("stderr", mockModule("printErr", "err"));
  assert.equal(
    result.status,
    0,
    `expected runner to exit 0 after stderr closed, got ${String(result.status)}\n${result.stderr}`,
  );
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event|write EPIPE/u);
});

function mockModule(method: "print" | "printErr", prefix: string): string {
  return `
export default function createModule(options) {
  return Promise.resolve().then(async () => {
    options.${method}(${JSON.stringify(prefix)} + "-0");
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    for (let i = 1; i < 10; i++) {
      options.${method}(${JSON.stringify(prefix)} + "-" + i);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    options.onExit(0);
    return {};
  });
}
`;
}

async function runGeneratedWithClosedPipe(
  closed: "stdout" | "stderr",
  moduleSource: string,
): Promise<{ status: number | null; stderr: string }> {
  const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-epipe-"));
  try {
    writeFileSync(join(distDir, "ffmpeg.js"), moduleSource);
    const child = spawn(process.execPath, [runner, "ffmpeg", distDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closedStream = closed === "stdout" ? child.stdout : child.stderr;
    closedStream.once("data", () => {
      closedStream.destroy();
    });
    const stderrChunks: Buffer[] = [];
    if (closed !== "stderr") {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
    }
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        resolve(code);
      });
    });
    return {
      status,
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    };
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

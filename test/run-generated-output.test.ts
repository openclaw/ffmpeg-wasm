import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runFfmpeg, runFfprobe } from "../src/index.js";

for (const run of [runFfmpeg, runFfprobe]) {
  // oxlint-disable-next-line no-await-in-loop -- Keep large output fixtures sequential.
  await test(`${run.name} preserves stdout and stderr before exit`, async () => {
    const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-output-"));
    const line = "x".repeat(4 * 1024 * 1024);
    try {
      for (const tool of ["ffmpeg", "ffprobe"]) {
        writeFileSync(
          join(distDir, `${tool}.js`),
          `export default async function(options) {
            const line = "x".repeat(${line.length});
            options.print(line);
            options.printErr(line);
            options.onExit(7);
            return {};
          }`,
        );
        writeFileSync(join(distDir, `${tool}_g.wasm`), "");
      }
      const result = await run([], { distDir, timeoutMs: 5000 });
      assert.equal(result.exitCode, 7);
      assert.equal(result.stdout.length, line.length + 1, "stdout was truncated");
      assert.equal(result.stderr.length, line.length + 1, "stderr was truncated");
      assert.equal(result.stdoutText, `${line}\n`);
      assert.equal(result.stderrText, `${line}\n`);
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });
}

await test("runner preserves large NODERAWFS-style descriptor writes", async () => {
  const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-raw-output-"));
  const bytes = Buffer.alloc(4 * 1024 * 1024, 165);
  try {
    writeFileSync(
      join(distDir, "ffmpeg.js"),
      `import { writeSync } from "node:fs";
      export default async function(options) {
        const bytes = Buffer.alloc(${bytes.length}, 165);
        writeSync(1, bytes);
        writeSync(2, bytes);
        options.onExit(0);
        return {};
      }`,
    );
    writeFileSync(join(distDir, "ffmpeg_g.wasm"), "");
    const result = await runFfmpeg([], { distDir, timeoutMs: 5000 });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, bytes.length, "raw stdout was truncated");
    assert.equal(result.stderr.length, bytes.length, "raw stderr was truncated");
    assert.deepEqual(result.stdout, bytes);
    assert.deepEqual(result.stderr, bytes);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

await test("runner preserves diagnostics when the module fails", async () => {
  const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-output-error-"));
  const message = "failure".repeat(1024 * 1024);
  try {
    writeFileSync(
      join(distDir, "ffmpeg.js"),
      `export default async function() { throw "failure".repeat(${1024 * 1024}); }`,
    );
    writeFileSync(join(distDir, "ffmpeg_g.wasm"), "");
    const result = await runFfmpeg([], { distDir, timeoutMs: 5000 });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, message.length + 1, "diagnostic was truncated");
    assert.equal(result.stderrText, `${message}\n`);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

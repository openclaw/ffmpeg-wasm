import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { execFfmpeg, execFfprobe, runFfmpeg, runFfprobe } from "../src/index.js";

// FFprobe reads only enough of pipe:0 to probe it, and FFmpeg stops reading
// when `-t`/`-frames` is satisfied. The child then exits normally while the
// rest of the stdin payload is still being written.
const partialReader = `import { readSync } from "node:fs";
export default async function(options) {
  const head = Buffer.alloc(4096);
  const bytes = readSync(0, head, 0, head.length, null);
  options.print("read " + bytes);
  options.onExit(0);
  return {};
}`;

for (const run of [runFfmpeg, runFfprobe]) {
  // oxlint-disable-next-line no-await-in-loop -- Each test owns one child.
  await test(`${run.name} resolves when the child exits before reading all stdin`, async () => {
    const distDir = writeFixture();
    try {
      const result = await run([], {
        distDir,
        stdin: Buffer.alloc(16 * 1024 * 1024),
        timeoutMs: 10_000,
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdoutText, "read 4096\n");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });
}

for (const run of [execFfmpeg, execFfprobe]) {
  // oxlint-disable-next-line no-await-in-loop -- Each test owns one child.
  await test(`${run.name} resolves when the child exits before reading all stdin`, async () => {
    const distDir = writeFixture();
    try {
      const exitCode = await run([], {
        distDir,
        stdin: Buffer.alloc(16 * 1024 * 1024),
        timeoutMs: 10_000,
      });
      assert.equal(exitCode, 0);
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });
}

function writeFixture() {
  const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-stdin-partial-"));
  for (const tool of ["ffmpeg", "ffprobe"]) {
    writeFileSync(join(distDir, `${tool}.js`), partialReader);
    writeFileSync(join(distDir, `${tool}_g.wasm`), "");
  }
  return distDir;
}

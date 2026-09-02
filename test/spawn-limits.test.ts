import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultTimeoutMs, maxProcessBufferBytes, runFfmpeg } from "../src/index.js";

await test("runFfmpeg rejects when captured stdout exceeds the buffer cap", async () => {
  const distDir = writeFakeDist(`
export default function createModule(options) {
  const keepAlive = setInterval(() => {}, 60_000);
  const payload = Buffer.alloc(${String(maxProcessBufferBytes + 1)}, 0x61);
  process.stdout.write(payload, () => {
    clearInterval(keepAlive);
    options.onExit(0);
  });
  return new Promise(() => {});
}
`);
  try {
    await assert.rejects(
      () => runFfmpeg(["-version"], { distDir, timeoutMs: 5000 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("stdout exceeded"));
        assert.ok(error.message.includes(String(maxProcessBufferBytes)));
        return true;
      },
    );
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

await test(
  "runFfmpeg rejects after the default timeout when the wasm process never exits",
  { timeout: defaultTimeoutMs + 10_000 },
  async () => {
    const distDir = writeFakeDist(`
export default function createModule() {
  setInterval(() => {}, 60_000);
  return new Promise(() => {});
}
`);
    try {
      await assert.rejects(
        () => runFfmpeg(["-version"], { distDir }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(`timed out after ${String(defaultTimeoutMs)}ms`));
          return true;
        },
      );
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  },
);

function writeFakeDist(moduleSource: string): string {
  const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-spawn-limits-"));
  writeFileSync(join(distDir, "ffmpeg.js"), moduleSource);
  writeFileSync(join(distDir, "ffmpeg_g.wasm"), "");
  return distDir;
}

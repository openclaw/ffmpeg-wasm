import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { execFfmpeg, execFfprobe, runFfmpeg, runFfprobe } from "../src/index.js";

for (const run of [runFfmpeg, runFfprobe, execFfmpeg, execFfprobe]) {
  // oxlint-disable-next-line no-await-in-loop -- Each test owns one child and its cleanup.
  await test(`${run.name} terminates the child when stdin fails`, async () => {
    const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-stdin-cleanup-"));
    let child: ChildProcess | undefined;
    let closed: Promise<void> | undefined;
    try {
      for (const tool of ["ffmpeg", "ffprobe"]) {
        writeFileSync(
          join(distDir, `${tool}.js`),
          `import { closeSync } from "node:fs";
          export default async function() {
            closeSync(0);
            setInterval(() => {}, 1000);
            return {};
          }`,
        );
        writeFileSync(join(distDir, `${tool}_g.wasm`), "");
      }
      await assert.rejects(
        run([], {
          distDir,
          stdin: Buffer.alloc(10 * 1024 * 1024),
          timeoutMs: 5000,
          onSpawn(spawned) {
            child = spawned;
            closed = new Promise((resolveClosed) => {
              spawned.once("close", () => {
                resolveClosed();
              });
            });
          },
        }),
        { code: "EPIPE" },
      );
      assert.equal(child?.killed, true, "rejected stdin left the child running");
      await closed;
      assert.equal(child?.signalCode, "SIGKILL");
    } finally {
      child?.kill("SIGKILL");
      await closed;
      rmSync(distDir, { recursive: true, force: true });
    }
  });
}

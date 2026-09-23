import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { execFfmpeg, execFfprobe, runFfmpeg, runFfprobe } from "../src/index.js";

for (const run of [runFfmpeg, runFfprobe, execFfmpeg, execFfprobe]) {
  // oxlint-disable-next-line no-await-in-loop -- Each regression owns its child and pending stdin write.
  await test(`${run.name} preserves the timeout error while stdin is pending`, async () => {
    const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-timeout-"));
    let child: ChildProcess | undefined;
    let closed: Promise<void> | undefined;
    try {
      for (const tool of ["ffmpeg", "ffprobe"]) {
        writeFileSync(
          join(distDir, `${tool}.js`),
          "export default async function() { setInterval(() => {}, 1000); return {}; }",
        );
        writeFileSync(join(distDir, `${tool}_g.wasm`), "");
      }
      await assert.rejects(
        run([], {
          distDir,
          stdin: Buffer.alloc(10 * 1024 * 1024),
          timeoutMs: 500,
          onSpawn(spawned) {
            child = spawned;
            closed = new Promise((resolveClosed) => {
              spawned.once("close", () => {
                resolveClosed();
              });
            });
          },
        }),
        /wasm timed out after 500ms/u,
      );
      await closed;
      assert.notEqual(child?.signalCode, null, "timed out child is still running");
    } finally {
      child?.kill("SIGKILL");
      await closed;
      rmSync(distDir, { recursive: true, force: true });
    }
  });
}

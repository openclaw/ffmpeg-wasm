import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const api of ["runFfmpeg", "runFfprobe", "execFfmpeg", "execFfprobe"]) {
  for (const missingCwd of [false, true]) {
    // oxlint-disable-next-line no-await-in-loop -- Isolate each subprocess regression sequentially.
    await test(`${api} contains onSpawn failures with ${missingCwd ? "invalid" : "valid"} cwd`, async () => {
      const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-spawn-"));
      try {
        for (const tool of ["ffmpeg", "ffprobe"]) {
          writeFileSync(
            join(distDir, `${tool}.js`),
            "export default async function () { setInterval(() => {}, 1000); return {}; }",
          );
          writeFileSync(join(distDir, `${tool}_g.wasm`), "");
        }
        const source = `
import assert from "node:assert/strict";
import { ${api} as run } from ${JSON.stringify(new URL("../src/index.js", import.meta.url).href)};
let child;
let closed;
let watchdog;
let expired = false;
const failure = new Error("caller setup failed");
try {
  await assert.rejects(run([], {
    distDir: ${JSON.stringify(distDir)},
    cwd: ${JSON.stringify(missingCwd ? join(distDir, "missing") : distDir)},
    stdinMode: "ignore",
    timeoutMs: 30_000,
    onSpawn(spawned) {
      child = spawned;
      closed = new Promise(resolve => child.once("close", resolve));
      watchdog = setTimeout(() => { expired = true; if (child.pid) child.kill("SIGKILL"); }, 2000);
      throw failure;
    },
  }), error => error === failure);
  await closed;
  assert.equal(expired, false, "rejected setup left the child running");
  if (child.pid) assert.equal(child.signalCode, "SIGKILL");
} finally {
  clearTimeout(watchdog);
  if (child?.pid) child.kill("SIGKILL");
}
`;
        const result = await new Promise<{ code: number | null; stderr: string }>(
          (resolveRun, reject) => {
            const host = spawn(process.execPath, ["--input-type=module", "--eval", source], {
              detached: process.platform !== "win32",
              stdio: ["ignore", "ignore", "pipe"],
              timeout: 5000,
            });
            let stderr = "";
            host.stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
            });
            host.once("error", reject);
            host.once("close", (code) => {
              resolveRun({ code, stderr });
            });
          },
        );
        assert.equal(result.code, 0, result.stderr);
      } finally {
        rmSync(distDir, { recursive: true, force: true });
      }
    });
  }
}

#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const signals = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

if (process.platform === "win32") {
  console.log("OS signal verification requires POSIX; run on macOS or Linux.");
} else {
  for (const tool of ["ffmpeg", "ffprobe"] as const) {
    const args =
      tool === "ffmpeg"
        ? ["-loglevel", "debug", "-f", "wav", "-i", "pipe:0", "-f", "null", "-"]
        : ["-loglevel", "debug", "-f", "wav", "-show_format", "pipe:0"];
    const api = tool === "ffmpeg" ? "execFfmpeg" : "execFfprobe";
    const source = `
import assert from "node:assert/strict";
import { ${api} as exec } from ${JSON.stringify(new URL("../src/index.js", import.meta.url).href)};
let child;
let received = 0;
const cancel = () => { received++; child.kill("SIGKILL"); };
process.once("SIGTERM", cancel);
const signals = ["SIGHUP", "SIGINT", "SIGTERM"];
const before = signals.map(signal => process.listenerCount(signal));
try {
  const running = exec(${JSON.stringify(args)}, {
    onSpawn(spawned) {
      child = spawned;
      console.log("child-pid=" + child.pid);
    },
    timeoutMs: 20_000,
  });
  assert.deepEqual(signals.map(signal => process.listenerCount(signal)), before);
  assert.equal(await running, 137);
  assert.equal(received, 1);
  console.log("host-survived");
} finally {
  process.off("SIGTERM", cancel);
  child?.kill("SIGKILL");
}
`;
    // oxlint-disable-next-line no-await-in-loop -- Keep wasm processes and OS signal probes sequential.
    const library = await signalRun(["--input-type=module", "--eval", source], "SIGTERM");
    assert.equal(library.code, 0, library.stderr);
    assert.match(library.stdout, /host-survived/u);
    console.log(`ok: ${api} preserves host listeners and caller-owned cancellation`);

    for (const signal of signals) {
      const cliPath = resolve(root, "lib", "src", tool === "ffmpeg" ? "cli.js" : "ffprobe-cli.js");
      // oxlint-disable-next-line no-await-in-loop -- Each signal probe owns one CLI process.
      const result = await signalRun([cliPath, ...args], signal);
      const expected = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal];
      assert.equal(result.code, expected, result.stderr);
      console.log(`ok: ${tool} CLI forwards ${signal} and exits ${expected}`);
    }
  }
}

function signalRun(args: string[], signal: NodeJS.Signals) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveRun, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        // Keep stdin open so the real wasm tool blocks reading a WAV header.
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let sent = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        const pid = /child-pid=(?<pid>\d+)/u.exec(stdout)?.groups?.pid;
        if (pid !== undefined) {
          try {
            process.kill(Number(pid), "SIGKILL");
          } catch {
            // The child may already have exited with its host.
          }
        }
        reject(new Error(`Timed out waiting for wasm signal proof: ${stderr}`));
      }, 30_000);
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (!sent && stderr.includes("Opening 'pipe:0' for reading")) {
          sent = true;
          child.kill(signal);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (!sent) {
          reject(new Error(`Tool exited before loading wasm and opening stdin: ${stderr}`));
          return;
        }
        resolveRun({ code, stdout, stderr });
      });
    },
  );
}

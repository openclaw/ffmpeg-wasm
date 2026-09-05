import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { forwardCliProcessSignals } from "../src/cli-host-signals.js";
import { execFfmpeg, execFfprobe } from "../src/index.js";

const forwardedSignals = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

await test("execFfmpeg does not install host signal listeners", async () => {
  await assertNoHostSignalListeners("ffmpeg", (distDir) =>
    execFfmpeg([], { distDir, stdinMode: "ignore" }),
  );
});

await test("execFfprobe does not install host signal listeners", async () => {
  await assertNoHostSignalListeners("ffprobe", (distDir) =>
    execFfprobe([], { distDir, stdinMode: "ignore" }),
  );
});

await test("CLI signal helper forwards SIGTERM to the child and exits the host", async () => {
  const kills: (NodeJS.Signals | number | undefined)[] = [];
  const exits: number[] = [];
  const child = {
    kill(signal?: NodeJS.Signals | number) {
      kills.push(signal);
      return true;
    },
  };
  const cleanup = forwardCliProcessSignals(child, {
    exit: (code) => {
      exits.push(code);
    },
    stuckMs: 1,
  });
  try {
    process.emit("SIGTERM");
    assert.deepEqual(kills, ["SIGTERM"]);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 15);
    });
    assert.deepEqual(kills, ["SIGTERM", "SIGKILL"]);
    assert.deepEqual(exits, [143]);
  } finally {
    cleanup();
  }
});

await test("CLI signal helper cleanup cancels a pending host exit", async () => {
  const exits: number[] = [];
  const child = {
    kill() {
      return true;
    },
  };
  const cleanup = forwardCliProcessSignals(child, {
    exit: (code) => {
      exits.push(code);
    },
    stuckMs: 20,
  });
  process.emit("SIGINT");
  cleanup();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 40);
  });
  assert.deepEqual(exits, []);
});

async function assertNoHostSignalListeners(
  tool: "ffmpeg" | "ffprobe",
  start: (distDir: string) => Promise<number>,
): Promise<void> {
  const distDir = writeMockDist(tool, immediateExitModule());
  const before = Object.fromEntries(
    forwardedSignals.map((signal) => [signal, process.listenerCount(signal)]),
  );
  const running = start(distDir);
  try {
    for (const signal of forwardedSignals) {
      assert.equal(
        process.listenerCount(signal),
        before[signal],
        `${tool} installed a ${signal} listener on the host process`,
      );
    }
    assert.equal(await running, 0);
  } finally {
    await running.catch(() => {});
    rmSync(distDir, { recursive: true, force: true });
  }
}

function writeMockDist(tool: string, moduleSource: string): string {
  const distDir = mkdtempSync(join(tmpdir(), "ffmpeg-wasm-signals-"));
  writeFileSync(join(distDir, `${tool}.js`), moduleSource);
  writeFileSync(join(distDir, `${tool}_g.wasm`), "");
  return distDir;
}

function immediateExitModule(): string {
  return `
export default function createModule(options) {
  queueMicrotask(() => {
    options.onExit(0);
  });
  return Promise.resolve({});
}
`;
}

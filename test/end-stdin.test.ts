import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { endChildStdin } from "../src/end-stdin.js";

await test("endChildStdin writes a payload that the child can read", async () => {
  const payload = Buffer.from("hello-stdin");
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
        let n = 0;
        process.stdin.on("data", (chunk) => {
          n += chunk.length;
        });
        process.stdin.on("end", () => {
          process.stdout.write(String(n));
        });
      `,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  const stdinErrors: Error[] = [];
  endChildStdin(child.stdin, payload, collectStdinError(stdinErrors));

  const [stdout, status] = await Promise.all([
    readAll(child.stdout),
    new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        resolve(code);
      });
    }),
  ]);

  assert.deepEqual(stdinErrors, []);
  assert.equal(status, 0);
  assert.equal(stdout.toString("utf8"), String(payload.length));
});

await test("writing stdin after the child has closed does not become an uncaughtException", () => {
  const helperHref = pathToFileURL(
    fileURLToPath(new URL("../src/end-stdin.js", import.meta.url)),
  ).href;
  const source = `
import { spawn } from "node:child_process";
import { endChildStdin } from ${JSON.stringify(helperHref)};

const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
  stdio: ["pipe", "ignore", "ignore"],
});
endChildStdin(child.stdin, Buffer.alloc(10 * 1024 * 1024), () => {});
await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
await new Promise((resolve) => {
  setTimeout(resolve, 100);
});
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `expected child to exit 0 without uncaughtException, got ${String(result.status)}\n${result.stderr}`,
  );
});

function collectStdinError(errors: Error[]): (error: Error) => void {
  return (error: Error) => {
    errors.push(error);
  };
}

async function readAll(stream: NodeJS.ReadableStream | null): Promise<Buffer> {
  if (!stream) {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

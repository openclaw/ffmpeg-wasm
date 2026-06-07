#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const port = String(4174 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;
const screenshotPath = resolve(root, ".tmp", "playground-e2e.png");
const chromePath = process.env.CHROME_PATH ?? resolveChromePath();

interface CdpError {
  message: string;
}

interface CdpResponse {
  error?: CdpError;
  id?: number;
  result?: unknown;
}

interface RuntimeResult {
  result?: {
    value?: unknown;
  };
}

interface RenderState {
  bytes: number;
  name: string;
  operation: string;
}

interface Point {
  x: number;
  y: number;
}

class CdpClient {
  #id = 0;
  readonly #pending = new Map<
    number,
    {
      reject: (error: Error) => void;
      resolve: (value: unknown) => void;
    }
  >();
  readonly #socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
  }

  public static connect(url: string) {
    return new Promise<CdpClient>((resolvePromise, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => {
        const client = new CdpClient(socket);
        clients.set(socket, client);
        resolvePromise(client);
      });
      socket.addEventListener("message", (event) => {
        CdpClient.handleMessage(socket, event);
      });
      socket.addEventListener("error", () => {
        reject(new Error("Chrome DevTools WebSocket failed"));
      });
    });
  }

  public static handleMessage(socket: WebSocket, event: MessageEvent) {
    const client = clients.get(socket);
    if (!client) {
      return;
    }
    const response = asCdpResponse(parseJson(String(event.data)));
    if (typeof response.id !== "number") {
      return;
    }
    const pending = client.#pending.get(response.id);
    if (!pending) {
      return;
    }
    client.#pending.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error.message));
      return;
    }
    pending.resolve(response.result);
  }

  public send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.#id;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise<unknown>((resolvePromise, reject) => {
      this.#pending.set(id, { reject, resolve: resolvePromise });
    });
  }

  public close() {
    this.#socket.close();
  }
}

const clients = new WeakMap<WebSocket, CdpClient>();

const server = spawn(process.execPath, [resolve(root, "lib", "scripts", "playground-server.js")], {
  env: {
    ...process.env,
    FFMPEG_WASM_PLAYGROUND_PORT: port,
  },
});

try {
  await waitForServer(server);
  await assertHostGuard();
  const profileDir = await mkdtemp(join(tmpdir(), "ffmpeg-wasm-chrome-"));
  const chromeArgs = [
    `--remote-debugging-port=${Number(port) + 10}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--new-window",
    "--window-size=1440,1600",
    baseUrl,
  ];
  if (process.env.CI === "true" || process.env.PLAYGROUND_E2E_HEADLESS === "1") {
    chromeArgs.unshift("--headless=new", "--disable-gpu", "--no-sandbox");
  }
  const chrome = spawn(chromePath, chromeArgs);
  try {
    const cdp = await connectToPlayground(Number(port) + 10);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Page.bringToFront");
      await cdp.send("Page.navigate", { url: baseUrl });
      await waitFor(cdp, "document.readyState === 'complete'", 30_000);
      await clickSelector(cdp, "[data-testid=sample-button]");
      await waitFor(
        cdp,
        "document.querySelector('[data-testid=status-text]')?.textContent.trim() === 'Ready'",
        180_000,
      );
      await cdp.send("Runtime.evaluate", { expression: "delete globalThis.__lastRender" });
      await clickSelector(cdp, "[data-testid=render-button]");
      await waitFor(cdp, "!!globalThis.__lastRender", 120_000);
      const state = await readState(cdp);
      if (state.lastRender.operation !== "clip-mp4" || state.lastRender.bytes <= 1000) {
        throw new Error(`Unexpected render result: ${JSON.stringify(state.lastRender)}`);
      }
      if (!state.outputVideo || state.status !== "Rendered") {
        throw new Error(`Unexpected UI state: ${JSON.stringify(state)}`);
      }
      const screenshot = await cdp.send("Page.captureScreenshot", {
        captureBeyondViewport: true,
        format: "png",
      });
      await writeFile(screenshotPath, Buffer.from(asStringField(screenshot, "data"), "base64"));
      console.log(`playground e2e ok (${state.lastRender.name}, ${state.lastRender.bytes} bytes)`);
      console.log(`screenshot: ${screenshotPath}`);
    } catch (error) {
      await writeFailureState(cdp);
      throw error;
    } finally {
      cdp.close();
    }
  } finally {
    stop(chrome);
  }
} finally {
  stop(server);
}

function resolveChromePath() {
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(macChrome)) {
    return macChrome;
  }
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    if (result.status === 0) {
      const found = result.stdout.trim();
      if (found.length > 0) {
        return found;
      }
    }
  }
  throw new Error("Chrome not found. Set CHROME_PATH to run playground:e2e.");
}

async function assertHostGuard() {
  const status = await new Promise<number>((resolvePromise, reject) => {
    const request = httpRequest(
      {
        headers: {
          Host: `example.invalid:${port}`,
        },
        host: "127.0.0.1",
        method: "GET",
        path: "/",
        port: Number(port),
      },
      (response) => {
        response.resume();
        resolvePromise(response.statusCode ?? 0);
      },
    );
    request.on("error", reject);
    request.end();
  });
  if (status !== 403) {
    throw new Error(`Expected Host guard to reject rebinding request, got ${status}`);
  }
}

async function writeFailureState(cdp: CdpClient) {
  const state = await runtimeEvaluate(
    cdp,
    `JSON.stringify({
      url: location.href,
      status: document.querySelector('[data-testid=status-text]')?.textContent,
      source: document.querySelector('#sourceTitle')?.textContent,
      body: document.body.innerText.slice(0, 800)
    })`,
  );
  const value = state.result?.value;
  const renderedState = typeof value === "string" ? value : JSON.stringify(value ?? "");
  console.error(`playground e2e state: ${renderedState}`);
  const screenshot = await cdp.send("Page.captureScreenshot", {
    captureBeyondViewport: true,
    format: "png",
  });
  await writeFile(screenshotPath, Buffer.from(asStringField(screenshot, "data"), "base64"));
  console.error(`screenshot: ${screenshotPath}`);
}

async function connectToPlayground(debugPort: number) {
  const endpoint = await waitForDevtoolsEndpoint(debugPort);
  const targets = asTargets(await jsonGet(`${endpoint}/json/list`));
  const target =
    targets.find((candidate) => candidate.url.startsWith(baseUrl)) ??
    targets.find((candidate) => candidate.type === "page") ??
    targets[0];
  if (target === undefined) {
    throw new Error("Chrome did not open the playground");
  }
  return CdpClient.connect(target.webSocketDebuggerUrl);
}

async function waitForDevtoolsEndpoint(debugPort: number) {
  const endpoints = [`http://127.0.0.1:${debugPort}`, `http://[::1]:${debugPort}`];
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    for (const endpoint of endpoints) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- Polling Chrome startup must be sequential.
        const response = await fetch(`${endpoint}/json/version`);
        if (response.ok) {
          return endpoint;
        }
      } catch {
        // Try the other loopback address.
      }
    }
    // oxlint-disable-next-line no-await-in-loop -- Polling Chrome startup must be sequential.
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Chrome DevTools on port ${debugPort}`);
}

async function readState(cdp: CdpClient) {
  const result = await runtimeEvaluate(
    cdp,
    `JSON.stringify({
      status: document.querySelector('[data-testid=status-text]').textContent,
      outputTitle: document.querySelector('[data-testid=output-title]').textContent,
      outputMetrics: document.querySelector('[data-testid=output-metrics]').textContent,
      outputVideo: !!document.querySelector('[data-testid=output-viewer] video'),
      lastRender: globalThis.__lastRender
    })`,
  );
  const value = result.result?.value;
  if (typeof value !== "string") {
    throw new TypeError("Missing playground state");
  }
  const parsed = asRecord(parseJson(value));
  return {
    lastRender: asRenderState(parsed.lastRender),
    outputTitle: asString(parsed.outputTitle),
    outputVideo: parsed.outputVideo === true,
    status: asString(parsed.status),
  };
}

async function clickSelector(cdp: CdpClient, selector: string) {
  const point = await elementCenter(cdp, selector);
  await cdp.send("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mousePressed",
    x: point.x,
    y: point.y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mouseReleased",
    x: point.x,
    y: point.y,
  });
}

async function elementCenter(cdp: CdpClient, selector: string) {
  const result = await runtimeEvaluate(
    cdp,
    `JSON.stringify((() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })())`,
  );
  const value = result.result?.value;
  if (typeof value !== "string") {
    throw new TypeError(`Missing element ${selector}`);
  }
  return asPoint(parseJson(value));
}

async function runtimeEvaluate(cdp: CdpClient, expression: string) {
  return asRuntimeResult(
    await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    }),
  );
}

async function waitFor(cdp: CdpClient, expression: string, timeout = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    // oxlint-disable-next-line no-await-in-loop -- Polling CDP state must be sequential.
    const result = await runtimeEvaluate(cdp, expression);
    if (result.result?.value === true) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- Polling CDP state must be sequential.
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function waitForServer(serverProcess: ChildProcessWithoutNullStreams) {
  let output = "";
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Playground server did not start: ${output}`));
    }, 30_000);
    serverProcess.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(baseUrl)) {
        clearTimeout(timeout);
        resolvePromise();
      }
    });
    serverProcess.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    serverProcess.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Playground server exited with ${code}: ${output}`));
    });
  });
}

async function jsonGet(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const value: unknown = await response.json();
  return value;
}

function stop(child: ChildProcessWithoutNullStreams) {
  if (!child.killed) {
    child.kill();
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function asCdpResponse(value: unknown): CdpResponse {
  const record = asRecord(value);
  const errorRecord = record.error === undefined ? undefined : asRecord(record.error);
  return {
    error: errorRecord ? { message: asString(errorRecord.message) } : undefined,
    id: typeof record.id === "number" ? record.id : undefined,
    result: record.result,
  };
}

function asRuntimeResult(value: unknown): RuntimeResult {
  const record = asRecord(value);
  const result = record.result === undefined ? undefined : asRecord(record.result);
  return { result };
}

function asRenderState(value: unknown): RenderState {
  const record = asRecord(value);
  return {
    bytes: asNumber(record.bytes),
    name: asString(record.name),
    operation: asString(record.operation),
  };
}

function asPoint(value: unknown): Point {
  const record = asRecord(value);
  return {
    x: asNumber(record.x),
    y: asNumber(record.y),
  };
}

function asTargets(value: unknown) {
  if (!Array.isArray(value)) {
    throw new TypeError("Expected targets array");
  }
  return value.map((item) => {
    const record = asRecord(item);
    return {
      url: asString(record.url),
      type: typeof record.type === "string" ? record.type : "",
      webSocketDebuggerUrl: asString(record.webSocketDebuggerUrl),
    };
  });
}

function asStringField(value: unknown, key: string) {
  return asString(asRecord(value)[key]);
}

function asRecord(value: unknown) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON records are validated at field reads.
    return value as Record<string, unknown>;
  }
  throw new TypeError("Expected object");
}

function asString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  throw new Error("Expected string");
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error("Expected number");
}

async function sleep(ms: number) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

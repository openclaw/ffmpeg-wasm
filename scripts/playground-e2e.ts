#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const root = resolve(import.meta.dirname, "..", "..");
const port = String(4174 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;
const staticMode = process.env.PLAYGROUND_E2E_STATIC === "1";
const mode = staticMode ? "static" : "server";
const screenshotPath = resolve(root, ".tmp", `playground-e2e-${mode}.png`);
await mkdir(dirname(screenshotPath), { recursive: true });
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

interface ProgressState {
  detail: string;
  value: string;
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

const server = staticMode ? startStaticServer() : startPlaygroundServer();

try {
  await waitForServer(server);
  await assertHostGuard(staticMode);
  if (staticMode) {
    await assertStaticMode();
  }
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
      await waitFor(
        cdp,
        "document.querySelector('[data-testid=preset-video-mp4]')?.classList.contains('active') && document.querySelector('[data-testid=command-preview]')?.value.includes('-c:v mpeg4')",
      );
      await waitFor(cdp, "!document.querySelector('[data-testid=preset-audio-mp3]')?.disabled");
      await runtimeEvaluate(
        cdp,
        `(async () => {
          const video = document.querySelector('#sourceViewer video');
          if (!video) return false;
          const seeked = new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
          video.currentTime = 2;
          await seeked;
          return true;
        })()`,
      );
      await waitFor(
        cdp,
        "document.querySelector('#parameterTitle')?.textContent === 'Poster frame' && document.querySelector('#frameInput')?.value === '2'",
      );
      await clickSelector(cdp, "[data-testid=preset-video-mp4]");
      await waitFor(
        cdp,
        "!document.querySelector('.video-quality-field')?.classList.contains('hidden') && document.querySelector('[data-testid=command-preview]')?.value.includes('scale=1280:-2,format=yuv420p') && document.querySelector('[data-testid=command-preview]')?.value.includes('-c:v mpeg4')",
      );
      await cdp.send("Runtime.evaluate", { expression: "delete globalThis.__lastRender" });
      await clickSelector(cdp, "[data-testid=render-button]");
      await waitFor(cdp, "!!globalThis.__lastRender", 120_000);
      const videoState = await readState(cdp);
      if (videoState.lastRender.operation !== "video-mp4" || videoState.lastRender.bytes <= 1000) {
        throw new Error(`Unexpected video render result: ${JSON.stringify(videoState.lastRender)}`);
      }
      if (staticMode && videoState.lastProgress.value !== "100%") {
        throw new Error(`Missing video progress state: ${JSON.stringify(videoState.lastProgress)}`);
      }
      if (!videoState.outputVideo || videoState.status !== "Rendered") {
        throw new Error(`Unexpected video UI state: ${JSON.stringify(videoState)}`);
      }
      await clickSelector(cdp, "[data-testid=preset-audio-mp3]");
      await cdp.send("Runtime.evaluate", { expression: "delete globalThis.__lastRender" });
      await clickSelector(cdp, "[data-testid=render-button]");
      await waitFor(cdp, "globalThis.__lastRender?.operation === 'audio-mp3'", 120_000);
      const audioState = await readState(cdp);
      if (audioState.lastRender.bytes <= 1000 || !audioState.outputAudio) {
        throw new Error(`Unexpected audio render result: ${JSON.stringify(audioState)}`);
      }
      const screenshot = await cdp.send("Page.captureScreenshot", {
        captureBeyondViewport: true,
        format: "png",
      });
      await writeFile(screenshotPath, Buffer.from(asStringField(screenshot, "data"), "base64"));
      console.log(
        `playground e2e ok (${mode}, ${videoState.lastRender.name}, ${audioState.lastRender.name})`,
      );
      console.log(`screenshot: ${screenshotPath}`);
    } catch (error) {
      await writeFailureState(cdp);
      throw error;
    } finally {
      try {
        await cdp.send("Browser.close");
      } catch {
        // Chrome may already be gone after a browser-side failure.
      }
      cdp.close();
    }
  } finally {
    await stop(chrome);
  }
} finally {
  await stop(server);
}

function startPlaygroundServer() {
  return spawn(process.execPath, [resolve(root, "lib", "scripts", "playground-server.js")], {
    env: {
      ...process.env,
      FFMPEG_WASM_PLAYGROUND_PORT: port,
    },
  });
}

function startStaticServer() {
  const siteDir = resolve(root, "dist", "docs-site");
  return createServer((request, response) => {
    // oxlint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- Node HTTP request handlers are callback based.
    handleStaticRequest(siteDir, request.url ?? "/", response).catch((error: unknown) => {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Static server failed");
    });
  }).listen(Number(port), "127.0.0.1");
}

async function handleStaticRequest(siteDir: string, rawUrl: string, response: ServerResponse) {
  const url = new URL(rawUrl, baseUrl);
  if (url.pathname.startsWith("/api/")) {
    response.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
    response.end("Not found");
    return;
  }
  const filePath = staticFilePath(siteDir, url.pathname);
  if (!existsSync(filePath)) {
    response.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
    response.end("Not found");
    return;
  }
  const size = statSync(filePath).size;
  response.writeHead(200, {
    ...securityHeaders(contentType(filePath)),
    "Content-Length": String(size),
  });
  await pipeline(createReadStream(filePath), response);
}

function staticFilePath(siteDir: string, pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const candidate = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const filePath = resolve(siteDir, `.${candidate}`);
  const rel = relative(siteDir, filePath);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || rel === "") {
    return resolve(siteDir, "404");
  }
  if (!existsSync(filePath) && extname(filePath) === "") {
    return resolve(filePath, "index.html");
  }
  return filePath;
}

function securityHeaders(contentTypeValue: string) {
  return {
    "Content-Type": contentTypeValue,
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function contentType(filePath: string) {
  switch (extname(filePath)) {
    case ".css": {
      return "text/css; charset=utf-8";
    }
    case ".html": {
      return "text/html; charset=utf-8";
    }
    case ".js": {
      return "text/javascript; charset=utf-8";
    }
    case ".json": {
      return "application/json; charset=utf-8";
    }
    case ".mp4": {
      return "video/mp4";
    }
    case ".webm": {
      return "video/webm";
    }
    case ".png": {
      return "image/png";
    }
    case ".wasm": {
      return "application/wasm";
    }
    default: {
      return "text/javascript; charset=utf-8";
    }
  }
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

async function assertHostGuard(expectForbidden: boolean) {
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
  const expected = expectForbidden ? 200 : 403;
  if (status !== expected) {
    throw new Error(`Expected Host guard status ${expected}, got ${status}`);
  }
}

async function assertStaticMode() {
  const apiStatus = await responseStatus("/api/sample");
  if (apiStatus !== 404) {
    throw new Error(`Expected static mode to reject API routes, got ${apiStatus}`);
  }
  const headers = await responseHeaders("/");
  if (headers.get("cross-origin-opener-policy") !== "same-origin") {
    throw new Error("Static mode missing Cross-Origin-Opener-Policy");
  }
  if (headers.get("cross-origin-embedder-policy") !== "require-corp") {
    throw new Error("Static mode missing Cross-Origin-Embedder-Policy");
  }
}

async function responseStatus(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  await response.body?.cancel();
  return response.status;
}

async function responseHeaders(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  await response.body?.cancel();
  return response.headers;
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
      outputAudio: !!document.querySelector('[data-testid=output-viewer] audio'),
      outputVideo: !!document.querySelector('[data-testid=output-viewer] video'),
      lastProgress: globalThis.__lastProgress,
      lastRender: globalThis.__lastRender
    })`,
  );
  const value = result.result?.value;
  if (typeof value !== "string") {
    throw new TypeError("Missing playground state");
  }
  const parsed = asRecord(parseJson(value));
  return {
    lastProgress: asProgressState(parsed.lastProgress),
    lastRender: asRenderState(parsed.lastRender),
    outputAudio: parsed.outputAudio === true,
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

async function waitForServer(
  serverProcess: ChildProcessWithoutNullStreams | ReturnType<typeof createServer>,
) {
  if (!("stdout" in serverProcess)) {
    await waitForStaticServer();
    return;
  }
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

async function waitForStaticServer() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Polling local static server startup must be sequential.
      const response = await fetch(baseUrl);
      // oxlint-disable-next-line no-await-in-loop -- Polling local static server startup must be sequential.
      await response.body?.cancel();
      if (response.ok) {
        return;
      }
    } catch {
      // Wait for listen to bind.
    }
    // oxlint-disable-next-line no-await-in-loop -- Polling local static server startup must be sequential.
    await sleep(250);
  }
  throw new Error("Static playground server did not start");
}

async function jsonGet(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const value: unknown = await response.json();
  return value;
}

async function stop(child: ChildProcessWithoutNullStreams | ReturnType<typeof createServer>) {
  if (!("killed" in child)) {
    await new Promise<void>((resolvePromise, reject) => {
      child.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise();
      });
    });
    return;
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  if (await waitForExit(child, 5000)) {
    return;
  }
  child.kill("SIGKILL");
  if (!(await waitForExit(child, 5000))) {
    throw new Error(`Process ${String(child.pid)} did not exit`);
  }
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }
  try {
    await once(child, "exit", { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return false;
    }
    throw error;
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

function asProgressState(value: unknown): ProgressState {
  const record = asRecord(value);
  return {
    detail: asString(record.detail),
    value: asString(record.value),
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

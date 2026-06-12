type Operation = "audio-mp3" | "audio-wav" | "clip-mp4" | "hash-raw" | "poster-png" | "video-mp4";
export type WorkbenchOperation = Operation;
type StatusMode = "busy" | "error" | "idle";

interface Preset {
  detail: string;
  extension: string;
  id: Operation;
  name: string;
  tone: "amber" | "blue" | "coral" | "green";
}

interface ProbeStream {
  codec_name?: string;
  codec_type: string;
  duration?: string;
  height?: number;
  sample_rate?: string;
  width?: number;
}

interface ProbeResult {
  format?: {
    duration?: string;
  };
  streams?: ProbeStream[];
}

function isProbeResult(value: unknown): value is ProbeResult {
  return typeof value === "object" && value !== null;
}

interface RenderOutput {
  blob: Blob;
  ffmpegArgs?: string | null;
  name: string;
  url?: string;
}

interface LastRenderState {
  args: string[] | null;
  bytes: number;
  name: string;
  operation: Operation;
}

interface LastProgressState {
  detail: string;
  value: string;
}

interface WorkbenchState {
  commandEdited: boolean;
  file: File | null;
  inputUrl: string | null;
  lastOutput: RenderOutput | null;
  operation: Operation;
  probe: ProbeResult | null;
}

interface BrowserFileHandle {
  createWritable: () => Promise<{
    close: () => Promise<void>;
    write: (blob: Blob) => Promise<void>;
  }>;
}

interface BrowserSaveOptions {
  id: string;
  startIn: string;
  suggestedName: string;
  types: {
    accept: Record<string, string[]>;
    description: string;
  }[];
}

interface BrowserToolResult {
  exitCode: number;
  outputFile?: ArrayBuffer;
  stderrText: string;
  stdoutText: string;
}

interface BrowserWorkerSuccess {
  exitCode: number;
  id: number;
  ok: true;
  outputFile?: ArrayBuffer;
  stderrText: string;
  stdoutText: string;
}

interface BrowserWorkerFailure {
  error: string;
  id: number;
  ok: false;
  stderrText?: string;
}

interface BrowserWorkerProgress {
  id: number;
  progress: {
    frame?: number;
    outTimeSeconds?: number;
    phase: "continue" | "end";
    speed?: string;
  };
  type: "progress";
}

type BrowserWorkerResponse = BrowserWorkerFailure | BrowserWorkerProgress | BrowserWorkerSuccess;

interface BrowserToolProgress {
  frame?: number;
  outTimeSeconds?: number;
  phase: "continue" | "end";
  speed?: string;
}

type BrowserGlobal = typeof globalThis & {
  __lastProgress?: LastProgressState;
  __lastRender?: LastRenderState;
  showSaveFilePicker?: (options: BrowserSaveOptions) => Promise<BrowserFileHandle>;
};

const browserGlobal = globalThis as BrowserGlobal;

const BROWSER_TOOL_ABSOLUTE_TIMEOUT_MS = 15 * 60_000;
const BROWSER_TOOL_IDLE_TIMEOUT_MS = 180_000;

const presets: Preset[] = [
  {
    detail: "MP4 stream copy",
    extension: ".mp4",
    id: "clip-mp4",
    name: "Lossless clip",
    tone: "green",
  },
  {
    detail: "Downscaled MP4",
    extension: ".mp4",
    id: "video-mp4",
    name: "Smaller video",
    tone: "green",
  },
  {
    detail: "Scaled still frame",
    extension: ".png",
    id: "poster-png",
    name: "Poster frame",
    tone: "blue",
  },
  {
    detail: "Portable audio",
    extension: ".mp3",
    id: "audio-mp3",
    name: "MP3 extract",
    tone: "amber",
  },
  {
    detail: "Speech ready PCM",
    extension: ".wav",
    id: "audio-wav",
    name: "WAV extract",
    tone: "coral",
  },
  {
    detail: "32 x 32 gray frame",
    extension: ".raw",
    id: "hash-raw",
    name: "Frame hash",
    tone: "blue",
  },
];

const state: WorkbenchState = {
  commandEdited: false,
  file: null,
  inputUrl: null,
  lastOutput: null,
  operation: "clip-mp4",
  probe: null,
};

const playgroundToken =
  document.querySelector("meta[name='playground-token']")?.getAttribute("content") ?? "";

function requireElement<T extends Element>(
  selector: string,
  constructor: new (...args: never[]) => T,
) {
  const element = document.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function sourceFile() {
  if (state.file === null) {
    throw new Error("Load media first");
  }
  return state.file;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(raw: string | null | undefined) {
  if (raw === null || raw === undefined || raw.length === 0) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
}

function runAsync(action: () => Promise<void>): () => void {
  return () => {
    // oxlint-disable-next-line no-void -- Event listeners cannot return promises.
    void runAndReport(action);
  };
}

async function runAndReport(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
}

const elements = {
  bitrateSelect: requireElement("#bitrateSelect", HTMLSelectElement),
  channelsSelect: requireElement("#channelsSelect", HTMLSelectElement),
  commandInput: requireElement("#commandInput", HTMLTextAreaElement),
  copyButton: requireElement("#copyButton", HTMLButtonElement),
  durationInput: requireElement("#durationInput", HTMLInputElement),
  fileInput: requireElement("#fileInput", HTMLInputElement),
  frameInput: requireElement("#frameInput", HTMLInputElement),
  outputMetrics: requireElement("#outputMetrics", HTMLElement),
  outputTitle: requireElement("#outputTitle", HTMLElement),
  outputViewer: requireElement("#outputViewer", HTMLElement),
  parameterTitle: requireElement("#parameterTitle", HTMLElement),
  presetArgsButton: requireElement("#presetArgsButton", HTMLButtonElement),
  presetList: requireElement("#presetList", HTMLElement),
  progressBar: requireElement("#progressBar", HTMLElement),
  progressDetail: requireElement("#progressDetail", HTMLElement),
  progressPanel: requireElement("#progressPanel", HTMLElement),
  progressValue: requireElement("#progressValue", HTMLElement),
  qualitySelect: requireElement("#qualitySelect", HTMLSelectElement),
  renderButton: requireElement("#renderButton", HTMLButtonElement),
  renderSaveButton: requireElement("#renderSaveButton", HTMLButtonElement),
  sampleButton: requireElement("#sampleButton", HTMLButtonElement),
  sampleRateSelect: requireElement("#sampleRateSelect", HTMLSelectElement),
  saveButton: requireElement("#saveButton", HTMLButtonElement),
  sourceMetrics: requireElement("#sourceMetrics", HTMLElement),
  sourceTitle: requireElement("#sourceTitle", HTMLElement),
  sourceViewer: requireElement("#sourceViewer", HTMLElement),
  startInput: requireElement("#startInput", HTMLInputElement),
  statusPill: requireElement("[data-testid='status-pill']", HTMLElement),
  statusText: requireElement("#statusText", HTMLElement),
  widthSelect: requireElement("#widthSelect", HTMLSelectElement),
};

renderPresets();
bindEvents();
updateControls();
updateCommand();
configureBackendAvailability();

function bindEvents() {
  elements.fileInput.addEventListener(
    "change",
    runAsync(async () => {
      const file = elements.fileInput.files?.[0];
      if (file) {
        await setSourceFile(file);
      }
    }),
  );
  elements.sampleButton.addEventListener("click", runAsync(loadSample));
  elements.renderButton.addEventListener(
    "click",
    runAsync(() => renderOutput(false)),
  );
  elements.renderSaveButton.addEventListener(
    "click",
    runAsync(() => renderOutput(true)),
  );
  elements.saveButton.addEventListener("click", runAsync(saveLastOutput));
  elements.copyButton.addEventListener(
    "click",
    runAsync(async () => {
      await navigator.clipboard?.writeText(elements.commandInput.value);
      setStatus("Copied command", "idle");
    }),
  );
  elements.commandInput.addEventListener("input", () => {
    state.commandEdited = elements.commandInput.value !== displayCommand();
  });
  elements.presetArgsButton.addEventListener("click", () => {
    state.commandEdited = false;
    updateCommand();
  });
  for (const input of [
    elements.startInput,
    elements.durationInput,
    elements.frameInput,
    elements.widthSelect,
    elements.qualitySelect,
    elements.bitrateSelect,
    elements.sampleRateSelect,
    elements.channelsSelect,
  ]) {
    input.addEventListener("input", updateCommand);
    input.addEventListener("change", updateCommand);
  }
}

function configureBackendAvailability() {
  if (hasServerBackend()) {
    return;
  }
  setStatus("Browser ffmpac", "idle");
}

function renderPresets() {
  elements.presetList.replaceChildren(
    ...presets.map((preset) => {
      const button = document.createElement("button");
      button.className = `preset-card${preset.id === state.operation ? " active" : ""}`;
      button.dataset.operation = preset.id;
      button.dataset.testid = `preset-${preset.id}`;
      button.dataset.tone = preset.tone;
      button.type = "button";
      button.innerHTML = `
        <span class="preset-mark" aria-hidden="true"></span>
        <span>
          <span class="preset-name">${preset.name}</span>
          <span class="preset-detail">${preset.detail}</span>
        </span>
        <span class="preset-ext">${preset.extension}</span>
      `;
      button.addEventListener("click", () => {
        selectOperation(preset.id);
      });
      return button;
    }),
  );
}

async function loadSample() {
  setStatus("Loading sample", "busy");
  const response = await fetch(hasServerBackend() ? "/api/sample" : "sample.webm", {
    headers: hasServerBackend() ? playgroundHeaders() : {},
  });
  if (!response.ok) {
    await failFromResponse(response);
  }
  const blob = await response.blob();
  selectOperation("video-mp4");
  await setSourceFile(new File([blob], "sample.webm", { type: "video/webm" }));
}

async function setSourceFile(file: File) {
  state.file = file;
  state.probe = null;
  state.lastOutput = null;
  if (state.inputUrl !== null) {
    URL.revokeObjectURL(state.inputUrl);
  }
  state.inputUrl = URL.createObjectURL(file);
  elements.sourceTitle.textContent = file.name;
  elements.outputTitle.textContent = "Waiting";
  elements.saveButton.disabled = true;
  setSourceViewer(file, state.inputUrl);
  setOutputEmpty();
  setMetrics(elements.sourceMetrics, ["-", "-", "-", formatBytes(file.size)]);
  setMetrics(elements.outputMetrics, ["-", "-", "-"]);
  updateCommand();
  setStatus("Probing", "busy");
  try {
    state.probe = await probeFile(file);
    updateSourceMetrics(file, state.probe);
    setStatus("Ready", "idle");
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
}

async function probeFile(file: File): Promise<ProbeResult> {
  if (!hasServerBackend()) {
    return probeFileInBrowser(file);
  }
  const response = await fetch("/api/probe", {
    body: file,
    headers: {
      "Content-Type": "application/octet-stream",
      ...playgroundHeaders(),
      "X-File-Name": safeHeaderName(file.name),
    },
    method: "POST",
  });
  if (!response.ok) {
    await failFromResponse(response);
  }
  const parsed: unknown = await response.json();
  if (!isProbeResult(parsed)) {
    throw new Error("Invalid probe response");
  }
  return parsed;
}

async function renderOutput(saveAfterRender: boolean) {
  if (state.file === null) {
    setStatus("Load media first", "error");
    return;
  }
  if (state.commandEdited) {
    setStatus("Use preset args before rendering", "error");
    return;
  }

  let saveHandle: BrowserFileHandle | null = null;
  if (saveAfterRender && browserGlobal.showSaveFilePicker) {
    const showSaveFilePicker = browserGlobal.showSaveFilePicker;
    try {
      saveHandle = await showSaveFilePicker(savePickerOptions(null));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Save canceled", "idle");
        return;
      }
      throw error;
    }
  }

  setStatus("Rendering", "busy");
  showProgress("Preparing ffmpac", null);
  elements.renderButton.disabled = true;
  elements.renderSaveButton.disabled = true;
  try {
    const rendered = await renderWithBackend();
    setLastOutput(rendered);
    if (saveHandle !== null) {
      await writeBlobToHandle(saveHandle, rendered.blob);
      setStatus("Saved", "idle");
    } else if (saveAfterRender) {
      downloadBlob(rendered.blob, rendered.name);
      setStatus("Downloaded", "idle");
    } else {
      setStatus("Rendered", "idle");
    }
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
    hideProgress();
    elements.renderButton.disabled = false;
    elements.renderSaveButton.disabled = false;
  }
}

function setLastOutput(output: RenderOutput) {
  if (state.lastOutput?.url !== undefined) {
    URL.revokeObjectURL(state.lastOutput.url);
  }
  const url = URL.createObjectURL(output.blob);
  state.lastOutput = { ...output, url };
  elements.outputTitle.textContent = output.name;
  elements.saveButton.disabled = false;
  setOutputViewer(output.blob, url);
  const delta = state.file === null ? 0 : output.blob.size - state.file.size;
  setMetrics(elements.outputMetrics, [
    /\.[^.]+$/u.exec(output.name)?.[0] ?? currentPreset().extension,
    formatBytes(output.blob.size),
    formatDelta(delta),
  ]);
  // oxlint-disable-next-line no-underscore-dangle -- Stable browser E2E test hook.
  browserGlobal.__lastRender = {
    args: parseArgs(output.ffmpegArgs),
    bytes: output.blob.size,
    name: output.name,
    operation: state.operation,
  };
}

async function saveLastOutput() {
  if (state.lastOutput === null) {
    return;
  }
  if (browserGlobal.showSaveFilePicker) {
    const showSaveFilePicker = browserGlobal.showSaveFilePicker;
    try {
      const handle = await showSaveFilePicker(savePickerOptions());
      await writeBlobToHandle(handle, state.lastOutput.blob);
      setStatus("Saved", "idle");
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Save canceled", "idle");
        return;
      }
      setStatus(errorMessage(error), "error");
      return;
    }
  }
  downloadBlob(state.lastOutput.blob, state.lastOutput.name);
  setStatus("Downloaded", "idle");
}

function setSourceViewer(file: File, url: string) {
  elements.sourceViewer.className = "media-frame";
  const element = mediaElement(file.type, url, file.name);
  if (element instanceof HTMLVideoElement) {
    bindSourceVideo(element);
  }
  elements.sourceViewer.replaceChildren(element);
}

function setOutputViewer(blob: Blob, url: string) {
  elements.outputViewer.className = "media-frame";
  elements.outputViewer.replaceChildren(mediaElement(blob.type, url, "Rendered output"));
}

function mediaElement(type: string, url: string, label: string): HTMLElement {
  if (type.startsWith("video/")) {
    const video = document.createElement("video");
    video.controls = true;
    video.src = url;
    video.title = label;
    return video;
  }
  if (type.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = url;
    audio.title = label;
    return audio;
  }
  if (type.startsWith("image/")) {
    const image = document.createElement("img");
    image.alt = label;
    image.src = url;
    return image;
  }
  const block = document.createElement("div");
  block.className = "raw-output";
  block.innerHTML = `<strong>Raw frame bytes</strong><span>${formatBytes(
    state.lastOutput?.blob.size ?? 0,
  )}</span>`;
  return block;
}

function bindSourceVideo(video: HTMLVideoElement) {
  video.addEventListener("seeked", () => {
    selectPosterFrame(video.currentTime);
  });
}

function selectPosterFrame(seconds: number) {
  elements.frameInput.value = formatSeconds(seconds);
  if (state.operation !== "poster-png") {
    selectOperation("poster-png");
    return;
  }
  updateCommand();
}

function selectOperation(operation: Operation) {
  state.operation = operation;
  state.commandEdited = false;
  renderPresets();
  updateControls();
  updateCommand();
}

function setOutputEmpty() {
  elements.outputViewer.className = "media-frame empty";
  elements.outputViewer.replaceChildren(textNode("Render result"));
}

function updateSourceMetrics(file: File, probe: ProbeResult) {
  const video = probe.streams?.find((stream: ProbeStream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream: ProbeStream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration ?? video?.duration ?? audio?.duration);
  setMetrics(elements.sourceMetrics, [
    Number.isFinite(duration) ? formatDuration(duration) : "-",
    video ? `${video.codec_name ?? "video"} ${video.width ?? "-"}x${video.height ?? "-"}` : "-",
    audio ? `${audio.codec_name ?? "audio"} ${audio.sample_rate ?? "-"} Hz` : "-",
    formatBytes(file.size),
  ]);
}

function setMetrics(container: HTMLElement, values: string[]) {
  const items = [...container.querySelectorAll("dd")];
  for (let index = 0; index < items.length; index += 1) {
    items[index].textContent = values[index] ?? "-";
  }
}

function updateControls() {
  const preset = currentPreset();
  elements.parameterTitle.textContent = preset.name;
  for (const field of document.querySelectorAll(".clip-field")) {
    field.classList.toggle(
      "hidden",
      state.operation !== "clip-mp4" && state.operation !== "video-mp4",
    );
  }
  for (const field of document.querySelectorAll(".frame-field")) {
    field.classList.toggle(
      "hidden",
      state.operation !== "poster-png" && state.operation !== "hash-raw",
    );
  }
  for (const field of document.querySelectorAll(".size-field")) {
    field.classList.toggle(
      "hidden",
      state.operation !== "poster-png" &&
        state.operation !== "hash-raw" &&
        state.operation !== "video-mp4",
    );
  }
  for (const field of document.querySelectorAll(".video-quality-field")) {
    field.classList.toggle("hidden", state.operation !== "video-mp4");
  }
  for (const field of document.querySelectorAll(".audio-field")) {
    field.classList.toggle(
      "hidden",
      state.operation !== "audio-mp3" && state.operation !== "audio-wav",
    );
  }
  elements.bitrateSelect
    .closest(".field")
    ?.classList.toggle("hidden", state.operation !== "audio-mp3");
}

function updateCommand() {
  if (!state.commandEdited) {
    elements.commandInput.value = displayCommand();
  }
}

function displayCommand() {
  return ["ffmpeg", ...buildDisplayArgs()].map((value) => quoteShell(value)).join(" ");
}

async function renderWithBackend(): Promise<RenderOutput> {
  const file = sourceFile();
  if (!hasServerBackend()) {
    return renderWithBrowserFfmpac(file);
  }
  const query = buildQuery();
  const response = await fetch(`/api/render?${query.toString()}`, {
    body: file,
    headers: {
      "Content-Type": "application/octet-stream",
      ...playgroundHeaders(),
      "X-File-Name": safeHeaderName(file.name),
    },
    method: "POST",
  });
  if (!response.ok) {
    await failFromResponse(response);
  }
  return {
    blob: await response.blob(),
    ffmpegArgs: response.headers.get("X-Ffmpeg-Args"),
    name: response.headers.get("X-Output-Name") ?? defaultOutputName(),
  };
}

async function probeFileInBrowser(file: File): Promise<ProbeResult> {
  const inputPath = `/input${inputExtension(file.name)}`;
  const result = await runBrowserTool("ffprobe", {
    args: ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", inputPath],
    inputPath,
    source: file,
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderrText || "ffprobe failed");
  }
  const parsed: unknown = JSON.parse(result.stdoutText);
  if (!isProbeResult(parsed)) {
    throw new Error("Invalid probe response");
  }
  return parsed;
}

async function renderWithBrowserFfmpac(file: File): Promise<RenderOutput> {
  const operation = state.operation;
  const inputPath = `/input${inputExtension(file.name)}`;
  const outputName = backendOutputName();
  const outputPath = `/${outputName}`;
  const args = buildBackendArgs(inputPath, outputPath);
  const result = await runBrowserTool("ffmpeg", {
    args: progressArgs(args),
    inputPath,
    onProgress: renderProgressHandler(progressDurationSeconds(operation, args)),
    outputPath,
    source: file,
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderrText || "ffmpeg failed");
  }
  if (result.outputFile === undefined) {
    throw new Error("ffmpeg did not produce an output file");
  }
  return {
    blob: new Blob([result.outputFile], { type: mimeForPreset(operation) }),
    ffmpegArgs: JSON.stringify(args),
    name: outputName,
  };
}

async function runBrowserTool(
  tool: "ffmpeg" | "ffprobe",
  options: {
    args: string[];
    inputPath: string;
    onProgress?: (progress: BrowserToolProgress) => void;
    outputPath?: string;
    source: File;
  },
): Promise<BrowserToolResult> {
  const inputBuffer = await options.source.arrayBuffer();
  const worker = new Worker(new URL("ffmpac-worker.js", import.meta.url), { type: "module" });
  const id = crypto.getRandomValues(new Uint32Array(1))[0];
  try {
    return await new Promise<BrowserToolResult>((resolvePromise, reject) => {
      const timeouts: {
        absolute?: ReturnType<typeof setTimeout>;
        idle?: ReturnType<typeof setTimeout>;
      } = {};
      let settled = false;
      const clearToolTimeouts = () => {
        if (timeouts.idle !== undefined) {
          clearTimeout(timeouts.idle);
        }
        if (timeouts.absolute !== undefined) {
          clearTimeout(timeouts.absolute);
        }
      };
      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearToolTimeouts();
        reject(error);
      };
      const resolveOnce = (result: BrowserToolResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearToolTimeouts();
        resolvePromise(result);
      };
      const refreshIdleTimeout = () => {
        if (timeouts.idle !== undefined) {
          clearTimeout(timeouts.idle);
        }
        timeouts.idle = setTimeout(() => {
          rejectOnce(new Error("Timed out waiting for browser ffmpac progress"));
        }, BROWSER_TOOL_IDLE_TIMEOUT_MS);
      };
      refreshIdleTimeout();
      timeouts.absolute = setTimeout(() => {
        rejectOnce(new Error("Timed out running browser ffmpac"));
      }, BROWSER_TOOL_ABSOLUTE_TIMEOUT_MS);
      worker.addEventListener("message", (event: MessageEvent<BrowserWorkerResponse>) => {
        const response = event.data;
        if (response.id !== id) {
          return;
        }
        if (isProgressResponse(response)) {
          refreshIdleTimeout();
          options.onProgress?.(response.progress);
          return;
        }
        if (!response.ok) {
          rejectOnce(
            new Error(
              response.stderrText !== undefined && response.stderrText.length > 0
                ? response.stderrText
                : response.error,
            ),
          );
          return;
        }
        resolveOnce({
          exitCode: response.exitCode,
          outputFile: response.outputFile,
          stderrText: response.stderrText,
          stdoutText: response.stdoutText,
        });
      });
      worker.addEventListener("error", (event) => {
        rejectOnce(new Error(event.message));
      });
      worker.postMessage(
        {
          args: options.args,
          id,
          inputBuffer,
          inputPath: options.inputPath,
          outputPath: options.outputPath,
          tool,
        },
        [inputBuffer],
      );
    });
  } finally {
    worker.terminate();
  }
}

function isProgressResponse(response: BrowserWorkerResponse): response is BrowserWorkerProgress {
  return "type" in response && response.type === "progress";
}

function progressArgs(args: string[]) {
  return ["-progress", "pipe:2", "-nostats", ...args];
}

function renderProgressHandler(durationSeconds: number | null) {
  return (progress: BrowserToolProgress) => {
    if (progress.phase === "end") {
      showProgress("Finalizing output", 1);
      setStatus("Rendering 100%", "busy");
      return;
    }
    const ratio =
      durationSeconds === null || progress.outTimeSeconds === undefined
        ? null
        : Math.min(Math.max(progress.outTimeSeconds / durationSeconds, 0), 0.99);
    const detailParts: string[] = [];
    if (progress.outTimeSeconds !== undefined) {
      detailParts.push(`time ${formatDuration(progress.outTimeSeconds)}`);
    }
    if (progress.frame !== undefined) {
      detailParts.push(`frame ${progress.frame}`);
    }
    if (progress.speed !== undefined && progress.speed.length > 0) {
      detailParts.push(`speed ${progress.speed}`);
    }
    showProgress(detailParts.join(" · ") || "ffmpac is working", ratio);
    if (ratio !== null) {
      setStatus(`Rendering ${Math.round(ratio * 100)}%`, "busy");
    }
  };
}

function progressDurationSeconds(operation: Operation, args: string[]) {
  if (operation === "clip-mp4" || operation === "video-mp4") {
    return clippedDurationSeconds(args);
  }
  if (operation === "audio-mp3" || operation === "audio-wav") {
    return sourceAudioDurationSeconds();
  }
  return null;
}

function clippedDurationSeconds(args: string[]) {
  const requestedDuration = optionNumber(args, "-t");
  const sourceDuration = sourceMediaDurationSeconds();
  if (sourceDuration === null) {
    return requestedDuration;
  }
  const start = optionNumber(args, "-ss") ?? 0;
  const remainingDuration = Math.max(sourceDuration - start, 0);
  if (remainingDuration === 0) {
    return null;
  }
  if (requestedDuration === null) {
    return remainingDuration;
  }
  return Math.min(requestedDuration, remainingDuration);
}

function optionNumber(args: string[], option: string) {
  const index = args.indexOf(option);
  if (index === -1) {
    return null;
  }
  return positiveNumber(args[index + 1]);
}

function sourceAudioDurationSeconds() {
  const audio = state.probe?.streams?.find((stream: ProbeStream) => stream.codec_type === "audio");
  return positiveNumber(audio?.duration ?? state.probe?.format?.duration);
}

function sourceMediaDurationSeconds() {
  return positiveNumber(state.probe?.format?.duration);
}

function positiveNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildQuery() {
  const query = new URLSearchParams({ op: state.operation });
  if (state.operation === "clip-mp4" || state.operation === "video-mp4") {
    query.set("start", elements.startInput.value);
    query.set("duration", elements.durationInput.value);
  }
  if (
    state.operation === "poster-png" ||
    state.operation === "hash-raw" ||
    state.operation === "video-mp4"
  ) {
    query.set("frameTime", elements.frameInput.value);
    query.set("width", elements.widthSelect.value);
  }
  if (state.operation === "video-mp4") {
    query.set("quality", elements.qualitySelect.value);
  }
  if (state.operation === "audio-mp3" || state.operation === "audio-wav") {
    query.set("audioBitrate", elements.bitrateSelect.value);
    query.set("sampleRate", elements.sampleRateSelect.value);
    query.set("channels", elements.channelsSelect.value);
  }
  return query;
}

function buildDisplayArgs(): string[] {
  const input = state.file?.name ?? "input.mp4";
  return buildBackendArgs(input, displayOutputName());
}

function buildBackendArgs(input: string, output: string): string[] {
  switch (state.operation) {
    case "clip-mp4": {
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        elements.startInput.value,
        "-i",
        input,
        "-t",
        elements.durationInput.value,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        output,
      ];
    }
    case "poster-png": {
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        elements.frameInput.value,
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        `scale=${elements.widthSelect.value}:-2`,
        "-update",
        "1",
        output,
      ];
    }
    case "video-mp4": {
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        elements.startInput.value,
        "-i",
        input,
        "-t",
        elements.durationInput.value,
        "-vf",
        `scale=${elements.widthSelect.value}:-2,format=yuv420p`,
        "-c:v",
        "mpeg4",
        "-q:v",
        videoQuality(elements.qualitySelect.value),
        "-an",
        "-movflags",
        "+faststart",
        output,
      ];
    }
    case "audio-mp3": {
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-vn",
        "-ac",
        elements.channelsSelect.value,
        "-ar",
        elements.sampleRateSelect.value,
        "-b:a",
        elements.bitrateSelect.value,
        output,
      ];
    }
    case "audio-wav": {
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-vn",
        "-ac",
        elements.channelsSelect.value,
        "-ar",
        elements.sampleRateSelect.value,
        "-sample_fmt",
        "s16",
        output,
      ];
    }
    case "hash-raw": {
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        elements.frameInput.value,
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        "scale=32:32,format=gray",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        output,
      ];
    }
    default: {
      throw new Error("Unsupported operation");
    }
  }
}

function displayOutputName() {
  switch (state.operation) {
    case "clip-mp4": {
      return "clip.mp4";
    }
    case "poster-png": {
      return "poster.png";
    }
    case "video-mp4": {
      return "smaller.mp4";
    }
    case "audio-mp3": {
      return "audio.mp3";
    }
    case "audio-wav": {
      return "audio.wav";
    }
    case "hash-raw": {
      return "frame-gray.raw";
    }
    default: {
      throw new Error("Unsupported operation");
    }
  }
}

function backendOutputName() {
  return displayOutputName();
}

function savePickerOptions(output: RenderOutput | null = state.lastOutput): BrowserSaveOptions {
  const preset = currentPreset();
  const extension = /\.[^.]+$/u.exec(output?.name ?? "")?.[0] ?? preset.extension;
  const mime = output?.blob.type ?? mimeForPreset(preset.id);
  return {
    id: "ffmpeg-wasm-output",
    startIn: "videos",
    suggestedName: output?.name ?? defaultOutputName(),
    types: [
      {
        accept: { [mime]: [extension] },
        description: preset.name,
      },
    ],
  };
}

async function writeBlobToHandle(handle: BrowserFileHandle, blob: Blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

async function failFromResponse(response: Response): Promise<never> {
  const text = await response.text();
  let message = "";
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      message = parsed.error;
    }
  } catch {
    message = "";
  }
  let fallback = response.statusText;
  if (text.length > 0) {
    fallback = text;
  }
  throw new Error(message.length > 0 ? message : fallback);
}

function setStatus(text: string, mode: StatusMode) {
  elements.statusText.textContent = text;
  elements.statusPill.classList.toggle("busy", mode === "busy");
  elements.statusPill.classList.toggle("error", mode === "error");
}

function showProgress(detail: string, ratio: number | null) {
  elements.progressPanel.hidden = false;
  elements.progressDetail.textContent = detail;
  if (ratio === null) {
    elements.progressPanel.classList.add("indeterminate");
    elements.progressBar.style.width = "42%";
    elements.progressValue.textContent = "Working";
    // oxlint-disable-next-line no-underscore-dangle -- Stable browser E2E test hook.
    browserGlobal.__lastProgress = { detail, value: "Working" };
    return;
  }
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  elements.progressPanel.classList.remove("indeterminate");
  elements.progressBar.style.width = `${percent}%`;
  elements.progressValue.textContent = `${percent}%`;
  // oxlint-disable-next-line no-underscore-dangle -- Stable browser E2E test hook.
  browserGlobal.__lastProgress = { detail, value: `${percent}%` };
}

function hideProgress() {
  elements.progressPanel.hidden = true;
  elements.progressPanel.classList.remove("indeterminate");
  elements.progressBar.style.width = "0%";
  elements.progressValue.textContent = "0%";
  elements.progressDetail.textContent = "";
}

function currentPreset(): Preset {
  return presets.find((preset) => preset.id === state.operation) ?? presets[0];
}

function mimeForPreset(id: Operation) {
  if (id === "clip-mp4") {
    return "video/mp4";
  }
  if (id === "video-mp4") {
    return "video/mp4";
  }
  if (id === "poster-png") {
    return "image/png";
  }
  if (id === "audio-mp3") {
    return "audio/mpeg";
  }
  if (id === "audio-wav") {
    return "audio/wav";
  }
  return "application/octet-stream";
}

function defaultOutputName() {
  const preset = currentPreset();
  return `${baseName(state.file?.name ?? "output")}-${preset.id}${preset.extension}`;
}

function baseName(name: string) {
  const cleaned = name
    .replaceAll(/\.[^.]+$/gu, "")
    .replaceAll(/[^a-z0-9_-]+/giu, "-")
    .replaceAll(/^-|-$/gu, "");
  return cleaned.length > 0 ? cleaned : "output";
}

function quoteShell(value: string) {
  if (/^[a-z0-9_./:-]+$/iu.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

function safeHeaderName(name: string) {
  return name.replaceAll(/[^\u0020-\u007E]/gu, "_");
}

function playgroundHeaders() {
  return { "X-Playground-Token": playgroundToken };
}

function hasServerBackend() {
  return playgroundToken.length > 0;
}

function inputExtension(name: string) {
  const match = /\.[a-z0-9]{1,8}$/iu.exec(name);
  return match?.[0].toLowerCase() ?? ".mp4";
}

function formatSeconds(value: number) {
  return String(Math.round(value * 1000) / 1000);
}

function videoQuality(quality: string) {
  if (quality === "high") {
    return "2";
  }
  if (quality === "small") {
    return "9";
  }
  return "5";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDelta(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }
  return `${bytes > 0 ? "+" : "-"}${formatBytes(Math.abs(bytes))}`;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
}

function textNode(text: string) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

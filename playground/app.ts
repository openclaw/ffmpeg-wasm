type Operation = "audio-mp3" | "audio-wav" | "clip-mp4" | "hash-raw" | "poster-png";
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
  browserFallback?: boolean;
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

interface WorkbenchState {
  commandEdited: boolean;
  file: File | null;
  inputUrl: string | null;
  lastOutput: RenderOutput | null;
  operation: Operation;
  probe: ProbeResult | null;
}

interface BrowserMetadata {
  duration: number;
  videoHeight?: number;
  videoWidth?: number;
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

interface RenderOptions {
  allowFallback?: boolean;
}

interface VideoFrame {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

interface VideoWithCaptureStream extends HTMLVideoElement {
  captureStream: () => MediaStream;
}

interface CanvasWithCaptureStream extends HTMLCanvasElement {
  captureStream: (frameRate?: number) => MediaStream;
}

type BrowserGlobal = typeof globalThis & {
  __lastRender?: LastRenderState;
  showSaveFilePicker?: (options: BrowserSaveOptions) => Promise<BrowserFileHandle>;
};

const browserGlobal = globalThis as BrowserGlobal;

const presets: Preset[] = [
  {
    detail: "MP4 stream copy",
    extension: ".mp4",
    id: "clip-mp4",
    name: "Lossless clip",
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
    elements.bitrateSelect,
    elements.sampleRateSelect,
    elements.channelsSelect,
  ]) {
    input.addEventListener("input", updateCommand);
    input.addEventListener("change", updateCommand);
  }
}

function renderPresets() {
  elements.presetList.replaceChildren(
    ...presets.map((preset) => {
      const button = document.createElement("button");
      button.className = `preset-card${preset.id === state.operation ? " active" : ""}`;
      button.dataset.operation = preset.id;
      button.dataset.tone = preset.tone;
      button.disabled = preset.id === "audio-mp3" && !hasBackend();
      if (button.disabled) {
        button.title = "MP3 output requires the local wasm backend";
      }
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
        state.operation = preset.id;
        state.commandEdited = false;
        renderPresets();
        updateControls();
        updateCommand();
      });
      return button;
    }),
  );
}

async function loadSample() {
  setStatus("Loading sample", "busy");
  try {
    if (!hasBackend()) {
      throw new Error("Static workbench sample");
    }
    const response = await fetch("/api/sample", { headers: playgroundHeaders() });
    if (!response.ok) {
      await failFromResponse(response);
    }
    const blob = await response.blob();
    await setSourceFile(new File([blob], "sample.mp4", { type: "video/mp4" }));
  } catch {
    try {
      await setSourceFile(await browserSampleFile());
      setStatus("Ready", "idle");
    } catch (error) {
      setStatus(errorMessage(error), "error");
    }
  }
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
  try {
    if (!hasBackend()) {
      throw new Error("Static workbench probe");
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
  } catch {
    return probeFileInBrowser(file);
  }
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
  if (saveAfterRender && playgroundToken.length > 0 && browserGlobal.showSaveFilePicker) {
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
  elements.renderButton.disabled = true;
  elements.renderSaveButton.disabled = true;
  try {
    const rendered = await renderWithBestBackend({ allowFallback: saveHandle === null });
    setLastOutput(rendered);
    if (saveHandle !== null) {
      await writeBlobToHandle(saveHandle, rendered.blob);
      setStatus("Saved", "idle");
    } else if (saveAfterRender) {
      downloadBlob(rendered.blob, rendered.name);
      setStatus("Downloaded", "idle");
    } else {
      setStatus(rendered.browserFallback === true ? "Rendered in browser" : "Rendered", "idle");
    }
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
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
  elements.sourceViewer.replaceChildren(mediaElement(file.type, url, file.name));
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
    field.classList.toggle("hidden", state.operation !== "clip-mp4");
  }
  for (const field of document.querySelectorAll(".frame-field")) {
    field.classList.toggle(
      "hidden",
      state.operation !== "poster-png" && state.operation !== "hash-raw",
    );
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

async function renderWithBestBackend(options: RenderOptions = {}): Promise<RenderOutput> {
  const file = sourceFile();
  try {
    if (!hasBackend()) {
      throw new Error("Static workbench render");
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
  } catch (error) {
    if (options.allowFallback === false) {
      throw error;
    }
    const fallback = await renderInBrowser();
    return {
      ...fallback,
      browserFallback: true,
      ffmpegArgs: JSON.stringify(buildDisplayArgs()),
    };
  }
}

function renderInBrowser(): Promise<RenderOutput> {
  switch (state.operation) {
    case "clip-mp4": {
      return renderClipInBrowser();
    }
    case "poster-png": {
      return renderPosterInBrowser();
    }
    case "audio-mp3": {
      throw new Error("MP3 output requires the local wasm backend");
    }
    case "audio-wav": {
      return renderWavInBrowser();
    }
    case "hash-raw": {
      return renderRawFrameInBrowser();
    }
    default: {
      throw new Error("Unsupported operation");
    }
  }
}

function buildQuery() {
  const query = new URLSearchParams({ op: state.operation });
  if (state.operation === "clip-mp4") {
    query.set("start", elements.startInput.value);
    query.set("duration", elements.durationInput.value);
  }
  if (state.operation === "poster-png" || state.operation === "hash-raw") {
    query.set("frameTime", elements.frameInput.value);
    query.set("width", elements.widthSelect.value);
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
  switch (state.operation) {
    case "clip-mp4": {
      return [
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
        "clip.mp4",
      ];
    }
    case "poster-png": {
      return [
        "-ss",
        elements.frameInput.value,
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        `scale=${elements.widthSelect.value}:-2`,
        "poster.png",
      ];
    }
    case "audio-mp3": {
      return [
        "-i",
        input,
        "-vn",
        "-ac",
        elements.channelsSelect.value,
        "-ar",
        elements.sampleRateSelect.value,
        "-b:a",
        elements.bitrateSelect.value,
        "audio.mp3",
      ];
    }
    case "audio-wav": {
      return [
        "-i",
        input,
        "-vn",
        "-ac",
        elements.channelsSelect.value,
        "-ar",
        elements.sampleRateSelect.value,
        "-sample_fmt",
        "s16",
        "audio.wav",
      ];
    }
    case "hash-raw": {
      return [
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
        "frame-gray.raw",
      ];
    }
    default: {
      throw new Error("Unsupported operation");
    }
  }
}

function browserSampleFile(): Promise<File> {
  if (!("MediaRecorder" in globalThis)) {
    throw new Error("Sample generation is unavailable in this browser");
  }
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas rendering is unavailable");
  }
  if (!hasCanvasCaptureStream(canvas)) {
    throw new Error("Sample generation is unavailable in this browser");
  }
  const stream = canvas.captureStream(24);
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const audioStream = audioContext.createMediaStreamDestination();
  oscillator.frequency.value = 440;
  gain.gain.value = 0.05;
  oscillator.connect(gain);
  gain.connect(audioStream);
  oscillator.start();
  for (const track of audioStream.stream.getAudioTracks()) {
    stream.addTrack(track);
  }
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  let started = 0;
  let animation = 0;
  const paint = (time: number) => {
    if (started === 0) {
      started = time;
    }
    const elapsed = (time - started) / 1000;
    context.fillStyle = "#080a08";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#b8e48c";
    context.fillRect(80 + Math.sin(elapsed * 2) * 40, 120, 280, 160);
    context.fillStyle = "#9cc7ff";
    context.fillRect(420, 170 + Math.cos(elapsed * 2.4) * 60, 360, 190);
    context.fillStyle = "#f4f1e8";
    context.font = "700 44px sans-serif";
    context.fillText("ffmpeg.sh sample", 80, 430);
    animation = requestAnimationFrame(paint);
  };
  animation = requestAnimationFrame(paint);
  return new Promise((resolvePromise, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener(
      "error",
      runAsync(async () => {
        cancelAnimationFrame(animation);
        oscillator.stop();
        await closeAudioContext(audioContext);
        reject(new Error("Sample recording failed"));
      }),
    );
    recorder.addEventListener(
      "stop",
      runAsync(async () => {
        cancelAnimationFrame(animation);
        oscillator.stop();
        await closeAudioContext(audioContext);
        resolvePromise(new File(chunks, "sample.webm", { type: "video/webm" }));
      }),
    );
    recorder.start();
    setTimeout(() => {
      recorder.stop();
    }, 6200);
  });
}

async function closeAudioContext(audioContext: AudioContext) {
  if (audioContext.state !== "closed") {
    await audioContext.close();
  }
}

function hasCanvasCaptureStream(canvas: HTMLCanvasElement): canvas is CanvasWithCaptureStream {
  return "captureStream" in canvas && typeof canvas.captureStream === "function";
}

async function probeFileInBrowser(file: File): Promise<ProbeResult> {
  const meta = await loadMediaMetadata(file);
  return {
    format: {
      duration: String(meta.duration ?? 0),
    },
    streams: [
      ...(meta.videoWidth === undefined
        ? []
        : [
            {
              codec_name: file.type.includes("webm") ? "webm" : "video",
              codec_type: "video",
              height: meta.videoHeight,
              width: meta.videoWidth,
            },
          ]),
      ...(file.type.startsWith("audio/")
        ? [
            {
              codec_name: "audio",
              codec_type: "audio",
            },
          ]
        : []),
    ],
  };
}

async function renderPosterInBrowser(): Promise<RenderOutput> {
  const file = sourceFile();
  const frame = await videoFrameCanvas(
    Number(elements.frameInput.value),
    Number(elements.widthSelect.value),
  );
  const blob = await canvasBlob(frame.canvas, "image/png");
  return { blob, name: `${baseName(file.name)}-poster.png` };
}

async function renderRawFrameInBrowser(): Promise<RenderOutput> {
  const file = sourceFile();
  const frame = await videoFrameCanvas(Number(elements.frameInput.value), 32, 32);
  const pixels = frame.context.getImageData(0, 0, 32, 32).data;
  const gray = new Uint8Array(32 * 32);
  for (let index = 0; index < gray.length; index += 1) {
    const pixel = index * 4;
    gray[index] = Math.round(
      pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114,
    );
  }
  return {
    blob: new Blob([gray], { type: "application/octet-stream" }),
    name: `${baseName(file.name)}-frame-gray.raw`,
  };
}

function hasVideoCaptureStream(video: HTMLVideoElement): video is VideoWithCaptureStream {
  return "captureStream" in video && typeof video.captureStream === "function";
}

async function renderClipInBrowser(): Promise<RenderOutput> {
  if (!("MediaRecorder" in globalThis)) {
    throw new Error("Browser clip rendering is unavailable");
  }
  const file = sourceFile();
  const video = await loadedVideoElement(file);
  const start = Number(elements.startInput.value);
  const duration = Number(elements.durationInput.value);
  await seekVideo(video, Math.min(start, Math.max(0, video.duration - 0.1)));
  video.muted = true;
  video.playbackRate = 1;
  if (!hasVideoCaptureStream(video)) {
    throw new Error("Browser clip rendering is unavailable");
  }
  const stream = video.captureStream();
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });
  const stopped = once(recorder, "stop");
  recorder.start();
  await video.play();
  await wait(Math.max(200, duration * 1000));
  recorder.stop();
  video.pause();
  await stopped;
  return {
    blob: new Blob(chunks, { type: "video/webm" }),
    name: `${baseName(file.name)}-clip.webm`,
  };
}

async function renderWavInBrowser(): Promise<RenderOutput> {
  const file = sourceFile();
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channels = Number(elements.channelsSelect.value);
    const sampleRate = Number(elements.sampleRateSelect.value);
    const length = Math.ceil(decoded.duration * sampleRate);
    const offline = new OfflineAudioContext(channels, length, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return {
      blob: new Blob([encodeWav(rendered)], { type: "audio/wav" }),
      name: `${baseName(file.name)}-audio.wav`,
    };
  } finally {
    await audioContext.close();
  }
}

async function videoFrameCanvas(
  seconds: number,
  width: number,
  height?: number,
): Promise<VideoFrame> {
  const video = await loadedVideoElement(sourceFile());
  await seekVideo(video, Math.min(Math.max(0, seconds), Math.max(0, video.duration - 0.1)));
  const ratio = video.videoWidth === 0 ? 9 / 16 : video.videoHeight / video.videoWidth;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height ?? Math.max(2, Math.round(width * ratio));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas rendering is unavailable");
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

async function seekVideo(video: HTMLVideoElement, targetTime: number) {
  if (Math.abs(video.currentTime - targetTime) < 0.01) {
    return;
  }
  const seeked = once(video, "seeked");
  video.currentTime = targetTime;
  await seeked;
}

async function loadedVideoElement(file: File): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = URL.createObjectURL(file);
  try {
    await once(video, "loadedmetadata");
    return video;
  } catch (error) {
    URL.revokeObjectURL(video.src);
    throw error;
  }
}

async function loadMediaMetadata(file: File): Promise<BrowserMetadata> {
  if (file.type.startsWith("video/")) {
    const video = await loadedVideoElement(file);
    return {
      duration: video.duration,
      videoHeight: video.videoHeight,
      videoWidth: video.videoWidth,
    };
  }
  if (file.type.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = URL.createObjectURL(file);
    await once(audio, "loadedmetadata");
    return { duration: audio.duration };
  }
  return { duration: 0 };
}

function encodeWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * channels * 2;
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, length, true);
  let offset = 44;
  for (let index = 0; index < audioBuffer.length; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[index]));
      view.setInt16(offset, sample < 0 ? sample * 32_768 : sample * 32_767, true);
      offset += 2;
    }
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.codePointAt(index) ?? 0);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolvePromise, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("Canvas export failed"));
      } else {
        resolvePromise(blob);
      }
    }, type);
  });
}

function once(target: EventTarget, eventName: string): Promise<Event> {
  return new Promise((resolvePromise, reject) => {
    target.addEventListener(eventName, resolvePromise, { once: true });
    target.addEventListener(
      "error",
      () => {
        reject(new Error(`${eventName} failed`));
      },
      {
        once: true,
      },
    );
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(() => {
      resolvePromise();
    }, ms);
  });
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

function currentPreset(): Preset {
  return presets.find((preset) => preset.id === state.operation) ?? presets[0];
}

function mimeForPreset(id: Operation) {
  if (id === "clip-mp4") {
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

function hasBackend() {
  return playgroundToken.length > 0;
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

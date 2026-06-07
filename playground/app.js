const presets = [
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

const state = {
  commandEdited: false,
  file: null,
  inputUrl: null,
  lastOutput: null,
  operation: "clip-mp4",
  probe: null,
};

const playgroundToken =
  document.querySelector("meta[name='playground-token']")?.getAttribute("content") ?? "";

const elements = {
  bitrateSelect: document.querySelector("#bitrateSelect"),
  channelsSelect: document.querySelector("#channelsSelect"),
  commandInput: document.querySelector("#commandInput"),
  copyButton: document.querySelector("#copyButton"),
  durationInput: document.querySelector("#durationInput"),
  fileInput: document.querySelector("#fileInput"),
  frameInput: document.querySelector("#frameInput"),
  outputMetrics: document.querySelector("#outputMetrics"),
  outputTitle: document.querySelector("#outputTitle"),
  outputViewer: document.querySelector("#outputViewer"),
  parameterTitle: document.querySelector("#parameterTitle"),
  presetArgsButton: document.querySelector("#presetArgsButton"),
  presetList: document.querySelector("#presetList"),
  renderButton: document.querySelector("#renderButton"),
  renderSaveButton: document.querySelector("#renderSaveButton"),
  sampleButton: document.querySelector("#sampleButton"),
  sampleRateSelect: document.querySelector("#sampleRateSelect"),
  saveButton: document.querySelector("#saveButton"),
  sourceMetrics: document.querySelector("#sourceMetrics"),
  sourceTitle: document.querySelector("#sourceTitle"),
  sourceViewer: document.querySelector("#sourceViewer"),
  startInput: document.querySelector("#startInput"),
  statusPill: document.querySelector("[data-testid='status-pill']"),
  statusText: document.querySelector("#statusText"),
  widthSelect: document.querySelector("#widthSelect"),
};

renderPresets();
bindEvents();
updateControls();
updateCommand();

function bindEvents() {
  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files?.[0];
    if (file) {
      void setSourceFile(file);
    }
  });
  elements.sampleButton.addEventListener("click", () => {
    void loadSample();
  });
  elements.renderButton.addEventListener("click", () => {
    void renderOutput(false);
  });
  elements.renderSaveButton.addEventListener("click", () => {
    void renderOutput(true);
  });
  elements.saveButton.addEventListener("click", () => {
    void saveLastOutput();
  });
  elements.copyButton.addEventListener("click", () => {
    void navigator.clipboard?.writeText(elements.commandInput.value);
    setStatus("Copied command", "idle");
  });
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
      setStatus(error.message, "error");
    }
  }
}

async function setSourceFile(file) {
  state.file = file;
  state.probe = null;
  state.lastOutput = null;
  if (state.inputUrl) URL.revokeObjectURL(state.inputUrl);
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
    setStatus(error.message, "error");
  }
}

async function probeFile(file) {
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
    return response.json();
  } catch {
    return probeFileInBrowser(file);
  }
}

async function renderOutput(saveAfterRender) {
  if (!state.file) {
    setStatus("Load media first", "error");
    return;
  }
  if (state.commandEdited) {
    setStatus("Use preset args before rendering", "error");
    return;
  }

  let saveHandle = null;
  if (saveAfterRender && playgroundToken && "showSaveFilePicker" in window) {
    try {
      saveHandle = await window.showSaveFilePicker(savePickerOptions(null));
    } catch (error) {
      if (error.name === "AbortError") {
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
    const rendered = await renderWithBestBackend({ allowFallback: !saveHandle });
    setLastOutput(rendered);
    if (saveHandle) {
      await writeBlobToHandle(saveHandle, rendered.blob);
      setStatus("Saved", "idle");
    } else if (saveAfterRender) {
      downloadBlob(rendered.blob, rendered.name);
      setStatus("Downloaded", "idle");
    } else {
      setStatus(rendered.browserFallback ? "Rendered in browser" : "Rendered", "idle");
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.renderButton.disabled = false;
    elements.renderSaveButton.disabled = false;
  }
}

function setLastOutput(output) {
  if (state.lastOutput?.url) URL.revokeObjectURL(state.lastOutput.url);
  const url = URL.createObjectURL(output.blob);
  state.lastOutput = { ...output, url };
  elements.outputTitle.textContent = output.name;
  elements.saveButton.disabled = false;
  setOutputViewer(output.blob, url);
  const delta = state.file ? output.blob.size - state.file.size : 0;
  setMetrics(elements.outputMetrics, [
    output.name.match(/\.[^.]+$/)?.[0] ?? currentPreset().extension,
    formatBytes(output.blob.size),
    formatDelta(delta),
  ]);
  window.__lastRender = {
    args: output.ffmpegArgs ? JSON.parse(output.ffmpegArgs) : null,
    bytes: output.blob.size,
    name: output.name,
    operation: state.operation,
  };
}

async function saveLastOutput() {
  if (!state.lastOutput) return;
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker(savePickerOptions());
      await writeBlobToHandle(handle, state.lastOutput.blob);
      setStatus("Saved", "idle");
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        setStatus("Save canceled", "idle");
        return;
      }
      setStatus(error.message, "error");
      return;
    }
  }
  downloadBlob(state.lastOutput.blob, state.lastOutput.name);
  setStatus("Downloaded", "idle");
}

function setSourceViewer(file, url) {
  elements.sourceViewer.className = "media-frame";
  elements.sourceViewer.replaceChildren(mediaElement(file.type, url, file.name));
}

function setOutputViewer(blob, url) {
  elements.outputViewer.className = "media-frame";
  elements.outputViewer.replaceChildren(mediaElement(blob.type, url, "Rendered output"));
}

function mediaElement(type, url, label) {
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
  block.innerHTML = `<strong>Raw frame bytes</strong><span>${formatBytes(state.lastOutput?.blob.size ?? 0)}</span>`;
  return block;
}

function setOutputEmpty() {
  elements.outputViewer.className = "media-frame empty";
  elements.outputViewer.replaceChildren(textNode("Render result"));
}

function updateSourceMetrics(file, probe) {
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration ?? video?.duration ?? audio?.duration);
  setMetrics(elements.sourceMetrics, [
    Number.isFinite(duration) ? formatDuration(duration) : "-",
    video ? `${video.codec_name ?? "video"} ${video.width ?? "-"}x${video.height ?? "-"}` : "-",
    audio ? `${audio.codec_name ?? "audio"} ${audio.sample_rate ?? "-"} Hz` : "-",
    formatBytes(file.size),
  ]);
}

function setMetrics(container, values) {
  const items = [...container.querySelectorAll("dd")];
  for (let index = 0; index < items.length; index += 1) {
    items[index].textContent = values[index] ?? "-";
  }
}

function updateControls() {
  const preset = currentPreset();
  elements.parameterTitle.textContent = preset.name;
  document.querySelectorAll(".clip-field").forEach((field) => {
    field.classList.toggle("hidden", state.operation !== "clip-mp4");
  });
  document.querySelectorAll(".frame-field").forEach((field) => {
    field.classList.toggle(
      "hidden",
      state.operation !== "poster-png" && state.operation !== "hash-raw",
    );
  });
  document.querySelectorAll(".audio-field").forEach((field) => {
    field.classList.toggle(
      "hidden",
      state.operation !== "audio-mp3" && state.operation !== "audio-wav",
    );
  });
  elements.bitrateSelect
    .closest(".field")
    .classList.toggle("hidden", state.operation !== "audio-mp3");
}

function updateCommand() {
  if (!state.commandEdited) {
    elements.commandInput.value = displayCommand();
  }
}

function displayCommand() {
  return ["ffmpeg", ...buildDisplayArgs()].map(quoteShell).join(" ");
}

async function renderWithBestBackend(options = {}) {
  try {
    if (!hasBackend()) {
      throw new Error("Static workbench render");
    }
    const query = buildQuery();
    const response = await fetch(`/api/render?${query.toString()}`, {
      body: state.file,
      headers: {
        "Content-Type": "application/octet-stream",
        ...playgroundHeaders(),
        "X-File-Name": safeHeaderName(state.file.name),
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

async function renderInBrowser() {
  switch (state.operation) {
    case "clip-mp4":
      return renderClipInBrowser();
    case "poster-png":
      return renderPosterInBrowser();
    case "audio-mp3":
      throw new Error("MP3 output requires the local wasm backend");
    case "audio-wav":
      return renderWavInBrowser();
    case "hash-raw":
      return renderRawFrameInBrowser();
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

function buildDisplayArgs() {
  const input = state.file?.name ?? "input.mp4";
  switch (state.operation) {
    case "clip-mp4":
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
    case "poster-png":
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
    case "audio-mp3":
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
    case "audio-wav":
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
    case "hash-raw":
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
}

async function browserSampleFile() {
  if (!("MediaRecorder" in window)) {
    throw new Error("Sample generation is unavailable in this browser");
  }
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d");
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
  const chunks = [];
  let started = 0;
  let animation = 0;
  const paint = (time) => {
    if (!started) started = time;
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
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      cancelAnimationFrame(animation);
      oscillator.stop();
      void audioContext.close();
      reject(new Error("Sample recording failed"));
    });
    recorder.addEventListener("stop", () => {
      cancelAnimationFrame(animation);
      oscillator.stop();
      void audioContext.close();
      resolvePromise(new File(chunks, "sample.webm", { type: "video/webm" }));
    });
    recorder.start();
    setTimeout(() => recorder.stop(), 6200);
  });
}

async function probeFileInBrowser(file) {
  const meta = await loadMediaMetadata(file);
  return {
    format: {
      duration: String(meta.duration || 0),
    },
    streams: [
      ...(meta.videoWidth
        ? [
            {
              codec_name: file.type.includes("webm") ? "webm" : "video",
              codec_type: "video",
              height: meta.videoHeight,
              width: meta.videoWidth,
            },
          ]
        : []),
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

async function renderPosterInBrowser() {
  const frame = await videoFrameCanvas(
    Number(elements.frameInput.value),
    Number(elements.widthSelect.value),
  );
  const blob = await canvasBlob(frame.canvas, "image/png");
  return { blob, name: `${baseName(state.file.name)}-poster.png` };
}

async function renderRawFrameInBrowser() {
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
    name: `${baseName(state.file.name)}-frame-gray.raw`,
  };
}

async function renderClipInBrowser() {
  if (!("MediaRecorder" in window)) {
    throw new Error("Browser clip rendering is unavailable");
  }
  const video = await loadedVideoElement(state.file);
  const start = Number(elements.startInput.value);
  const duration = Number(elements.durationInput.value);
  await seekVideo(video, Math.min(start, Math.max(0, video.duration - 0.1)));
  video.muted = true;
  video.playbackRate = 1;
  const stream = video.captureStream();
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
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
    name: `${baseName(state.file.name)}-clip.webm`,
  };
}

async function renderWavInBrowser() {
  const arrayBuffer = await state.file.arrayBuffer();
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
      name: `${baseName(state.file.name)}-audio.wav`,
    };
  } finally {
    await audioContext.close();
  }
}

async function videoFrameCanvas(seconds, width, height) {
  const video = await loadedVideoElement(state.file);
  await seekVideo(video, Math.min(Math.max(0, seconds), Math.max(0, video.duration - 0.1)));
  const ratio = video.videoHeight / video.videoWidth || 9 / 16;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height ?? Math.max(2, Math.round(width * ratio));
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

async function seekVideo(video, targetTime) {
  if (Math.abs(video.currentTime - targetTime) < 0.01) {
    return;
  }
  const seeked = once(video, "seeked");
  video.currentTime = targetTime;
  await seeked;
}

async function loadedVideoElement(file) {
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

async function loadMediaMetadata(file) {
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

function encodeWav(audioBuffer) {
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
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function canvasBlob(canvas, type) {
  return new Promise((resolvePromise, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolvePromise(blob);
      } else {
        reject(new Error("Canvas export failed"));
      }
    }, type);
  });
}

function once(target, eventName) {
  return new Promise((resolvePromise, reject) => {
    target.addEventListener(eventName, resolvePromise, { once: true });
    target.addEventListener("error", () => reject(new Error(`${eventName} failed`)), {
      once: true,
    });
  });
}

function wait(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function savePickerOptions(output = state.lastOutput) {
  const preset = currentPreset();
  const extension = output?.name.match(/\.[^.]+$/)?.[0] ?? preset.extension;
  const mime = output?.blob.type || mimeForPreset(preset.id);
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

async function writeBlobToHandle(handle, blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function failFromResponse(response) {
  const text = await response.text();
  let message = "";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === "string") {
      message = parsed.error;
    }
  } catch {
    message = "";
  }
  throw new Error(message || text || response.statusText);
}

function setStatus(text, mode) {
  elements.statusText.textContent = text;
  elements.statusPill.classList.toggle("busy", mode === "busy");
  elements.statusPill.classList.toggle("error", mode === "error");
}

function currentPreset() {
  return presets.find((preset) => preset.id === state.operation) ?? presets[0];
}

function mimeForPreset(id) {
  if (id === "clip-mp4") return "video/mp4";
  if (id === "poster-png") return "image/png";
  if (id === "audio-mp3") return "audio/mpeg";
  if (id === "audio-wav") return "audio/wav";
  return "application/octet-stream";
}

function defaultOutputName() {
  const preset = currentPreset();
  return `${baseName(state.file?.name ?? "output")}-${preset.id}${preset.extension}`;
}

function baseName(name) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-|-$/g, "") || "output"
  );
}

function quoteShell(value) {
  if (/^[a-z0-9_./:-]+$/i.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function safeHeaderName(name) {
  return name.replace(/[^\x20-\x7e]/g, "_");
}

function playgroundHeaders() {
  return { "X-Playground-Token": playgroundToken };
}

function hasBackend() {
  return playgroundToken.length > 0;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDelta(bytes) {
  if (bytes === 0) return "0 B";
  return `${bytes > 0 ? "+" : "-"}${formatBytes(Math.abs(bytes))}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
}

function textNode(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

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
  commandPreview: document.querySelector("#commandPreview"),
  copyButton: document.querySelector("#copyButton"),
  durationInput: document.querySelector("#durationInput"),
  fileInput: document.querySelector("#fileInput"),
  frameInput: document.querySelector("#frameInput"),
  outputMetrics: document.querySelector("#outputMetrics"),
  outputTitle: document.querySelector("#outputTitle"),
  outputViewer: document.querySelector("#outputViewer"),
  parameterTitle: document.querySelector("#parameterTitle"),
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
    void navigator.clipboard?.writeText(elements.commandPreview.textContent ?? "");
    setStatus("Copied args", "idle");
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
  const response = await fetch("/api/sample", { headers: playgroundHeaders() });
  if (!response.ok) {
    await failFromResponse(response);
  }
  const blob = await response.blob();
  await setSourceFile(new File([blob], "sample.mp4", { type: "video/mp4" }));
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
}

async function renderOutput(saveAfterRender) {
  if (!state.file) {
    setStatus("Load media first", "error");
    return;
  }

  let saveHandle = null;
  if (saveAfterRender && "showSaveFilePicker" in window) {
    try {
      saveHandle = await window.showSaveFilePicker(savePickerOptions());
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
    const blob = await response.blob();
    const outputName = response.headers.get("X-Output-Name") ?? currentPreset().name;
    const ffmpegArgs = response.headers.get("X-Ffmpeg-Args");
    setLastOutput({ blob, ffmpegArgs, name: outputName });
    if (saveHandle) {
      await writeBlobToHandle(saveHandle, blob);
      setStatus("Saved", "idle");
    } else if (saveAfterRender) {
      downloadBlob(blob, outputName);
      setStatus("Downloaded", "idle");
    } else {
      setStatus("Rendered", "idle");
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
    currentPreset().extension,
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
  elements.commandPreview.textContent = ["ffmpeg", ...buildDisplayArgs()].map(quoteShell).join(" ");
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

function savePickerOptions() {
  const preset = currentPreset();
  const mime = mimeForPreset(preset.id);
  return {
    id: "ffmpeg-wasm-output",
    startIn: "videos",
    suggestedName: state.lastOutput?.name ?? defaultOutputName(),
    types: [
      {
        accept: { [mime]: [preset.extension] },
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

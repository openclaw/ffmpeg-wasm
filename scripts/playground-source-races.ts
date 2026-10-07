// Runs in the page through CDP, exercising real event handlers with controlled backend timing.
// oxlint-disable-next-line import/prefer-default-export -- Keep the named-export convention used by the project.
export async function assertSourceRaces(browserBackend: boolean): Promise<string> {
  interface Pending {
    fail: () => void;
    finish: (duration?: string) => void;
    progress: () => void;
  }
  const pending: Pending[] = [];
  const originalWorker = globalThis.Worker;
  const originalFetch = globalThis.fetch;
  const page = globalThis as typeof globalThis & {
    showSaveFilePicker?: () => Promise<unknown>;
  };
  const originalPicker = page.showSaveFilePicker;
  const tick = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  const element = (id: string) => {
    const found = document.querySelector(`#${id}`);
    if (!(found instanceof HTMLElement)) {
      throw new Error(`Missing ${id}`);
    }
    return found;
  };
  const expect = (condition: boolean, message: string) => {
    if (!condition) {
      throw new Error(message);
    }
  };
  const nextRequest = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const request = pending.shift();
      if (request !== undefined) {
        return request;
      }
      // oxlint-disable-next-line no-await-in-loop -- Wait for the page's asynchronous file read.
      await tick();
    }
    throw new Error("The page did not start a backend request");
  };
  const select = () => {
    const input = element("fileInput");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Missing file input");
    }
    const transfer = new DataTransfer();
    // Same name and bytes, different File identity: filenames cannot identify a selection.
    transfer.items.add(new File(["synthetic media"], "source.mp4", { type: "video/mp4" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return nextRequest();
  };
  const ready = () => {
    expect(element("statusText").textContent === "Ready", "Stale work overwrote Ready");
    expect(element("outputTitle").textContent === "Waiting", "Stale render published output");
    expect(
      element("sourceMetrics").textContent?.includes("0:02") ?? false,
      "Stale probe replaced metrics",
    );
  };
  const probe = (duration: string) => JSON.stringify({ format: { duration }, streams: [] });
  class ControlledWorker extends EventTarget {
    public postMessage(request: { id: number; tool: string }) {
      const send = (data: object) =>
        this.dispatchEvent(new MessageEvent("message", { data: { id: request.id, ...data } }));
      pending.push({
        fail: () => {
          send({ ok: false, error: "stale failure" });
        },
        finish: (duration = "2") => {
          send({
            ok: true,
            exitCode: 0,
            stderrText: "",
            stdoutText: probe(duration),
            ...(request.tool === "ffmpeg" ? { outputFile: new ArrayBuffer(4) } : {}),
          });
        },
        progress: () => {
          send({ type: "progress", progress: { phase: "end", outTimeSeconds: 8 } });
        },
      });
    }
    public terminate() {}
  }
  try {
    if (browserBackend) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Implements the Worker surface consumed by the app, without starting wasm.
      globalThis.Worker = ControlledWorker as unknown as typeof Worker;
    } else {
      globalThis.fetch = (input, options) => {
        if (typeof input !== "string" || !input.startsWith("/api/")) {
          return originalFetch(input, options);
        }
        return new Promise<Response>((resolve, reject) => {
          pending.push({
            fail: () => {
              reject(new Error("stale failure"));
            },
            finish: (duration = "2") => {
              resolve(
                new Response(input === "/api/probe" ? probe(duration) : "synthetic output", {
                  headers: { "X-Output-Name": "stale.mp4" },
                }),
              );
            },
            progress: () => {},
          });
        });
      };
    }
    const oldProbe = await select();
    const newProbe = await select();
    newProbe.finish();
    await tick();
    oldProbe.finish("8");
    await tick();
    ready();

    const failedProbe = await select();
    const replacementProbe = await select();
    replacementProbe.finish();
    await tick();
    failedProbe.fail();
    await tick();
    ready();

    element("renderButton").click();
    const render = await nextRequest();
    const replacement = await select();
    replacement.finish();
    await tick();
    render.progress();
    await tick();
    ready();
    render.finish();
    await tick();
    ready();

    element("renderButton").click();
    const failedRender = await nextRequest();
    const nextProbe = await select();
    nextProbe.finish();
    await tick();
    failedRender.fail();
    await tick();
    ready();

    let closeWrite = () => {};
    let written = false;
    const handle = {
      createWritable: () =>
        Promise.resolve({
          close: () =>
            new Promise<void>((resolve) => {
              closeWrite = resolve;
            }),
          write: () => {
            written = true;
            return Promise.resolve();
          },
        }),
    };
    let chooseHandle: (value: typeof handle) => void = () => {};
    page.showSaveFilePicker = () =>
      new Promise((resolve) => {
        chooseHandle = resolve;
      });
    element("renderSaveButton").click();
    const pickerProbe = await select();
    pickerProbe.finish();
    await tick();
    chooseHandle(handle);
    await tick();
    expect(pending.length === 0, "Source changed during picker but rendering still started");
    ready();

    page.showSaveFilePicker = () => Promise.resolve(handle);
    element("renderSaveButton").click();
    const savingRender = await nextRequest();
    savingRender.finish();
    await tick();
    expect(written, "Current output was not written");
    const savingProbe = await select();
    savingProbe.finish();
    await tick();
    closeWrite();
    await tick();
    ready();
    return "ok";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    globalThis.Worker = originalWorker;
    globalThis.fetch = originalFetch;
    page.showSaveFilePicker = originalPicker;
  }
}

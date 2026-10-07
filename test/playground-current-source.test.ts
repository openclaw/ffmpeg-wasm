import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCurrentSource,
  resultForCurrentSource,
  statusForRenderProgress,
} from "../playground/current-source.js";

await test("resultForCurrentSource drops a render after the source file changes", () => {
  const original = new File(["one"], "clip.webm", { type: "video/webm" });
  const replacement = new File(["one"], "clip.webm", { type: "video/webm" });
  const rendered = { bytes: 4, name: "clip.mp4" };
  assert.equal(isCurrentSource(original, original), true);
  assert.equal(isCurrentSource(original, replacement), false);
  assert.equal(isCurrentSource(original, null), false);
  assert.deepEqual(resultForCurrentSource(original, original, rendered), rendered);
  assert.equal(resultForCurrentSource(original, replacement, rendered), null);
  assert.equal(resultForCurrentSource(original, null, rendered), null);
});

await test("stale render progress does not mark the replacement busy", () => {
  const original = new File(["one"], "clip.webm", { type: "video/webm" });
  const replacement = new File(["two"], "other.mov", { type: "video/quicktime" });
  assert.equal(statusForRenderProgress(original, replacement, { phase: "end" }, 4), null);
  assert.equal(
    statusForRenderProgress(replacement, replacement, { phase: "end" }, 4),
    "Rendering 100%",
  );
  assert.equal(
    statusForRenderProgress(replacement, replacement, { outTimeSeconds: 1 }, 4),
    "Rendering 25%",
  );
});

await test("resultForCurrentSource drops a probe after the source file changes", () => {
  const original = new File(["one"], "clip.webm", { type: "video/webm" });
  const replacement = new File(["two"], "other.mov", { type: "video/quicktime" });
  const probe = { streams: [{ codec_type: "video" }] };
  assert.equal(isCurrentSource(original, replacement), false);
  assert.deepEqual(resultForCurrentSource(original, original, probe), probe);
  assert.equal(resultForCurrentSource(original, replacement, probe), null);
});

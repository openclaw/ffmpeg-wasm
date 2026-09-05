#!/usr/bin/env node
import { execFfprobe } from "./index.js";
import { forwardCliProcessSignals } from "./cli-host-signals.js";

let cleanup = () => {};
try {
  process.exitCode = await execFfprobe(process.argv.slice(2), {
    onSpawn(child) {
      cleanup = forwardCliProcessSignals(child);
    },
  });
} finally {
  cleanup();
}

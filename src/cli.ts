#!/usr/bin/env node
import { execFfmpeg } from "./index.js";
import { forwardCliProcessSignals } from "./cli-host-signals.js";

let cleanup = () => {};
try {
  process.exitCode = await execFfmpeg(process.argv.slice(2), {
    onSpawn(child) {
      cleanup = forwardCliProcessSignals(child);
    },
  });
} finally {
  cleanup();
}

#!/usr/bin/env node
import { execFfprobe } from "./index.js";

process.exitCode = await execFfprobe(process.argv.slice(2));

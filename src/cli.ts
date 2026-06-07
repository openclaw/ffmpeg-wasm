#!/usr/bin/env node
import { execFfmpeg } from "./index.js";

process.exitCode = await execFfmpeg(process.argv.slice(2));

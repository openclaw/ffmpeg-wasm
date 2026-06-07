---
title: CI and Verification
description: "Quality checks, wasm E2E, playground E2E, and Cloudflare deployment."
---

# CI and Verification

## Local Checks

```sh
pnpm check
pnpm test:e2e
pnpm playground:e2e
PLAYGROUND_E2E_STATIC=1 pnpm playground:e2e
```

`pnpm check` runs `tsgo`, strict type-aware `oxlint`, and `oxfmt --check`.

`pnpm test:e2e` rebuilds FFmpeg and FFprobe from source, then runs live verifier coverage against the generated wasm assets.

`pnpm playground:e2e` launches Chrome through DevTools, loads the local playground, renders a smaller MP4 and MP3, and writes `.tmp/playground-e2e.png`.

`PLAYGROUND_E2E_STATIC=1 pnpm playground:e2e` serves `dist/docs-site` with COOP/COEP headers, blocks `/api/*`, and verifies browser-only ffmpac rendering.

## GitHub Actions

CI runs:

- TypeScript, lint, format, and docs build.
- Full wasm build and live verification.
- Server and static browser workbench smoke tests with Chrome.
- Cloudflare Pages deployment for `ffmpeg.sh`.

The wasm job uploads `dist/` as an artifact for inspection.

---
title: CI and Verification
description: "Quality checks, wasm E2E, playground E2E, and Pages deployment."
---

# CI and Verification

## Local Checks

```sh
pnpm check
pnpm test:e2e
pnpm playground:e2e
```

`pnpm check` runs `tsgo`, strict type-aware `oxlint`, and `oxfmt --check`.

`pnpm test:e2e` rebuilds FFmpeg and FFprobe from source, then runs live verifier coverage against the generated wasm assets.

`pnpm playground:e2e` launches Chrome through DevTools, loads the local playground, renders a smaller MP4 and MP3, and writes `.tmp/playground-e2e.png`.

## GitHub Actions

CI runs:

- TypeScript, lint, format, and docs build.
- Full wasm build and live verification.
- Playground smoke test with Chrome.
- GitHub Pages deployment for the docs site.

The wasm job uploads `dist/` as an artifact for inspection.

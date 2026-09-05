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

`pnpm check` runs `tsc`, strict type-aware `oxlint`, and `oxfmt --check`.

`pnpm test:e2e` rebuilds FFmpeg and FFprobe from source, then runs live verifier coverage against the generated wasm assets with external executable lookup disabled. Set `FFMPEG_WASM_VERIFY_OUTPUT_DIR` to retain converted media and a JSON proof manifest.

On macOS and Linux, the verifier also blocks the real wasm tools on stdin and sends OS signals. It checks application-owned SIGTERM cancellation through both streaming APIs and SIGHUP/SIGINT/SIGTERM forwarding through both CLI entrypoints.

`pnpm playground:e2e` launches Chrome through DevTools, loads the local playground, renders a smaller MP4 and MP3, and writes `.tmp/playground-e2e-server.png`.

`PLAYGROUND_E2E_STATIC=1 pnpm playground:e2e` serves `dist/docs-site` with COOP/COEP headers, blocks `/api/*`, verifies browser-only ffmpac rendering, and writes `.tmp/playground-e2e-static.png`.

## GitHub Actions

CI runs:

- TypeScript, lint, format, and docs build.
- Full wasm build plus API and CLI MP4/MP3 conversions with codec and dimension assertions.
- Distribution audit rejecting native executables.
- Server and static browser workbench smoke tests with Chrome.
- Cloudflare Pages deployment for `ffmpeg.sh` when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` repository secrets are configured.

The wasm job uploads `dist/`, converted media, a JSON verification manifest, and both browser screenshots for inspection, including partial outputs when a later step fails.

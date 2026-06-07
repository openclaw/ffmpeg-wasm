---
title: Domains
description: "Cloudflare domain layout for ffmpeg.sh and docs.ffmpeg.sh."
---

# Domains

Cloudflare serves the canonical site at `https://ffmpeg.sh/` with the
`ffmpeg-sh-site` Pages project. The static artifact includes `_headers` so the
workbench can use `SharedArrayBuffer` for the browser ffmpac pthread build.

GitHub Pages is not used for the custom-domain path because it cannot serve the
COOP/COEP headers required by the in-browser ffmpac runtime.

DNS is hosted in Cloudflare:

- `ffmpeg.sh`: Pages custom domain; serves the workbench at `/`.
- `www.ffmpeg.sh`: Pages custom domain; redirects to `https://ffmpeg.sh/`.
- `docs.ffmpeg.sh`: Pages custom domain; redirects into `https://ffmpeg.sh/docs/`.

The static entrypoint performs the `www` and `docs` host redirects immediately.
Prefer Cloudflare Redirect Rules for those hosts when a zone DNS/rules token is
available; the Pages project custom domains keep TLS and hostname coverage in
place either way.

The Pages project handles `ffmpeg.sh/*`; host redirects handle `www` and `docs`.

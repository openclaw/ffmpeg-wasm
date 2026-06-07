---
title: Domains
description: "GitHub Pages domain layout for ffmpeg.sh and docs.ffmpeg.sh."
---

# Domains

Cloudflare serves the canonical site at `https://ffmpeg.sh/` with the
`ffmpeg-sh-site` Worker.

GitHub Pages stays on the repository URL, `https://openclaw.github.io/ffmpeg-wasm/`,
and the Pages artifact does not ship a `CNAME`. Keeping GitHub Pages out of the
custom-domain path avoids GitHub's apex/www canonical redirects while DNS changes
are propagating.

DNS is hosted in Cloudflare:

| Host             | Type    | Target                                                                                     | Proxy   |
| ---------------- | ------- | ------------------------------------------------------------------------------------------ | ------- |
| `ffmpeg.sh`      | `A`     | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`                 | Proxied |
| `ffmpeg.sh`      | `AAAA`  | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` | Proxied |
| `www.ffmpeg.sh`  | `CNAME` | `openclaw.github.io`                                                                       | Proxied |
| `docs.ffmpeg.sh` | `A`     | `192.0.2.1`                                                                                | Proxied |

Cloudflare redirects `docs.ffmpeg.sh/docs/*` to `https://ffmpeg.sh/docs/$1`, then
redirects `docs.ffmpeg.sh/*` to `https://ffmpeg.sh/docs/$1`.

The Worker route handles both `ffmpeg.sh/*` and `www.ffmpeg.sh/*`.

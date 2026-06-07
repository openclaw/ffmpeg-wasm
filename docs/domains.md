---
title: Domains
description: "GitHub Pages domain layout for ffmpeg.sh and docs.ffmpeg.sh."
---

# Domains

GitHub Pages serves the canonical site at:

```txt
ffmpeg.sh
```

The Pages artifact ships `CNAME` with only `ffmpeg.sh`, because GitHub Pages
artifacts support one canonical custom domain.

DNS is hosted in Cloudflare:

| Host             | Type    | Target                                                                                     | Proxy    |
| ---------------- | ------- | ------------------------------------------------------------------------------------------ | -------- |
| `ffmpeg.sh`      | `A`     | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`                 | DNS only |
| `ffmpeg.sh`      | `AAAA`  | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` | DNS only |
| `www.ffmpeg.sh`  | `CNAME` | `openclaw.github.io`                                                                       | DNS only |
| `docs.ffmpeg.sh` | `A`     | `192.0.2.1`                                                                                | Proxied  |

Cloudflare redirects `docs.ffmpeg.sh/docs/*` to `https://ffmpeg.sh/docs/$1`, then
redirects `docs.ffmpeg.sh/*` to `https://ffmpeg.sh/docs/$1`.

---
title: Domains
description: "GitHub Pages domain layout for ffmpeg.sh and docs.ffmpeg.sh."
---

# Domains

The Pages artifact ships `CNAME` as:

```txt
ffmpeg.sh
```

That makes the root landing page `https://ffmpeg.sh/`.

The documentation index is also available inside the same site at `https://ffmpeg.sh/docs/`. If `docs.ffmpeg.sh` is configured as an additional Pages/DNS alias, point it at the same Pages target and route it to the docs index.

GitHub Pages artifacts only carry one `CNAME` file, so the repository keeps the deployable canonical domain as `ffmpeg.sh`.

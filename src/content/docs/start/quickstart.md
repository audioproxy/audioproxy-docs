---
title: Quickstart
description: A running proxy and a rendered variant in about a minute.
---

Point the proxy at a directory of audio you already have. No signing key, no
bucket, no config file:

```bash
docker run --rm -p 4000:4000 \
  -e AP_ALLOW_INSECURE=true \
  -e AP_LOCAL_ROOT=/audio \
  -v /path/to/your/audio:/audio:ro \
  ghcr.io/audioproxy/audioproxy:0.4.0
```

Ask for variants — `track.wav` means a file at the root of the directory you
mounted:

```bash
BASE=localhost:4000
SRC='plain/local://track.wav'

# 30-second Opus preview, faded in and out
curl -o preview.opus "$BASE/insecure/f:opus/br:96/t:0:30/fade:1:1/$SRC"

# Waveform peaks for a player UI
curl "$BASE/insecure/f:peaks/$SRC"

# What is this file?
curl "$BASE/insecure/info/$SRC"
```

Both audio responses start arriving while ffmpeg is still encoding. Change any
option and you have a different variant — the URL is the whole request.

Two things before anything real:

- **`AP_ALLOW_INSECURE` is development only.** The literal `insecure` stands in
  for a signature; anyone reaching the port can render anything under the
  root. See [the README's signing section](https://github.com/audioproxy/audioproxy#signing-urls)
  for the real thing.
- **Mount the directory read-only** (`:ro` above).

From here: [Sources](/guides/sources/) for what you can point it at,
[Scaling](/guides/scaling/) for deployment shapes, and the
[API contract](/reference/api-v1/) for the exact grammar.

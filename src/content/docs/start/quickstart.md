---
title: Quickstart
description: Run the proxy against a directory of audio and render a preview, waveform data, and probe metadata in about a minute.
---

The proxy renders variants of audio you already have, so the fastest way to
understand it is to point it at a directory of real files. The container below
runs unsigned (the literal `insecure` stands in for a URL signature), which is
the mode meant for exactly this first look and nothing more.

```bash
docker run --rm -p 4000:4000 \
  -e AP_ALLOW_INSECURE=true \
  -e AP_LOCAL_ROOT=/audio \
  -v /path/to/your/audio:/audio:ro \
  ghcr.io/audioproxy/audioproxy:0.5.0
```

The mount is read-only (`:ro`) on purpose: write access to `AP_LOCAL_ROOT` is
equivalent to choosing what the proxy will serve, so nothing should have it.

Every request has the same shape, `/{signature}/{options}/{source}`, and the
options segment fully describes the output. `track.wav` below names a file at
the root of the directory you mounted:

```bash
BASE=localhost:4000
SRC='plain/local://track.wav'

# A 30-second Opus preview at 96 kbps, fading in and out
curl -o preview.opus "$BASE/insecure/f:opus/br:96/t:0:30/fade:1:1/$SRC"

# Waveform min/max pairs for drawing a player UI
curl "$BASE/insecure/f:peaks/$SRC"

# Duration, sample rate, channels, as JSON
curl "$BASE/insecure/info/$SRC"
```

In that first URL, `f:opus` picks the format, `br:96` the bitrate in kbps,
`t:0:30` cuts the first thirty seconds, and `fade:1:1` fades a second at each
edge; every option is covered in [Transforms](/guides/transforms/).

The preview starts downloading before ffmpeg has finished encoding it: the
response is chunked, produced as the encoder runs. Change any option and you
have described a different variant; there is no server-side configuration to
add, because the URL is the whole request. With a variant store configured,
the second request for the same URL is served from the cache with Range
support, which is what makes seeking work in players; the
[rendering guide](/guides/rendering/) explains both response shapes.

Before anything faces real traffic, replace `insecure` mode with signed URLs.
While it is on, anyone who can reach the port can render anything under the
root. The [README's signing section](https://github.com/audioproxy/audioproxy#signing-urls)
contains the algorithm and a reference implementation in Elixir and Ruby.

From here, [Transforms](/guides/transforms/) lists everything you can ask
for, [Sources](/guides/sources/) covers what the proxy can read and how
access is controlled, [Rails](/integrations/rails/) turns ActiveStorage
attachments into signed variant URLs, [Rails integration](/integrations/rails/) turns
ActiveStorage attachments into signed variant URLs, [Scaling](/guides/scaling/) covers deployment shapes
from one container to a fleet, and the [API contract](/reference/api-v1/) is
the exact grammar everything above is built on.

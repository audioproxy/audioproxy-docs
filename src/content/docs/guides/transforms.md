---
title: "Transforms"
description: "Everything the proxy can do to audio, by goal: formats, quality, trims, fades, loudness, resampling, waveform data, downloads."
---

<!-- authored here; the API contract is canonical for the exact grammar -->

Every transform is an option in the URL path, written `key:value` and
separated by `/`. Order never matters: `f:opus/br:96` and `br:96/f:opus`
name the same variant and share one cache entry. This page lists what you
can ask for, organized by what you are trying to achieve; the
[API contract](/reference/api-v1/) is canonical for the exact grammar.

## Choose a format and quality

```
f:mp3/br:128
```

`f` picks the output format; `br` sets the bitrate in kbps. This example
asks for MP3 (the format every browser plays) at 128 kbps.

`f` accepts `mp3`, `opus`, `ogg` (Vorbis), `aac`, `m4a`, `flac`, `wav`, and
`peaks` ([waveform data](#get-waveform-data), not audio). Leaving `f` out
means `mp3`.

For quality you have two mutually exclusive choices:

- **`br` (bitrate, kbps)** targets a constant size per second: `br:96` on
  Opus is a good preview, `br:128` on MP3 a good default. Lossy formats
  only; a bitrate on FLAC or WAV would change nothing and is refused.
- **`q` (encoder quality)** lets the encoder vary bitrate to hold quality.
  Each format has its own scale: mp3 `0`(best)..`9`, ogg `-1`..`10`(best),
  aac/m4a `0.1`..`2`, opus and flac `0`..`10`/`12` (compression effort).
  Values outside the scale are refused with a `422` naming the problem.

## Cut a section

```
t:12.5:30
```

`t` is `start[:duration]`, in seconds, decimals allowed to millisecond
precision. This cuts 30 seconds starting at 12.5 s. `t:30` alone runs from
30 s to the end. Only the bytes the cut needs are read from the source, so
a 30-second preview of a two-hour master is quick and cheap.

## Fade the edges

```
t:0:30/fade:1:2
```

`fade` is `in[:out]`, in seconds, applied inside the trimmed region. This
takes the first 30 seconds (`t:0:30`), fades in over 1 second and out over
the final 2. One rule to know: a fade-*out* needs a trim with a duration,
because its start is counted back from the end, and an unbounded cut has no
end to count from. A fade-in alone works without any trim.

## Set loudness

```
norm:ebu
```

`norm:ebu` normalizes to broadcast loudness targets, defaulting to
−16 LUFS integrated, −1.5 dBTP peak, 11 LU range; append your own as
`norm:ebu:-14:-1:9` (integrated:peak:range). Normalization is single-pass:
accurate enough for previews and podcast delivery, not for mastering work.

```
gain:-3
```

`gain` applies a fixed level change in dB, positive or negative, up to
±100. With both present, normalization runs first and the gain offsets its
result.

## Resample, downmix, bit depth

```
f:wav/ch:1/sr:16000
```

The shape speech-to-text wants: `ch:1` downmixes to mono, `sr:16000`
resamples to 16 kHz, and WAV keeps it uncompressed. `sr` accepts any rate
in Hz but caps at 48000 for lossy formats (higher buys nothing audible and
is refused explicitly). `ch` is `1` or `2`.

```
f:flac/bd:24
```

`bd` sets bit depth for lossless formats only: `16`, `24`, or `32f`
(32-bit float, WAV only, since FLAC stores integers). Without `bd`,
lossless output follows the source's depth.

## Get waveform data

```
f:peaks/pts:800
```

`f:peaks` returns min/max amplitude pairs for drawing a waveform, in
[audiowaveform](https://github.com/bbc/audiowaveform)-compatible JSON that
drops straight into [peaks.js](https://github.com/bbc/peaks.js). `pts` is
how many pairs you get (default 800, one per pixel of a typical player).
`pk_fmt:dat` gives the compact binary form instead of JSON.

Peaks respect `t` (a cut), `fade`, and `ch`, and refuse everything about
*encoding* (`br`, `q`, `sr`, `bd`, `gain`, `norm`), since none of those can
change the drawn shape. One default differs: peaks are **mono** unless you
ask for `ch:2`, because a waveform UI usually draws one shape.

Fetching peaks from a page on another origin needs CORS turned on — unlike
`<audio>` playback, which never did. Set `AP_ALLOW_ORIGIN` to the origin your
page is served from; see [reading a response from a
browser](/guides/rendering/#reading-a-response-from-a-browser).

## Deliver as a download

```
f:flac/bd:24/t:60:120/dl:excerpt.flac
```

`dl` turns the response into a download with the given filename: this
example cuts two minutes starting at 1:00, as 24-bit FLAC, offered to the
browser as `excerpt.flac`.

`cb` (cache-buster) is an opaque tag that changes the cache identity
without changing the audio: bump `cb:v2` to force a re-render after
replacing a source file under the same name.

## Worked examples

The whole range in one place. These use the dev-mode `insecure` segment in
place of a signature, as the [quickstart](/start/quickstart/) does; a real
deployment [signs every URL](/guides/signing/).

```bash
BASE=localhost:4000
SRC='plain/local://piece.wav'

# A 30-second preview: Opus at 96 kbps, starting 12.5 s in,
# half-second fade in and one-second fade out.
curl "$BASE/insecure/f:opus/br:96/t:12.5:30/fade:0.5:1/$SRC"

# Waveform peaks to draw a player UI, 800 min/max pairs as JSON.
curl "$BASE/insecure/f:peaks/pts:800/$SRC"

# The same peaks in the compact binary form, which is what you want
# once the pair count gets large.
curl -o peaks.dat "$BASE/insecure/f:peaks/pts:4000/pk_fmt:dat/$SRC"

# Speech, small: 64 kbps mono MP3 at 22.05 kHz.
curl "$BASE/insecure/f:mp3/br:64/ch:1/sr:22050/$SRC"

# Normalised to −16 LUFS for podcast delivery.
curl "$BASE/insecure/f:mp3/br:128/norm:ebu/$SRC"

# Two minutes of 24-bit FLAC, offered to the browser as a download.
curl -OJ "$BASE/insecure/f:flac/bd:24/t:60:120/dl:excerpt.flac/$SRC"

# Mono 16 kHz WAV, the shape a speech-to-text pipeline wants.
curl "$BASE/insecure/f:wav/ch:1/sr:16000/$SRC"

# What is this file? (source metadata, as JSON)
curl "$BASE/insecure/info/$SRC"
```

Each URL describes its output completely, so the same URL always means the
same bytes. The first request for a variant renders it and streams it
while it encodes; later requests come from the
[variant store](/guides/variant-store/).

## Rules for combining

The proxy refuses, with a `422` naming the offending option, anything that
could not change the output: `br` with `q`, `br` on lossless formats, `bd`
on lossy ones, encoding options with `f:peaks`, a fade-out without a
bounded trim. The reasoning is cache honesty: an option that cannot change
the bytes would give one variant two cache entries. Decimals are accepted
to three places and refused beyond, for the same reason.

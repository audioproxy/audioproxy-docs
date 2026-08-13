---
title: "Source metadata"
description: "Ask the proxy what a source is before you render it: duration, sample rate, channels, tags, and what /info deliberately will not tell you."
---

<!-- authored here; the API contract is canonical for the exact grammar -->

`info` sits where the options go and answers with the source's own
metadata, so a client can size a request to the file before making it. A
preview URL that trims past the end of a track is an easy mistake to make
blind.

```bash
curl "$BASE/$SIG/info/plain/local://piece.wav"
```

```json
{"format":"wav","duration":184.32,"sample_rate":48000,"channels":2,
 "bit_depth":16,"bitrate":1536000,"size":35389532,
 "tags":{"title":"Sea Change","artist":"…"}}
```

## The fields

| Field | Meaning |
|---|---|
| `format` | The `f:` token this source would be, not the container's internal name: an MP4 is `m4a`, and Ogg is `opus` or `ogg` depending on what is inside it. A source in a container the proxy cannot itself produce is named plainly (`matroska`) rather than forced into a token |
| `duration` | Seconds, as a float |
| `sample_rate`, `channels` | The source's own, which is what a variant inherits when you leave `sr` or `ch` off |
| `bit_depth` | Lossless sources only |
| `bitrate` | Bits per second |
| `size` | Bytes, from storage |
| `tags` | Whatever the file carries, title, artist and the rest, as strings |

**A field the source cannot answer is left out, never `null`.** A lossy
source has no `bit_depth`, so the key is simply absent; an untagged file
has no `tags`. Test for the key, not for a value.

## What it will not do

`info` takes no processing options. It describes the source, not a
variant, so `/info/br:128/…` is a `422`.

A source with no audio in it at all, a video-only MP4 or a text file, is a
`415`. So is one that has both audio and video: the audio-only rule
applies here too, so there is no endpoint that will describe a video file
for you. Cover art is not video, so a normal tagged catalogue is
unaffected.

## Caching

Responses carry an `ETag` derived from the source object, so a client or
CDN that has seen this metadata before revalidates for the price of a
`304`.

`Cache-Control` is one hour rather than the year a rendered variant gets,
and deliberately not `immutable`. A variant's URL describes its bytes
exactly and can never go stale; this describes a file somebody may
re-upload tomorrow.

## Cost

Probing is cheap. It reads the file's header and stops, so it does not
queue behind renders and has its own, much shorter `AP_PROBE_TIMEOUT`.

For the same reason `AP_MAX_SRC_BYTES` does not apply here: a source too
large to render can still be described, which is what you want, since the
long file is exactly the one you were going to ask for a trimmed preview
of.

Cheap is not free, though, so probes have a ceiling of their own,
`AP_MAX_PROBE_CONCURRENCY`, separate from `AP_MAX_CONCURRENCY` so that
neither pool can starve the other. Requests reading the same source share
one probe, whether that is several `/info` calls, several renditions, or
an `/info` alongside a render, so the ceiling is reached by traffic naming
many *different* sources at once. When it is, the answer is a `429` with
`Retry-After`, the same as a full render queue. Come back and there will
almost certainly be room, since a probe lasts milliseconds.

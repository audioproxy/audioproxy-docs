---
title: "Variant store"
description: "Keep completed renders so a variant is encoded once: choosing a backend, what write-back guarantees, and redirect versus proxy serve modes."
---

<!-- authored here; the API contract is canonical for the exact grammar -->

Without a variant store, every request renders. That works, and it is the
default, but it means a popular preview is re-encoded for every listener.

Point `AP_VARIANT_STORE` at somewhere to keep completed renders and each
variant is encoded once:

```bash
AP_VARIANT_STORE=s3://variants …                                       # object storage
AP_VARIANT_STORE=file:///var/cache/audio_proxy AP_SERVE_MODE=proxy …   # a directory
```

The scheme picks the backend, and each is validated at boot by the
operation it needs, a write and taking it back, so a store this deployment
cannot write fails the container instead of discarding every write-back in
silence.

`file://` names a directory that must exist and be writable. `s3://` names
a bucket and nothing else: no key prefix, and the credentials are the same
`AWS_*` variables covered in
[Configuration](/guides/configuration/#s3-credentials).

## What write-back guarantees

With a store configured, every successful render is written back under its
cache key, together with the headers it was served with, atomically, so a
failed or cancelled render leaves nothing behind.

It also changes what a client disconnect means. The render of a variant
nobody is waiting for anymore is completed into the store rather than
cancelled, so the next request for it is a hit rather than a fresh encode.

## Prefer `s3://` if you have object storage

The cache outlives the container, every node reads what any node rendered,
and it is the only backend that can presign, which is what makes
`AP_SERVE_MODE=redirect` work at all.

Two things about a `file://` store are yours to own:

- **It is unbounded.** Nothing evicts, expires or size-caps it; it grows
  until the disk is full. Manage it like any cache directory you operate:
  a dedicated volume, disk alerts, a sweep of your choosing.
- **It should live on a volume.** A store on the container's writable
  layer disappears with the container, taking every cached variant with
  it.

A `file://` store is also per-node: two nodes with separate directories
each render a variant once. That is the intended trade, and shared caches
are what `s3://` is for. See [Scaling](/guides/scaling/).

An `s3://` store is unbounded in the same way, and there the lever is the
bucket's own lifecycle rules rather than anything this proxy does. Worth
setting one for incomplete multipart uploads too: a write-back aborts its
own, but a hard kill of the container is not something it can clean up
after.

## What a hit looks like

A request for a variant that is not stored renders it (`MISS`), or
attaches to a render already running for it (`COALESCED`). A request for
one that is stored renders nothing (`HIT`), and the two answer in
different shapes:

| | `MISS` / `COALESCED` | `HIT` |
|---|---|---|
| Status | `200` | `200`, or `302` in redirect mode |
| Framing | `transfer-encoding: chunked` | `content-length` |
| `accept-ranges` | absent | `bytes` |
| A `Range` request | ignored, answered in full | `206` with the slice |

`content-type`, `cache-control` and `etag` are the same either way, and so
are the bytes. Both shapes start delivering before the variant is complete
or fully read, so neither makes a client wait.

The one thing to take from this table: **the same URL can answer in either
shape**, because which one you get depends on whether the variant happens
to be cached at that moment. A client that assumes a length, or assumes a
range will be honoured, will be wrong on a cold cache; one that assumes
chunked framing will be wrong on a warm one. Browsers handle both
natively, which is why this is a note for anything else you write against
the endpoint.

Two ways to make a first play seekable, if you need one: request the URL
once and discard the response before setting `src`, or warm the cache
after upload. Both leave the player facing a hit.

## Choosing a serve mode

`AP_SERVE_MODE=proxy` serves hits from the store through the proxy. It
works with every backend, keeps one hostname in front of clients, and
means the proxy stays in the path for the bytes.

`AP_SERVE_MODE=redirect` (the default) answers a hit with a `302` to a
presigned URL valid for `AP_PRESIGN_TTL` seconds, and storage serves the
bytes. The proxy leaves the hot path entirely, which is the point of it,
and the client cannot tell the difference: the variant arrives under the
same `Content-Type` and `Cache-Control` a proxied hit would have sent,
because the store holds the ones the write-back saved. `Range` is the
store's to answer, natively.

Presigning is a capability of the store's backend, so `redirect` needs an
`s3://` store. Against a `file://` one, which has no URLs to sign, it is
refused at boot naming both variables; use `proxy` there.

**Behind a CDN, prefer `proxy`.** It is the mode that collaborates with an
edge: one origin, cacheable immutable responses, `Range` served through
the same URL the CDN already holds. `redirect` routes the media bytes
around the edge to storage, so the CDN caches a `302` it must not keep and
none of the audio. See [Caching and CDNs](/guides/caching/).

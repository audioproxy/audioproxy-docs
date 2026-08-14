---
title: "Caching and CDNs"
description: "Putting a CDN in front of the proxy: what every response says about its own lifetime, revalidation, HEAD, and how Range is handled."
---

<!-- authored here; the API contract is canonical for the exact grammar -->

The proxy is built to sit behind a CDN without special configuration on
either side. The URL names the variant completely, the `ETag` is the cache
key, there are no cookies and no `Vary`, and changing the `cb` option
busts every tier at once.

Every response states how long it may be held rather than inheriting a
framework default.

## What each response says

| Response | `Cache-Control` | Why |
|---|---|---|
| `200` media / peaks | `public, max-age=31536000, immutable, no-transform` | The URL encodes the variant, so it *is* immutable; `no-transform` keeps edge features from recompressing or mangling the bytes |
| `404` | `max-age=10` | Sources appear: a file uploaded moments after the miss is served within seconds |
| `413`, `415` | `max-age=10` | Verdicts about the current source bytes, which a re-upload changes |
| `401`, `422` | `max-age=60` | Pure functions of the URL: a bad signature never becomes good, invalid options never become valid, and only a deploy changes that |
| `410` (expired) | `max-age=31536000, immutable` | The one verdict that is permanent by construction. An expired URL cannot become valid again, because the timestamp it is judged against is inside the signature, and no deploy changes that either. See [Expiring URLs](/guides/signing/#expiring-urls) |
| `302` (cache hit, redirect mode) | `no-store` | The `Location` is a credential with an expiry; a cached redirect hands out URLs that no longer work |
| `416` | `no-store` | The only response whose body depends on a request header, and nothing here sends `Vary: Range` |
| `429`, `500`, `502`, `504` | `no-store` | Transient. Caching a transient failure amplifies it: `429` carries `Retry-After`, and a cached `502` would suppress the retry that would have worked |
| `200` from `/info` | `public, max-age=3600` | Not `immutable`, and not a year: the metadata describes a source somebody may re-upload, so caches must be able to revalidate it |
| `/health`, `/ready`, `/metrics` | `no-store` | Liveness is only worth anything fresh, a stored readiness verdict is advice about a load level that has since moved, and a cached scrape is a measurement of a moment that has passed |

The error rows are a deliberate relaxation, worth knowing if you operate a
shared cache. Without them every response would carry
`max-age=0, private, must-revalidate`, so errors would not be cacheable at
all and never shareable. Dropping `private` is safe here because an error
body is a pure function of the URL: no cookies, no auth headers, nothing
per-user in it. The practical effect is that a hot `404` or a
bad-signature storm is absorbed at the edge instead of reaching the origin
every time.

If you need the stricter behaviour for a specific deployment, an edge rule
overriding `Cache-Control` on 4xx is the place to do it. The proxy has no
knob for it by design.

## Revalidation costs no render

A request whose `If-None-Match` matches the variant's `ETag` answers `304`
before the proxy touches storage or spawns anything, because the ETag
derives from the URL alone.

The signature still gates: an unsigned request is `401`, matching
validator or not.

On `/info` the validator comes from the source object rather than the URL,
so revalidating there costs one `stat` and still no probe.

## HEAD works

`HEAD` on a signed URL runs every check a `GET` runs (signature, options,
source authorization and stat) with an empty body and no render. Errors
answer as `GET` does, bodiless. `HEAD /health` works too.

Two caveats if you use it to validate URLs:

- Because it neither decodes nor probes, it cannot report a source ffmpeg
  would reject or one that turns out to be video, so a `HEAD` can answer
  `200` where the `GET` answers `415`. Everything decidable without a
  subprocess (`401`, `404`, `413`, `422`) matches the `GET` exactly.
- It does not consult the variant cache, so it reports the render path's
  framing, never a hit's `content-length` or its `302`.

## Range on an uncached variant is ignored

A `Range` header on a variant that has to be rendered gets the full `200`
chunked stream, which RFC 9110 permits, with no `Accept-Ranges` and no
`206`.

Range serving belongs to cached variants: a hit answers `206` in proxy
mode, or redirects to storage that serves it natively. A range no byte of
a cached variant can satisfy is a `416`. One this proxy does not implement
(several ranges at once, a unit other than `bytes`) is ignored, and
answers the whole variant rather than failing.

See [Variant store](/guides/variant-store/#what-a-hit-looks-like) for the
two response shapes and why the same URL can answer in either.

## Serve mode matters here

`AP_SERVE_MODE=redirect` is the default and it is the wrong default behind
a CDN. It routes the media bytes around the edge to storage, so the CDN
caches a `302` it must not keep and none of the audio.

Put a CDN in front and set `AP_SERVE_MODE=proxy`.

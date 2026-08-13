---
title: "Configuration"
description: "Every AP_ environment variable the proxy reads, the AWS_ credentials group, CORS, and how to size a container."
---

<!-- authored here; the API contract is canonical for the exact grammar -->

All configuration comes from environment variables. There is no config
file and nothing to put in `config/*.exs`. Values are read, typed and
validated once at boot, so a malformed value aborts startup with an error
naming the variable rather than failing the first request that touches it.

Booleans accept `1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`,
case-insensitively. An empty value counts as unset.

The variables below are the full configuration surface for the design, so
a few of them are parsed and validated but not yet consumed.

## The variables

| Variable | Type | Default | Purpose |
|---|---|---|---|
| `AP_PORT` | positive integer | `4000` | Port the proxy listens on. `PORT` is read when it is unset, so a host that sets `PORT` for something else will be followed |
| `AP_KEY` | hex, ≥ 32 bytes decoded | unset | HMAC key for URL signatures |
| `AP_SALT` | hex | unset | HMAC salt |
| `AP_ALLOW_INSECURE` | boolean | `false` | Accept unsigned URLs (dev only) |
| `AP_SOURCE_ALLOWLIST` | comma-separated | empty | Permitted buckets and hosts for `s3://` and `https://` sources. Empty accepts every bucket and refuses every host. See [Sources](/guides/sources/) |
| `AP_LOCAL_ROOT` | existing directory | unset | Root for `local://` sources; unset disables them. Must exist at boot, and may not be `/` |
| `AP_VARIANT_STORE` | URL (`file:///path`, `s3://bucket`) | unset | Where rendered variants are written back; unset means no cache and every request renders. Probed for writability at boot. See [Variant store](/guides/variant-store/) |
| `AP_MAX_CONCURRENCY` | positive integer | schedulers online | Max simultaneous ffmpeg processes. Requests that share a render share its slot, so this counts encodes, not connections |
| `AP_MAX_PROBE_CONCURRENCY` | positive integer | `4 × AP_MAX_CONCURRENCY` | Max simultaneous ffprobe processes. A ceiling of its own so a probe never queues behind a render. Raise it if you serve many distinct sources at once and see `429`s while ffmpeg is idle |
| `AP_QUEUE_SIZE` | non-negative integer | `32` | Requests that may wait for a render slot before the next one is answered `429` with `Retry-After`. `0` means no waiting at all |
| `AP_READY_QUEUE_THRESHOLD` | non-negative integer, ≤ `AP_QUEUE_SIZE` | half `AP_QUEUE_SIZE`, rounded down (min 1) | Queue depth at which `/ready` answers `503`; it recovers at half the threshold, rounded down. `0` disables the check, which is what a single node wants. See [Scaling](/guides/scaling/) |
| `AP_MAX_SRC_BYTES` | positive integer | `2000000000` | Reject larger sources with `413`, before any render starts. Does not apply to `/info`, which only reads headers |
| `AP_MAX_VARIANT_BYTES` | positive integer | the effective `AP_MAX_SRC_BYTES` | Cap the bytes one render may hold in memory; output past it kills the render and fails the request mid-stream. Set it below `AP_MAX_SRC_BYTES` to accept large sources while producing small outputs |
| `AP_RENDER_TIMEOUT` | positive integer | `300` | Seconds a render may take before ffmpeg is killed and the request answered `504`. Raise it for full-length transcodes; the default suits previews. See [Rendering](/guides/rendering/) |
| `AP_PROBE_TIMEOUT` | positive integer | `10` | Seconds an `/info` probe may take before ffprobe is killed and the request answered `504`. Much shorter than the render timeout, because a probe reads a header rather than decoding |
| `AP_SERVE_MODE` | `redirect` \| `proxy` | `redirect` | Serve cache hits by redirect or proxied. See [Variant store](/guides/variant-store/#choosing-a-serve-mode) |
| `AP_PRESIGN_TTL` | positive integer | `300` | Seconds a cache hit's presigned URL stays valid. Redirect mode only |
| `AP_LOG_LEVEL` | `debug` \| `info` \| `warning` \| `error` | `info` | Lowest level written to stdout. See [Operations](/guides/operations/) |
| `AP_METRICS_BIND` | IP address literal | `127.0.0.1` | Interface the `/metrics` listener binds. The endpoint is unsigned, so this *is* its access control. A hostname is refused |
| `AP_METRICS_PORT` | positive integer | `9568` | Port for the `/metrics` listener. Must differ from the listener port, and the clash is refused at boot rather than left to an `:eaddrinuse` naming neither |
| `AP_ALLOW_ORIGIN` | `*` or an origin | unset | Send CORS headers, so a page on another origin can `fetch()` from the proxy. See [Fetching from a browser](#fetching-from-a-browser) |
| `AP_S3_ENDPOINT` | origin URL | unset | Talk to an S3-compatible store instead of AWS. See [S3 providers](/guides/s3-providers/) |
| `AP_S3_ADDRESSING` | `virtual` \| `path` | `virtual` with no endpoint, `path` with one | Whether a request names its bucket in the host (`bucket.host/key`) or in the path (`host/bucket/key`) |
| `AP_S3_CA_BUNDLE` | path to a PEM file | unset | Verify the store's certificate against this bundle instead of the system trust store, for a store behind a private CA. Must be readable at boot |

## S3 credentials

S3 access is the one thing configured with **standard AWS variables**
rather than `AP_`-prefixed ones, because every tool that produces
credentials already writes those names:

| Variable | Required | Purpose |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | with the others | Access key |
| `AWS_SECRET_ACCESS_KEY` | with the others | Secret key |
| `AWS_REGION` (or `AWS_DEFAULT_REGION`) | with the others | Signing region, part of every signature, so there is nothing safe to guess |
| `AWS_SESSION_TOKEN` | no | For temporary credentials |

They are validated as a group at boot: all three, or none. Half a
credential signs nothing, and a container that starts and then fails its
first S3 request is worse than one that does not start.

**Credentials come from the environment only.** There is no IMDS or STS
lookup, so an EC2/EKS instance role does not work: supply keys. That is a
known limitation, not an oversight.

[S3 providers](/guides/s3-providers/) has working configurations for
Backblaze B2, DigitalOcean Spaces, Hetzner, Scaleway and Tigris, and is
the honest account of what is tested.

## Fetching from a browser

An `<audio src="…">` pointed at the proxy plays from any page, with
nothing configured. Anything that *reads* the bytes instead of playing
them needs CORS: `fetch()`ing `f:peaks` to draw a waveform, reading
`/info`, or reading `Retry-After` off a `429` to back off politely.
Without it the browser refuses the response and the page sees an opaque
failure.

Name the origin your page is served from:

```bash
AP_ALLOW_ORIGIN=https://app.example.com …
```

An origin and nothing else (scheme, host, optional port) **spelled the way
a browser spells it**, since the browser compares your value to its own
`Origin` byte for byte. Anything that means the right origin to a person
but matches nothing in a browser is refused at boot, with the canonical
spelling in the error:

| Refused | Write instead |
|---|---|
| `https://app.example.com/` | `https://app.example.com` |
| `HTTPS://App.Example.com` | `https://app.example.com` |
| `https://app.example.com.` | `https://app.example.com` |
| `https://app.example.com:443` | `https://app.example.com` |

A non-default port stays, of course: `http://localhost:5173` is exactly
what a dev server sends. `AP_ALLOW_ORIGIN=*` allows every origin, which
suits a public catalogue and nothing that a signed URL is meant to keep
scoped.

Setting it also makes `OPTIONS` answer the browser's preflight; unset,
`OPTIONS` is a `404` like every other non-GET method. Either way the URL
signature is still what authorizes a request: CORS decides which page may
*read* a response, never which requests are valid.

One origin, not a list. If you need several, put a CDN or reverse proxy in
front.

## Sizing the container

`AP_MAX_CONCURRENCY` and `AP_MAX_VARIANT_BYTES` are the two variables that
decide how much memory a container needs, and the answer is a lookup
rather than a guess: a render's output is held in memory until the render
ends, so a full-length transcode costs its own size while a source of any
length costs nothing.

[Capacity planning](/guides/capacity/) opens with a matrix. Find your
output length and format in a row and your memory limit in a column, and
read the largest safe `AP_MAX_CONCURRENCY`. Read it before serving
anything longer than a preview.

Raising `AP_MAX_VARIANT_BYTES` does **not** buy capacity. It bounds one
render, so every concurrent slot may reach it; the lever for the total is
`AP_MAX_CONCURRENCY`.

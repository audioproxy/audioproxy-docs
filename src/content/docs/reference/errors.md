---
title: "Errors"
description: "Every error the proxy returns: status, code, what caused it, and whether retrying helps."
---

<!-- authored here; the API contract is canonical for the exact grammar -->

Failures are JSON, one shape everywhere:

```json
{"error": "…", "message": "…"}
```

The `error` code is stable and safe to branch on. The `message` is prose
for a human and may change between releases; do not parse it.

## The table

| Status | `error` | When |
|---|---|---|
| `401` | `invalid_signature` | Missing or invalid signature |
| `404` | `not_found` | The source is missing, unreadable, unparseable, or not one this proxy may serve. Deliberately indistinguishable, so a `404` tells you nothing about what exists on disk |
| `413` | `source_too_large` | The source exceeds `AP_MAX_SRC_BYTES`. Renders only; `/info` describes a source of any size |
| `415` | `undecodable_source` | The source format is not decodable, or, on `/info`, carries no audio at all |
| `415` | `video_source` | The source contains a video stream, and this proxy serves audio only. Cover art is not video |
| `422` | `invalid_options` | Invalid or conflicting options; the message names the offending segment |
| `429` | `queue_full` | A pool is full: either the render queue (or this request waited longer than `AP_RENDER_TIMEOUT` for a slot), or `AP_MAX_PROBE_CONCURRENCY` probes are already running. `Retry-After` is set either way, and the two are deliberately indistinguishable to a client |
| `500` | `render_failed` | The render failed for a reason that is not yours: no encoder on the host, no disk space, a failure the proxy could not classify. Worth retrying |
| `500` | `probe_failed` | A probe failed for a reason that is not yours. Worth retrying. Both endpoints probe: `/info` is a probe, and a render runs one first to check the source is audio |
| `500` | `not_configured` | The storage backend the source names is misconfigured: no credentials, or a region/endpoint that is not the object's, which the store answers with a redirect. An operator has to fix it; retrying will not |
| `502` | `upstream_unavailable` | The storage backend could not be reached: it answered `5xx`, or nothing at all. Says nothing about whether your object exists, and is `no-store` for that reason. Worth retrying |
| `504` | `render_timeout` | A render started and then exceeded `AP_RENDER_TIMEOUT`. Time spent *waiting* for a slot is a `429`, not this |
| `504` | `probe_timeout` | A probe exceeded `AP_PROBE_TIMEOUT`. On a render URL this means the audio-only check ran out of time before any encoding started: raise `AP_PROBE_TIMEOUT`, not `AP_RENDER_TIMEOUT` |

## Which of these are worth retrying

Three groups, and the distinction is worth building into a client:

- **Never retry unchanged.** `401`, `422`, `413`, `415`. These are pure
  functions of the URL and the current source bytes. A bad signature never
  becomes good and invalid options never become valid; only a different
  URL, or a re-uploaded source, changes the answer.
- **Retry with backoff.** `429`, `500`, `502`, `504`. All transient.
  `429` carries `Retry-After` and you should honour it rather than
  guessing. Reading that header from a browser needs CORS; see
  [Configuration](/guides/configuration/#fetching-from-a-browser).
- **Fix the deployment.** `not_configured` is the one error a retry can
  never clear, despite being a `500`. It means credentials or an endpoint
  are wrong.

## A failure after the response has started

The table above covers failures decided *before* any bytes are sent.

A render that fails partway through cannot use it. The status line and
headers are already on the wire, so the only way to signal the failure is
to cut the connection short. **Treat a chunked response that ends without
its terminating chunk as a failed download**, not as a complete file.

This is a property of streaming rather than a shortcoming of this proxy;
it is the honest reason segmented formats are on the roadmap. See
[Rendering](/guides/rendering/).

## Errors are cacheable

Unusually, most of these carry a positive `Cache-Control`, so a hot `404`
or a bad-signature storm is absorbed at the edge instead of reaching the
origin every time. The durations differ by what could change the verdict.
See [Caching and CDNs](/guides/caching/).

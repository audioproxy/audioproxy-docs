---
title: "Source resolution"
description: "Source forms and encodings (local://, s3://, https://), the allowlist grammar, and what the proxy refuses."
---

<!-- adapted from the audioproxy repo's docs/sources.md; authored here for the user-facing site -->

The last portion of every URL names the audio you want rendered: a file under
a mounted directory, an object in an S3 bucket, or a URL at an origin you
control. This page covers how to write that portion, how access to each kind
of source is controlled, and what the proxy refuses to touch. For the exact
grammar, see the [API contract](/reference/api-v1/) §1.

> **Status.** `local://` and `s3://` sources render today. An `https://`
> source is parsed and checked against the allowlist, but answers `404` until
> HTTPS fetching ships. Any other scheme, `http://` included, is refused.
## Two encodings, one source

| Form | Example |
|---|---|
| `plain/{source}` | `plain/s3://masters/2026/piece-final.wav` |
| `enc/{base64url(source)}` | `enc/czM6Ly9tYXN0ZXJzLzIwMjYvcGllY2UtZmluYWwud2F2` |

The `enc/` payload is decoded to the plain *source string* first, and from
there both encodings share one code path. That is what keeps them from
drifting semantically: there is exactly one parser per scheme, and the
encoding is peeled off before it runs. Both forms therefore land on the same
typed source, the same canonical string, and the same cache key.

It also fixes an ordering every source type depends on — decode fully, *then*
interpret. A path-confinement check or a URL parse is only sound on a
fully-decoded string, and doing it in the wrong order is how traversal bugs
happen.

Base64url is accepted padded or unpadded. Unlike a signature, an encoded
source has nothing to gain from being non-malleable: every spelling decodes to
the same bytes, so every spelling is the same variant.

## Escaping

The `plain/` payload is percent-decoded **exactly once**. So a literal `%` is
written `%25`, a space `%20`, and `+` is left alone — `+` is a literal plus in
a path, and the plus-means-space convention belongs to query strings. A
malformed escape (`%zz`, a trailing `%`) is rejected rather than passed
through, because passing it through would give one source two spellings:
`%zz` and `%25zz` would both decode to `%zz`, and one source with two
spellings is one variant with two cache keys.

That single decode has a consequence worth stating plainly. A source that
**already carries escapes has to be escaped again** for the `plain/` form,
since the outer layer is what gets stripped:

```
https://h/a%20b.wav                the source
plain/https://h/a%2520b.wav        …as a plain source
enc/aHR0cHM6Ly9oL2ElMjBiLndhdg     …as an encoded source
```

This is exactly the headache `enc/` exists to avoid — base64url the source as
written and be done with it.

Remember that the signature covers the raw request path, so a source must be
signed in the same spelling it is requested in. Re-encoding anything between
signing and requesting breaks the signature.

## Refused for everyone, once

Control, format and line/paragraph-separator code points are refused in any
decoded source, whatever its type. Matching is by Unicode category (`Cc`,
`Cf`, `Zl`, `Zp`) rather than by the ASCII range, because `\x00-\x1f` alone
lets U+0085, U+2028 and a right-to-left override straight through.

Nothing legitimate needs one, and they would otherwise reach ffmpeg argv,
object keys, `Content-Disposition` and log lines — where a right-to-left
override is a filename-spoofing tool. Doing this in the shared layer rather
than per type is the point: a source type cannot forget it, so a NUL byte
never reaches a confinement check.

The failures the shared layer produces, each an `{:error, reason}` the HTTP
layer maps to a status. A source type adds its own on top.

| Reason | Cause |
|---|---|
| `:unknown_encoding` | Segment starts with neither `plain/` nor `enc/` |
| `:invalid_encoding` | `enc/` payload is not base64url, or does not decode to UTF-8 |
| `:malformed_escape` | A `%` not followed by two hex digits |
| `:empty_source` | Nothing after the encoding prefix |
| `:control_character` | A control, format or separator code point |
| `:unknown_scheme` | No registered source type claims the scheme |

Every one of them, and every reason a source type adds, renders the same
byte-identical **404**. That is the no-oracle rule, and it is why the table
above is about diagnosis rather than about what a client sees.

## Local sources

`local://{path}` names a path relative to `AP_LOCAL_ROOT`. The root is
deployment configuration — a bind mount, a volume, a directory on a laptop —
and unset means the type is disabled: nothing mounted, nothing served. The
root *is* the allowlist for disk, which is why this type has no allowlist of
its own. `/` is refused at boot, since every relative path is "under" it.

### Confinement

Order matters more than any single check:

1. The shared layer has already decoded the source exactly once and refused
   control-class code points. A confinement check on a half-decoded string
   proves nothing, so it does not run on one.
2. `Path.safe_relative/2` rejects absolute paths and any `..` that climbs out
   of the root, and normalizes `.` and interior `..` away.
3. The result is joined to the root and resolved link by link — `safe_relative`
   does not follow symlinks, and a `previews` symlinked at `/etc` is a
   perfectly safe *relative* path.
4. The resolved path must still sit under the resolved root.

Nothing is normalized-and-continued: a path failing any step is refused, not
repaired. Every refusal is `{:error, :not_allowed}` → **404**, the same answer
as a missing file, so the root cannot be used to probe the filesystem around
it.

One consequence worth knowing: OTP treats *any* absolute symlink target as
unsafe, so a link inside the root that spells its target absolutely is refused
even though the target is servable. Relative links inside the root work;
absolute ones want a root pointed at the resolved location instead.

### Limits

At most **64 path components** and **1024 bytes**, enforced before resolution
runs. This is a denial-of-service control, not tidiness: `Path.safe_relative/2`
is superlinear in component count — measured at 7.9 ms for 100 components,
397 ms for 500, and 2764 ms for 1000 — so an unbounded path would buy seconds
of scheduler time on one process.

### Metadata

Regular files only. A missing file, a directory, a FIFO, a socket or a device
is a `404`; a file larger than `AP_MAX_SRC_BYTES` is a `413` before any render
starts. ETag material is a hash of size and mtime.

### Identity

The root does not appear in the canonical string, so `local://previews/track.wav`
names the same variant whether it is mounted at `/srv/audio` or `/data`, and
moving or redeploying the root invalidates nothing. `parse/1` collapses empty
and `.` segments so that one file does not wear several cache keys; it does not
touch `..`, and a leading `/` survives so absolute paths are refused rather than
quietly reinterpreted.

### What confinement does not cover

Confinement is defined over *paths*, and two things escape that definition.
Both are deployment assumptions rather than defects, and both need write access
to the root:

- **Hardlinks.** A hardlink inside the root pointing at an inode outside it is
  indistinguishable from an ordinary file to any path-based check.
- **Time of check to time of use.** `ffmpeg_input/1` returns a path and ffmpeg
  opens it a moment later; anything that can rewrite the root in that window can
  swap the file for a symlink. Closing this needs the render pipeline to pass an
  already-open descriptor, tracked with `add-render-endpoint`.

**Mount the root read-only**, and treat write access to it as equivalent to
choosing what the proxy will serve.

## Remote sources

Two forms, one policy. `s3://{bucket}/{key}` names an object in a bucket;
`https://{host}/{path}` names a URL at an origin. Both are gated by
`AP_SOURCE_ALLOWLIST`. `s3://` renders;
`https://` does not yet — see the status note at the top.

### `s3://`: an object in a bucket

Split at the first `/`, and both halves are required: `s3://masters` and
`s3:///a.wav` are refused rather than guessed at. The key is kept as its **raw
decoded bytes**, because that is what S3 stores — `a b.wav` and `a+b.wav` are
different objects, and `a//b` is not collapsed the way `local://` collapses it.
An empty segment is an ordinary character in a key.

A bucket may be 63 bytes and a key 1024, S3's own maxima, and the body as a
whole is bounded at 1088 before it is split. Past those the object cannot exist.

The bound comes *before* the split, which is worth stating because the first
version of this got it backwards. Finding the first `/` is a memchr-style scan:
cheap when a separator turns up early, and linear in the whole body when none
ever does (0.016 ms for 1 MB, 0.177 ms for 10 MB of separator-free input). That
is four orders of magnitude short of what makes `local://`'s cap a
denial-of-service control, so this is a protocol bound rather than a scheduler
defence — but an input that cannot name an object should not be scanned at all.

#### How the proxy reads S3

Before rendering, one HEAD request fetches the object's size and ETag:
the size is what answers **413** before a subprocess is spawned, the ETag is
what `/info`'s validator hashes. The object itself is handed to ffmpeg as a
presigned URL, so
ffmpeg opens the object itself and issues its own Range requests — no source
bytes cross the BEAM, and `-ss` on a two-hour master reads only what it needs.

Nothing is presigned at `stat/1` time. Both flows call the two callbacks
separately, and a presigned URL has an expiry; minting one the caller may never
use is a credential with a lifetime and no purpose.

`AP_PRESIGN_TTL` bounds the URL, not the read. ffmpeg has to *open* the object
within the TTL; the connection it opens outlives it, so a long transcode does
not need a long TTL.

#### Failures classify by cause, not by convenience

Every way an S3 request can fail maps to an HTTP status explicitly, with no
catch-all: a failure shape the proxy does not recognize is a loud error, never
a plausible-looking guess.

| What happened at the store | Status |
|---|---|
| Object missing | `404`, the blind row |
| Access denied | `404`, the blind row |
| Any other 4xx from the store | `404`, the blind row |
| A redirect (wrong-region bucket) | `500` |
| S3 credentials not configured | `500` |
| The store answered 5xx | `502` |
| The store was unreachable | `502` |

The status *ranges* are the part worth reading twice. An earlier revision
covered 4xx and 5xx and called that total, which it is not: redirects are not
followed (deliberately), so S3's "your bucket is in another region" arrived as
a 301 nothing handled. A redirect is an operator's misconfiguration, not
a transient one, so it answers `500` and not the `502` that would invite a
retry that cannot succeed.

Folding `:access_denied` into the 404 is the deliberate part: a bucket policy
that denies HEAD is indistinguishable from a missing object *to the client*,
which is the property the blind 404 exists to protect. The operator gets the
truth from the log line, which names the S3 reason. A `4xx` that is neither
goes the same way — it means the proxy asked wrongly for an object the client
named, and the client cannot tell that apart from the object not being there.

An outage does **not** go there. A transport failure and an upstream `5xx` say
nothing about whether the object exists, so answering `404` would report a
deletion that did not happen and then edge-cache it for ten seconds,
suppressing the retry that would have worked. Both answer `502` with
`Cache-Control: no-store`.

`:invalid_range` belongs to `get_stream/3`, which this backend never calls, and
so has no clause at all.

### `https://`: a URL at an allowlisted origin

`http://` never reaches this type: the resolver dispatches on scheme, no type
claims `http`, and the source is `:unknown_scheme`. Userinfo
(`https://user:pass@h/a`) is refused by the type. Neither is merely left
unallowlisted, because both are wrong independent of the host they name — a
cleartext fetch has no business being a source, and credentials in a URL end up
in logs, in argv and in a cache key. Keeping them out also keeps the allowlist a
single-axis policy: host, and nothing else.

#### The host is validated after it is normalized

Not before, and the order is the whole point. A host is refused
(`:invalid_url`) when, once lowercased and stripped of a single trailing root
dot, it is empty, carries an **empty label** (`.media.example`,
`cdn..media.example`), or contains a **percent-escape** (`%6D%65dia.example` —
`URI` does not decode those, so they would ride into the canonical string). IP
literals are exempt from the label rules; their own parser has vouched for them.

Validating the raw host instead let three things through, all found by review:
`https://./a` rendered a canonical URL with *no host at all*, `https://.../a`
was admitted by a bare `*`, and `*.media.example` admitted every
`cdn..media.example` spelling — so one origin resource could wear unboundedly
many allowlisted cache keys, one per inserted dot.

Underneath all three sat the defect that actually matters: **`parse/1` and
`authorize/1` could disagree about which host a URL names.** The gate re-parses
the canonical URL, so `https://../a` parsed to the host `.` and re-parsed to
`""`. It failed closed, by luck rather than design. Both now run the same
normalization and the same validation, and a property pins it: anything that
parses must authorize under a bare `*`, and its canonical string must parse back
to an identical source.

A URL may be 2048 bytes and a host 253 — the de-facto interoperable URL maximum
and DNS's own name limit. Unlike `local://`'s caps these are protocol bounds
rather than denial-of-service controls: `URI.new/1` is linear here (measured at
0.026 ms for a 4 KB URL and 0.51 ms for 80 KB, ~6 ns/byte), so there is no cost
curve to flatten.

#### What normalizes

Every spelling of one resource folds onto one canonical string, because each
surviving spelling would buy one object a second cache key:

| Spelling | Canonical |
|---|---|
| `https://Media.Example/a.wav` | `https://media.example/a.wav` |
| `https://media.example./a.wav` | `https://media.example/a.wav` |
| `https://media.example:443/a.wav` | `https://media.example/a.wav` |
| `https://media.example` | `https://media.example/` |
| `https://media.example/a.wav?` | `https://media.example/a.wav` |
| `https://media.example/a.wav#part` | `https://media.example/a.wav` |
| `https://[0:0:0:0:0:0:0:1]/a.wav` | `https://[::1]/a.wav` |

IP literals normalize through `:inet.parse_strict_address/1`, and that choice is
a security boundary rather than a detail. The lenient parser accepts inet_aton
shorthand, where `1.2` means 1.0.0.2 and `01.2.3.4` means 1.2.3.4; folding those
would let an allowlist entry for `1.2.3.4` silently admit `01.2.3.4`. Left as
text they stay distinct subjects, and are refused unless an operator names them
in that exact spelling.

#### What deliberately does not

- **The URL's own percent-encoding.** `https://h/a%2Fb` and `https://h/a/b` are
  different objects on many origins, so collapsing that layer would hand two
  objects one cache key. The cost is that an already-escaped URL needs escaping
  *again* in the `plain/` form (`%2520`) — which is what `enc/` exists for.
- **Dot segments.** `https://h/a/../b` is left as written: only the origin knows
  whether it resolves them.

A raw space, or anything else that is not legal in a URL, is not repaired
either: it is `{:error, :invalid_url}`. A space has to be `%20` in the URL, and
therefore `%2520` in the `plain/` form.

### The allowlist

`AP_SOURCE_ALLOWLIST` is a comma-separated list, and one list answers for both
forms because the question is the same one — *is this namespace ours?*

| Entry | Matches |
|---|---|
| `masters` | Exactly that bucket (case-sensitive) or host (case-folded) |
| `previews-*` | Buckets beginning `previews-` |
| `*.media.example` | `media.example` and any subdomain of it |
| `*` | Everything |

**Unset accepts S3 sources and refuses HTTPS ones.** An S3 bucket the proxy has
no credentials for is unreadable whatever the list says, so credentials are
already a gate; an HTTPS URL has no such backstop, and an ungated one is a
server-side request forgery primitive pointed at whatever the container can
reach. Deny-by-default is the only safe posture for a fetch.

**The wildcards are asymmetric, and the asymmetry is the security property.** A
bucket namespace belongs to the operator — nobody else can create `previews-eu`
in their account — so a prefix glob hands out nothing. A host namespace belongs
to anyone with a registrar, so hosts get the mirror image, anchored to a label
boundary: `*.media.example` admits `cdn.media.example` and refuses
`media.example.evil.com`. `cdn.*` is the footgun this forecloses; it reads as
"our CDN" and would mean "any host starting `cdn.`", `cdn.evil.com` included. A
`*` anywhere but its type's documented position matches **nothing** rather than
matching loosely.

Two more rules worth knowing:

- **An IP-literal host is matched bracketless.** The entry for
  `https://[::1]/…` is `::1`, since that is the form `URI` parses out. The
  canonical URL shows the brackets, so the mismatch would otherwise fail closed
  and silently.
- **No IDN conversion.** Hosts are matched as written; an operator allowlisting
  an internationalized domain writes its punycode form.

A source that fails the allowlist is `{:error, :not_allowed}` → the same **404**
as a missing object. Nothing distinguishes "not allowed" from "not there".

## Canonical identity

Each source has one canonical spelling: the "what" half of a variant's
identity, hashed into the cache key alongside the normalized options. Two
rules hold for every source kind:

- **Both encodings of one source must render identical bytes.** Guaranteed by
  construction: they parse to the same typed source.
- **Deployment configuration must not appear in it.** A filesystem root or an
  endpoint override is where a deployment put things, not what the source is,
  and folding it in would mean variants did not survive a redeployment.

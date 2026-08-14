---
title: "Signing URLs"
description: "Build a signed audioproxy URL: the HMAC rule, reference signers in Elixir and Ruby, escaping, and dev mode."
---

<!-- authored here; the API contract is canonical for the exact grammar -->

Every URL the proxy serves is signed. The signature is the first path
segment, and it covers everything after it:

```
/{signature}/{options}/{source}
```

```
signature = base64url(HMAC-SHA256(key, salt ‖ rest-of-path))
```

`rest-of-path` is the exact byte sequence after the signature segment,
**leading `/` included**, taken from the raw, still percent-encoded
request path. Key and salt are the hex-decoded values of `AP_KEY` and
`AP_SALT`.

Signatures are emitted unpadded. The canonical padded form is accepted on
verification, but non-canonical spellings (over-padding, variant final
characters) are rejected, so a signature cannot be respelled into a
second URL that also verifies.

## A worked example

These key and salt values are **published test vectors** used throughout
the proxy's test suite. Never use them as real ones.

```elixir
key  = Base.decode16!("00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF")
salt = Base.decode16!("FFEEDDCCBBAA99887766554433221100")
rest = "/f:opus/br:96/plain/s3://masters/2026/piece-final.wav"

AudioProxy.Signature.sign(rest, key, salt)
# => "zfLTfPPhQ8kdeYYJOdagqPfog2nFk7KzDFUjtRAf_Ns"
```

The URL is `/<signature><rest>`:

```
/zfLTfPPhQ8kdeYYJOdagqPfog2nFk7KzDFUjtRAf_Ns/f:opus/br:96/plain/s3://masters/2026/piece-final.wav
```

The same three lines in Ruby, for a non-Elixir client:

```ruby
require "openssl"
require "base64"

key  = "00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF"  # AP_KEY (hex)
salt = "FFEEDDCCBBAA99887766554433221100"                                  # AP_SALT (hex)
path = "/f:opus/br:96/plain/s3://masters/2026/piece-final.wav"

sig = Base64.urlsafe_encode64(
  OpenSSL::HMAC.digest("SHA256", [key].pack("H*"), [salt].pack("H*") + path),
  padding: false
)
# => "zfLTfPPhQ8kdeYYJOdagqPfog2nFk7KzDFUjtRAf_Ns"
```

Both produce the same signature, which is the point: the signer is a
client contract, not an implementation detail. If you are writing one in
another language and your output differs on this input, the difference is
in your code.

Using Rails? The [audioproxy-rails](/integrations/rails/) gem builds
signed URLs from ActiveStorage attachments and you do not write any of
this.

## Sign the spelling you will request

Verification runs over the raw request path, so re-encoding anything
breaks the signature. A key with a space must appear as `a%20track.wav` in
both the signature input and the request.

A source that already carries percent-escapes has to be escaped *again*, so
a URL ending in `a%20b.wav` is written `plain/https://h/a%2520b.wav`.

If that sounds like a trap, it is, and the `enc/` source form exists to
avoid it: base64url the source exactly as written and there is nothing
left to escape.

```
enc/czM6Ly9tYXN0ZXJzLzIwMjYvcGllY2UtZmluYWwud2F2
```

Both forms name the same object and produce the same cache key. See
[Sources](/guides/sources/) for the full escaping rules.

## Keys

Generate a real key with:

```bash
openssl rand -hex 32
```

`AP_KEY` must decode to at least 32 bytes or the proxy refuses to boot.
`AP_SALT` has no length floor but should be generated the same way.

A signed URL is a bearer capability: the HMAC covers the path and nothing
else, so anyone holding the URL can fetch it, and the only revocation is
rotating the key, which invalidates every URL ever issued. To time-box one
URL instead, see [Expiring URLs](#expiring-urls) below.

## Expiring URLs

Add `exp:<unix-seconds>` to the options segment:

```elixir
rest = "/f:opus/br:96/exp:#{System.system_time(:second) + 300}/plain/s3://masters/piece.wav"

AudioProxy.Signature.sign(rest, key, salt)
```

Requested before that second, it renders exactly as the same URL without
`exp` would. From that second on, it is a `410`:

```json
{"error": "expired", "message": "URL has expired"}
```

`exp` needs no mechanism of its own to be tamper-proof. It sits in the
path, so it is inside the signature, and changing or removing it is the
same `401` as changing anything else.

**It does not participate in the cache key.** That is the whole reason it
is worth having as an option rather than a query parameter: mint a fresh
five-minute URL on every page view and all of them still resolve to *one*
rendered variant. Two requests differing only in `exp` coalesce into a
single render, and the one already in the store answers both.

**Expiry caps everything the response hands out.** A `200`'s
`Cache-Control: max-age` is clamped to at most `exp − now`, so a CDN
cannot keep serving the body after the URL is dead, and a cache-hit
redirect's presigned storage URL is clamped to the same bound, so the
`302` cannot trade a short-lived URL for a long-lived one. Without both,
enforcement at the proxy would be theatre.

Three things worth knowing before you generate them:

- **There is no clock-skew leeway.** If you want a margin, add it to your
  own timestamp. A margin here would be one every deployment pays.
- **A timestamp in the past is a valid URL.** It signs, it parses, and it
  answers `410`. It is not a `422`, which is what lets the `410` be a
  permanent verdict a CDN can cache and serve on your behalf.
- **`/info` cannot carry it**, because that endpoint has no options
  segment. Info URLs are meant for your own services rather than for end
  users.

## Dev mode

Setting `AP_ALLOW_INSECURE=true` makes the literal segment `insecure` pass
as a signature:

```
/insecure/f:opus/br:96/plain/local://track.wav
```

It exists for local development and smoke tests. With it on, anyone who
can reach the proxy can render anything it can read. **Never enable it in
production.**

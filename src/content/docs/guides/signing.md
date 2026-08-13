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
rotating the key, which invalidates every URL ever issued. Time-boxing a
single URL is what the `exp` option is for; see the
[API contract](/reference/api-v1/).

## Dev mode

Setting `AP_ALLOW_INSECURE=true` makes the literal segment `insecure` pass
as a signature:

```
/insecure/f:opus/br:96/plain/local://track.wav
```

It exists for local development and smoke tests. With it on, anyone who
can reach the proxy can render anything it can read. **Never enable it in
production.**

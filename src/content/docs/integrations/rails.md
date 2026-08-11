---
title: "Rails"
description: "Build signed audioproxy URLs from a Rails app: ActiveStorage attachments in, playable variant URLs out, via the audioproxy-rails gem."
---

<!-- authored here; the gem's README is canonical for its full API -->

To play a variant of an uploaded file in a Rails view, you need a signed
proxy URL for it. [audioproxy-rails](https://github.com/audioproxy/audioproxy-rails)
builds those URLs: hand it an ActiveStorage attachment (or a plain source
string), describe the variant, and it resolves the blob's storage service
into the source form the proxy speaks, renders the options, and signs the
result. It hooks in through a railtie; nothing to mount, no routes added.

The gem is not on RubyGems yet, so install from GitHub for now:

```ruby
# Gemfile
gem "audioproxy-rails", github: "audioproxy/audioproxy-rails"
```

Tell it where the proxy lives and how to sign, with the same key and salt
the proxy boots with:

```yaml
# bin/rails credentials:edit
audioproxy:
  endpoint: https://audio.example.com
  key: 7a3f9c21…      # hex, the proxy's AP_KEY
  salt: 9c217a3f…     # hex, the proxy's AP_SALT
```

Then, to put a playable 96 kbps Opus version of an upload on a page
(`format:` and `bitrate:` are the spelled-out aliases of the proxy's `f:`
and `br:` [transforms](/guides/transforms/)):

```erb
<%= audioproxy_audio_tag @recording.audio,
      format: "opus", bitrate: 96,
      html: { controls: true } %>
```

`@recording.audio` is an ordinary `has_one_attached`. The helper reads
which storage service the blob lives on (S3 and Disk are supported), builds
the matching source string, and returns an `<audio>` tag whose `src` is the
signed variant URL. Outside of views, or without ActiveStorage:

```ruby
Audioproxy.url_for("s3://masters/2026/piece-final.wav",
                   format: "opus", bitrate: 96)
```

For development against a proxy running `AP_ALLOW_INSECURE`, set
`config.unsigned = true` and skip the key entirely.

The [gem's README](https://github.com/audioproxy/audioproxy-rails#readme)
is canonical for the rest: the full option vocabulary and aliases,
configuration precedence (credentials, ENV, initializer), the preload-hint
helper, and the deployment coupling that Disk-service resolution brings.

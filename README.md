# audioproxy-docs

Operator and integrator documentation for [audioproxy](https://github.com/audioproxy/audioproxy), built with [Starlight](https://starlight.astro.build), deployed to Netlify.

## The sync model

Pages under `src/content/docs/guides/` and `reference/api-v1` are **synced, not authored here**: the proxy repo is canonical (its slices update docs in the same change), and `bin/sync-proxy-docs` copies them in, injecting frontmatter and a provenance banner naming the source commit. Edit them in the proxy repo, then re-run the script. Hand-authored pages: the landing page and `start/`.

## Working on it

```bash
npm install
bin/sync-proxy-docs ../audioproxy   # refresh synced content
npm run dev                          # http://localhost:4321
npm run build                        # what Netlify runs (netlify.toml)
```

Module-level API reference lives on [hexdocs.pm/audio_proxy](https://hexdocs.pm/audio_proxy) and is not duplicated here.

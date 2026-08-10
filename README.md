# audioproxy-docs

User-facing documentation for [audioproxy](https://github.com/audioproxy/audioproxy), built with [Starlight](https://starlight.astro.build), deployed to Netlify.

## The content model

- **Authored here** (the default): the landing page, quickstart, and every guide. These are written for users — goal-first examples, no code internals — and may diverge from the proxy repo's `docs/` by design. When the upstream counterparts change, `sync.yml` opens a `docs-drift` issue instead of overwriting; a human decides what is user-relevant.
- **Synced 1:1** (the exception): `reference/api-v1` — the contract must be exact, so `bin/sync-proxy-docs` re-imports it and CI commits the result automatically.
- **Not hosted**: contributor documents (`development.md`, `ffmpeg-arguments.md`) stay in the proxy repo; the sidebar links to them under *Project*.

## Working on it

```bash
npm install
npm run dev                          # http://localhost:4321
bin/sync-proxy-docs ../audioproxy    # refresh the API contract page
npm run build                        # what Netlify runs (netlify.toml)
```

Module-level API reference lives on [hexdocs.pm/audio_proxy](https://hexdocs.pm/audio_proxy) and is not duplicated here.

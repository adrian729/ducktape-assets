# Ducktape Assets

A library of decorative image assets (borders, frames, dividers, ornaments, initials, illustrations) published as one npm package per curated set and served from jsDelivr, with a metadata-only index package that tells you where everything is.

Status: design complete, implementation in Phase 0. See `docs/vault/00 Index.md` for the design and `docs/vault/Design/Roadmap.md` for what happens next.

## Layout

- `docs/vault/`: the design, as an Obsidian vault.
- `schemas/`: JSON Schemas for `set.yaml`, `asset.yaml` and the generated manifest, plus the vocabularies.
- `tools/`: the CLI used by CI in every repository and by agents locally.
- `index/`: the index package: resolver, `index.json`, `catalog.json`, generated README and AGENTS.
- `spikes/`: throwaway Phase 0 experiments with their recorded results.

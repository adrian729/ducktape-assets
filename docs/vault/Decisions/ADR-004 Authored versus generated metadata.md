# ADR-004: authored metadata in per-asset YAML, generated metadata in one manifest per set

Status: proposed, 2026-10-26.

## Context

The old library kept about 25 metadata JSON files with a different schema per import batch and up to eight copies of each record, mixing hand-written description with measured dimensions and byte counts. Fields drifted because the schema allowed unknown properties.

## Decision

- Humans and agents write `set.yaml` and `assets/<id>/asset.yaml` only. Schemas use `additionalProperties: false`. Vocabularies (categories, colours, subjects allowlist) are files in the main repo.
- CI generates `manifest.json` per set with every authored field copied verbatim plus every measurement (dimensions, bytes, hashes, transparency, palette, thumbhash, rung list, tooling versions). Consumers read manifests only.
- The main repo generates `index.json` (sets and pins) and `catalog.json` (descriptive union for search) from manifests.
- Provenance is a structured record on the asset with normalised institution names and SPDX licences where the rights text allows it; the free text is kept alongside, never instead.

## Alternatives

- **One JSON per set edited by hand.** Easier to grep, but merge conflicts on every PR and no per-asset history. Rejected.
- **Database or CMS.** Not free, not in git. Rejected.
- **YAML front matter in Markdown per asset.** Nice for prose, but descriptions are short and structured validation matters more. Rejected, but `provenance/*.md` audits remain Markdown.

## Consequences

- A measurable field that appears in YAML is a validation error.
- Metadata changes without pixel changes are patch releases detected by the content hash.

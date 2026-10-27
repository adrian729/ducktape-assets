# Design: metadata model

Status: proposed, 2026-10-26. Depends on [[Architecture]] for where files live. See [[Decisions/ADR-003 Set-scoped identifiers]] and [[Decisions/ADR-004 Authored versus generated metadata]].

## Principles

1. **Authored and generated data never share a file.** Humans (or agents on their behalf) write small per-asset YAML files. CI measures everything measurable (dimensions, bytes, hashes, transparency, palette, placeholder) and writes it into a generated manifest. Nothing measurable is ever typed by hand, so it can never drift.
2. **The set is the unit of everything.** A set has one repo, one authored `set.yaml`, one generated manifest, one npm package per channel, one version line, one licence story. Assets belong to exactly one set.
3. **Identifiers are set-scoped and permanent.** An asset is `<set>/<asset>`, for example `illuminated-acanthus/divider-center`. Within a set the short id is unique. An id is never reused and never renamed without a migration record. This replaces the old flat global namespace where every acanthus piece carried the `illuminated-acanthus-` prefix in its name and the resource package number leaked into consumer code.
4. **Consumers read generated data only.** The authored YAML is for curation and review. Every field consumers may need is copied into the manifest, so a consumer never needs the repo.
5. **Enumerations are small and documented.** Free-text tags (`subjects`) carry nuance; enumerations (`categories`, `colors`, `type`) carry filtering. Both are validated: enums by schema, subjects by a shared vocabulary file with an allowlist that grows by PR.
6. **Nothing is copied from the old library as final.** The old records are an input the importer turns into `status: draft` files; every set is reviewed and rewritten against the new model before it is approved and published. Which old fields are usable and what the reviewed model finally contains is a separate discussion with the owner; the field lists in this note are the proposal that discussion starts from.

## Authored files

### `set.yaml` (one per set repo)

Agreed with the owner on 2026-10-26. The file is flat; the three comment headings follow the descriptive / structural / administrative split from the owner's data analysis notes and exist to make the record easy to write and to reason about.

```yaml
id: walters-w102                         # [a-z0-9-]+, equals repo suffix and package suffix
title: Walters W.102 marginalia
summary: Marginal creatures and scenes from a 14th-century Flemish book of hours.
kind: historical                         # authored | historical | imported
author: adrian729
maintainer: https://github.com/adrian729/ducktape-assets/issues
license:
  artwork: CC0                           # SPDX id, or a custom id defined in LICENSES.md; applies to every asset unless overridden
period: 14th century                     # coverage, inherited by assets unless overridden
region: Flanders
style: illuminated manuscript
origin: { institution: Walters Art Museum, object_identifier: W.102 }
tags: [marginalia, animals, book-of-hours]
```

`maintainer`, `period`, `region` and `style` were added on 2026-10-26. An authored set carries `origin: { method: reference-guided-ai-generation, references: [walters-w102] }` instead of an institution, and a `license.notes` line for attribution. A historical set that spans several holdings (an artist's loose prints, see [[Design/Repository layout]]) carries `origin: {}` and every asset names `institution` and `object_identifier` in its provenance; the validator refuses one that does not, and the schema allows institution and object identifier at set level only together.

The build writes `attribution` into the manifest as the bare credit, never with the licence: `Walters Art Museum W.102` for a set from one object, the sorted institutions for a set spanning holdings, the author for authored and imported sets. An asset gets its own `attribution` only when its holding differs from the set's line. The licence is the separate `license` field (SPDX id). Since tooling 0.2.0, 2026-10-27.

### `assets/<asset-id>/asset.yaml` (one per asset)

```yaml
# descriptive: find it and understand it
id: rabbit-church-bells
title: Rabbit ringing church bells
description: A grey rabbit in a red tunic pulls two bell ropes in a marginal scene, facing left, on a transparent background.
type: illustration                       # see enumerations below
categories: [animals, music]             # fixed list
subjects: [rabbit, bells, rope, tunic, marginalia]   # free tags from a growing vocabulary
colors: [grey, red, gold]                # fixed list, as a human sees them; the measured palette is generated
facing: left                             # where the subject's front or head points in the image plane
view: side                               # optional camera angle
composition: single-figure
period: 14th century                     # optional, overrides the set
region: Flanders
style: illuminated manuscript

# structural: how it is organised and related
group: 194v                              # folio, plate, series or theme inside the set; replaces the old nested sets. Never a type: that is `type`
render:
  image: {}                              # image | tile {axis, period} | frame {corner, slice} or frame {slice_px} for a ready-made complete frame
components: {}                           # for example corner: { master: corner.png, description: … }
related:
  - { asset: walters-w102/rabbit-organist, role: companion }
usage_notes:
  - Complete scene; keep proportions.
display_width: [200, 400]                # optional recommended CSS width range

# administrative: manage, access, preserve
status: approved                         # draft | approved | deprecated
created: 2026-11-02
deprecated_by: null
quality: Faint parchment halo along the lower edge.   # optional known limitation
master: master.png                       # lossless PNG or lossless WebP, or master.svg for hand-made vectors
provenance:                              # required when the set kind is historical; null allowed only for kind imported
  method: native-source-extraction
  institution: Walters Art Museum
  object_identifier: W.102
  object_dimensions: 150 × 105 mm        # optional, as the institution records it
  record_url: https://art.thewalters.org/detail/…
  image_rights: CC0
  source_sha256: …
license: null                            # null inherits the set licence; otherwise an SPDX or custom id
```

`description` is written for people and for agents alike: one or two plain sentences saying what is depicted, in which direction, and on what background. Sizes are never typed here; see "Where the sizes are" below.

A tiling border with a matching corner, showing components and geometry:

```yaml
id: stepped-ribbon
title: Stepped ribbon border
type: border
render:
  tile:
    axis: x                              # the master repeats along x
    period: 1                            # repeat length in multiples of the tile's own length; usually 1
  frame:
    corner: corner                       # component id used to build the frame atlas
    slice: 33.3                          # border-image slice percent for the generated atlas
master: tile.png
components:
  corner: { master: corner.png, description: Mitred corner matching the tile. }
```

Rotated tiles and frame atlases are **generated**, not stored. Only hand-made pixels are masters.

### Provenance for historical sources

```yaml
provenance:
  method: native-source-extraction       # ai-assisted-extraction | independent-ai-interpretation | native-source-extraction | native-ink-extraction | native-source-repeat | ai-assisted-source-mask | mixed-source-extraction | reference-guided-ai-generation
  institution: Cleveland Museum of Art
  object_title: Leaf from a Greek Psalter and New Testament
  object_identifier: "1950.154"
  date: "1084"
  artist: null
  record_url: https://clevelandart.org/art/1950.154
  image_url: https://openaccess-cdn.clevelandart.org/1950.154/1950.154_full.tif
  image_rights: CC0
  rights_url: https://www.clevelandart.org/open-access
  source_sha256: 50cf1d6a…                # hash of the downloaded source image, which lives in the set's sources archive
  audit: ../../provenance/greek-psalter.md
```

Every historical set also ships a `SOURCES.md` generated from these records, which is what the gallery and READMEs link to for attribution.

## Where the sizes are

Every number that can be read from the pixels is generated by the build and lives in `manifest.json`, the catalog, the resolver output and the copy manifest: master width and height, transparency, measured palette, thumbhash, and for every delivered file its width, height, bytes, hash and package. They are never typed into `asset.yaml`, so they cannot drift. The only size-related authored fields are the two that cannot be measured: `provenance.object_dimensions` (the physical original) and `display_width` (the recommended CSS width range).

## Enumerations

Reviewed with the owner on 2026-10-26.

- `type` (content, what it is): `border` (repeating strip), `frame` (complete non-repeating frame), `corner`, `divider` (complete horizontal or vertical piece), `ornament` (fleuron, headpiece, flourish, rosette, sprig), `initial`, `illustration` (figure, scene, creature), `texture` (seamless background), `icon`, `banner` (scroll or ribbon meant to carry text; the old "ribbons" plus title flourishes). The old `asset_type` ∪ `kind` ∪ `composition` triplet collapses into `type` plus `render` capabilities.
- `render` capabilities (how it may be used): `image` (place as is), `tile` (repeat along an axis), `frame` (CSS `border-image` from a generated atlas). Replaces `uses` and `components.border_image`.
- `categories`: keep the old thirteen (animals, botanical, fantasy, floral, geometric, humans, hybrids, knotwork, music, reading, ribbons, royalty, scrollwork) and allow growth by PR to the vocabulary file; revisit after the first wave.
- `colors`: keep the old sixteen; revisit after the first wave.
- `facing`: where the subject's front or head points in the image plane: `left | right | up | down | viewer | away | mixed | none`. A lizard climbing a wall seen from above is `up`; a top view with no direction is `none`.
- `view`: optional camera angle, `side | front | top | three-quarter`. Most assets omit it.
- `composition`: `single-ornament | standalone | repeat-tile | single-figure | multiple-figures | framed-scene`.
- `status`: `draft` (built and previewable, not published), `approved` (published), `deprecated` (still published, excluded from the gallery by default, carries `deprecated_by`).

Field meanings live as descriptions in the JSON Schemas and are rendered to a `SCHEMA.md` in the index package, the data dictionary of the library.

## Generated manifest (per set, per version)

Written by the build to `manifest.json` at the package root. Consumers and the gallery read only this. Fields are the authored ones, verbatim, plus measurements.

```json
{
  "schema": 1,
  "set": "illuminated-acanthus",
  "title": "Illuminated acanthus",
  "version": "1.2.0",
  "package": "@ranx729/ducktape-assets-illuminated-acanthus",
  "mastersPackage": "@ranx729/ducktape-assets-illuminated-acanthus-masters",
  "cdn": "https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-illuminated-acanthus@1.2.0/",
  "license": { "artwork": "CC-BY-4.0" },
  "inputsHash": "sha256:…",
  "contentHash": "sha256:…",
  "tooling": { "sharp": "0.35.5", "libvips": "8.18.7", "svgo": "4.1.0" },
  "builtAt": "2026-11-02T10:12:00Z",
  "assets": {
    "divider-center": {
      "title": "Divider centrepiece",
      "description": "…",
      "type": "ornament",
      "categories": ["botanical", "scrollwork"],
      "subjects": ["divider", "centerpiece", "acanthus"],
      "colors": ["blue", "red", "gold", "green", "brown"],
      "facing": "none",
      "status": "approved",
      "render": { "image": {} },
      "width": 1774,
      "height": 887,
      "transparent": true,
      "palette": ["#2a4f8f", "#b5262d", "#c9a227"],
      "thumbhash": "3OcRJYB4d3h/iIeHeEh3eIhw+j2w",
      "master": { "path": "masters/divider-center.webp", "width": 1774, "height": 887, "bytes": 1261660, "sha256": "…", "package": "masters" },
      "sources": {
        "avif": [ { "w": 128, "h": 64, "path": "avif/divider-center-128.avif", "bytes": 4012, "sha256": "…" }, { "w": 256, "h": 128, "path": "avif/divider-center-256.avif", "bytes": 9530, "sha256": "…" } ],
        "webp": [ { "w": 128, "h": 64, "path": "webp/divider-center-128.webp", "bytes": 6210, "sha256": "…" } ]
      },
      "components": {}
    }
  }
}
```

Notes:

- `sources` holds the variant ladder per format, ascending by width, never exceeding the master. The resolver builds `srcset` straight from it.
- `thumbhash` (about 25 bytes, base64) gives an instant blurred placeholder with the correct aspect ratio and transparency. Blurhash does not encode alpha; ThumbHash does, which matters for this art.
- `palette` is measured, `colors` is authored. Both are kept because they answer different questions.
- Composed frames carry `components.corner` and a generated `atlas` entry under `render.frame` with `slice` and its own `sources`. Ready-made frames (`slice_px`, added 2026-10-27) use their image ladder as the atlas and get per-side percentages plus `slicePx`.
- Tiles carry a generated `rotated` entry so a vertical use of a horizontal strip needs no runtime rotation.
- `inputsHash` is the publish gate: identical inputs, no rebuild and no publish. `contentHash` and per-file `sha256` are for integrity checks. See [[Image pipeline]].
- `sources` lists only the formats that were actually built for this asset; AVIF is omitted when it did not beat WebP by at least 15 %.
- Every file entry may carry `"package": "part2"` when the set is published as volume packages (see [[Repository layout]]); absent means the first package.

## The index package (`@ranx729/ducktape-assets`): one place to look

The index package is where a person or an agent finds anything, without visiting a set repo. It is published to npm and committed verbatim under `index/` in the main repo, so GitHub shows it too. Contents:

- `README.md` (generated): how to use an asset (the three flows in [[Delivery and consumption]]), the URL scheme, and a table of every set: id, title, one-line summary, asset count, licence, repo link, gallery link.
- `AGENTS.md` (generated): the same for agents, imperative: search `catalog.json`, write `ducktape.json`, honour the licence block, never use `@latest` URLs, never put a master on a page.
- `index.json`: every set with pinned version, package names including parts, CDN base, asset count, licence and `contentHash`. The resolver and the copy command read this.
- `catalog.json`: every asset of every set with all descriptive fields (id, title, description, type, categories, subjects, colours, facing, status, group), measurements (width, height, transparent, palette, thumbhash), render capabilities, licence and attribution, and the exact CDN URL of each width and format. No hashes, no component internals. This is the search surface for the gallery and for agents; one grep finds an asset and its URL.
- `sets/<set>.json`: a verbatim copy of each set's published `manifest.json`, for anything the catalog leaves out (hashes, bytes, components, parts).

All of it is regenerated whenever any set publishes. The whole package is metadata: about 3 MB for the full library (the catalog measures 3.9 KB per asset), never an image.

## What is deliberately dropped from the old model

- `png` and `png_bytes` at every level: PNG is a master format, not a delivery format.
- `svg` for traced rasters. Hand-made vectors become their own `type` with `master: x.svg` and are optimised, not traced.
- `variants` with `max_dimension` and `rendered_max_dimension`: replaced by width-keyed `sources` per format.
- `kind`, `uses`, `formats`, `repeat_ratio` (derivable from `period` and dimensions), `derivation` (folded into `provenance.method`), `reference` (folded into `provenance.audit`).
- `sets` as an array on an asset: an asset is in exactly one set. Today 188 assets sit in two sets only because the old sets nest a manuscript (`walters-w82-marginalia`) and a folio (`walters-w82-194v-set`). The manuscript becomes the set, the folio becomes `group`.
- Package numbers in any name.

## Validation

A single JSON Schema per authored file type lives in the main repo and is versioned. CI in every set repo validates on every PR. Validation failures are the only "tests" the metadata gets; see [[Testing policy]].

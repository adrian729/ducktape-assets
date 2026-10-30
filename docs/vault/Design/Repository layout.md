# Design: repositories, packages and naming

Status: proposed, 2026-10-26. See [[Architecture]] and [[Decisions/ADR-001 One repository per set]], [[Decisions/ADR-002 Masters in git, variants only on npm]].

## Naming

| Thing | Name | Example |
| --- | --- | --- |
| Main repo | `adrian729/ducktape-assets` | |
| Set repo | `adrian729/ducktape-assets-<set>` | `ducktape-assets-walters-w82` |
| Gallery repo | `adrian729/ducktape-assets-gallery` | |
| Template repo | `adrian729/ducktape-assets-template` | |
| Delivery package | `@ranx729/ducktape-assets-<set>` | `@ranx729/ducktape-assets-walters-w82` |
| Masters package | `@ranx729/ducktape-assets-<set>-masters` | |
| Volume packages (large sets only) | `@ranx729/ducktape-assets-<set>-part<n>`, `…-masters-part<n>` | `ducktape-assets-cma-1524-psalter-part2` |
| Index + resolver + catalog | `@ranx729/ducktape-assets` | |
| Tooling | `@ranx729/ducktape-assets-tools` | |
| Asset id | `<set>/<asset>` | `walters-w102/rabbit-church-bells` |

Rules: ids are `[a-z0-9]+(-[a-z0-9]+)*`, at most 48 characters for a set and 48 for an asset. The words `gallery`, `template`, `tools`, `index`, `masters` and the pattern `part<n>` are reserved and cannot be set ids or id suffixes. A set id does not encode the asset type (no `borders-`, `illustrations-`); type is metadata. No numbering.

The npm scope stays `@ranx729` and repos stay under `adrian729`, decided 2026-10-26: `ducktape` is taken on both npm and GitHub, and the owner's other projects already live as `adrian729/ducktape-*`, so the `ducktape-assets-` prefix is the family convention. A set registered in `sets.yaml` may name an existing repo that does not follow the `ducktape-assets-<set>` pattern (today: set `brand` in `adrian729/ducktape-brand`); the package names still follow the set id. This is the only exception to the naming table and is meant for repos that predate the library.

## What is a set

A set is a curated group of assets that share an origin and belong together visually. The grouping rule, applied in this order:

1. **One historical source object = one set**: a manuscript (Walters W.82), a printed book (Gessner, Fuchs), a titled print series or model book (Livre nouveau de fleurs, Schoen's Modelbuch, de Bry's alphabet), a single leaf when it is the only thing from that holding (`cma-1999-127`). Folios or plates inside it are `group` on the asset.
   - **Loose prints go by artist, not by holding** (decided 2026-10-27): an engraving is an edition, so the impression an institution happens to own is not the work. A single-sheet ornament print that belongs to no titled series goes into `<artist>-prints` (`aldegrever-prints`, `hopfer-prints`, `master-w-with-the-key-prints`) across institutions, with `group` = the holding object's accession and full provenance on every asset; the set's `origin` names no institution and the manifest credits each asset with its own holding. The rule is decidable from the asset alone, so nothing ever moves when more sheets arrive, and a set of one print is acceptable. Never a per-institution catch-all.
2. **One authored or AI campaign = one set**: the illuminated acanthus pieces, the shaggy bestiary.
3. **One imported legacy collection = one set** at import time (the 41 medieval-cutouts, the 38 numbered-plate designs, the 6 floral SVG border styles), which may be split later by curation with migration records.
4. A set is a curation decision, not a size decision. A set that outgrows one npm package is still one set, one repo, one manifest, one version: the publisher splits its files across **volume packages** (below). Splitting a set into two sets is done only when the curation calls for it (`walters-w82-marginalia`, `walters-w82-initials`), never by counter and never just to fit a limit.

## Volume packages for large sets

The package size guard (warn at 100 MB, fail at 120 MB unpacked, see [[Image pipeline]]) applies per npm package because jsDelivr refuses a package version above 150 MB. A set whose delivery files exceed it is published as `@ranx729/ducktape-assets-<set>` plus `@ranx729/ducktape-assets-<set>-part2`, `-part3` and so on. The word is `part`, not a version: all parts of a set share the set's single version number and are published together. Rules:

- `manifest.json` lives in the first package only and records, for every file, which package holds it (`"package": "part2"`). The catalog, the resolver and the copy command read that field, so consumers never know the split exists.
- Assignment is deterministic and sticky: a file keeps its package for life, and new files go into the newest part that has room. The publisher never moves a file between parts, so a republish changes only the parts that changed.
- Masters packages use the same scheme (`-masters`, `-masters-part2`).
- With the 2048 cap and the format rule a typical asset ladder is under 1 MB, so a set needs roughly 150 assets before it needs a second part. One to three of the planned sets will.
- Asking jsDelivr for a raised limit stays optional and is never relied on.

Historical set ids use `<institution-short>-<object-id>` (`walters-w82`, `cma-1524-psalter`, `met-425823`, `openn-lewis-e-m-013`), or `<artist>-prints` for an artist's loose prints. Authored sets use a descriptive name. The initial list of sets for the migration is in [[Migration]].

## Set repository layout

```
ducktape-assets-<set>/
├── set.yaml                     # authored, see Metadata model
├── README.md                    # generated by `tools readme` from set.yaml + manifest; committed so GitHub shows it
├── LICENSE.md                   # generated: artwork licence text(s) + attribution block; code in this repo is MIT
├── SOURCES.md                   # generated for historical sets from provenance records
├── assets/
│   └── <asset-id>/
│       ├── asset.yaml           # authored
│       ├── master.png           # lossless, native resolution (or master.webp lossless, or master.svg for hand-made vectors)
│       └── corner.png           # optional components, named in asset.yaml
├── provenance/                  # authored audits: prompts, extraction notes, reference crops (small), source hashes
│   └── *.md | *.json
├── sources.yaml                 # inventory of cold-storage inputs with sha256 and the Release tag that holds them
├── .github/workflows/ci.yml     # validate + build preview on PR; calls the reusable workflow from the main repo
└── .gitattributes               # binary handling; no LFS
```

What is **not** in git: generated variants, thumbhashes, manifests (all built in CI), and raw sources (scans, AI generation outputs, traces). Raw sources go to a GitHub Release of the set repo as a zip (`sources-<date>.zip`, up to 2 GB per file), listed in `sources.yaml` with hashes. They are cold storage: needed to re-extract, never needed to build.

Size expectations: a master in this collection is 0.1 to 29 MB PNG, median about 1 MB. A 50-asset set is typically 50 to 150 MB of git objects. Masters change rarely, so history stays close to that. The 1 GB GitHub recommendation is far away for every planned set; the largest today (`cma-1524-psalter`, 77 assets) will be around 200 MB.

Per-asset folders replace format-first directories. One asset is one folder; `git log assets/<id>` is its history; deleting or moving it is one operation.

## Main repository layout

```
ducktape-assets/
├── docs/vault/                  # this Obsidian vault
├── schemas/                     # set.schema.json, asset.schema.json, manifest.schema.json, vocab/*.yaml
├── sets.yaml                    # registry: id, repo, status (active|frozen|archived), added date
├── tools/                       # @ranx729/ducktape-assets-tools (Node, sharp, svgo)
├── index/                       # @ranx729/ducktape-assets: resolver source + generated README.md, AGENTS.md, index.json, catalog.json, sets/<set>.json (committed so GitHub shows them)
├── .github/workflows/
│   ├── publish.yml              # plan job + ONE environment-gated publish job
│   ├── ci.yml                   # tooling tests, schema checks
│   └── set-ci.yml               # reusable: validate + preview, called by every set repo
└── AGENTS.md                    # short, durable rules for agents; no release narrative
```

## Delivery package layout (generated)

```
@ranx729/ducktape-assets-<set>@x.y.z/
├── package.json                 # files allowlist, contentHash, exports for manifest.json and files
├── manifest.json
├── LICENSE.md
├── avif/<asset>-<w>.avif        # ladder, see Image pipeline
├── webp/<asset>-<w>.webp
├── svg/<asset>.svg              # hand-made vectors only, optimised
└── frames/<asset>-atlas-<w>.avif|webp, tiles/<asset>-rotated-<w>.avif|webp   # generated geometry for tile/frame capabilities
```

Flat per-format directories with the width in the filename keep package.json's `files` list to five globs, keep URLs short, and let a human guess the URL of any variant. A `-part<n>` package has the same layout minus `manifest.json`; its `package.json` names the set and the part number.

## Masters package layout (generated)

```
@ranx729/ducktape-assets-<set>-masters@x.y.z/
├── package.json
├── manifest.json                # identical to the delivery manifest
└── masters/<asset>.webp         # lossless WebP capped at 2048 px long side; components as <asset>.<component>.webp
```

Capped at 2048 because no web consumer renders more (polyhymnia's largest request is 1536 px) and because this keeps every file under 5 MB and every set under the guard. Native masters stay in git for archival and re-encoding. If a consumer ever needs more than 2048, that is a new, explicit request with a `masters-full` package.

## Versioning

Each set has its own semver line, bumped automatically: patch for metadata-only changes, minor for added assets or new variants, major for removed or deprecated assets. The delivery package, its parts, the masters package and its parts always share the set's version and publish together. The index package bumps minor whenever any set changes and pins exact set versions. Consumers pin the index or individual sets; both are valid.

## Lifecycle

- `active`: receives assets, publishes.
- `frozen`: no new assets, still published and resolvable (a finished historical extraction).
- `archived`: repo archived on GitHub, packages stay on npm forever, index marks it and the gallery hides it by default.

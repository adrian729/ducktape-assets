# Investigation: importer dry run (Phase 0)

Run 2026-10-26 with `spikes/importer-dry-run/plan.mjs` (no dependencies, deterministic: two runs give the same `migration/plan.yaml`). The spike and the plan it wrote were deleted on 2026-10-30 after the import completed (last commit carrying them: e4ee6c4); this note keeps the results. Estimation constants: lossy WebP 0.10 byte/pixel at rung size, AVIF 0.07 (counted only for masters wider than 256 px), lossless masters 0.9 byte/pixel capped at 2048 px long side; 1 MB = 10^6 bytes. The encoding benchmark (same day) replaces these constants with measured ones.

## Headline numbers

| What | Result |
| --- | --- |
| Old designs placed | 679 of 726 in 39 sets; 47 in triage (single-object holdings) |
| Masters found on disk | 726 of 726, 0 dimension or byte mismatches against the old catalog |
| New assets after local additions | 698 (679 plus the 18 `homepage-art` pieces and the logo frame) |
| Estimated delivery bytes, all sets | 273 MB (221 MB with the 2048 long-side cap) |
| Estimated masters packages, all sets | 534 MB (native masters on disk: 816 MB) |
| Largest set | `cma-1524-psalter`: 39 MB delivery, 64 MB masters |
| Sets needing `-part2` | none; none reaches the 100 MB warning |
| `plan.yaml` rows | 1290: 649 moved, 204 merged, 341 dropped (traced SVGs, generated components), 96 renamed (ids over 48 characters, to shorten by hand) |

The volume-package mechanism stays in the design but is not needed by the migration. The Migration note's guess that the psalter would need a second part was wrong.

## Wave 1

| Set | Assets | Allowlisted | Extras | Delivery MB | Masters MB |
| --- | --- | --- | --- | --- | --- |
| `illuminated-acanthus` (whole set) | 35 | 12 | 23 | 20.8 | 48.5 |
| `medieval-cutouts` | 11 of 41 | 11 | 0 | 5.7 | 13.6 |
| `walters-w102` | 1 of 4 | 1 | 0 | 0.02 | 0.09 |

The group rule added nothing: the cutouts have no groups, and `walters-horse-flute-drum` is alone in its folio. Decision recorded in [[Design/Migration]]: take the whole `medieval-cutouts` set (41, one coherent legacy collection) and the whole of `walters-w102` (4), which makes wave 1 80 assets in three sets, about 48 MB of delivery files.

## Measured on the real wave 1 build (same day)

The full pipeline ran over the three imported repos on the laptop: `plan` built all 80 assets in 15.5 minutes (58 CPU-minutes across cores), then `publish --dry-run` staged seven packages in 15 s. Measured package sizes: `illuminated-acanthus` 39.1 MB delivery (702 files) and 34.0 MB masters, `medieval-cutouts` 43.0 MB delivery (806 files) and 43.3 MB masters, `walters-w102` 1.6 MB and 1.4 MB. Against the dry run's estimates (20.8, 24.6, 0.02 MB) the delivery figures are 1.8x higher, as the encoding benchmark predicted; the largest planned set should therefore be read as about 70 MB, still under the warning. The generated `catalog.json` is 3.9 KB per asset (309 KB for 80), so the full library's catalog will be about 2.7 MB, not the 1 to 2 MB estimated earlier. The copy flow and the resolver were exercised against the staged packages through a local mirror: a `ducktape.json` with three assets fetched 41 files with verified hashes, and a second run copied nothing.

## Corrections to the earlier notes

- `walters-rabbit-church-bells` and `walters-horse-flute-drum` come from Walters **W.102** (fols 81r and 74v), not W.82. Example ids in the design notes were corrected to `walters-w102/…`.
- `met-livre-nouveau-de-fleurs` and `met-flower-friezes` were the same 46 designs listed twice; only the first name is used.
- Set sizes differ from the first estimate: `walters-w171` 35 (not 44), `openn-lewis-e-m` 41 (not 35), `gessner-historiae-animalium` 13 (not 18), `walters-w88` 15, `met-du-cerceau` 15 (two Met singletons sharing accession 21.10.1 joined it), `illuminated-acanthus` 35, `shaggy-bestiary` 17 (`rabbit-lutenist-painted` fits it by subject).
- Sets the first plan did not list: `walters-w102` (4 assets, 4 folios), `fitzwilliam-ms1-2005` (1), `cma-2011-65` (4, kept apart from the psalter as the old catalog did).
- polyhymnia's selection file has 30 entries, not 32.
- Authored leftovers: `polyhymnia` goes to `illuminated-acanthus` (gold floral frame), `rabbit-lutenist-painted` to `shaggy-bestiary`, the other 16 to `authored-ornaments` in groups `black-penwork` (11), `gold-dividers` (4), `book` (1).

## Triage: 47 single-object holdings

Every triaged design is the only extract from its source object: 7 Cleveland leaves, 10 Met prints, 10 MKG prints, 17 NGA prints (15 of them share accession prefix 1943.3 with `nga-ornament-prints`; 2 Met share 2012.136 with `met-hopfer-friezes`), and 2 drawn vector sheet pieces without provenance. One set and two packages per single asset would be absurd. Proposal for the owner, to decide before wave 2: one set per institution for such holdings (`cma-leaves`, `met-prints`, `mkg-prints`, `nga-prints`) with `group` = the object, the accession-prefix matches folded into the existing sets, and the two vector-sheet pieces into `supplied-sheets`. This is not a catch-all: the institution is the shared origin and each object keeps its own provenance record.

**Outcome (2026-10-27).** The per-institution proposal was dropped once the records were read: the accession-prefix matches are an accident of gift year, not of the work (Met 2012.136.787 is an Aldegrever, not a Hopfer; `nga-ornament-prints` already mixed three engravers), and an engraving is an edition, so the impression a museum owns is not the work. The rule chosen is in [[Design/Repository layout]]: loose prints go into `<artist>-prints` across institutions, `group` = holding accession, full provenance and a per-asset credit. Applied to `plan.yaml`: the 47 triage rows plus the dissolved `nga-ornament-prints`, `met-acanthus-prints`, `met-hopfer-friezes` and `met-du-cerceau` became 13 artist sets (`aldegrever-prints` 22, `du-cerceau-prints` 16 incl. components, `hopfer-prints` 12, `beham-prints` 8, `schongauer-prints` 6, `meckenem-prints` 4, `solis-prints` 3, `lucas-van-leyden-prints` 3, `della-bella-prints` 2, `zoan-andrea-prints` 2, `giancarli-prints`, `christollien-prints` and `master-w-with-the-key-prints` 1 each), the two Cleveland leaves their own sets (`cma-1999-127`, `cma-2001-79`) by the object rule, and the two drawn pieces `supplied-sheets` (group `drawn-vector-sheet`). 50 sets, 100 packages, no triage rows; 104 ids over 48 characters to shorten by hand at import. Nothing imported yet.

## Open items for the real import

- 96 ids over 48 characters need hand-shortening in `plan.yaml` (13 in `cma-1524-psalter`, 7 in `met-du-cerceau`); none are in wave 1.
- `illuminated-acanthus-floral-frame`: the PNG (1410 × 1116) and the delivered WebP (1367 × 1000, cropped) differ; choose the master.
- `module-sprig` and `title-ivy` have only a lossless WebP master, which is fine.
- The logo frame master is extracted from the data URI inside the SVG (1254 × 1254, hash matches the descriptor).
- `rotated_bar` components are dropped as generated, like `rotated_tile`.

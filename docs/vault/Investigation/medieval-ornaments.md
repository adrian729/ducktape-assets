# Investigation: medieval-ornaments, what went wrong and what to keep

Analysed 2026-10-26 at commit `efe40e4` (92 commits, 2026-10-02 to 2026-10-26). Paths are relative to `/home/ranx729/projects/medieval-ornaments`. See [[Current asset inventory]] for the byte counts.

## Shape of the thing

726 designs (89 borders, 289 decorations, 348 illustrations) spread over 29 GitHub repos and 29 npm packages, plus two legacy archive packages and one runtime package with 18 published versions. The runtime (`lib/`) holds 4,422 committed files, roughly six generated modules per design, and ships 832 KB packed / 5.2 MB unpacked. The main repo's git pack is 435 MB because artwork was committed to it before the storage question was decided. About 693 KB of tracked Markdown exists, most of it release narrative (`QA.md` 118 KB, `PACKAGE-PLAN.md` 62 KB, `README.md` 218 KB, `AGENTS.md` 33 KB).

## The mistakes, ranked by cost

1. **Storage topology became the public API.** Designs are packed first-in-first-out into numbered packages (`scripts/resources.mjs:53-63`: fill the open package, else seal it and open the next). Each design's package and version are baked into generated runtime modules, so every artwork change forces a runtime release, moving a design between packages is a runtime release, and consumers end up pinning `borders-004@0.1.2` in their own code. Package membership is accidental: `borders-002` and `borders-003` hold one design each, others hold 62. Every rollover needs a new npm package and therefore a passkey. Rollover machinery (`migrate`, `release`, `seal`, `archive`) became a first-class workflow.
2. **Masters were published as delivery assets.** 79 % of published bytes are native-resolution lossless masters, stored twice (PNG and lossless WebP) plus an auto-traced SVG per design. No lossy format exists at all. The variant ladder stops at 768 px, so 112 of 637 whole images load the master at the gallery's default size (DPR 2). Masters have a median of 1.2 MB and a max of 22.7 MB as WebP; traced SVGs reach 48 MB. The project rule "do not lower raster fidelity" (`docs/PERFORMANCE.md:148`) was applied to delivery, where it does not belong.
3. **No responsive images.** One `src` per element, `pixelRatio` hard-coded to 2 (`lib/resolve-core.js:45`), the React wrapper rejects `srcSet` and `sizes` props. DPR 1 users download double, DPR 3 users get blurry images, and frames always load the master atlas because atlases have no variants.
4. **Metadata sprawl.** About 25 metadata JSON files at the root, one schema per import batch, one importer script per batch, and up to eight copies of each design's record (batch audit, master catalog, `images.json`, `lib/catalog.json`, per-design module, resource manifest, resource `catalog.json`, README row). The schema lacks `additionalProperties: false`, so seven undeclared fields are in production (`source_canvas` on 631 entries). Five classification fields overlap (`asset_type`, `kind`, `repeat_axis`, `composition`, `uses`). `derivation` duplicates `provenance.method` on all 566 provenance entries. `usage_notes` holds 1,843 strings of which 177 are unique; one note repeats 637 times. `image_rights` has more than ten spellings of CC0.
5. **No per-asset licence.** `LICENSE` grants MIT for code only and explicitly excludes artwork. Rights are free text. 111 designs have neither provenance nor author and the project forbids backfilling (`AGENTS.md:24`). For a library whose purpose is reuse, this is the largest product risk.
6. **Generated code explosion and a private codec.** Per-design modules were generated and committed so that individual imports tree-shake, then a custom key/path/note compression codec (`lib/metadata-codec.js`) was written to fit a runtime budget that was raised from 150 KB to 1 MB anyway.
7. **Disproportionate React layer and CLI.** React adds 2,178 files for three thin wrappers. The CLI vendors generated component code into consumers with edit-protection guards. Neither real consumer uses either (see [[Consumers]]).
8. **Border geometry baked into the core schema.** Slice percent, repeat ratio, four corner phases, bars and rotated tiles, including 30 MB rotated SVGs that could be a CSS transform.
9. **Docs as logs.** Rules are spread over five documents with precedence clauses. Status lines go stale (`PACKAGE-PLAN.md:3` still says runtime 0.7.1).
10. **Checks depend on 6.8 GB of local state.** `audits.test.mjs` and `resources.test.mjs` read `tmp/resource-checkouts`. There is no test CI; results are pasted into `QA.md` by hand. The weekly `warm-cdn.yml` re-downloads 3.1 GB.
11. **Naming.** Up to 69-character kebab names doubling as identity, file stem, import path and TypeScript literal, with suffix conventions hard-coded in the codec. Renaming is effectively impossible. Format-first directories (`png/512/<name>.png`) scatter one asset over ten folders and force every package.json to enumerate hundreds of files.
12. **Misallocated effort.** Byte-exact verification, CDN warming, history audits and installer guards received heavy investment while the delivery format and partitioning were never revisited.

## Where it ran into walls (and the numbers to remember)

- npm rejected a 340 MB archive with HTTP 413 (0.6.0).
- jsDelivr refuses packages over 150 MB; the project settled on a 140 MB unpacked cap (0.10.0).
- unpkg cold misses took 0.5 to 45 s; jsDelivr miss 2.6 s versus hit 34 ms.
- Alphabetical tarball ordering put WebP after 369 MB of PNG/SVG, so pack order was changed to WebP first.
- GitHub rate-limited repo creation after ten repos when 22 were created in one release (0.11.0).
- A new npm trust connection expires after 2 days if unused; `npm trust` needs an interactive passkey.
- Right after publishing, the registry returns ETARGET and the CDN 404s for a few minutes (several QA incidents).
- Measured before/after of the earlier gallery: 5.07 MB / 60 requests down to 292 KB / 20; all-frames page 28 MB down to 1.06 MB; CLS 0.443 down to 0.

## What is worth keeping (the ideas, not the code)

- A runtime that contains no artwork, and immutable version-pinned CDN URLs.
- Per-file SHA-256 manifests, and "published" meaning npm plus tag plus CDN digest agree.
- A pure, DOM-free resolver with actionable errors, shared by every adapter.
- Reserved `width`/`height`, lazy loading, every variant made from the master, never upscaling.
- Capability metadata: what an asset can be used as (image, tile, frame) and the geometry that use needs.
- Provenance with record URL, source hash and extraction method, and honest labelling of AI-assisted work.
- OIDC trusted publishing with idempotent uploads that compare integrity instead of re-uploading.
- Pages deploying a release tag rather than the tip of main.
- Sets as a concept, now with a real registry and roles. 75 sets exist, 520 assets are in at least one, 188 are in two because sets nest (manuscript and folio).
- Word-prefix search ranked by field in the gallery; thumbnails at 1x; prefetch on hover.

## Direct consequences for the new design

| Old | New |
| --- | --- |
| FIFO numbered packages | one package per curated set, see [[Repository layout]] |
| Masters on the CDN | masters in git and a masters package; CDN gets AVIF/WebP ladders only, see [[Image pipeline]] |
| Single `src`, DPR 2 | `srcset`/`sizes`/`<picture>` from the manifest, see [[Delivery and consumption]] |
| 25 metadata files, 8 copies | one authored YAML per asset, one generated manifest per set, see [[Metadata model]] |
| No licence | required licence per set with per-asset override |
| 4,422 generated modules + codec | one small resolver plus per-set JSON loaded on demand |
| React layer and vendoring CLI | none; an optional one-file React helper later if asked for |
| Name as identity and path | set-scoped id, separate title, per-asset folder |
| Passkey per new package | package names created in batches inside one 2FA window, see [[Automation and publishing]] |
| Docs as logs | short durable rules, machine-readable release records |

# Design: image pipeline

Status: proposed, 2026-10-26. Evidence in [[Current asset inventory]] (encoding experiment) and [[Research/Hosting and CDN]]. See [[Decisions/ADR-002 Masters in git, variants only on npm]] and [[Decisions/ADR-005 AVIF first, WebP fallback, no PNG delivery]].

## Inputs

- `master.png` or `master.webp` (lossless) at native resolution, or `master.svg` for hand-made vectors. Components (`corner.png`, …) are masters too.
- `asset.yaml` for `type`, `render` capabilities and geometry.

The build never reads anything else. Raw scans and AI outputs are cold storage.

## Outputs per raster asset

1. **WebP ladder**, lossy, quality 82, effort 4 at every rung (measured: 3 to 4 % more bytes than effort 6 for 15 to 46x less time; effort 6 still cost seconds per rung even at 384 px), always. Widths: `64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048`, only those not exceeding the master width, plus the master's own width if it is below 2048 and not already a rung (so small ornaments always have a native-size rung). Never upscale. WebP decodes 2.5 to 5x faster than AVIF and is supported everywhere, so it is the floor.
2. **AVIF ladder**, lossy, quality 60, effort 4 (effort 6 at or below 256 px), only when it wins for this asset: the build encodes the top rung in both formats and keeps AVIF if it is at least 15 % smaller. Measured on 30 real assets ([[Encoding benchmark]]): frames, corners and dividers win by half or more, painted scenes by about a third, and only fine-detail repeat tiles lose (4 of 20 borders, ratios 0.89 to 1.03). The decision and both top-rung sizes are recorded in the manifest.
3. **Capped lossless master** for the masters package: lossless WebP at up to 2048 px long side, `exact` alpha, method 6.
4. **Geometry derivatives** when `render.tile` or `render.frame` is declared: a rotated tile (90°) at the same ladder, and a frame atlas (tile plus corner composed into a border-image atlas) at the same ladder. These are built from masters, so they are as crisp as the originals. Rotating in CSS instead was considered and rejected for tiles: `border-image` and `background-repeat` cannot rotate a tile without wrapping elements, and consumers (polyhymnia) read `rotated_tile` as a file.
5. **Measurements**: width, height, bytes, SHA-256 per output; `transparent` (any alpha < 255 on the master); `palette` (five dominant colours, measured on a 64 px thumbnail with simple k-means or median cut); `thumbhash` (from a 100 px thumbnail, ThumbHash because it encodes alpha and aspect, about 25 bytes).

Resize filter: Lanczos3 with premultiplied alpha (sharp's default), sRGB, metadata stripped. Transparent edges are not trimmed by the build; trimming is a curation step on the master.

## Outputs per vector asset

`svgo` with a pinned config (keep `viewBox`, remove editor metadata, 3-decimal precision, no path merging that alters rendering; single pass, in the build since 2026-10-30, `svgo` 4.1.0 exact). The optimised SVG is the only delivery file and what the raster ladder is rasterised from; the masters package keeps the authored bytes. The svgo version is recorded in the manifest's `tooling` block for every set but is part of the inputs hash only for sets with a vector master, so adding or bumping svgo republishes the vector sets and nothing else; a raster ladder (AVIF/WebP) is also built from a 2048 px rasterisation so that consumers that want `<img srcset>` or need thumbnails do not have to rasterise. Only hand-made vectors qualify. Auto-tracing paintings is banned; the 48 MB traces of the old library are dropped in the migration.

## Determinism and the publish gate

sharp's encoders produced byte-identical output across repeated runs on one machine (608 of 608 files, verified 2026-10-26), but AVIF bytes change with the libaom thread count (30 of 89 AVIF files differed between 1 and 8 threads; WebP never did), and cross-machine and cross-version determinism is not guaranteed. The build therefore pins `sharp.concurrency(1)`, records it in the manifest's `tooling` block, gets parallelism from building several assets at once, and the design does not depend on byte determinism:

- The **publish gate is the inputs hash**: `inputsHash = sha256(sorted master hashes + asset.yaml + set.yaml + encoding config + tooling versions)`, stored in the published manifest. If a set's inputs hash equals the published one, nothing is rebuilt or republished. Output bytes never decide whether to publish.
- The **content hash** of the outputs is still recorded per file and per package for integrity verification (CDN check, consumer `sha256` fields), not for gating.
- Pin `sharp` and its libvips build, pin `svgo`, fix `effort`/`speed`, strip metadata, sort JSON keys, run on a pinned runner image (`ubuntu-24.04`). The manifest records `tooling: { sharp, libvips, svgo }`. Bumping tooling changes every inputs hash, which republishes every set as a patch, visibly, in the plan table.
- Outputs are cached in the Actions cache (10 GB per repo) keyed by the per-asset inputs hash. A cache miss rebuilds one asset, not a set.

## Build time

Measured on one laptop thread ([[Encoding benchmark]]): AVIF effort 4 averages 3.7 s per file above 256 px (13 s at 2048 px) and 0.45 s at effort 6 below; lossy WebP at effort 4 is under a second per file at every rung, while effort 6 cost 6 to 16 s at the large rungs for 3 to 4 % fewer bytes, which is why effort 6 is used only below 512 px. With these settings a whole ladder is well under a minute for most assets and about a minute for a 5000 px painting, so the full migration build (698 assets) is a few runner-hours. The publisher shards the build per set across parallel jobs (20 concurrent on the Free plan), runs several assets at once inside a job, and relies on the cache afterwards. Day-to-day, a PR that adds five assets builds in a couple of minutes.

## Package size guard

`build` sums each npm package separately: the delivery package, each `-part<n>`, the masters package and its parts. Warn above 100 MB, fail above 120 MB. Because the publisher assigns files to volume packages automatically (see [[Repository layout]]), a set itself has no size limit; the guard can only fail if a single asset's files exceed it, and the failure message names the asset. The limit comes from jsDelivr's 150 MB rule with headroom for metadata, licences and future rungs. Measured sizes with this pipeline: a large painted illustration costs about 0.7 MB of AVIF and 1.3 MB of WebP across the ladder; a border or corner about 0.3 MB of AVIF and 0.5 MB of WebP; the dry run puts every planned set between 0.1 and about 80 MB of delivery files, none at the warning.

## Performance rules the pipeline enforces for consumers

- Every variant has intrinsic dimensions in the manifest so consumers can set `width`/`height` and avoid layout shift.
- A thumbhash exists for every raster asset so consumers can paint a placeholder before the first byte of the image arrives.
- The ladder is dense enough at small sizes (64 to 256) that ornaments and sprigs never download a 768 px file to render at 48 px, which the old library did.
- The top rung is 2048 px, which covers a full-width hero at DPR 2 on a 1024 px layout. Anything larger is a design question, not a delivery one.

## What the build refuses

- A master with an embedded colour profile other than sRGB (convert first, deterministically, as a curation step).
- A master smaller than 64 px on its long side.
- A `render.frame` without a `corner` component or an explicit `slice`.
- A `render.tile` whose master is not meaningfully longer along its axis than across it (ratio below 1.5), because it is probably not a strip.
- A PNG master that is not lossless (`sharp` reports it) or a JPEG anything.

## Tooling

`sharp` (libvips) does every raster operation: decode, resize, AVIF (libaom or SVT-AV1 as bundled), WebP, stats. ThumbHash is a 100-line reference implementation with an npm package. Palette extraction uses sharp's `stats()` on a reduced image or a small quantiser; a dependency is not needed. `svgo` for vectors. No Python in the pipeline; the extraction and curation scripts of the old library that used Pillow, CairoSVG and VTracer belong to asset *creation*, which happens before a master exists, and can stay in whatever language suits the agent doing the extraction.

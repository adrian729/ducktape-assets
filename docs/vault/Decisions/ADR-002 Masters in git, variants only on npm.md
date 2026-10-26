# ADR-002: masters live in the set repo, generated variants live only on npm

Status: proposed, 2026-10-26.

## Context

79 % of the old library's published bytes are native-resolution lossless masters and auto-traced SVGs, published as if they were delivery files. Twenty files exceed jsDelivr's 20 MB per-file limit on its GitHub endpoint, and packages were split by a 140 MB cap. The encoding experiment shows a 29 MB master becomes 283 KB as a 2048 px AVIF.

## Decision

- Native masters (lossless PNG, lossless WebP, or hand-made SVG) are committed to the set repo under `assets/<id>/`. They are the source of truth and are never served to browsers.
- Raw sources (scans, AI outputs, traces) are not committed; they go to a GitHub Release zip of the set repo, inventoried with hashes.
- Generated variants (AVIF/WebP ladders, atlases, rotated tiles, thumbhashes, manifest) are built in CI and published to npm only. They are not committed anywhere. A zip of them is attached to the set's GitHub Release as a fallback.
- A capped (2048 px) lossless WebP "web master" is published in a separate `-masters` package for build-time consumers.

## Alternatives

- **Git LFS**: the free quota is now 10 GiB storage and 10 GiB bandwidth per month (verified 2026-10-26), metered beyond. Still rejected: every CI checkout of masters would spend that bandwidth, jsDelivr's `/gh/` endpoint does not resolve LFS pointers, and plain git copes with our 50 to 200 MB per-set repos.
- **Masters only in Releases**: keeps repos tiny but takes masters out of version control and review. Rejected; repos stay well under 1 GB anyway.
- **Commit generated variants to the set repo and serve from jsDelivr's `/gh/` endpoint**: no npm package needed, but the repo would carry every regenerated variant forever, the 150 MB per-repo-state limit would bind, and there is no provenance. Kept only as a documented fallback for the same files via the Release zip.
- **Cloudflare R2 or Pages as the delivery origin**: free tiers are generous, but they need an account, a token in CI and a custom domain for caching, which breaks "no secrets, nothing to renew". Kept as a future option if jsDelivr becomes unsuitable.

## Consequences

- Set repos are 50 to 200 MB; the main repo holds no artwork.
- No file on the CDN exceeds a few MB; no package approaches 150 MB without the guard saying so first.
- Re-encoding is cheap, so the ladder and formats can change later with a patch republish.

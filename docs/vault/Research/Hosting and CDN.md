# Research: free hosting, CDN limits and image delivery

Researched 2026-10-26. Legend: **V-doc** verified against the vendor's current docs or terms that day, **V-live** verified by `curl` or a local benchmark that day, **S** secondary source, **I** inference. Re-verify the V items before Phase 1; jsDelivr's terms changed on 2026-10-05 and Cloudflare's on 2026-09-28.

## jsDelivr

Sources: [README](https://raw.githubusercontent.com/jsdelivr/jsdelivr/master/README.md), [Terms of Use](https://raw.githubusercontent.com/jsdelivr/jsdelivr/master/Terms%20of%20Use.md).

Limits:

- **V-doc** "Packages larger than 150 MB or single files larger than 20 MB (in the case of GitHub) are not supported by default." The 20 MB per-file rule is `/gh/` only. Limits "may be further increased or removed for legitimate projects on request".
- **V-live** Over the limit, the **whole version** is refused: every path of `@nylas/web-elements@1.1.3` (166.9 MB unpacked) returns `403 Package size exceeded the configured limit of 150 MB`, while 1.1.2 (143.3 MB) is served. The check uses unpacked size. Stay under 140 MB.
- **V-doc** `/gh/` soft limits: 10,000 actively accessed files per repo, 100,000 files per repo.
- **V-doc** Prohibited: "general-purpose file or media hosting" (an image-hosting website is the example) and "trying to bypass our limits or restrictions in any way". Explicitly allowed: "icons packs, apps, or games with a large number of assets". **I** Per-set packages are a natural partition like icon packs, not a bypass. Owner decision 2026-10-26: no email to jsDelivr; the risk is accepted with Cloudflare Workers static assets as the fallback.
- **V-doc** "No limits on bandwidth or number of requests." Served immutable files may be kept in permanent storage even after upstream deletion.

Caching, documented versus observed:

| URL type | Docs | Observed `cache-control` |
| --- | --- | --- |
| Exact version (`/npm/pkg@1.2.3/f`, `/gh/u/r@v1.2.3/f`, commit SHA) | 1 year plus permanent storage | `public, max-age=31536000, s-maxage=31536000, immutable` |
| Alias or range (`@1`, `@latest`) | 7 days | `public, max-age=604800, s-maxage=43200` (12 h on the CDN) |
| Branch | 12 hours | same as alias |

- **V-doc** Tags are frozen once fetched; re-pointing a git tag changes nothing.
- **V-live** Headers: `access-control-allow-origin: *`, `timing-allow-origin: *`, `cross-origin-resource-policy: cross-origin`, HTTP/2 with `alt-svc: h3`, `accept-ranges: bytes`. Correct content types for `image/avif`, `image/webp`, `image/png`, `image/svg+xml`. SVG is served with Brotli; rasters uncompressed, correctly.
- **V-live** No resizing or format negotiation: `?w=`, `?format=webp` and `Accept: image/avif` all return the same bytes; no `vary: Accept`.
- **V-live** The purge endpoint worked without authentication for an alias URL. Purging does nothing for exact versions, which is the only kind we emit.
- **I** Git LFS pointers are not resolved by `/gh/`; keep CDN files out of LFS.
- **V-live** New versions are available immediately; a first request after publish is a cache miss (measured by the old library at about 2.6 s versus 34 ms for a hit).

## npm registry

- **S** No documented tarball cap. A 229.9 MB tarball was rejected with 413 ([npm/cli#4794](https://github.com/npm/cli/issues/4794)); the old library's 340 MB was rejected and 140 MB worked. **V-live** `next@16.4.3` (192 MB unpacked) and `onnxruntime-web@1.30.0` (144.6 MB) publish fine. Our 120 MB guard is comfortably inside.
- **V-doc** [Open source terms](https://docs.npmjs.com/policies/open-source-terms): a package "cannot simply be a PNG or JPEG image uploaded directly"; the registry is not a "general purpose database"; five million requests a month is never acceptable. **I** Packages with a manifest, licence, README and `package.json` exports are ordinary asset packages (icon libraries publish hundreds); mass-publishing near-identical packages would be a spam risk, which hash-gated publishing avoids.
- **V-doc** [Tokens](https://docs.npmjs.com/about-access-tokens): classic tokens removed November 2025; a granular token covers at most 50 packages; **"the ability to publish new package versions directly with a granular access token will be removed in January 2027."** After that, CI publishing is trusted publishing only. Our design already assumes that; the bootstrap token option expires with it.
- **V-doc** [Unpublish](https://docs.npmjs.com/policies/unpublish): 72 hours freely, afterwards only with under 300 weekly downloads and no dependents; a `name@version` is never reusable. Versions are therefore permanent, which is what we want.

## GitHub

- **V-doc** [Large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github): repos ideally under 1 GB, under 5 GB strongly recommended; files warn above 50 MiB and are blocked above 100 MiB.
- **V-doc** [Git LFS billing](https://docs.github.com/en/billing/concepts/product-billing/git-lfs): free quota is now **10 GiB storage and 10 GiB bandwidth per month**, metered beyond. **I** Still not for us: every CI checkout of masters would spend bandwidth, and `/gh/` cannot serve LFS files.
- **V-doc** [Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases): 2 GiB per asset, 1,000 assets per release, no limit on total size or bandwidth. **V-live** Delivery is a 302 with `cache-control: no-cache` to a signed URL that expires in about 45 minutes, then a blob with **no `Cache-Control`, no CORS**, `application/octet-stream`, `content-disposition: attachment`. Fine for zips and masters, useless for `<img>`.
- **V-doc** [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits): 1 GB site, 100 GB per month soft bandwidth, 10 builds per hour (not for custom Actions workflows), not for "running your online business". **V-live** Delivery is `cache-control: max-age=600` with ETag and CORS `*`; headers cannot be customised, so `immutable` is impossible. Right for the gallery, wrong for asset delivery.
- **V-live** `raw.githubusercontent.com`: `max-age=300`, CSP sandbox, unauthenticated rate limits tightened 2025-05-08, 429s reported. Not usable.
- **V-doc** Actions: free standard runners for public repos; 6 h per job; 10 GB cache per repo; 500 MB artifact quota on Free. Repo creation is rate-limited (the old library hit it after ten in one go).

## Alternatives (live-tested)

- **unpkg**: `max-age=31536000` without `immutable`, gzip only, outages in 2024, cold misses of 0.5 to 45 s measured by the old library. Fallback at best.
- **esm.sh**, **cdnjs** (no AVIF on its allow-list, recompresses PNG, needs 200 stars), **statically.io** (redirects to http), **raw.githack** (no guarantees): not suitable.
- **Cloudflare Workers Static Assets / Pages** (V-doc): static requests free and unlimited; 20,000 files per deployment and 25 MiB per file on Free; `_headers` can set `immutable` and CORS; Brotli. Needs an account and an API token secret in CI; no custom domain required (`*.workers.dev`). **This is plan B** if jsDelivr becomes unsuitable: one Worker per set, deployed by the same publish job. Cloudflare's CDN terms (2026-09-28) discourage image-heavy use of the plain CDN but name the Developer Platform as the sanctioned path.
- **Cloudflare R2**: 10 GB free, free egress, but `r2.dev` is rate-limited and "development only"; production caching needs a custom domain on a Cloudflare zone. Not zero-cost in practice.
- **Netlify** (about 15 GB per month on the credit plan), **Vercel Hobby** (non-commercial, "media hosting for hot-linking" is never fair use), **ImageKit** (20 GB per month, no custom domain), **Cloudinary** (credit-capped), **Bunny / Cloudflare Images** (paid): not suitable.

## Image formats and delivery practice

- **V-doc** Browser support: AVIF 96.4 %, WebP 97.2 % of global usage ([caniuse](https://caniuse.com/avif)). JPEG XL ships in Chrome from version 155 (announced 2026-10-06); Firefox still behind a preference. Revisit JXL in 2027.
- **V-live** Local benchmark, sharp 0.35.5 (libvips 8.18.7, aom 3.15.1, libwebp 1.6.0), on four medieval images:

| Input | WebP q82 | AVIF q60 effort 4 | AVIF vs WebP decode |
| --- | --- | --- | --- |
| Très Riches Heures 1280x1980, painted | 373 KB | 298 KB (encode 9.5 s) | 158 ms vs 45 ms |
| Bede initial 240x359 | 33 KB | 20 KB | 12.6 ms vs 5.4 ms |
| Line-art initial 931x896 | 77 KB | 51 KB | 46 ms vs 18 ms |
| Synthetic transparent border 1200x900 | 85 KB | 92 KB (encode 10 s) | 79 ms vs 15 ms |

Combined with our own experiment on the eight largest masters (AVIF 40 to 60 % smaller than WebP on painted transparent art), the picture is: AVIF usually wins on bytes by a wide margin, can lose on noisy transparent edges, and always costs 2.5 to 5x the decode time. Lossless AVIF is never worth it. Encoding AVIF at effort 4 takes 3 to 30 s per image, so thousands of images times a ladder means hours of CI; incremental builds are mandatory.

- **V-live** Determinism: every sharp encoder produced byte-identical output across three runs on one machine, threaded or not. Not tested across machines or versions. Design accordingly: gate publishing on input keys (master hash, config, tool versions), not on output bytes.
- **I** Standard practice checklist: `<picture>` with AVIF then WebP sources; `srcset`/`sizes`; `width`/`height` always; `loading="lazy"` below the fold only (never on the LCP image; it does not apply to CSS backgrounds); `fetchpriority="high"` plus a preload for the LCP image; `decoding="async"` elsewhere; one `preconnect` to the CDN (without `crossorigin` for plain `<img>`); one hostname per page; ThumbHash placeholders (alpha-aware, about 25 bytes) stored in the manifest; `border-image` with `image-set(url() type())` for frames; SVGO 4.1 pinned for hand-made vectors; cross-origin `<use href>` sprites are blocked, so no SVG sprite CDN; raster sprite sheets are not worth it.
- **V-doc** Tooling: sharp 0.35.5 does AVIF, WebP, palette PNG, resize, stats, strips metadata by default. oxipng 10.2 is a Rust binary (the npm wrapper is stale). Squoosh CLI and imagemin are unmaintained; avoid. `thumbhash` 0.1.1 supports alpha; `blurhash` does not.

## Verdict

Per-set npm packages on jsDelivr's npm endpoint, exact versions only, remain the primary delivery path: free, secret-free from CI, immutable, CORS-open, HTTP/3, permanent storage, and the same package gives build-time consumers a `node_modules` path and npm provenance. Two things the research adds to the plan:

1. ~~Ask jsDelivr for an explicit OK on the per-set layout.~~ Declined by the owner on 2026-10-26; keep every package under the guard and keep the fallback documented.
2. Keep a plan B that is one configuration change away: generated variants are also zipped on each set's GitHub Release, and the resolver accepts a `base` override. If jsDelivr changes course, the same publish job deploys the variants to Cloudflare Workers Static Assets, which needs one API token secret and nothing else. Worked out in [[Design/CDN contingency]].

The research agent preferred jsDelivr's `/gh/` endpoint as primary because it needs no npm at all (no passkey ever for new sets). It was not chosen because it requires committing generated bytes to git (history growth per version), has the same 150 MB and terms constraints, gives no `node_modules` path for build-time consumers, and the passkey cost on npm is bounded to one tap per batch of about 80 new packages. Closed by the owner on 2026-10-26: npm is final, see [[Open questions]].

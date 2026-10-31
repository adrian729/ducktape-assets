# Design: what happens if delivery gets blocked

Status: proposed, 2026-10-26, written after the owner declined to ask jsDelivr for an explicit OK ([[Open questions]] item 8). Facts in [[Research/Hosting and CDN]]. Everything here is free-tier only.

## Why a block cannot break consumers who did it right

The design keeps the host out of every contract:

- Files are identical whatever serves them. The publish job produces one tree per package; a host is only a `base` URL in front of it.
- Consumers never construct URLs. The catalog, the resolver and the copy command read the per-set `cdn` base from `index.json` of the index package. Changing the host is a new index release with new bases; every set stays at its version.
- Consumers on the pick-and-copy flow ([[Delivery and consumption]]) already have their files in their own repo and are unaffected by anything that happens to any host, ever. `AGENTS.md` in the index package says so and recommends that flow for anything that must survive unattended.
- npm is the archive of record. Even if jsDelivr refuses to serve a package, the tarball is still downloadable from the registry, and the publish job can fetch any published version from there to redeploy it elsewhere.
- Exact-version files already served by jsDelivr stay in its permanent storage, so a block on new uploads does not take down pages that pasted URLs in the past; only new versions would be missing.

## Detection, with no scheduled jobs

- The publish job's verify step fetches `manifest.json` and one file per package from the CDN with bounded retries. A `403` on a package is a package problem; a `403` on everything under the scope is a project-level block. Both are written to the release record and fail the run with a message naming the level below.
- `tools check-cdn` does the same on demand for every pinned package in `index.json` and prints a table. Run it when something looks wrong, not on a timer.
- The gallery's Lighthouse run in its own CI fails loudly when assets do not load.

## Levels

### Level 0: one package refused

Cause: a package version over 150 MB unpacked, or a single file jsDelivr dislikes. Should be impossible with the 120 MB guard and volume packages ([[Repository layout]]). Fix: correct the build, republish as a new patch version, republish the index. Mechanical, no owner action beyond the usual approve.

### Level 1: jsDelivr refuses the project

Cause: jsDelivr reads the per-set layout as a terms violation, or the limits change. Plan B is **Cloudflare Workers Static Assets**, chosen in the research because static-asset requests are free and unlimited on the Free plan, with 20,000 files per Worker version and 25 MiB per file, custom `_headers` for `immutable` and CORS, Brotli, and a `*.workers.dev` hostname so no domain is needed.

Shape:

- One Worker per set, named `ducktape-assets-<set>`, serving `/<version>/<format>/<asset>-<w>.<ext>`: the npm package tree under a version folder, so URLs stay exact-version and immutable.
- `_headers` sets `Cache-Control: public, max-age=31536000, immutable` and `Access-Control-Allow-Origin: *` on everything.
- A Worker deployment replaces its whole file tree, so every deploy re-uploads the versions it keeps. Retention: every set version pinned by any index release of the last 12 months, plus the latest, capped by the 20,000-file limit. A 150-asset set is about 3,000 files per version, so six versions fit. Older versions remain on npm and in Release zips; a consumer that needs one uses the copy command, which can read tarballs from the registry directly.
- The publish job gains a `deploy-cdn` step gated by a repository variable `CDN_PROVIDER=cloudflare`. It downloads the retained tarballs from npm, lays them out per Worker, runs `wrangler deploy` with the token, verifies headers, and then publishes the index with the new bases. Masters packages deploy the same way; parts fold into their set's Worker.
- The index package's `cdn` field per set becomes `https://ducktape-assets-<set>.<account>.workers.dev/<version>/`. Catalog URLs regenerate. One minor index release, one approve click. The gallery redeploys on it.

Owner actions, once, when the level is reached: create a free Cloudflare account, create an API token with "Workers Scripts: Edit", store it as the single secret in the main repo's `release` environment, and set the `CDN_PROVIDER` variable. About ten minutes. This is the one secret the design ever holds, and it exists only while plan B is live.

Drill: Phase 1 writes and tests the `deploy-cdn` step against a throwaway Worker on the owner's account once, then the token is deleted. The step then sits unused until needed, and the drill result is in the release records so nobody has to trust an untested fallback.

Status 2026-10-30: `tools deploy-cdn` is written (`tools/src/deploy-cdn.mjs`): retention from the release records (`retainedVersions`, tested), one tree per set with the delivery, part and masters packages folded under `/<version>/`, `_headers`, a `wrangler.jsonc` per Worker, `wrangler` pinned, header verification after the deploy, and `--dry-run`, which laid out W.102's three versions (187 files, 9 MB) from the real npm tarballs without an account. The index switch is the `cdnTemplate` option of the index generator, fed by the `DUCKTAPE_CDN_TEMPLATE` environment variable from the `CDN_TEMPLATE` repository variable (`https://ducktape-assets-<set>.<account>.workers.dev/<version>/`); the resolver's URL builder already folds parts into one base. Arming is three repository settings (`CDN_PROVIDER`, `CDN_ACCOUNT`, `CDN_TEMPLATE`) plus the token secret. The drill against a real Worker still needs the owner's account; the steps are in [[Owner runbook]].

### Level 2: npm refuses the project

Cause: tarball cap tightened, scope dispute, or trusted publishing changing again after the January 2027 token removal. Then both the archive of record and the host move:

- Archive: the GitHub Releases of the main repository, one per publisher run (`run-<id>`, written by `tools archive` since 2026-10-30), become the record. Each holds the npm tarball of every package that run published, with bytes and sha256 in the release notes and in the run's record (`archive`). Decided 2026-10-30: on the main repository rather than on each set repository, because the publish job can write its own repository with its job token and anything cross-repository would need a long-lived credential, which the invariants forbid. First exercised by run 41243521368 (2026-10-31): three tarballs, each byte-identical to npm's (`dist.shasum` matched).
- Host: Cloudflare Workers as in level 1, fed from those tarballs instead of the registry (`deploy-cdn` fetches with `npm pack <name>@<version>`; at this level the fetch is pointed at the release assets).
- The index package: published to npm if npm still allows the small metadata package, otherwise committed to the main repo only and served by the gallery's GitHub Page, which the resolver and the copy command can read as a URL (`index: 'https://…/index.json'`).
- Build-time consumers are unaffected because the copy command fetches from the `cdn` base, not from npm.

### Level 3: GitHub itself

Public repos get free Actions and Pages; the only realistic failure is rate limiting, which the tooling already handles with backoff. A total loss of GitHub is a loss of the git hosting, not of any artwork: masters are in git and cloned locally, sources are in the set repositories' Releases and mirrored locally by `tools sources pull`, which verifies every hash against `sources.yaml`. Not planned beyond keeping local clones.

## What is never the fallback

- `/gh/` on jsDelivr: same operator, same terms, so it cannot answer a level-1 block.
- GitHub Pages for asset delivery: ten-minute cache, no `immutable`, 100 GB per month soft limit, and the terms exclude it.
- unpkg: cold misses up to 45 s measured by the old library and no `immutable`.
- Anything paid.

## Cost of keeping this ready

One extra tooling command (`check-cdn`), one conditional step in `publish.yml`, a `_headers` template, a retention rule, and one Phase 1 drill. No runtime cost, no secrets at rest, no scheduled jobs.

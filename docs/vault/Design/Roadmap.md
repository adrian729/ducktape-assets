# Roadmap

Status: approved by the owner on 2026-10-26 ("go for it"); Phase 0 started the same day. Phases are ordered so that each one produces something checkable on its own, and so the riskiest unknowns (npm bootstrap, determinism, package sizes) are settled first.

Last review before starting (2026-10-26) found and fixed three contradictions in [[Architecture]] (the copy command listed as a non-goal, the old split-by-curation size rule, `/gh/` named as fallback) and added two facts from polyhymnia: its logo frame (`src/assets/logo/polyhymnia-logo-acanthus.json`, an authored acanthus medallion made with the same prompts) belongs in `illuminated-acanthus`, and the 138 Vectorian ornaments in the notation app are under Vectorian's Standard License (raster only, not redistributable) and must never enter the library.

## Phase 0: settle the unknowns (small spikes, throwaway code)

Done locally on 2026-10-26, results in [[Investigation/Importer dry run]] and [[Investigation/Encoding benchmark]]:

- Importer dry run: 698 assets in 39 sets, 47 single-object holdings to decide before wave 2, no set near the size guard, wave 1 fixed at 80 assets in three sets. `migration/plan.yaml` written.
- Encoding benchmark: the 15 % AVIF rule confirmed on 30 real assets, build times measured, one-machine determinism confirmed, AVIF found to depend on thread count, so the build pins `sharp.concurrency(1)`. sharp 0.35.5 / libvips 8.18.7 are the first pins.
- WebP effort follow-up: effort 4 from 512 px up, effort 6 below. Config pinned.

Needs the owner's account, batched into one sitting:

- Test `npm stage publish` for a brand-new name from CI, and `npm trust` bulk registration in one 2FA window with two throwaway names. Record the result in [[Open questions]].
- Repeat the determinism check on two GitHub runners once the main repo exists.
- Confirm jsDelivr's `Content-Type` for AVIF on the first published test package (WebP, JSON, `immutable` and CORS are already verified).

## Phase 1: schemas and tooling (built locally 2026-10-26, nothing on GitHub or npm yet)

- Done: `schemas/` with `set`, `asset`, `manifest` JSON Schemas and vocabularies (subjects seeded from wave 1, to be pruned in review). `tools/`: `validate`, `build` (with `--preview`), `plan`, `publish`, `check-cdn`, `import`, `new-set`, `readme`, with tests in the five places (25 tests). Template directory with `ci.yml` calling the reusable `set-ci.yml`. Main repo `ci.yml` and `publish.yml` with the `release` environment and the dormant `deploy-cdn` step.
- Not done: `tools bootstrap`, `deploy-cdn`, `sources add`, svgo optimisation of hand-made SVGs, Release zips, per-set `CHANGELOG.md`, the gallery dispatch, the Cloudflare drill (needs the owner's account).

## Phase 2: index and resolver (built locally 2026-10-26)

- Done: `index/` package with the resolver (`image`, `picture`, `preload`, `tile`, `frame`, `local`, `url`), the `copy` command for `ducktape.json`, and the generators for `index.json`, `catalog.json`, `sets/<set>.json`, README and AGENTS (11 tests).
- Not done: publishing `@ranx729/ducktape-assets-tools` and `@ranx729/ducktape-assets` at 0.x and their trust configs (first passkey tap, owner).

## Phase 3: first wave, only what the owner's apps use (decided 2026-10-26)

Start small so every piece of the chain is proven on real pages before the bulk import. Status 2026-10-26: the wave 1 import ran locally into `tmp/wave1/` (80 assets, three sets, every master verified pixel-identical, drafts validate), the Walters W.102 set builds in 21 s to 3 MB, and the planner plus dry-run publish were exercised over the three local repos. Nothing has left this machine.

- Import the assets polyhymnia and elder-scrolls use today, plus their immediate neighbours, into the handful of sets they belong to. Rule (owner, 2026-10-26): the used asset, every other asset in the same `group`, and the whole set when the set is small and coherent; never a large set just because one asset of it is used. Concretely: the complete `illuminated-acanthus` set (the 15 published pieces plus the 18 made in polyhymnia's `homepage-art`, unused variants included, so the set is whole from day one), the thirteen animal illustrations with their group siblings, `walters-horse-flute-drum` with its folio group, and `polyhymnia`. Expected size: 60 to 80 assets; the dry run gives the exact list. Sets grow in later waves, which the design allows without restructuring.
- Review and rewrite their metadata against the new model; PR per set; merge. Bootstrap those package names (one passkey tap); first publisher run; approve once.
- Move polyhymnia (`ornament-selection.json` to `ducktape.json`, retire `homepage-art`) and elder-scrolls (`ducktape.json` with four ids). Build and ship both. This is the acceptance test of the whole design.
- Commit `migration/medieval-ornaments.json` and `MIGRATION.md` in the main repo only; never in a package.

## Phase 3b: remaining waves

- Import the rest of the 726 designs set by set, in batches of ten repos (GitHub rate-limits repo creation), reviewing metadata per set; bootstrap names per batch (one tap each); one approve per batch.
- Mark `medieval-ornaments` as superseded in its README. Unpublish nothing.
- Delete `migration/` once both consumers are verified against the new library.

## Phase 4: gallery

- `ducktape-assets-gallery` on GitHub Pages: search over `catalog.json`, lazy manifests, thumbhash placeholders, AVIF thumbnails, per-asset page with the exact `<picture>` and resolver snippet, licence and attribution block, set pages. Lighthouse in CI as the only performance measurement.
- Redeploys on index package release.

## Phase 5: steady state

- Adding assets: agent PRs to set repos, owner merges, agent triggers the publisher, one approval.
- New historical sources: rights check, new set, same flow.
- Quarterly: review tooling pins (sharp, svgo), bump deliberately, let the plan table show the republish.

## Not planned

- Image transformation services, custom domains, paid CDNs.
- React, Vue or web components.
- Unpublishing or rewriting old packages.

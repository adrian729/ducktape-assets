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
- ~~Repeat the determinism check on a GitHub runner.~~ Done 2026-10-26: runner and laptop hashes identical for the W.102 set.
- Confirm jsDelivr's `Content-Type` for AVIF on the first published test package (WebP, JSON, `immutable` and CORS are already verified).

## Phase 1: schemas and tooling (built locally 2026-10-26, nothing on GitHub or npm yet)

- Done: `schemas/` with `set`, `asset`, `manifest` JSON Schemas and vocabularies (subjects seeded from wave 1, to be pruned in review). `tools/`: `validate`, `build` (with `--preview`), `plan`, `publish`, `check-cdn`, `import`, `new-set`, `readme`, with tests in the five places (25 tests). Template directory with `ci.yml` calling the reusable `set-ci.yml`. Main repo `ci.yml` and `publish.yml` with the `release` environment and the dormant `deploy-cdn` step.
- Not done: `tools bootstrap`, `deploy-cdn`, `sources add`, svgo optimisation of hand-made SVGs, Release zips, per-set `CHANGELOG.md`, the gallery dispatch, the Cloudflare drill (needs the owner's account).

## Phase 2: index and resolver (built locally 2026-10-26)

- Done: `index/` package with the resolver (`image`, `picture`, `preload`, `tile`, `frame`, `local`, `url`), the `copy` command for `ducktape.json`, and the generators for `index.json`, `catalog.json`, `sets/<set>.json`, README and AGENTS (11 tests).
- Not done: publishing `@ranx729/ducktape-assets-tools` and `@ranx729/ducktape-assets` at 0.x and their trust configs (first passkey tap, owner).

## Phase 3: first wave, only what the owner's apps use (decided 2026-10-26)

Start small so every piece of the chain is proven on real pages before the bulk import. Status 2026-10-26: the wave 1 import ran locally into `tmp/wave1/` (80 assets, three sets, every master verified pixel-identical, drafts validate), the Walters W.102 set builds in 21 s to 3 MB, and the planner plus dry-run publish were exercised over the three local repos. The main repo and the three set repos are on GitHub with CI green; the metadata review is in progress; the npm bootstrap is with the owner.

- Import the assets polyhymnia and elder-scrolls use today, plus their immediate neighbours, into the handful of sets they belong to. Rule (owner, 2026-10-26): the used asset, every other asset in the same `group`, and the whole set when the set is small and coherent; never a large set just because one asset of it is used. Concretely: the complete `illuminated-acanthus` set (the 15 published pieces plus the 18 made in polyhymnia's `homepage-art`, unused variants included, so the set is whole from day one), the thirteen animal illustrations with their group siblings, `walters-horse-flute-drum` with its folio group, and `polyhymnia`. Expected size: 60 to 80 assets; the dry run gives the exact list. Sets grow in later waves, which the design allows without restructuring.
- ~~Review and rewrite their metadata against the new model; bootstrap those package names; first publisher run.~~ Done 2026-10-26: all seven packages at 1.0.0 on npm through trusted publishing (run 40403447326), verified on jsDelivr the next morning. The run itself was marked failed because its CDN check gave up after a minute while npm's public replication lagged; the publisher now waits up to 15 minutes and commits the record and `index/` regardless, and the first record was reconstructed by hand from the plan artifact and the job log.
- ~~Move polyhymnia and elder-scrolls.~~ Both migrated by agents on 2026-10-27 (commits local in their repos, not pushed): elder-scrolls through the Node resolver, polyhymnia through `ducktape.json` with 31 masters and `homepage-art` deleted; builds and tests pass in both. Their findings produced the second release (attribution for authored and imported sets, `file`/`files` on `image()`, `createNodeResolver`, ready-made frames with `slice_px`, richer copy manifest, masters-only copies), see [[Investigation/Consumers]]. Run 40547559404 published illuminated-acanthus 2.0.0 (major because the cropped floral frame removed a rung) and index 1.1.0, verified and recorded without a hitch; the tooling bump to 0.1.0 republishes the two other sets with their attribution line. Run 40549810810 (tooling 0.1.0) republished every set as a patch and index 1.2.0. Both apps were then bumped to 1.2.0: elder-scrolls lost its attribution regex and rung lookup, polyhymnia lost its own frame crop and now takes the slice from the copy manifest; builds and tests green in both. Phase 3 acceptance passed. Both app repos pushed. Small index-package items for the next release, not urgent: `package` and `version` on the `image()` result; attribution without the licence suffix; polyhymnia's pnpm release-age policy needs an exclusion per fresh library version. Done 2026-10-27 (tooling 0.2.0): `image()` reports `set`, `package` and `version`; the manifest `attribution` is the bare credit and an asset carries its own when its holding differs from the set's, which is what artist print sets need; the publisher republished every set as a patch and the index as 1.3.0.
- Commit `migration/medieval-ornaments.json` and `MIGRATION.md` in the main repo only; never in a package.

## Phase 3b: remaining waves

- Import the rest of the 726 designs set by set, in batches of ten repos (GitHub rate-limits repo creation), reviewing metadata per set; bootstrap names per batch (one tap each); one approve per batch.
- Batch 1 (2026-10-28): `hopfer-prints`, `schongauer-prints`, `solis-prints`, `fuchs-1542-herbal`, `gessner-historiae-animalium`, `mkg-de-bry-alphabet`, `met-356741`, `cma-1950-154`, `cma-1963-256`, `getty-ms20`; 77 imported, 73 approved after one review agent per set (two near-duplicate Gessner fruit crops and two de Bry masks under the 64 px minimum dropped, two generated "bar" components removed), 42 ids shortened before they become permanent, 60 subjects added to the vocabulary. First real composed frames (`met-356741`) and tiles (`met-356741`, `cma-1950-154`): the foliate frame composes cleanly; the mask frame composes but the mirrored rule hangs the bottom masks upside down, see [[Design/Delivery and consumption]]. The tile guard now refuses only a wrong axis, so a square swatch can tile. Published by run 40722497463: twenty packages at 1.0.0 and the index at 1.4.0 (13 sets), all verified on jsDelivr; the Fuchs delivery package took about 40 minutes to appear on npm, see [[Design/Automation and publishing]].
- Batch 2 (2026-10-28): the nine remaining artist print sets `aldegrever-prints`, `beham-prints`, `meckenem-prints`, `zoan-andrea-prints`, `della-bella-prints`, `lucas-van-leyden-prints`, `christollien-prints`, `giancarli-prints`, `master-w-with-the-key-prints`, plus `authored-ornaments`; 60 imported, 60 approved by four review agents (small sets shared one agent), 8 over-long ids shortened before import and 12 more renamed after review (misleading motifs such as "griffins" or "grotesque" that the pixels do not show), 39 subjects added to the vocabulary. No tiles or frames in this batch: no print repeats at its ends and the authored corners have no slices. The three Walters W.102 rows still marked wave 2 in the plan had been imported whole with wave 1; the rows were corrected, nothing re-imported. Lesson: push the registry and vocabulary commit to main before creating the set repositories, or their first CI run fails on unknown subjects and has to be rerun. Ten repositories on GitHub with CI green; publishing waits for the owner's passkey tap on the npm bootstrap (twenty new names), which expired unanswered on the first attempt.
- Mark `medieval-ornaments` as superseded in its README. Unpublish nothing.
- Delete `migration/` once both consumers are verified against the new library.

## Phase 4: gallery

- `ducktape-assets-gallery` on GitHub Pages: search over `catalog.json`, lazy manifests, thumbhash placeholders, AVIF thumbnails, per-asset page with the exact `<picture>` and resolver snippet, licence and attribution block, set pages. Lighthouse in CI as the only performance measurement.
- Redeploys on index package release.
- The gallery is also the library's own consumer (owner, 2026-10-28): it uses the assets exactly as another app is supposed to, through the published index package and the resolver, never through a private path, so that the consumer flows are proven on every release.

## Phase 5: steady state

- Adding assets: agent PRs to set repos, owner merges, agent triggers the publisher, one approval.
- New historical sources: rights check, new set, same flow.
- Quarterly: review tooling pins (sharp, svgo), bump deliberately, let the plan table show the republish.

## Not planned

- Image transformation services, custom domains, paid CDNs.
- React, Vue or web components.
- Unpublishing or rewriting old packages.

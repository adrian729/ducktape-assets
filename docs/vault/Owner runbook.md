# Owner runbook

The short list of things only the owner can do, with the exact command or page for each. Everything else is automated or done by agents. Updated 2026-10-26.

## Done on 2026-10-26 by an agent with the owner's `gh` session

- Main repository created and pushed: https://github.com/adrian729/ducktape-assets (public, `main`, CI green).
- `release` environment created, deployments from `main` only. The required reviewer was removed by the owner the same day.
- Tag `v0` on the main repository, which the set repositories' `ci.yml` pins for the reusable workflow. The reusable workflow checks the tooling out of this repository, so nothing has to exist on npm for set CI to run.
- The three wave 1 set repositories created and pushed with their draft metadata: `ducktape-assets-illuminated-acanthus`, `ducktape-assets-medieval-cutouts`, `ducktape-assets-walters-w102`. Registered in `sets.yaml`. Drafts never publish, so registering them is safe.

## Once: GitHub notification emails (no longer needed)

Deployment review requests only exist while an environment has required reviewers. Since the reviewer was removed on 2026-10-26, GitHub sends none. If the gate is ever restored, the toggle is at https://github.com/settings/notifications under "System" → "Actions".

## Once per batch of new package names: npm (passkey needed)

`scripts/owner-npm-bootstrap.sh` does the whole sitting: checks who is logged in, publishes a 0.0.0 placeholder for every missing name (first publish asks for the passkey, then accept "skip 2FA for 5 minutes"), registers trusted publishing for each name bound to this repository, `publish.yml` and the `release` environment, and triggers the publisher. Wave 1 needs seven names. Run `./scripts/owner-npm-bootstrap.sh --test-stage` first if you want the Phase 0 answer on staged publishing for new names; it costs one throwaway name.

If `npm trust` rejects the flags, `npm help trust` shows the current syntax; the two lines are marked ADJUST in the script.

## Every publish: none

The owner removed the required reviewer on 2026-10-26, so a dispatch of `publish.yml` publishes without a click. The run summary table is the record. Drafts are never in it. To restore the gate: Settings → Environments → release → Required reviewers.

## Before the first publish: the metadata review

The 80 wave 1 records are drafts. An agent rewrites each against [[Design/Metadata model]], you look at the preview contact sheet in the PR (artifact "preview") and a sample of records, merge, and the assets flip to `approved` in that PR. A set with no approved asset is excluded from every plan.

## Later, optional

- Cloudflare drill for the fallback host ([[Design/CDN contingency]]): free account, one API token, one dry deployment, token deleted.
- Decide the single-object-holding rule before wave 2 ([[Investigation/Importer dry run]]).

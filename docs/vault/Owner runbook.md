# Owner runbook

The short list of things only the owner can do, with the exact command or page for each. Everything else is automated or done by agents. Updated 2026-10-26.

## Done on 2026-10-26 by an agent with the owner's `gh` session

- Main repository created and pushed: https://github.com/adrian729/ducktape-assets (public, `main`, CI green).
- `release` environment created, deployments from `main` only. The required reviewer was removed by the owner the same day.
- Tag `v0` on the main repository, which the set repositories' `ci.yml` pins for the reusable workflow. The reusable workflow checks the tooling out of this repository, so nothing has to exist on npm for set CI to run.
- The three wave 1 set repositories created and pushed with their draft metadata: `ducktape-assets-illuminated-acanthus`, `ducktape-assets-medieval-cutouts`, `ducktape-assets-walters-w102`. Registered in `sets.yaml`. Drafts never publish, so registering them is safe.

## Once: GitHub notification emails (no longer needed)

Deployment review requests only exist while an environment has required reviewers. Since the reviewer was removed on 2026-10-26, GitHub sends none. If the gate is ever restored, the toggle is at https://github.com/settings/notifications under "System" → "Actions".

## Once per batch of new set repositories: GitHub (the agent does it)

An agent prepares the batch under `tmp/wave<n>/` (import, review, local commit on `main`) and runs `scripts/owner-create-batch-repos.sh tmp/wave<n>`, which creates `adrian729/ducktape-assets-<set>` for each directory and pushes it (owner rule 2026-10-28: agents create the set repositories themselves; a permission-classifier refusal is retried, not escalated). The agent then commits `sets.yaml`, watches the set CI runs, and hands over to the npm step below. Order matters: the registry is pushed only after the repositories exist, and the npm script dispatches the publisher at its end, so it runs last. The vocabulary additions (`schemas/vocab/subjects.yaml`) are the exception: push them to main before creating the repositories, because set CI validates against main and the first run otherwise fails on unknown subjects (batch 2, 2026-10-28, ten reruns).

## Once per batch of new package names: npm (passkey needed)

Run it in a real terminal, never through Claude Code's `!` prefix: that backgrounds the command after 120 seconds, the passkey prompt goes unanswered, every publish fails with EOTP and (before 2026-10-28) the script still dispatched a doomed publisher run. The script now stops on the first real failure and dispatches nothing unless every name is published and trusted.

`scripts/owner-npm-bootstrap.sh` does the whole sitting: checks who is logged in, publishes a 0.0.0 placeholder for every missing name (first publish asks for the passkey, then accept "skip 2FA for 5 minutes"), registers trusted publishing for every name bound to this repository, `publish.yml` and the `release` environment (an existing config is reported and skipped), and triggers the publisher. Wave 1 needs seven names. The first run on 2026-10-26 listed only the index package because of a bug in the set listing (fixed the same night); the index placeholder it published is fine and stays. Rerun the script for the six set package names. Run `./scripts/owner-npm-bootstrap.sh --test-stage` first if you want the Phase 0 answer on staged publishing for new names; it costs one throwaway name.

If `npm trust` rejects the flags, `npm help trust` shows the current syntax; the two lines are marked ADJUST in the script.

Batch 3 (2026-10-29) is one sitting for 54 names, the owner's decision ("a single release"): the placeholder loop takes about five minutes and the trust loop another five, so expect the passkey prompt two or three times (each `npm trust` call asks again once the five-minute window closes). The script is the same; nothing to pass.

## Every publish: none

The owner removed the required reviewer on 2026-10-26, so a dispatch of `publish.yml` publishes without a click. The run summary table is the record. Drafts are never in it. To restore the gate: Settings → Environments → release → Required reviewers.

## Before the first publish: the metadata review (done 2026-10-26)

All 80 wave 1 records are reviewed, approved and pushed to the set repos. Spot-check whenever convenient: each set repo's README lists every asset with its title, and the CI run's "preview" artifact is the contact sheet. Ids become permanent at the first publish; the reviewers' remaining naming suggestions are listed in [[Design/Migration]]. Decide them before running the npm bootstrap, or accept the ids as they are.

## Done 2026-10-27: both apps migrated and pushed

elder-scrolls and polyhymnia-ear-training are on `@ranx729/ducktape-assets@1.2.0`, pushed to their `main` by an agent. Owner rule stated the same day: agents commit and push in the owner's repos without asking.

## Later, optional

- Cloudflare drill for the fallback host ([[Design/CDN contingency]]): free account, one API token, one dry deployment, token deleted.
- Decide the single-object-holding rule before wave 2 ([[Investigation/Importer dry run]]).

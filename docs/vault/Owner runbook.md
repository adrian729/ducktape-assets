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

Batch 3 (2026-10-29) is one sitting for 54 names, the owner's decision ("a single release"): the placeholder loop takes about five minutes and the trust loop another five, so it asked for the passkey five times because the trust loop also re-ran the 47 names that were already trusted (each `npm trust` call asks again once the five-minute window closes, and two of those redundant calls failed on an unanswered browser prompt, which stopped the dispatch although every new name was published and trusted). The script now trusts only the names it published (`--retrust` restores the old behaviour), so a batch of fifty names is one prompt per loop, two in all.

## Every publish: none

The owner removed the required reviewer on 2026-10-26, so a dispatch of `publish.yml` publishes without a click. The run summary table is the record. Drafts are never in it. To restore the gate: Settings → Environments → release → Required reviewers.

## Before the first publish: the metadata review (done 2026-10-26)

All 80 wave 1 records are reviewed, approved and pushed to the set repos. Spot-check whenever convenient: each set repo's README lists every asset with its title, and the CI run's "preview" artifact is the contact sheet. Ids become permanent at the first publish; the reviewers' remaining naming suggestions are listed in [[Design/Migration]]. Decide them before running the npm bootstrap, or accept the ids as they are.

## Done 2026-10-27: both apps migrated and pushed

elder-scrolls and polyhymnia-ear-training are on `@ranx729/ducktape-assets@1.2.0`, pushed to their `main` by an agent. Owner rule stated the same day: agents commit and push in the owner's repos without asking.

## Later, optional

- Cloudflare drill for the fallback host ([[Design/CDN contingency]]; the command exists since 2026-10-30 and its dry run passed): create a free Cloudflare account and note the `workers.dev` subdomain it gives you (Workers & Pages → Overview); create an API token from the "Edit Cloudflare Workers" template and copy the account id from the same page; then in a real terminal from the main repository root run `CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id> node tools/src/cli.mjs deploy-cdn --sets walters-w102 --account <subdomain> 2>&1 | tee tmp/cdn-drill-$(date +%Y%m%d).log`. It prints a table whose last column must say `ok` (status 200, `immutable`, CORS `*` on the Worker's `manifest.json`). Then delete the Worker (`npx --yes wrangler@4.156.0 delete --name ducktape-assets-walters-w102`) and the token, and tell an agent to note the result in [[Design/CDN contingency]]. Nothing in this drill touches npm, jsDelivr or the index.
- Decide the single-object-holding rule before wave 2 ([[Investigation/Importer dry run]]).

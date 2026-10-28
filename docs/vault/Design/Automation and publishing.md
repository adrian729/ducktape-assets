# Design: automation and publishing

Status: proposed, 2026-10-26. Facts in [[Research/npm publishing automation]]. See [[Decisions/ADR-006 Centralised publisher with one approval per batch]].

## The owner's manual actions, exhaustively

1. Ask for assets to be added (to an agent, in words).
2. Merge PRs in set repos (or let an agent merge when the owner has said so for that repo).
3. Click **Approve** once per publish batch in the main repo's Actions UI.
4. Once per batch of new set names: one passkey tap in a terminal to register trusted publishing for up to about 80 packages.
5. Accept terms of use for a new historical source, when a set's licence is not already covered.

Nothing else. No tokens to rotate, no secrets in any repo, no versions to choose, no files to upload, no CDN to warm.

## Workflows

### Set repo `ci.yml` (on every PR and push)

Calls the reusable `set-ci.yml` from the main repo, pinned to a tag. Steps: install tooling, `validate` (schemas, vocabularies, ids, master integrity, provenance completeness for historical sets, licence present), `build` into a temp dir with the Actions cache, size guard, `preview` (a static contact sheet of changed assets with thumbhash placeholders, posted as a PR comment via a Pages preview branch or an artifact link). No publishing, no `id-token`.

### Main repo `publish.yml` (manual dispatch only)

Decided 2026-10-26: no schedule, no notification emails. Changes happen only when the owner asks, so the agent that finishes a batch triggers the run (`gh workflow run publish.yml`) and the owner approves on the run page. The plan job doubles as the way to check what differs; `tools plan` prints the same table locally.

```
plan (no environment, no secrets)
  checkout main; read sets.yaml
  for each active set: shallow-clone its default branch (public repos, GITHUB_TOKEN is enough)
  compute inputsHash per set (masters, YAML, config, tooling); compare with `npm view <pkg> inputsHash`
  build only the changed sets (cached, sharded per set across parallel jobs), compute contentHash for integrity
  write table to $GITHUB_STEP_SUMMARY: set | current | next | +added | ~changed | -removed | delivery MB | masters MB
  output: JSON list of packages to publish; if empty, stop here and skip the publish job entirely

publish (environment: release, required reviewer = owner; permissions id-token: write)
  rebuild the changed sets (same cache, same tooling version; verify hashes match the plan)
  for each changed set: npm publish --access public (delivery, then masters); "already published" is success
  regenerate index.json and catalog.json with the new pins; npm publish the index package
  attach each changed set's generated files as a zip to a GitHub Release `v<version>` on the set repo (GITHUB_TOKEN cannot write to other repos; use a GitHub App or a fine-grained PAT ONLY for this optional step, or do it from the set repo on a `release` dispatch; see Open questions)
  verify: fetch manifest.json for each published package from jsDelivr with bounded retries; record the result in a release record JSON committed to main
  dispatch the gallery repo's deploy
```

Owner decision 2026-10-26, after the repositories went live: the required reviewer was removed from the `release` environment so agents can publish without waiting. The manual dispatch is now the only "go"; the environment still exists because the npm trust configurations are bound to it. The plan table in the run summary remains the record of what went out. (Original design: the owner opens the run, reads the summary table, approves.) If a set repo is broken (validation fails in the plan job), the plan excludes it and says why; the rest still publishes.

Why the publisher lives in the main repo and not in each set repo: trusted publishing binds a package to a repo plus a workflow filename plus an environment, and environment approval is per job. Publishing from each set repo would mean one approval per set per batch. Publishing everything from one job in one repo means one approval. The set repos stay secret-free because public repos can be cloned with no token at all.

### Creating a new set

`tools new-set <id> --title … --kind …` run locally by an agent: creates the repo from the template with `gh repo create`, pushes `set.yaml`, registers the set in `sets.yaml` in a PR to main. The first publish of its two packages needs the names to exist on npm. The bootstrap procedure, batched:

1. The plan job lists packages that do not exist on the registry (`E404`).
2. The owner, once per batch, runs `tools bootstrap` locally. It publishes a `0.0.0` placeholder for each missing name (one passkey tap starts the 5-minute 2FA-skip window), then runs `npm trust github <pkg> --repo adrian729/ducktape-assets --file publish.yml --env release --allow-publish --yes` for each, with a 2-second sleep. About 80 names fit in one window; our migration needs roughly 80 (40 sets × 2), so at most two taps.
3. The trust configuration expires after 2 days if unused, so `tools bootstrap` ends by triggering the publisher run itself, and the owner approves it in the same sitting.

If `npm stage publish` turns out to create placeholders for new names from CI, step 2 shrinks to the `npm trust` loop only. This is the first thing to test in implementation.

### Tooling and index releases

The tooling package and the index package publish from the same `publish.yml`. The tooling publishes when `tools/` changes (its own contentHash); set repos pin a tooling version in their reusable workflow call, bumped by a tooling-authored PR so a tooling change never silently rebuilds every set.

## Idempotency and recovery

- `inputsHash` in each published manifest is the only gate (see [[Image pipeline]]); output bytes are recorded for integrity but never decide a publish, because encoder determinism across machines is not guaranteed. Re-running the publish job after a partial failure republishes only what is missing.
- The granular-token bootstrap option (step 2 above) stops working in January 2027, when npm removes direct publishing with granular tokens. After that, placeholder creation is either `npm stage publish` from CI (if it works for new names) or a local publish inside the 2FA window. Trusted publishing itself is unaffected.
- Version numbers are derived, not chosen: the plan proposes the next version from the diff classification (patch/minor/major, see [[Repository layout]]); the publish job uses the plan's numbers. Nobody edits a version field by hand.
- "Published" is recorded only when npm has it and jsDelivr serves the manifest with the expected hash. The release record lists both checks. No weekly warming job.
- Registry eventual consistency (ETARGET and CDN 404 minutes after publish) is handled by publishing the index package last and by the gallery deploy waiting on the verification step.

## First publish, what actually happened (2026-10-26)

Run 40403447326 published all seven wave 1 packages at 1.0.0 through trusted publishing on the first try. What did not go as designed: npm's public registry view lagged several minutes behind the publish (packages visible to the owner's token, 404 anonymously), so the bootstrap script's "exists" check misjudged a rerun, and the job's jsDelivr verification gave up after six tries in one minute and the run was marked failed before its release record and regenerated `index/` were committed. Fixes: the script tolerates "cannot publish over 0.0.0"; the verification waits up to fifteen minutes; the record and `index/` are committed whatever the verification says, with a separate failing step afterwards. The first record was reconstructed from the plan artifact and the job log. Side observation: npm now creates a `0.0.0-stage` version by itself on the first publish of a new name.

## Batch publish, what actually happened (2026-10-28)

Run 40722497463 published the twenty packages of wave 2 batch 1 and the index 1.4.0; npm accepted every publish, but `fuchs-1542-herbal@1.0.0` (the largest delivery package, 32.6 MB) was still absent from npm and the CDN after the 15-minute verification and about 25 minutes more. A second dispatch planned it again (the plan reads the live registry, so a version that never landed is simply replanned) and its `npm publish` failed, yet the version appeared on npm right after; a third dispatch found nothing to publish. Reading: npm processed the first publish late, the second collided with it. The record of the first run was verified by hand afterwards (`check-cdn` with the run's plan artifact and `GITHUB_RUN_ID` set) and committed. Two lessons kept: a batch of twenty new names can need more than 15 minutes, and a failed re-dispatch is not a loss, the next plan tells the truth. The publisher now reports npm's own error lines instead of the tarball listing.

The owner's npm bootstrap also needed three attempts: the passkey prompt must reach a terminal (the script now keeps npm on a pseudo-terminal and logs everything to `tmp/bootstrap-<timestamp>.log`), and each `npm trust` call needs 2FA again once the five-minute window closes, so a batch of twenty names takes one approval for the publishes and one more for the trust calls.

## Release records

`releases/<date>-<run-id>.json` in the main repo: what was published, versions, hashes, sizes, the approver and timestamps. Machine-readable, appended by the publish job, replaces the hand-written QA log of the old library. A short generated `CHANGELOG.md` per set repo is written from the same data.

## Adding assets with an agent

The agent workflow in a set repo is: drop masters into `assets/<id>/`, write `asset.yaml` (description, categories, subjects, colours, usage notes, provenance), run `tools validate && tools build --preview`, open a PR. CI repeats the checks and posts the preview. The owner looks at the contact sheet and merges. Everything after merge is the publisher.

For historical imports, the agent also writes the provenance record and adds the raw source to the sources archive (uploaded as a Release asset by `tools sources add`, which hashes it and updates `sources.yaml`).

## What stays manual, and why

- Approve: so that a broken build or an unwanted change never reaches npm, and because npm's own rules mean something must say "go".
- The 2FA window for new names: npm requires a human for package creation, by design, after the 2025 supply-chain incidents.
- Rights review of a new source: a legal judgement, not a build step.

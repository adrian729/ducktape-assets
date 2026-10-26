# ADR-006: all packages publish from one job in the main repo, gated by one environment approval

Status: proposed, 2026-10-26. Facts in [[Research/npm publishing automation]].

## Context

npm trusted publishing binds each package to a repo, a workflow filename and an optional environment. GitHub environment approval is granted per job. The owner wants one approval per batch, no stored secrets, and no passkey prompts except where npm forces one (package creation).

## Decision

- The main repo's `publish.yml` has a `plan` job (no secrets) and one `publish` job bound to the `release` environment with the owner as required reviewer.
- Every package (`ducktape-assets-<set>`, `-masters`, the index, the tooling) has its trust config pointing at `adrian729/ducktape-assets`, `publish.yml`, environment `release`, direct publish allowed.
- The publish job clones every changed set repo, rebuilds, publishes in a loop, publishes the index last, verifies on the CDN and writes a release record.
- New package names are bootstrapped in batches inside npm's 5-minute 2FA window with `npm trust … --yes`, roughly 80 names per tap.
- The publisher runs on manual dispatch only (decided 2026-10-26: no schedule, no emails); the agent that finished a batch triggers it, and if nothing changed, no approval is requested.

## Alternatives

- **Publish from each set repo** (what the old library did with a reusable workflow): one approval per set per batch and a trust config per repo. Rejected.
- **Release PR (changesets / release-please)**: merging is the approval and the diff is the preview, but it brings version-choosing machinery for packages whose versions are derived from content. Rejected for now; could be layered on if human changelogs are wanted.
- **Staged publishing with per-package approval**: one 2FA tap per package. Rejected.
- **A long-lived bypass-2FA token in CI**: npm caps write tokens at 90 days, so the owner would rotate secrets. Rejected except as a 7-day bootstrap tool that is deleted afterwards.

## Consequences

- The main repo is the only repo with a publishing workflow and the only one with an environment.
- Set repos never need secrets; public repos clone with no token.
- Attaching Release zips to set repos from the main repo needs a cross-repo token; this one optional step is listed in [[Open questions]].

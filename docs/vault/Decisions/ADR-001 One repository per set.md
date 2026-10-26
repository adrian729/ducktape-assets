# ADR-001: one repository and one package pair per curated set

Status: proposed, 2026-10-26.

## Context

medieval-ornaments packed designs first-in-first-out into numbered packages capped by bytes. Membership was accidental, consumers pinned package numbers, and every rollover needed a new package and a passkey. The owner asked for assets to be grouped by set, author or source in individual repos. Sets today number 75 (plus unassigned imports), nested two levels deep.

## Decision

One GitHub repo per set (`ducktape-assets-<set>`), one delivery package and one masters package per set, the set id in both names. A set is defined by origin (one source object, one authored campaign, one legacy import), with `group` for sub-structure. A set that exceeds the package guard stays one set and one repo; the publisher spreads its files over volume packages (`-part2`, `-part3`, sticky assignment, shared version) that consumers never see. Splitting into two sets happens only for curation reasons, named meaningfully, never by counter.

## Alternatives

- **One monorepo for everything.** Simplest orchestration and one publish job, but the git history would carry every master forever (already 1.7 GB of masters today, well past GitHub's 1 GB recommendation), and the owner explicitly wants per-set repos. Rejected for size and preference.
- **Per-set directories in a monorepo with masters in Releases.** Keeps git small, but masters would then live outside version control, which hurts review and reproducibility. Rejected.
- **Keep numbered byte-capped packages.** Rejected; it is the main structural mistake of the old library.

## Consequences

- About 40 repos after migration. Creation is automated and batched (GitHub rate-limits after ten).
- Cross-repo publishing is centralised in the main repo (see ADR-006) so the owner still approves once.
- Set CI uses a reusable workflow pinned to a tooling version; a tooling change is rolled out by PRs, not implicitly.
- The gallery and the index aggregate from many packages, which is cheap because each manifest is small and loaded on demand.

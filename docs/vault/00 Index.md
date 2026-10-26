# Ducktape Assets: design vault index

Start with [[Ducktape Assets]] (the owner's brief), then [[Design/Architecture]]. Everything is proposed as of 2026-10-26; nothing is implemented.

## Investigation (what exists)

- [[Investigation/medieval-ornaments]]: the predecessor, its mistakes ranked by cost, what to keep.
- [[Investigation/Importer dry run]]: Phase 0 result: measured set plan, wave 1 list, corrections, triage.
- [[Investigation/Encoding benchmark]]: Phase 0 result: AVIF rule, build times, determinism and thread count, masters sizes.
- [[Investigation/Consumers]]: how polyhymnia and elder-scrolls really use the assets, and the names the migration must cover.
- [[Investigation/Current asset inventory]]: bytes, counts, the encoding experiment.

## Research (what the free services allow)

- [[Research/npm publishing automation]]: trusted publishing, the 2FA window, one approval per batch.
- [[Research/Hosting and CDN]]: jsDelivr, GitHub, npm limits and image delivery practice.

## Design (what we will build)

- [[Design/Architecture]]: the system, components, flows, invariants.
- [[Design/Repository layout]]: repos, packages, naming, what a set is.
- [[Design/Metadata model]]: authored YAML, generated manifest, enumerations.
- [[Design/Image pipeline]]: formats, ladder, determinism, guards.
- [[Design/Delivery and consumption]]: URLs, the resolver, consumer patterns, performance targets.
- [[Design/Automation and publishing]]: workflows, bootstrap, idempotency, what stays manual.
- [[Design/CDN contingency]]: detection and the free fallbacks if jsDelivr, npm or GitHub refuse the project.
- [[Design/Migration]]: the importer (artwork plus draft metadata for review), set plan, the temporary migration map kept apart from everything, consumer moves.
- [[Design/Testing policy]]: the five places that get tests.
- [[Design/Roadmap]]: phases, starting with the spikes that settle the unknowns.

## Decisions

- [[Decisions/ADR-001 One repository per set]]
- [[Decisions/ADR-002 Masters in git, variants only on npm]]
- [[Decisions/ADR-003 Set-scoped identifiers]]
- [[Decisions/ADR-004 Authored versus generated metadata]]
- [[Decisions/ADR-005 AVIF first, WebP fallback, no PNG delivery]]
- [[Decisions/ADR-006 Centralised publisher with one approval per batch]]
- [[Decisions/ADR-007 No browser runtime, a build-time resolver instead]]

## Open

- [[Owner runbook]]: the few things only the owner does, with the command or page for each.
- [[Open questions]]: what the owner decides, what Phase 0 verifies.

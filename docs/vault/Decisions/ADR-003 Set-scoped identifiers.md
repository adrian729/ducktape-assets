# ADR-003: assets are identified as `<set>/<asset>`, permanently

Status: proposed, 2026-10-26.

## Context

The old library used one flat global namespace where the name was identity, file stem, import path and TypeScript literal, with suffix conventions hard-coded in a codec. Names reached 69 characters, set membership was repeated as a prefix, and renaming was impossible. Consumers invented their own short local names.

## Decision

- An asset id is `<set-id>/<asset-id>`, both kebab-case, each at most 48 characters. The short id is unique within its set.
- Ids never change. A rename or a move is a new id, with the old asset marked `deprecated` and `deprecated_by` pointing at the new one, and a migration record.
- Display `title` is a separate field and may change freely.
- File names in packages derive from the asset id and the rung width only; no suffix carries semantics except component ids declared in `asset.yaml`.

## Alternatives

- **Opaque ids (ULIDs) with names as metadata.** Maximally stable, but unreadable in URLs, markup and PRs. Rejected; readability matters more than the rare rename, which the deprecation path handles.
- **Global flat names as before.** Rejected.

## Consequences

- Consumers write `walters-w102/rabbit-church-bells`; the resolver splits on the slash.
- Migration strips redundant set prefixes from old names and records every mapping.

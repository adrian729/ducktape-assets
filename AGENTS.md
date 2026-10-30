# Ducktape Assets: rules for agents

Durable rules only. No release narrative, no logs. The design lives in `docs/vault/` (start at `docs/vault/00 Index.md`); read the relevant note before changing anything it covers.

## What this repository is

The main repository of the Ducktape Assets library: the design vault, the JSON Schemas, the tooling package, the set registry, the index package and the single publishing workflow. It never holds artwork. Artwork lives in one repository per set (`adrian729/ducktape-assets-<set>`).

## Invariants

- An asset id (`<set>/<asset>`) never changes and never moves between sets. A rename is a new id plus `deprecated_by` on the old one.
- A published version is never mutated. New bytes mean a new version.
- Authored data (`set.yaml`, `asset.yaml`) and generated data (`manifest.json`, catalog, index) never share a file. Nothing measurable is typed by hand.
- Every npm package stays under 120 MB unpacked. Large sets are spread over `-part<n>` volume packages by the publisher, never split into two sets for size.
- No secrets anywhere. Publishing is trusted publishing from `.github/workflows/publish.yml`, approved once per batch by the owner on the run page.
- The publisher runs on manual dispatch only. No schedules, no notification emails.
- Nothing paid, ever.

## How to work

- Add assets in the set repository, not here: masters plus `asset.yaml`, run `tools validate && tools build --preview`, open a PR.
- Markdown prose is never hard-wrapped: one paragraph or list item is one physical line.
- Tests go only in the five places named in `docs/vault/Design/Testing policy.md`.
- Prefer deleting over adding. The old library failed by accretion.

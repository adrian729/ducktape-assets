# Design: architecture

Status: proposed, 2026-10-26. This is the top-level picture. Details live in [[Repository layout]], [[Metadata model]], [[Image pipeline]], [[Delivery and consumption]], [[Automation and publishing]], [[Migration]], [[Testing policy]] and [[Roadmap]]. Choices are justified in `Decisions/`.

## Goals, in priority order

1. Browsers get the smallest adequate bytes, from an immutable cached URL, with no layout shift.
2. Consumers pick exactly the sets and assets they need, by stable name, and pin by version.
3. The owner's only recurring manual actions are: ask for assets to be added, merge, and click approve once per publish batch.
4. Everything is free: GitHub, GitHub Actions, npm, jsDelivr, GitHub Pages.
5. Metadata is complete enough that a page can be built, attributed and licensed without opening the repo.

## Non-goals

- A browser runtime or React components. Nobody used them. (The copy command is build-time vendoring and is a goal, not a non-goal: see [[Delivery and consumption]].)
- Serving native-resolution masters to browsers.
- On-the-fly image transformation services. Every variant is pre-built in CI.
- Hosting the gallery in the main repo.

## The system in one picture

```
                 ┌──────────────────────── ducktape-assets (main repo) ─────────────────────────┐
                 │ vault/ (this)   schemas/   tools/ (CLI: validate, build, plan, publish)       │
                 │ index/ (@ranx729/ducktape-assets: index.json + catalog.json + resolver)       │
                 │ .github/workflows/publish.yml  (ONE env-gated job, all packages)              │
                 └───────────────┬───────────────────────────────────────────────┬──────────────┘
                                 │ scans set repos on manual dispatch             │ publishes
     ┌───────────────────────────▼──────────────┐                                ▼
     │ ducktape-assets-<set>  (one repo per set)│                      npm registry (@ranx729/…)
     │ set.yaml  assets/<id>/asset.yaml+master  │        ┌─ ducktape-assets-<set>          (AVIF/WebP ladders + manifest.json)
     │ provenance/  CI: validate + preview      │        ├─ ducktape-assets-<set>-masters  (capped lossless masters, build-time use)
     │ Releases: sources archive (cold storage) │        └─ ducktape-assets                (index + resolver)
     └──────────────────────────────────────────┘                                │
                                                                                  ▼
                                                                    cdn.jsdelivr.net/npm/@ranx729/…@x.y.z/…
                                                                                  │
                           ┌──────────────────────────────┬───────────────────────┴──────────────┐
                           ▼                              ▼                                      ▼
                 ducktape-assets-gallery         polyhymnia (build-time:              plain HTML pages (CDN URLs
                 (GitHub Pages, consumes          masters pkg + manifest →             from the resolver or copied
                  CDN exactly like a consumer)    vite-imagetools)                     from the gallery snippet)
```

## Components

### Set repositories (`adrian729/ducktape-assets-<set>`)

The unit of curation, storage, versioning and licensing. One repo holds one set's authored metadata, masters and provenance. It never holds generated variants. Its CI validates metadata and builds a preview on every PR, and does nothing on merge except mark the commit as buildable. It does not publish. Repos are created from a template repo by the tooling (`tools new-set <id>`), which also registers the set in the main repo's registry. Details in [[Repository layout]].

Why one repo per set rather than one monorepo: the owner asked for it, each repo stays small (tens to a few hundred MB of masters), history and licensing stay isolated, and sets can be archived or handed over independently. The cost is cross-repo orchestration, which the main repo's publisher absorbs. See [[Decisions/ADR-001 One repository per set]].

### Main repository (`adrian729/ducktape-assets`)

Holds this vault, the JSON Schemas, the tooling package, the set registry (`sets.yaml`: id, repo, status, licence summary), the single publishing workflow, and the index package with its generated `README.md`, `AGENTS.md`, `index.json`, `catalog.json` and per-set manifest copies, which together are the one place to look for any asset. It holds no artwork, ever. (The temporary `migration/` directory lived here, apart from everything else, until its deletion on 2026-10-30; see [[Migration]].)

### Tooling (`@ranx729/ducktape-assets-tools`, in `tools/`)

A Node CLI used by CI in all repos and by agents locally. Commands: `validate` (schemas, vocabularies, master integrity, id rules), `build` (variants, thumbhash, palette, manifest), `preview` (static HTML contact sheet for a PR), `plan` (hash every buildable set, compare with the registry, print the publish table), `publish` (idempotent loop), `new-set`, `import` (the migration importer from medieval-ornaments). Uses `sharp` for all raster work and `svgo` for hand-made vectors. Deterministic output is a requirement: same inputs produce byte-identical outputs, so content hashes are meaningful.

### Publisher (main repo `publish.yml`)

Runs on manual dispatch only, triggered by the owner or by the agent that finished a batch. The plan job checks out every registered set repo at its default branch, builds, hashes, compares with what the registry holds, and writes the table of what would be published (set, old version, new version, added/changed/removed assets, package size) into the job summary. The publish job references the `release` environment with the owner as required reviewer, rebuilds, publishes every changed set package and masters package via trusted publishing, then publishes the index package last with the new pins. One click per batch, no secrets stored anywhere. See [[Automation and publishing]].

### Index package (`@ranx729/ducktape-assets`)

Tiny. Ships `index.json` (sets, versions, package names, CDN bases, hashes, licences), `catalog.json` (descriptive fields of all assets, for search), and a resolver module with no dependencies: given `set/asset`, a wanted width or height, formats and DPR, it returns `{ src, srcset, sizes, width, height, thumbhash, alt }` ready for `<img>` or `<picture>`. The resolver loads a set's `manifest.json` on demand (from the CDN in the browser, from `node_modules` at build time). See [[Delivery and consumption]].

### Delivery (jsDelivr over npm)

Every published file is reachable at `https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-<set>@<version>/<path>`. Exact-version URLs are immutable and cached for a year at the edge and permanently in origin storage. No purging, no warming loops beyond a bounded post-publish verification. If jsDelivr or npm ever refuse the project, [[CDN contingency]] moves the same files to Cloudflare Workers Static Assets, fed from npm tarballs or from the Release zips; `/gh/` is never the fallback because it shares jsDelivr's terms. See [[Research/Hosting and CDN]].

### Gallery (`adrian729/ducktape-assets-gallery`)

A static site on GitHub Pages that consumes the index package and the CDN exactly like any consumer. It loads `catalog.json` for search and each set's manifest lazily, shows thumbhash placeholders, then AVIF/WebP thumbnails from the CDN, and prints the exact `<picture>` markup and resolver call for any asset. It is the integration test of the public contract. Out of scope for this design round beyond this paragraph.

## Data flow for "add a new asset"

1. Owner (or an agent on their behalf) adds `assets/<id>/asset.yaml` and `assets/<id>/master.png` to the set repo in a PR, with provenance if the source is historical.
2. Set CI validates, builds variants into a temporary directory, posts a contact sheet preview as a PR artifact or Pages preview, and reports sizes.
3. Owner merges.
4. The next publisher run picks it up, shows it in the plan table, and waits for approval.
5. Owner approves once. Set package, masters package and index are published. The gallery redeploys on the index package's release event.

## Data flow for "use an asset"

- **Plain page:** copy the `<picture>` snippet from the gallery, or call the resolver at build time. URLs are pinned to a version; nothing changes under the page.
- **Vite/React app (polyhymnia):** list the wanted assets in `ducktape.json` with `masters: true`, run the copy command, which fetches only those masters from the CDN and writes a local manifest with dimensions and geometry, then feed the capped lossless masters to `vite-imagetools`. Or list widths instead of masters and skip re-encoding. No image bytes ever land in `node_modules`; see [[Delivery and consumption]].
- **Offline / self-hosted:** `tools copy <set>/<asset>… --out public/assets` writes the chosen variants and a trimmed manifest; the resolver takes a `base` option.

## Invariants

- An asset id never changes and never moves between sets. Renames and moves are new ids plus a migration record and a `deprecated_by` pointer on the old one.
- A published version is never mutated. New bytes mean a new version.
- Every delivered file has a recorded width, height, byte count and SHA-256.
- Everything consumers need is in generated files; nothing requires reading YAML or git.
- Every npm package stays under 120 MB unpacked (warn at 100, fail at 120 in `build`) so that jsDelivr's 150 MB limit is never approached. A set that grows past it is spread over sticky `-part<n>` volume packages by the publisher; it is never split into two sets for size.
- No step after "merge" and "approve" needs a human, and no step needs a stored secret.

## Risks and their mitigations

- **jsDelivr changes terms or dies.** Files are also in the npm registry and in each set's GitHub Release zip. [[CDN contingency]] has the detection and the switch; consumers on the copy flow never notice.
- **npm tightens publishing further.** Trusted publishing is their recommended path; package creation is the only step that touches 2FA and it is batched.
- **GitHub rate-limits repo creation.** Sets are created a few at a time by the tooling with backoff; the migration creates its 30-odd repos over several runs.
- **Set repos grow with master edits.** Masters are edited rarely; the template repo documents that replacing a master is a new asset id when the pixels change meaningfully.
- **Agents over-build.** The tooling is small by design and [[Testing policy]] limits tests to five places.

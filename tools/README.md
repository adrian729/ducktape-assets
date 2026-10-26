# @ranx729/ducktape-assets-tools

CLI for the Ducktape Assets library. Node >= 22.14, ESM, no build step.

```
npm install
node src/cli.mjs <command> ...
```

## Commands

| Command | Options | What it does |
| --- | --- | --- |
| `validate [set-repo-dir]` | | Schemas, vocabularies, ids, masters, provenance, licence. Exit 1 on problems. |
| `build <set-repo-dir>` | `--out <dir>` (required) | Validates first and refuses on problems, then writes the delivery tree (`avif/ webp/ svg/ tiles/ frames/ manifest.json`) and the masters tree (`masters/`) into `<dir>`. The directory is wiped first. |
| | `--preview` | Also writes `preview.html`: a static contact sheet (thumbhash placeholder, 256 px WebP, title, type, dimensions, AVIF decision, ladder bytes). No scripts. |
| | `--version x.y.z` | Version written to the manifest and the CDN URL (default `0.0.0`). |
| | `--previous <manifest.json>` | Previous manifest; keeps every file in its volume package (`-part<n>`) and fills the newest part with new files. |
| | `--include-drafts` | Also build assets with `status: draft` (previews, set CI). Without it drafts are skipped entirely: no files, not in the manifest, and not part of `inputsHash`; the manifest lists their ids in `drafts`. |
| | `--jobs <n>` | Assets built in parallel (default `os.availableParallelism()`). Each encode is single-threaded (`sharp.concurrency(1)`). |

## Encoding settings (pinned, hashed into `inputsHash`)

| Output | Settings |
| --- | --- |
| WebP ladder | lossy q82, alphaQuality 100, effort 4 at every rung |
| AVIF ladder | q60, effort 6 at or below 256 px, 4 above; kept only if the top rung is <= 0.85 x WebP |
| Ladder widths | 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048, capped at the master width, plus the native width when under 2048; never upscaled |
| Masters tree | lossless WebP, 2048 px long side cap, exact alpha, effort 6 (hand-made SVG masters are copied as `.svg`) |
| Tile / frame | `render.tile`: 90 degree rotated ladder in `tiles/`; `render.frame`: nine-slice atlas ladder in `frames/` (composition rule in `src/compose.mjs`) |
| Size guard | warn above 100 MB, fail above 120 MB per package, naming the largest assets |

SVG optimisation with svgo is still a TODO (`src/build.mjs`); SVGs are copied through and rasterised at 2048 px for the ladder.

## Publisher commands

Used by `.github/workflows/publish.yml`; all take the cache directory (`--cache`, default `.ducktape-cache`) that the workflow persists between the plan and publish jobs.

| Command | Options | What it does |
| --- | --- | --- |
| `plan` | `--sets a,b` (default every active set), `--sets-file sets.yaml`, `--cache dir`, `--output plan.json`, `--summary file` (appended; `$GITHUB_STEP_SUMMARY`), `--index index` | For each active set in `sets.yaml`: shallow clone or update into `<cache>/repos/<set>` (a `repo` that is a local path is cloned too, for tests), validate (a failing set is excluded with its reason), compute the `inputsHash` without building, compare with `ducktape.inputsHash` of the latest published version. Unchanged sets stop there. Changed sets are built into `<cache>/build/<set>` (with the published manifest as `--previous`, so volume assignment stays sticky), the next version is derived from the diff against the published manifest (new set 1.0.0; removed or deprecated asset or removed file: major; added asset or variant: minor; anything else: patch), and the packages are laid out in `<cache>/stage/<set>/`. Writes `$GITHUB_OUTPUT` `packages=[names]` when set. A set with no non-draft assets is excluded (reason "no approved assets"). The summary table has a `drafts` column. Exits 0 with an empty package list when nothing changed. |
| `publish` | `--plan plan.json`, `--cache dir`, `--record releases`, `--index index`, `--dry-run` | `npm publish --access public` for each package of the plan in order ("already published" is success), then regenerates the index package (`generateIndex` over every registered set's manifest: built ones from the cache, others from `index/sets/` or the registry; previous `index/index.json`), writes it into `index/` with the planned version and publishes it last. Writes `releases/<date>-<run-id>.json` (also when it fails midway, with `error`). `--dry-run` runs `npm publish --dry-run` and generates the index in `<cache>/stage/index-dry`, leaving `index/` untouched. Missing staged packages are rebuilt from the cached clone and checked against the planned `inputsHash`. |
| `check-cdn` | `--plan plan.json` (default: every pinned package of `index/index.json` and the index package), `--record releases`, `--retries 6`, `--delay 10` (seconds) | Fetches `manifest.json` (delivery packages) or `package.json` (parts, masters, index) from `https://cdn.jsdelivr.net/npm/<pkg>@<version>/`, compares `inputsHash` and `contentHash`, prints a table, appends `cdn: {...}` to this run's release record. Exit 1 on any failure. A 403 on some packages is level 0, a 403 on every package (two or more checked) is level 1 (see `docs/vault/Design/CDN contingency.md`). |

### Package layout (`src/pack.mjs`)

`<cache>/stage/<set>/delivery` (`manifest.json`, `LICENSE.md`, files without `package`), `part2`, `part3`, `masters` (`manifest.json`, `LICENSE.md`, `masters/`), `masters-part2`. Every `package.json` has name, version, license, description, `files`, `repository`, `publishConfig.access`, and `ducktape: { set, part?, kind, inputsHash, contentHash, schema: 1 }`. `repository` is the publishing repo (npm checks it against the trusted-publishing repo); the set repo is `homepage`.

### plan.json

```json
{
  "schema": 1,
  "generatedAt": "2026-11-02T10:00:00.000Z",
  "publishRepo": "adrian729/ducktape-assets",
  "sets": [{
    "set": "fixture-set", "repo": "adrian729/ducktape-assets-fixture-set", "commit": "<sha>",
    "current": null, "next": "1.0.0", "bump": "new | patch | minor | major",
    "added": ["asset-id"], "changed": [], "removed": [], "deprecated": [], "drafts": [],
    "inputsHash": "sha256:...", "contentHash": "sha256:...",
    "deliveryBytes": 0, "mastersBytes": 0, "deliveryPackages": 1, "mastersPackages": 1, "warnings": []
  }],
  "packages": [
    { "name": "@ranx729/ducktape-assets-fixture-set", "version": "1.0.0", "set": "fixture-set", "kind": "delivery | delivery-part | masters | masters-part", "part": null, "dir": "stage/fixture-set/delivery", "inputsHash": "sha256:...", "contentHash": "sha256:...", "bytes": 0, "files": 0 },
    { "name": "@ranx729/ducktape-assets", "version": "1.0.0", "set": null, "kind": "index", "part": null, "dir": null, "inputsHash": null, "contentHash": null, "bytes": null, "files": null }
  ],
  "unchanged": ["set-ids"],
  "excluded": [{ "set": "id", "reason": "validation failed: ..." }],
  "bootstrapNeeded": ["package names that answer E404 on the registry"],
  "pins": { "fixture-set": "1.0.0" },
  "index": { "package": "@ranx729/ducktape-assets", "current": null, "next": "1.0.0" }
}
```

`packages` is in publish order (every set's delivery, its parts, masters, its parts; the index last) and `dir` is relative to the cache. The index is bumped minor whenever any set changes (0.0.0, the placeholder, goes to 1.0.0). The registry client (`src/registry.mjs`) is injectable in `planSets`, `publishPlan` and `checkCdn` (fake registry, fake `fetch`), which is how `test/plan.test.mjs` runs without network.

## Tests

`npm test` runs `test/ladder.test.mjs` (ladder, manifest, volume assignment) and `test/determinism.test.mjs`, plus the validator tests. `test/plan.test.mjs` covers publish planning (version classification, skipping unchanged sets, packaging, dry-run publish with a fake registry, check-cdn with a fake fetch).

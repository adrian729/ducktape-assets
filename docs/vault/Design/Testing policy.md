# Design: testing policy

Status: proposed, 2026-10-26. The owner's rule: tests only where they are really needed, and well thought. The old library had 33 unit tests, a 420-line browser integration suite, no CI to run them, and tests that read 6.8 GB of local state. This policy is the opposite.

## Principle

Most correctness in this system is **validation of data**, not testing of code. A schema check, a hash comparison and a size guard run on every build and fail loudly. Those are not tests and do not need test files. Unit tests exist only for logic whose failure would be silent and would reach consumers.

## The five places that get tests

1. **Resolver output** (`index/`): given a fixture manifest, `resolve('set/asset', { width: 300, dpr: 2 })` returns the expected `src`, `srcset`, `sizes`, `width`, `height`. Covers rung selection (never upscale, pick the smallest adequate rung, fall back to the top rung), format preference, `base` override, and geometry for `tile` and `frame`. One file, table-driven, about a dozen cases. Silent failure mode it prevents: a consumer gets a blurry or oversized image with no error.
2. **Ladder and manifest generation** (`tools/`): for three tiny synthetic masters (a 50 px, a 700 px and a 3000 px PNG, one with alpha), the build produces exactly the expected set of rungs, dimensions, `transparent` flag and a stable thumbhash. Runs in CI in a few seconds. Silent failure mode: a tooling change alters rungs or hashes across every set.
3. **Determinism** (`tools/`): building the same synthetic master twice yields byte-identical outputs and the same `contentHash`. Silent failure mode: every publisher run republishes every set.
4. **Publish planning** (`tools/`): with a mocked registry, `plan` classifies added/changed/removed assets into patch/minor/major and skips unchanged packages; `publish` treats "already published" as success and publishes the index last. Silent failure mode: a wrong version bump or a double publish.
5. **Migration map completeness** (`tools/test/import.test.mjs`, on a synthetic old catalog): every old design and component name in the frozen `images.json` snapshot has exactly one entry, every `new.id` exists in a set plan, and every `moved` entry's `masterSha256` matches a master in the target set. Ran for real during the import and stays as a regression guard on the importer; the `migration/` directory itself was deleted on 2026-10-30. Silent failure mode: an old name silently disappears.

Note (2026-10-26): the volume-package assignment (sticky parts, never over the limit) is tested inside the ladder-and-manifest place, `tools/test/ladder.test.mjs`, since it is part of manifest generation; it is not a sixth place.

## What is explicitly not tested with test files

- Schema validity of authored YAML: `validate` in CI is the check.
- Image quality: the PR preview contact sheet is the check; a human looks.
- CDN availability: the post-publish verification step is the check, recorded in the release record.
- React, SSR, browser behaviour: there is no runtime to test. The gallery is the living integration check.
- The CLI's argument parsing, logging, help text.

## Rules for agents adding tests

- A new test must name the silent failure it prevents in its description. If the failure would already surface as a validation error or a build failure, do not add the test.
- Tests use fixtures under 100 KB committed to the repo. No test reads another repo, the network, or the registry.
- The whole suite runs in under 30 seconds on a free runner.
- One test file per place above. No new places without a note in this document.

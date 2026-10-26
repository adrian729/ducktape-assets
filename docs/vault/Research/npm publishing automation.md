# Research: publishing many npm packages with one approval

Researched 2026-10-26. Legend: **V** verified from a primary doc, **R** reported by a secondary source, **I** inference. Re-check the V items before implementation; npm changed its rules three times in the last year.

## The 2026 npm security baseline

- **V** Classic tokens are gone (creation disabled 2025-11-05, revoked 2025-11-19). Granular write tokens live at most 90 days (default 7), cover at most 50 packages, and need 2FA unless "Bypass 2FA" is ticked. `npm login` sessions last 2 hours. **Direct publishing with granular tokens is removed in January 2027** ([about access tokens](https://docs.npmjs.com/about-access-tokens)); after that CI can publish only through trusted publishing. Sources: [npm security update](https://github.blog/changelog/2025-11-05-npm-security-update-classic-token-creation-disabled-and-granular-token-changes/).
- **V** Trusted publishing (OIDC) from GitHub Actions needs npm >= 11.5.1 and Node >= 22.14, GitHub-hosted runners only. No secret, no OTP prompt. The "Require 2FA and disallow tokens" package setting does not block it. Provenance is attached automatically when both repo and package are public. Source: [docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers).
- **V** A trust config is **per package**: owner, repo, workflow filename (case-sensitive, in `.github/workflows/`), optional environment. No org-wide or user-wide trust exists. Configs cannot be edited, only revoked and recreated. npm does not validate on save; a mismatch fails at publish time with `ENEEDAUTH`. `package.json` `repository.url` must match the GitHub repo exactly.
- **V** Reusable workflows: the check uses the **calling** workflow's filename. `id-token: write` is needed in both caller and callee. Keep one top-level `publish.yml` per repository that does the publishing.
- **V** Per-action permissions: a trust config allows `npm publish` and/or `npm stage publish`. Configs created after 2026-09-03 default to stage-only, so `--allow-publish` must be set explicitly. Source: [npm-trust](https://docs.npmjs.com/cli/v11/commands/npm-trust).
- **V** Staged publishing (2026-05): CI stages, a human approves each stage id with 2FA. No batch approval is documented. **I** This is one tap per package, exactly the pain to avoid. Do not rely on it for N packages. Source: [staged publishing](https://docs.npmjs.com/staged-publishing).

## Bootstrapping a brand-new package name

- **V** `npm trust` requires the package to already exist on the registry. A new trust config must complete a successful publish within 2 days or it expires.
- **V** Bulk `npm trust` (npm >= 11.10) loops with `--yes`. The first call prompts for 2FA, then npmjs.com offers "skip 2FA for 5 minutes", which covers about 80 packages with a 2-second sleep between calls. Bypass-2FA tokens do not work for `npm trust`. Source: [bulk trusted publishing config](https://github.blog/changelog/2026-02-18-npm-bulk-trusted-publishing-config-and-script-security-now-generally-available/).
- **V/conflict** The docs say `npm stage publish` of a non-existent name creates a public `0.0.0-stage` placeholder. One secondary source says new names cannot be staged. Test with one name before relying on it.

Net effect: creating a new set package costs the owner **one passkey tap per batch of up to ~80 new names**, once in the package's lifetime. Everything after that is OIDC with zero prompts. Options for the placeholder publish, best first:

1. `npm stage publish` from CI, if it works for new names.
2. A 7-day granular bypass-2FA token scoped to `@ranx729`, stored as an environment secret, used by a `bootstrap` workflow that publishes `0.0.0` placeholders for names missing from the registry, then revoked.
3. Local `npm publish` of placeholders inside one 2FA-skip window, same session as the `npm trust` loop.

## One approval per batch

- **V** Environment "required reviewers" are free for public repos. Private repos need Enterprise. Switching a repo to private disables the rule. Source: [manage environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- **I** Approval is granted per **job** that references the environment. All publishes must happen in one job (a loop, not a matrix) to get one click.
- **V** A run can wait up to 35 days for approval; a job runs at most 6 hours. Source: [Actions limits](https://docs.github.com/en/actions/reference/limits).

Ranked patterns:

1. **Plan job plus one environment-gated publish job.** The plan job (no environment, no `id-token`) builds, hashes every package, compares with the registry and writes a table to the job summary. The publish job waits for the owner's single approval, rebuilds and loops over changed packages. Best fit.
2. Release PR (changesets or release-please): merging is the approval, the diff is the preview. Adds changelog machinery we do not need for asset snapshots. The changesets action README recommends its sub-actions with trusted publishing.
3. `workflow_dispatch` with inputs: no gate by itself.
4. Label or issue approval: custom and brittle.

Reference `publish.yml` shape:

```yaml
name: publish                      # .github/workflows/publish.yml, bound in every trust config
on:
  workflow_dispatch:
  push: { branches: [main] }
permissions: { contents: read }
jobs:
  plan:
    runs-on: ubuntu-latest
    outputs: { packages: ${{ steps.p.outputs.list }} }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci && npm run build
      - id: p
        run: node scripts/plan.mjs      # hash tarballs, compare with `npm view <pkg> contentHash`, write $GITHUB_STEP_SUMMARY
  publish:
    needs: plan
    if: needs.plan.outputs.packages != '[]'
    runs-on: ubuntu-latest
    environment: release               # required reviewer = owner
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, registry-url: 'https://registry.npmjs.org' }
      - run: npm ci && npm run build
      - run: node scripts/publish.mjs   # skip unchanged, publish changed, index package last, "already published" = success
```

The build runs twice because the free artifact quota is small (500 MB on the Free plan; the public-repo figure is unverified).

## Idempotent, retryable publishing

- **I** Per package: compute a content hash over sorted file paths plus bytes (excluding the version field), store it as `contentHash` in the published `package.json`, and compare with `npm view <name>@latest contentHash` (`E404` means new). Publish only on change. Treat "cannot publish over previously published version" as success. Publish the small index package last, pinning exact set versions.
- **I** Custom script over npm workspaces beats changesets, release-please and lerna-lite for content-snapshot packages. Use `npm publish --dry-run` and `npm pack --json` to preview.
- **V** `publishConfig.access: public` is required for the first publish of a scoped package. A `files` allowlist is preferred over `.npmignore`.

## jsDelivr facts relevant to publishing

- **V** Packages over 150 MB are unsupported by default; the limit can be raised by opening an issue. A 20 MB per-file limit is stated for the GitHub endpoint; no per-file limit is stated for npm. New npm versions are available immediately. Exact-version URLs are cached 1 year (and permanently in S3); aliases like `@latest` or ranges are cached 7 days; branches 12 hours. Purge works only on alias URLs and is rate-limited. Source: [jsdelivr README](https://github.com/jsdelivr/jsdelivr).
- **I** Pin exact versions in the index and never purge. Warm-up fetches after publish only improve first-request latency and should be optional and bounded.
- **unverified** npm's maximum tarball size. **I** npm does not deduplicate bytes across versions, so hash-gated publishing and per-set packages are what keep registry growth and republishing down.

## GitHub Actions free limits (public repos)

**V** from [usage limits](https://docs.github.com/en/actions/concepts/overview/usage-limits-billing-and-administration) and [limits](https://docs.github.com/en/actions/reference/limits): hosted standard runners are free for public repos; 6 h per job; 35 days per run; 20 concurrent jobs; 256-job matrix cap; 10 GB cache per repo; 500 MB artifact quota on Free. **I** Cache `node_modules` and a derivative cache keyed by source hashes; build and publish in the same job; shard image work per set.

## GitHub Packages npm registry

**V** Installing even public packages needs a token, so jsDelivr cannot read it. Not an option. Source: [working with the npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## Reference architectures

- **Lucide** (V, from its `release.yml`): pnpm monorepo, SVG sources with per-icon JSON metadata, a `v*` tag triggers a matrix of 11 packages, `pnpm publish --access public` with `id-token: write` and `NPM_CONFIG_PROVENANCE`, no token, no environment gate, lockstep versions, then a GitHub release with zips.
- **simple-icons** (R): weekly scheduled workflow opens a release PR; merging triggers npm publish and a GitHub release; a PAT or App token is used because `GITHUB_TOKEN` events do not trigger workflows. Data is one JSON file plus one SVG per brand.
- Tabler, heroicons, OpenMoji, game-icons: not researched.

## Gaps to close during implementation

- npm tarball cap.
- Whether `npm stage publish` works for a brand-new name.
- Whether a matrix needs one approval per leg (we avoid the question by looping in one job).
- Public-repo artifact quota.

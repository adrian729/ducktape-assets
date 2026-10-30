// Generates the index package's data and docs from the published manifests of every set.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileUrl } from './urls.mjs';

const REPO = 'https://github.com/adrian729';

// `cdnTemplate` (CDN contingency, level 1) replaces the jsDelivr bases with a host that folds a set's packages into
// one tree: `<set>` and `<version>` are substituted, and masters share the base.
export function indexEntry(manifest, { status = 'active', cdnTemplate } = {}) {
  const cdn = cdnTemplate ? cdnTemplate.replaceAll('<set>', manifest.set).replaceAll('<version>', manifest.version) : manifest.cdn;
  const mastersCdn = cdnTemplate ? cdn : manifest.cdn.replace(`${manifest.package}@`, `${manifest.mastersPackage}@`);
  return {
    version: manifest.version,
    package: manifest.package,
    parts: manifest.parts ?? [],
    mastersPackage: manifest.mastersPackage,
    mastersParts: manifest.mastersParts ?? [],
    cdn,
    mastersCdn,
    assets: Object.keys(manifest.assets).length,
    license: { artwork: manifest.license.artwork },
    contentHash: manifest.contentHash,
    status,
  };
}

function ladderUrls(entry, setId, ladder) {
  const out = {};
  for (const [fmt, v] of Object.entries(ladder ?? {})) {
    out[fmt] = Array.isArray(v)
      ? Object.fromEntries([...v].sort((a, b) => a.w - b.w).map((f) => [f.w, fileUrl(entry, f, { setId })]))
      : fileUrl(entry, v, { setId });
  }
  return out;
}

const DESCRIPTIVE = ['title', 'description', 'type', 'categories', 'subjects', 'colors', 'facing', 'view', 'composition', 'period', 'region', 'style', 'group', 'status', 'usage_notes', 'display_width'];
const MEASURED = ['width', 'height', 'transparent', 'palette', 'thumbhash', 'resolutionLimited'];

export function catalogEntry(setId, manifest, entry, assetId, asset) {
  const e = { id: `${setId}/${assetId}`, set: setId, asset: assetId };
  for (const k of [...DESCRIPTIVE, ...MEASURED]) if (asset[k] !== undefined && asset[k] !== null) e[k] = asset[k];
  const r = asset.render ?? {};
  e.render = {};
  if (r.image) e.render.image = {};
  if (r.tile) e.render.tile = { axis: r.tile.axis, period: r.tile.period };
  if (r.frame) e.render.frame = { corner: r.frame.corner, slice: r.frame.slice };
  e.license = asset.license ?? manifest.license.artwork;
  e.attribution = asset.attribution ?? manifest.attribution ?? '';
  e.urls = ladderUrls(entry, setId, asset.sources);
  if (r.tile?.rotated) e.urls.rotated = ladderUrls(entry, setId, r.tile.rotated);
  if (r.frame?.atlas) e.urls.atlas = ladderUrls(entry, setId, r.frame.atlas);
  return e;
}

/**
 * @param {object} o
 * @param {Array<{setId: string, manifest: object, status?: string, repo?: string}>} o.manifests  Every set; the catalog is rebuilt from scratch.
 * @param {object} [o.previous]  Previous index.json: its generatedAt is kept when the sets did not change.
 * @param {string} [o.generatedAt]
 * @returns {{index, catalog, sets, readme, agents}}
 */
export function generateIndex({ manifests, previous, generatedAt, cdnTemplate } = {}) {
  const list = [...manifests].sort((a, b) => a.setId.localeCompare(b.setId));
  const sets = {};
  const entries = {};
  for (const { setId, manifest, status } of list) {
    sets[setId] = indexEntry(manifest, { status, cdnTemplate });
    entries[setId] = manifest;
  }
  const unchanged = previous && JSON.stringify(previous.sets) === JSON.stringify(sets);
  const stamp = unchanged ? previous.generatedAt : generatedAt ?? new Date().toISOString();
  const index = { schema: 1, generatedAt: stamp, sets };
  const assets = list.flatMap(({ setId, manifest }) =>
    Object.entries(manifest.assets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([assetId, asset]) => catalogEntry(setId, manifest, sets[setId], assetId, asset)),
  );
  const catalog = { schema: 1, generatedAt: stamp, assets };
  const setFiles = Object.fromEntries(list.map(({ setId, manifest }) => [setId, manifest]));
  return { index, catalog, sets: setFiles, readme: readme(list), agents: agents(list) };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function table(list) {
  const rows = list.map(({ setId, manifest, repo }) => {
    const r = repo ?? `${REPO}/ducktape-assets-${setId}`;
    return `| \`${setId}\` | ${cell(manifest.title)} | ${cell(manifest.summary)} | ${Object.keys(manifest.assets).length} | ${cell(manifest.license.artwork)} | [repo](${r}) |`;
  });
  return ['| Set | Title | Summary | Assets | Licence | Repo |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
}

const FLOWS = `1. **Paste a URL.** Any HTML, CSS or Markdown references one file on jsDelivr, for example \`https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-walters-w102@1.2.0/webp/rabbit-church-bells-512.webp\`. Only that file is transferred. \`catalog.json\` lists the exact URL of every width and format, so nothing has to be guessed.
2. **Pick and copy.** Keep a small \`ducktape.json\` listing the asset ids you want, with optional widths, formats and \`masters: true\`. \`npx @ranx729/ducktape-assets copy\` fetches exactly those files into the project (default \`src/assets/ducktape/\`), verifies every SHA-256 against the manifest, and writes \`ducktape.manifest.json\` beside them with type, dimensions (native and of the capped master), transparency, render geometry (tile axis, frame slice), thumbhash, licence and attribution per asset. \`masters: true\` alone copies only the lossless master (for apps that encode their own images); add \`formats\`, \`widths\` or \`max\` to copy ladder files as well. Re-running is idempotent.
3. **Resolve in code.** \`npm i @ranx729/ducktape-assets\` installs metadata and a resolver, zero images. \`assets.image(id, { width })\` returns \`src\`, \`srcset\`, \`sizes\`, width, height, thumbhash, \`license\`, \`attribution\` (the bare credit, licence kept separate), \`set\` / \`package\` / \`version\` (where the bytes come from), and \`file\` / \`files\` (path, bytes and sha256 of every referenced rung, for scripts that record or verify what they use). Bytes come from the CDN at request time, or from flow 2 when \`base\` points at the copied directory.

Build-time recipe in Node, offline, no network:

\`\`\`js
import { createNodeResolver } from '@ranx729/ducktape-assets/node';
const assets = await createNodeResolver({ formats: ['webp'] });
const img = await assets.image('walters-w102/rabbit-church-bells', { width: 256, dpr: 1 });
// img.src is the smallest rung at or above 256 px (never upscaled); img.file.sha256 and img.file.bytes are the publisher's.
// For an exact 2x pick ask for width 512 with dpr 1; the default dpr 3 returns the whole range for a srcset.
\`\`\``;

const CONFIG = `\`\`\`json
{
  "pin": "@ranx729/ducktape-assets@3.4.0",
  "out": "src/assets/ducktape",
  "assets": [
    "walters-w102/rabbit-church-bells",
    { "id": "numbered-plate/stepped-ribbon", "formats": ["avif", "webp"], "max": 1024 },
    { "id": "illuminated-acanthus/divider-center", "masters": true }
  ]
}
\`\`\``;

const URLS = `\`https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-<set>@<version>/<format>/<asset>-<w>.<ext>\`

Exact-version URLs are immutable and cached for a year. Large sets are split into volume packages (\`…-<set>-part2\`); the catalog, the resolver and the copy command emit the right URL, so a consumer never notices the split.`;

function readme(list) {
  return `# Ducktape Assets

Find an asset here, use it in under a minute. This package is metadata and a build-time resolver: it never contains an image. It is generated; do not edit it by hand.

## Three ways to use an asset

${FLOWS}

\`ducktape.json\`:

${CONFIG}

## URLs

${URLS}

## Files

- \`catalog.json\`: every asset with id, title, description, type, categories, subjects, colours, size, render capabilities, thumbhash, licence, attribution and the exact URL of each width and format.
- \`sets/<set>.json\`: the published manifest of each set (hashes, bytes, components, volume packages).
- \`index.json\`: the pinned version, packages and CDN base of each set.

## Sets

${table(list)}
`;
}

function agents(list) {
  return `# Ducktape Assets for agents

Generated. Use these rules; do not edit this file by hand.

## Finding an asset

- Search \`catalog.json\` (one grep finds an asset and its URL). Ids are \`<set>/<asset>\`.
- Read \`sets/<set>.json\` only for what the catalog leaves out (hashes, bytes, components, parts).

## Using an asset

${FLOWS}

Prefer flow 2 for anything that must survive unattended: copied files do not depend on any host.

\`ducktape.json\`:

${CONFIG}

## URLs

${URLS}

## Rules

- Honour the licence block: show the \`attribution\` credit together with \`license\` (SPDX id) when the licence requires it; \`attribution\` is the institution and object for historical sets, or the author for authored and imported ones, and never contains the licence.
- Never use \`@latest\` or range URLs; always an exact version from \`index.json\` or \`catalog.json\`.
- Never put a master on a page. Masters are for re-encoding in a build.
- Images are decorative by default (\`alt=""\`); use \`description\` when the image carries meaning.
- Always set the \`width\` and \`height\` attributes; the resolver returns them.

## Sets

${table(list)}
`;
}

/** Write the generated files of a generateIndex() result into `dir`. */
export async function writeIndex(dir, { index, catalog, sets, readme, agents }) {
  const json = (v) => JSON.stringify(v, null, 2) + '\n';
  await mkdir(join(dir, 'sets'), { recursive: true });
  await Promise.all([
    writeFile(join(dir, 'index.json'), json(index)),
    writeFile(join(dir, 'catalog.json'), json(catalog)),
    writeFile(join(dir, 'README.md'), readme),
    writeFile(join(dir, 'AGENTS.md'), agents),
    ...Object.entries(sets).map(([id, m]) => writeFile(join(dir, 'sets', `${id}.json`), json(m))),
  ]);
}

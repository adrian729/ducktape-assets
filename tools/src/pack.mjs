// Lays out npm package directories from a build output directory (see build.mjs for the output layout).
//   <stage>/delivery            manifest.json, LICENSE.md, delivery files without `package`
//   <stage>/part2 ...           delivery files with package "part2" ...
//   <stage>/masters             manifest.json, LICENSE.md, masters/ files without `package`
//   <stage>/masters-part2 ...   masters files with package "part2" ...
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FIRST, existingFiles } from './volumes.mjs';

export const SCOPE = '@ranx729';
export const MAIN_REPO = 'adrian729/ducktape-assets';

const LICENSE_URLS = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'PDM-1.0': 'https://creativecommons.org/publicdomain/mark/1.0/',
};

export function licenseText(manifest) {
  const id = manifest.license.artwork;
  const lines = [`# Licence: ${manifest.title}`, '', `Artwork in this package: **${id}** (${LICENSE_URLS[id] ?? `https://spdx.org/licenses/${id}.html`}).`];
  if (manifest.license.notes) lines.push('', manifest.license.notes);
  if (manifest.attribution) lines.push('', `Attribution: ${manifest.attribution}`);
  lines.push('', 'Code and tooling of the Ducktape Assets library are MIT licensed. Individual assets may carry a different licence in `manifest.json`.', '');
  return lines.join('\n');
}

const partName = (pkg, tree, part) => (tree === 'masters' ? `${pkg}-masters` : pkg) + (part === FIRST ? '' : `-${part}`);

/**
 * @param {string} buildOutDir  output of buildSet
 * @param {object} o  { setId, version, repo (package.json repository, the publishing repo), sourceRepo (set repo, homepage), license (override), stageDir }
 * @returns {Promise<Array<{name, dir, kind, part, version, files, bytes, ducktape}>>} delivery first, its parts, masters, its parts
 */
export async function packSet(buildOutDir, { setId, version, repo = MAIN_REPO, sourceRepo, license, stageDir }) {
  if (!stageDir) throw new Error('packSet needs stageDir');
  const manifest = JSON.parse(await readFile(path.join(buildOutDir, 'manifest.json'), 'utf8'));
  const pkg = manifest.package;
  const licenseId = license ?? manifest.license.artwork;
  await rm(stageDir, { recursive: true, force: true });

  // package name -> { tree, part, files: [{ path, bytes }] }
  const groups = new Map();
  for (const tree of ['delivery', 'masters']) {
    const seen = new Set();
    for (const f of existingFiles(manifest, tree)) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      const part = f.package ?? FIRST;
      const name = partName(pkg, tree, part);
      if (!groups.has(name)) groups.set(name, { tree, part, files: [] });
      groups.get(name).files.push({ path: f.path, bytes: f.bytes });
    }
    // Always emit the first package of a tree, even if empty (a set always has delivery files and masters).
    const first = partName(pkg, tree, FIRST);
    if (!groups.has(first)) groups.set(first, { tree, part: FIRST, files: [] });
  }

  const order = [...groups].sort(([an, a], [bn, b]) => (a.tree === b.tree ? Number(a.part.slice(4) || 0) - Number(b.part.slice(4) || 0) : a.tree === 'delivery' ? -1 : 1));
  const license_ = licenseText(manifest);
  const out = [];
  for (const [name, g] of order) {
    const dirName = g.tree === 'masters' ? (g.part === FIRST ? 'masters' : `masters-${g.part}`) : (g.part === FIRST ? 'delivery' : g.part);
    const dir = path.join(stageDir, dirName);
    await mkdir(dir, { recursive: true });
    const hasManifest = g.part === FIRST;
    for (const f of g.files) {
      await mkdir(path.dirname(path.join(dir, f.path)), { recursive: true });
      await copyFile(path.join(buildOutDir, f.path), path.join(dir, f.path));
    }
    if (hasManifest) await copyFile(path.join(buildOutDir, 'manifest.json'), path.join(dir, 'manifest.json'));
    await writeFile(path.join(dir, 'LICENSE.md'), license_);
    const tops = [...new Set(g.files.map((f) => f.path.split('/')[0]))].sort();
    const files = [...(hasManifest ? ['manifest.json'] : []), 'LICENSE.md', ...tops];
    const ducktape = {
      set: setId,
      ...(g.part === FIRST ? {} : { part: g.part }),
      kind: g.tree,
      inputsHash: manifest.inputsHash,
      contentHash: manifest.contentHash,
      schema: 1,
    };
    const what = g.tree === 'masters' ? 'lossless masters (2048 px cap)' : 'delivery files (AVIF/WebP ladders)';
    const pj = {
      name,
      version,
      description: `Ducktape Assets, set ${setId}: ${manifest.title}. ${what}${g.part === FIRST ? '' : `, volume ${g.part}`}.`,
      license: licenseId,
      files,
      repository: { type: 'git', url: `git+https://github.com/${repo}.git` },
      ...(sourceRepo ? { homepage: `https://github.com/${sourceRepo}` } : {}),
      publishConfig: { access: 'public' },
      ducktape,
    };
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(pj, null, 2) + '\n');
    out.push({
      name, dir, kind: g.tree === 'masters' ? (g.part === FIRST ? 'masters' : 'masters-part') : (g.part === FIRST ? 'delivery' : 'delivery-part'),
      part: g.part === FIRST ? null : g.part, version, files: g.files.length, bytes: g.files.reduce((s, f) => s + f.bytes, 0), ducktape,
    });
  }
  return out;
}

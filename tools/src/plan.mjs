// `plan`: decide what to publish. Per active set: shallow clone, validate, cheap inputsHash, compare with the
// registry, build and pack the sets that changed, derive the next version from the diff. Writes plan.json.
import { execFile } from 'node:child_process';
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { buildSet, computeInputsHash, sortKeys } from './build.mjs';
import { packSet, SCOPE, MAIN_REPO } from './pack.mjs';
import { validateSet, formatProblems } from './validate.mjs';
import { existingFiles, MB } from './volumes.mjs';

export const INDEX_PACKAGE = `${SCOPE}/ducktape-assets`;

const git = (args, { cwd } = {}) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => (e ? reject(new Error(`git ${args.join(' ')} failed: ${String(err).trim()}`)) : resolve(String(out).trim())));
});
const exists = (p) => stat(p).then(() => true, () => false);

// ---- semver ----
export const parseVersion = (v) => v.split('.').map(Number);
export function bump(version, level) {
  const [a, b, c] = parseVersion(version);
  return level === 'major' ? `${a + 1}.0.0` : level === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}
export function maxVersion(x, y) {
  const [p, q] = [parseVersion(x), parseVersion(y)];
  for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return p[i] > q[i] ? x : y;
  return x;
}

// ---- diff and classification ----

// Strip measurements that change with the encoder (bytes, hashes) so that only authored metadata and the file set count.
const NOISE = new Set(['sha256', 'bytes', 'webpTopBytes', 'avifTopBytes']);
const strip = (v) => Array.isArray(v) ? v.map(strip)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !NOISE.has(k)).map(([k, x]) => [k, strip(x)])) : v;

export function diffManifests(previous, next) {
  const prevAssets = previous?.assets ?? {};
  const added = Object.keys(next.assets).filter((id) => !(id in prevAssets));
  const removed = Object.keys(prevAssets).filter((id) => !(id in next.assets));
  const changed = Object.keys(next.assets).filter((id) => id in prevAssets && JSON.stringify(sortKeys(strip(prevAssets[id]))) !== JSON.stringify(sortKeys(strip(next.assets[id]))));
  const deprecated = Object.keys(next.assets).filter((id) => id in prevAssets && next.assets[id].status === 'deprecated' && prevAssets[id].status !== 'deprecated');
  const paths = (m) => new Set(existingFiles(m, 'delivery').map((f) => f.path));
  const [pp, np] = [paths(previous), paths(next)];
  const addedFiles = [...np].filter((p) => !pp.has(p));
  const removedFiles = [...pp].filter((p) => !np.has(p));
  return { added, removed, changed, deprecated, addedFiles, removedFiles };
}

// patch: metadata only; minor: added assets or variants; major: removed or deprecated assets (or removed files).
export function classify(previous, next) {
  if (!previous) return { level: 'new', version: '1.0.0', diff: diffManifests(null, next) };
  const diff = diffManifests(previous, next);
  const level = diff.removed.length || diff.deprecated.length || diff.removedFiles.length ? 'major'
    : diff.added.length || diff.addedFiles.length ? 'minor' : 'patch';
  return { level, version: bump(previous.version, level), diff };
}

// ---- repositories ----

export function repoSource(entry) {
  const repo = entry.repo ?? `adrian729/ducktape-assets-${entry.id}`;
  if (/^(\/|\.\/|\.\.\/|~)/.test(repo)) return pathToFileURL(path.resolve(repo)).href; // local path (tests)
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return `https://github.com/${repo}.git`;
  return repo;
}

export async function syncRepo(source, dir) {
  if (await exists(path.join(dir, '.git'))) {
    await git(['remote', 'set-url', 'origin', source], { cwd: dir });
    await git(['fetch', '--depth', '1', 'origin', 'HEAD'], { cwd: dir });
    await git(['reset', '--hard', 'FETCH_HEAD'], { cwd: dir });
    await git(['clean', '-fdx'], { cwd: dir });
  } else {
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.dirname(dir), { recursive: true });
    await git(['clone', '--depth', '1', source, dir]);
  }
  return git(['rev-parse', 'HEAD'], { cwd: dir });
}

// Assets that are not drafts (drafts are built for previews but never published).
async function approvedAssets(repoDir) {
  let n = 0;
  for (const e of await readdir(path.join(repoDir, 'assets'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (YAML.parse(await readFile(path.join(repoDir, 'assets', e.name, 'asset.yaml'), 'utf8')).status !== 'draft') n++;
  }
  return n;
}

// ---- registry state ----

async function publishedState(registry, cacheDir, setId, pkg) {
  const view = await registry.view(pkg);
  if (!view) return { exists: false };
  if (!view.ducktape?.inputsHash) return { exists: true, placeholder: true, version: view.version }; // a bootstrap 0.0.0 placeholder
  const cacheFile = path.join(cacheDir, 'published', `${setId}.json`);
  const cached = await readJsonIf(cacheFile);
  const manifest = cached?.version === view.version ? cached : await registry.publishedManifest(pkg, view.version);
  if (manifest !== cached) { await mkdir(path.dirname(cacheFile), { recursive: true }); await writeFile(cacheFile, JSON.stringify(manifest, null, 2) + '\n'); }
  return { exists: true, version: view.version, inputsHash: view.ducktape.inputsHash, manifest };
}
async function readJsonIf(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

// ---- the plan ----

const mb = (bytes) => (bytes / MB).toFixed(1);

export async function planSets({ setsFile = 'sets.yaml', cacheDir = '.ducktape-cache', only = [], registry, indexDir = 'index', publishRepo = MAIN_REPO, log = () => {}, builtAt, now = () => new Date().toISOString(), jobs } = {}) {
  const registered = YAML.parse(await readFile(setsFile, 'utf8'))?.sets ?? [];
  const wanted = registered.filter((s) => (s.status ?? 'active') === 'active' && (only.length === 0 || only.includes(s.id)));
  const plan = { schema: 1, generatedAt: now(), publishRepo, sets: [], unchanged: [], excluded: [], packages: [], bootstrapNeeded: [], pins: {}, index: null };
  const savedEnv = process.env.DUCKTAPE_ALLOW_REPO_NAME;
  process.env.DUCKTAPE_ALLOW_REPO_NAME = '1'; // the clone directory is named after the set id, not the repo

  const staged = [];
  try {
    for (const entry of wanted.sort((a, b) => a.id.localeCompare(b.id))) {
      const id = entry.id;
      const pkg = `${SCOPE}/ducktape-assets-${id}`;
      try {
        const repoDir = path.join(cacheDir, 'repos', id);
        const commit = await syncRepo(repoSource(entry), repoDir);
        const problems = await validateSet(repoDir);
        if (problems.length) { plan.excluded.push({ set: id, reason: `validation failed:\n${formatProblems(problems)}` }); continue; }
        if ((await approvedAssets(repoDir)) === 0) { plan.excluded.push({ set: id, reason: 'no approved assets' }); continue; }
        const inputsHash = await computeInputsHash(repoDir);
        const published = await publishedState(registry, cacheDir, id, pkg);
        if (published.inputsHash) plan.pins[id] = published.version;
        if (published.inputsHash === inputsHash) { plan.unchanged.push(id); continue; }

        const outDir = path.join(cacheDir, 'build', id);
        log(`building ${id}`);
        const built = await buildSet(repoDir, outDir, { version: '0.0.0', previous: published.manifest ?? null, concurrency: jobs, builtAt });
        const { manifest } = built;
        if (manifest.inputsHash !== inputsHash) throw new Error(`internal: cheap inputsHash ${inputsHash} differs from the built one ${manifest.inputsHash}`);
        const { level, version, diff } = classify(published.manifest ?? null, manifest);
        // The version enters only manifest.version and manifest.cdn, neither of which is part of contentHash.
        manifest.version = version;
        manifest.cdn = `https://cdn.jsdelivr.net/npm/${manifest.package}@${version}/`;
        await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(sortKeys(manifest), null, 2) + '\n');
        const stageDir = path.join(cacheDir, 'stage', id);
        const packed = await packSet(outDir, { setId: id, version, repo: publishRepo, sourceRepo: entry.repo ?? `adrian729/ducktape-assets-${id}`, stageDir });
        plan.pins[id] = version;
        staged.push({ id, packed });
        plan.sets.push({
          set: id, repo: entry.repo ?? `adrian729/ducktape-assets-${id}`, commit, current: published.inputsHash ? published.version : null, next: version, bump: level,
          added: diff.added, changed: diff.changed, removed: diff.removed, deprecated: diff.deprecated, drafts: manifest.drafts ?? [], inputsHash, contentHash: manifest.contentHash,
          deliveryBytes: packed.filter((p) => p.kind.startsWith('delivery')).reduce((s, p) => s + p.bytes, 0),
          mastersBytes: packed.filter((p) => p.kind.startsWith('masters')).reduce((s, p) => s + p.bytes, 0),
          deliveryPackages: packed.filter((p) => p.kind.startsWith('delivery')).length,
          mastersPackages: packed.filter((p) => p.kind.startsWith('masters')).length,
          warnings: built.warnings,
        });
        for (const p of packed) {
          plan.packages.push({
            name: p.name, version, set: id, kind: p.kind, part: p.part, dir: path.relative(cacheDir, p.dir),
            inputsHash, contentHash: manifest.contentHash, bytes: p.bytes, files: p.files,
          });
        }
      } catch (e) {
        plan.excluded.push({ set: id, reason: e.message });
      }
    }
  } finally {
    if (savedEnv === undefined) delete process.env.DUCKTAPE_ALLOW_REPO_NAME; else process.env.DUCKTAPE_ALLOW_REPO_NAME = savedEnv;
  }

  // Names that do not exist on the registry yet: trusted publishing needs the name to exist (`tools bootstrap`).
  for (const p of plan.packages) if (!(await registry.view(p.name))) plan.bootstrapNeeded.push(p.name);

  if (plan.packages.length) {
    const local = await readJsonIf(path.join(indexDir, 'package.json'));
    const live = await registry.view(INDEX_PACKAGE);
    const current = maxVersion(local?.version ?? '0.0.0', live?.version ?? '0.0.0');
    const next = current === '0.0.0' ? '1.0.0' : bump(current, 'minor');
    plan.index = { package: INDEX_PACKAGE, current: current === '0.0.0' ? null : current, next };
    plan.packages.push({ name: INDEX_PACKAGE, version: next, set: null, kind: 'index', part: null, dir: null, inputsHash: null, contentHash: null, bytes: null, files: null });
    if (!live) plan.bootstrapNeeded.push(INDEX_PACKAGE);
  }
  return plan;
}

export function summaryMarkdown(plan) {
  const lines = ['## Publish plan', ''];
  if (plan.sets.length) {
    lines.push('| set | current | next | +added | ~changed | -removed | drafts | delivery MB | masters MB | parts |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const s of plan.sets) {
      lines.push(`| ${s.set} | ${s.current ?? '(new)'} | ${s.next} | ${s.added.length} | ${s.changed.length} | ${s.removed.length} | ${s.drafts.length} | ${mb(s.deliveryBytes)} | ${mb(s.mastersBytes)} | ${s.deliveryPackages}/${s.mastersPackages} |`);
    }
    lines.push('', `Index package ${plan.index.package}: ${plan.index.current ?? '(new)'} -> ${plan.index.next}. Parts column is delivery packages / masters packages.`);
  } else {
    lines.push('Nothing to publish.');
  }
  if (plan.unchanged.length) lines.push('', `Unchanged (inputsHash equals the published one): ${plan.unchanged.join(', ')}`);
  if (plan.bootstrapNeeded.length) lines.push('', `Bootstrap needed (not on the registry, run \`tools bootstrap\`): ${plan.bootstrapNeeded.join(', ')}`);
  for (const x of plan.excluded) lines.push('', `Excluded **${x.set}**: ${x.reason}`);
  for (const s of plan.sets) for (const w of s.warnings ?? []) lines.push('', `Warning (${s.set}): ${w}`);
  return lines.join('\n') + '\n';
}

export async function writePlan(plan, { output, summary }) {
  const table = summaryMarkdown(plan);
  if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(plan, null, 2) + '\n'); }
  if (summary) await appendFile(summary, table);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `packages=${JSON.stringify(plan.packages.map((p) => p.name))}\n`);
  return table;
}

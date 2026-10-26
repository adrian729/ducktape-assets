// `publish`: publish the packages of plan.json in order (set packages, then the index package), write a release record.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';
import { buildSet, computeInputsHash, sortKeys } from './build.mjs';
import { packSet, SCOPE } from './pack.mjs';
import { INDEX_PACKAGE } from './plan.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const readJsonIf = async (file) => readJson(file).catch(() => null);
const sha = (text) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const json = (v) => JSON.stringify(v, null, 2) + '\n';

// The staged package directories are normally restored from the cache. If one is missing (cache miss), rebuild the
// set from the cached clone at the planned commit and check that the inputs hash is the planned one.
async function ensureStaged(plan, planned, cacheDir, { log }) {
  const dirs = plan.packages.filter((p) => p.set === planned.set);
  const missing = [];
  for (const p of dirs) if (!(await readJsonIf(path.join(cacheDir, p.dir, 'package.json')))) missing.push(p.name);
  if (!missing.length) return;
  log(`rebuilding ${planned.set} (missing staged packages: ${missing.join(', ')})`);
  const repoDir = path.join(cacheDir, 'repos', planned.set);
  const inputsHash = await computeInputsHash(repoDir);
  if (inputsHash !== planned.inputsHash) throw new Error(`${planned.set}: rebuilt inputsHash ${inputsHash} differs from the plan ${planned.inputsHash}`);
  const previous = await readJsonIf(path.join(cacheDir, 'published', `${planned.set}.json`));
  const outDir = path.join(cacheDir, 'build', planned.set);
  const { manifest } = await buildSet(repoDir, outDir, { version: '0.0.0', previous });
  manifest.version = planned.next;
  manifest.cdn = `https://cdn.jsdelivr.net/npm/${manifest.package}@${planned.next}/`;
  await writeFile(path.join(outDir, 'manifest.json'), json(sortKeys(manifest)));
  await packSet(outDir, { setId: planned.set, version: planned.next, repo: plan.publishRepo, sourceRepo: planned.repo, stageDir: path.join(cacheDir, 'stage', planned.set) });
}

// Manifests of every registered set, for the index: built ones from the cache, the rest from index/sets/ or the registry.
async function collectManifests({ plan, registered, cacheDir, indexDir, registry }) {
  const out = [];
  for (const entry of registered) {
    const built = plan.sets.find((s) => s.set === entry.id);
    let manifest = built ? await readJsonIf(path.join(cacheDir, 'build', entry.id, 'manifest.json')) : null;
    const pin = plan.pins[entry.id];
    if (!manifest) {
      const fromIndex = await readJsonIf(path.join(indexDir, 'sets', `${entry.id}.json`));
      manifest = fromIndex && (!pin || fromIndex.version === pin) ? fromIndex : null;
    }
    if (!manifest && pin) manifest = await registry.publishedManifest(`${SCOPE}/ducktape-assets-${entry.id}`, pin);
    if (!manifest) continue; // registered but never published
    out.push({ setId: entry.id, manifest, status: entry.status ?? 'active', repo: entry.repo ? `https://github.com/${entry.repo}` : undefined });
  }
  return out;
}

export function recordPath(recordDir, runId, date) {
  return path.join(recordDir, `${date}-${runId}.json`);
}

export async function publishPlan({ planFile, cacheDir = '.ducktape-cache', recordDir = 'releases', indexDir = 'index', setsFile = 'sets.yaml', registry, dryRun = false, runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`, now = () => new Date().toISOString(), log = () => {} }) {
  const plan = await readJson(planFile);
  const { generateIndex, writeIndex } = await import(pathToFileURL(path.resolve(indexDir, 'src', 'generate.mjs')).href);
  const registered = YAML.parse(await readFile(setsFile, 'utf8'))?.sets ?? [];
  const startedAt = now();
  const record = { schema: 1, runId: String(runId), dryRun, actor: process.env.GITHUB_ACTOR ?? null, startedAt, finishedAt: null, planGeneratedAt: plan.generatedAt, packages: [], sets: plan.sets.map((s) => ({ set: s.set, current: s.current, next: s.next, bump: s.bump, commit: s.commit, inputsHash: s.inputsHash, contentHash: s.contentHash, added: s.added.length, changed: s.changed.length, removed: s.removed.length })), index: null, error: null };
  const file = recordPath(recordDir, record.runId, startedAt.slice(0, 10));
  const save = async () => { record.finishedAt = now(); await mkdir(recordDir, { recursive: true }); await writeFile(file, json(record)); };

  try {
    for (const planned of plan.sets) await ensureStaged(plan, planned, cacheDir, { log });
    for (const p of plan.packages.filter((x) => x.kind !== 'index')) {
      const r = await registry.publish(path.join(cacheDir, p.dir), { dryRun });
      log(`${p.name}@${p.version}: ${r.status}`);
      record.packages.push({ name: p.name, version: p.version, set: p.set, kind: p.kind, inputsHash: p.inputsHash, contentHash: p.contentHash, bytes: p.bytes, result: r.status, at: now() });
    }

    // Index package last. Dry runs work on a copy so the repository's index/ is not touched.
    const indexPlanned = plan.packages.find((p) => p.kind === 'index');
    if (indexPlanned) {
      const target = dryRun ? path.join(cacheDir, 'stage', 'index-dry') : indexDir;
      if (dryRun) { await rm(target, { recursive: true, force: true }); await cp(indexDir, target, { recursive: true }); }
      const manifests = await collectManifests({ plan, registered, cacheDir, indexDir, registry });
      const previous = await readJsonIf(path.join(indexDir, 'index.json'));
      const out = generateIndex({ manifests, previous });
      await writeIndex(target, out);
      const pkgFile = path.join(target, 'package.json');
      const pj = await readJson(pkgFile);
      pj.version = indexPlanned.version;
      pj.ducktape = {
        kind: 'index',
        inputsHash: sha(json(sortKeys(Object.fromEntries(manifests.map((m) => [m.setId, { version: m.manifest.version, inputsHash: m.manifest.inputsHash }]))))),
        contentHash: sha(json(out.index) + json(out.catalog)),
        schema: 1,
      };
      await writeFile(pkgFile, json(pj));
      const r = await registry.publish(target, { dryRun });
      log(`${INDEX_PACKAGE}@${pj.version}: ${r.status}`);
      record.index = { name: INDEX_PACKAGE, version: pj.version, previous: plan.index?.current ?? null, pins: Object.fromEntries(manifests.map((m) => [m.setId, m.manifest.version])), inputsHash: pj.ducktape.inputsHash, contentHash: pj.ducktape.contentHash, result: r.status, at: now() };
      record.packages.push({ name: INDEX_PACKAGE, version: pj.version, set: null, kind: 'index', inputsHash: pj.ducktape.inputsHash, contentHash: pj.ducktape.contentHash, bytes: null, result: r.status, at: now() });
    }
  } catch (e) {
    record.error = e.message;
    await save();
    throw e;
  }
  await save();
  return { record, file };
}

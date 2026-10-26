// Place 4 of the Testing policy: publish planning. Silent failures guarded: a wrong version bump (patch/minor/major),
// a set republished although its inputsHash is unchanged, a part file landing in the wrong package, a double publish
// ("already published" must be success), and the index package published before the sets it pins.
// The registry is a fake; the set repository is a local git repo made from the fixture; the CDN is a fake fetch.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { planSets, summaryMarkdown, writePlan } from '../src/plan.mjs';
import { packSet } from '../src/pack.mjs';
import { publishPlan } from '../src/publish.mjs';
import { createRegistry } from '../src/registry.mjs';
import { checkCdn, formatTable, recordOutcome, targetsFromPlan } from '../src/check-cdn.mjs';
import { existingFiles } from '../src/volumes.mjs';
import { fixture, tempDir, useFixtureVocab } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = '@ranx729/ducktape-assets-fixture-set';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString().trim();
const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));
const exists = (f) => readFile(f).then(() => true, () => false);

class FakeRegistry {
  constructor() { this.packages = new Map(); this.calls = []; }
  async view(name) { return this.packages.get(name) ?? null; }
  async publishedInputsHash(name) { return this.packages.get(name)?.ducktape?.inputsHash ?? null; }
  async publishedManifest(name, version) { return this.manifests?.get(`${name}@${version}`); }
  async publish(dir, { dryRun }) {
    const pj = await readJson(path.join(dir, 'package.json'));
    this.calls.push({ name: pj.name, version: pj.version, dryRun });
    return { status: dryRun ? 'dry-run' : 'published' };
  }
  // Pretend that a plan was published: every set package becomes visible with its ducktape block.
  async markPublished(plan, cacheDir) {
    this.manifests ??= new Map();
    for (const p of plan.packages.filter((x) => x.set)) {
      const pj = await readJson(path.join(cacheDir, p.dir, 'package.json'));
      this.packages.set(p.name, { name: p.name, version: p.version, ducktape: pj.ducktape });
      if (p.kind === 'delivery') this.manifests.set(`${p.name}@${p.version}`, await readJson(path.join(cacheDir, p.dir, 'manifest.json')));
    }
  }
}

let work, repo, base, setsFile, indexDir, registry, cacheA, planA, planFileA, recordDir;

before(async () => {
  await useFixtureVocab();
  work = await tempDir('ducktape-plan-');
  repo = path.join(work, 'set-origin');
  await cp(fixture, repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'fixture');
  base = git(repo, 'rev-parse', 'HEAD');
  setsFile = path.join(work, 'sets.yaml');
  await writeFile(setsFile, YAML.stringify({ sets: [{ id: 'fixture-set', repo, status: 'active', added: '2026-11-02' }] }));
  indexDir = path.join(work, 'index');
  await cp(path.resolve(here, '../../index'), indexDir, { recursive: true, filter: (s) => !s.includes('node_modules') && !s.includes(`${path.sep}test`) });
  registry = new FakeRegistry();
  cacheA = path.join(work, 'cache-a');
  recordDir = path.join(work, 'releases');
});

const plan = (cacheDir, opts = {}) => planSets({ setsFile, cacheDir, indexDir, registry, builtAt: '2026-11-02T00:00:00.000Z', jobs: 2, ...opts });

test('a new set plans 1.0.0, orders the index package last and lists unregistered names for bootstrap', async () => {
  planA = await plan(cacheA);
  assert.deepEqual(planA.excluded, []);
  assert.equal(planA.sets.length, 1);
  assert.equal(planA.sets[0].next, '1.0.0');
  assert.equal(planA.sets[0].bump, 'new');
  assert.equal(planA.sets[0].current, null);
  assert.deepEqual(planA.packages.map((p) => p.name), [PKG, `${PKG}-masters`, '@ranx729/ducktape-assets']);
  assert.equal(planA.packages.at(-1).kind, 'index');
  assert.equal(planA.index.next, '1.0.0');
  assert.deepEqual(planA.bootstrapNeeded, [PKG, `${PKG}-masters`, '@ranx729/ducktape-assets']);
  planFileA = path.join(work, 'plan-a.json');
  const summaryFile = path.join(work, 'summary.md');
  const table = await writePlan(planA, { output: planFileA, summary: summaryFile });
  assert.match(table, /\| fixture-set \| \(new\) \| 1\.0\.0 \| 2 \| 0 \| 0 \| 0 \|/);
  assert.equal(await readFile(summaryFile, 'utf8'), table);
  console.log(table);
});

test('an unchanged inputsHash plans nothing and builds nothing', async () => {
  await registry.markPublished(planA, cacheA);
  const cache = path.join(work, 'cache-b');
  const p = await plan(cache);
  assert.deepEqual(p.packages, []);
  assert.deepEqual(p.unchanged, ['fixture-set']);
  assert.deepEqual(p.bootstrapNeeded, []);
  assert.equal(await exists(path.join(cache, 'build', 'fixture-set', 'manifest.json')), false, 'unchanged set must not be built');
  assert.equal(summaryMarkdown(p).includes('Nothing to publish.'), true);
});

test('packaging puts the files of each volume package in its own directory and every package.json has the ducktape block', async () => {
  for (const p of planA.packages.filter((x) => x.set)) {
    const pj = await readJson(path.join(cacheA, p.dir, 'package.json'));
    assert.equal(pj.name, p.name);
    assert.equal(pj.version, '1.0.0');
    assert.equal(pj.license, 'CC0-1.0');
    assert.equal(pj.publishConfig.access, 'public');
    assert.deepEqual([pj.ducktape.set, pj.ducktape.schema, pj.ducktape.inputsHash, pj.ducktape.contentHash], ['fixture-set', 1, planA.sets[0].inputsHash, planA.sets[0].contentHash]);
    assert.equal(pj.exports, undefined);
    assert.ok(await exists(path.join(cacheA, p.dir, 'LICENSE.md')));
  }
  const delivery = path.join(cacheA, 'stage/fixture-set/delivery');
  const masters = path.join(cacheA, 'stage/fixture-set/masters');
  assert.ok(await exists(path.join(delivery, 'manifest.json')));
  assert.ok(await exists(path.join(delivery, 'webp/rabbit-church-bells-64.webp')));
  assert.equal(await exists(path.join(delivery, 'masters')), false);
  assert.ok(await exists(path.join(masters, 'masters/rabbit-church-bells.webp')));
  assert.match(await readFile(path.join(delivery, 'LICENSE.md'), 'utf8'), /CC0-1\.0[\s\S]*Attribution: Walters Art Museum W\.82/);

  // Volume packages: move the ribbon's files to part2 in a copy of the build output.
  const out = path.join(work, 'build-parts');
  await cp(path.join(cacheA, 'build/fixture-set'), out, { recursive: true });
  const manifest = await readJson(path.join(out, 'manifest.json'));
  for (const tree of ['delivery', 'masters']) {
    for (const f of existingFiles(manifest, tree)) if (f.path.includes('stepped-ribbon')) f.package = 'part2';
  }
  manifest.parts = [`${PKG}-part2`];
  manifest.mastersParts = [`${PKG}-masters-part2`];
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest));
  const stage = path.join(work, 'stage-parts');
  const packed = await packSet(out, { setId: 'fixture-set', version: '2.0.0', stageDir: stage });
  assert.deepEqual(packed.map((p) => p.name), [PKG, `${PKG}-part2`, `${PKG}-masters`, `${PKG}-masters-part2`]);
  const list = async (d) => (await readdir(path.join(stage, d), { recursive: true })).sort();
  assert.ok((await list('part2')).includes('webp/stepped-ribbon-64.webp'));
  assert.ok((await list('part2')).includes('tiles/stepped-ribbon-rotated-28.webp'));
  assert.equal((await list('part2')).includes('manifest.json'), false);
  assert.equal((await list('delivery')).some((f) => f.includes('stepped-ribbon-')), false);
  assert.ok((await list('delivery')).some((f) => f.includes('rabbit-church-bells-')));
  assert.deepEqual((await list('masters-part2')).filter((f) => f.startsWith('masters/')), ['masters/stepped-ribbon.corner.webp', 'masters/stepped-ribbon.webp']);
  assert.equal((await list('masters')).includes('masters/stepped-ribbon.webp'), false);
  const part = await readJson(path.join(stage, 'masters-part2/package.json'));
  assert.deepEqual([part.ducktape.set, part.ducktape.part, part.ducktape.kind], ['fixture-set', 'part2', 'masters']);
  assert.deepEqual(part.files.filter((f) => f !== 'LICENSE.md'), ['masters']);
});

test('registry.publish treats "cannot publish over previously published version" as success and other failures as errors', async () => {
  const fail = (stderr) => async () => ({ error: new Error('exit 1'), stdout: '', stderr });
  const ok = await createRegistry({ exec: fail('npm error You cannot publish over the previously published versions: 1.0.0.') }).publish('/x');
  assert.equal(ok.status, 'already-published');
  await assert.rejects(createRegistry({ exec: fail('npm error 403 Forbidden') }).publish('/x'), /npm publish failed/);
  const calls = [];
  const dry = await createRegistry({ exec: async (...a) => { calls.push(a); return { error: null, stdout: '', stderr: '' }; } }).publish('/x', { dryRun: true });
  assert.deepEqual([dry.status, calls[0][1]], ['dry-run', ['publish', '--access', 'public', '--dry-run']]);
  const missing = createRegistry({ exec: async () => ({ error: new Error('x'), stdout: '{"error":{"code":"E404"}}', stderr: '' }) });
  assert.equal(await missing.view('@ranx729/nope'), null);
});

test('publish --dry-run publishes the set packages in plan order, the index last, and writes a release record', async () => {
  const reg = new FakeRegistry();
  reg.manifests = new Map();
  const indexBefore = await readFile(path.join(indexDir, 'index.json'), 'utf8');
  const { record, file } = await publishPlan({ planFile: planFileA, cacheDir: cacheA, recordDir, indexDir, setsFile, registry: reg, dryRun: true, runId: 'test-run', now: () => '2026-11-02T10:00:00.000Z' });
  assert.deepEqual(reg.calls.map((c) => c.name), [PKG, `${PKG}-masters`, '@ranx729/ducktape-assets']);
  assert.ok(reg.calls.every((c) => c.dryRun));
  assert.equal(reg.calls.at(-1).version, '1.0.0');
  assert.equal(path.basename(file), '2026-11-02-test-run.json');
  const saved = await readJson(file);
  assert.equal(saved.dryRun, true);
  assert.deepEqual(saved.packages.map((p) => [p.name, p.result]), reg.calls.map((c) => [c.name, 'dry-run']));
  assert.equal(saved.index.pins['fixture-set'], '1.0.0');
  assert.equal(saved.packages[0].contentHash, planA.sets[0].contentHash);
  assert.equal(record.error, null);
  // The repository's index/ is untouched by a dry run; the generated copy pins the set.
  assert.equal(await readFile(path.join(indexDir, 'index.json'), 'utf8'), indexBefore);
  const dryIndex = await readJson(path.join(cacheA, 'stage/index-dry/index.json'));
  assert.equal(dryIndex.sets['fixture-set'].version, '1.0.0');
  const dryPkg = await readJson(path.join(cacheA, 'stage/index-dry/package.json'));
  assert.equal(dryPkg.version, '1.0.0');
});

test('publish failures are written to the release record and a re-run is not blocked', async () => {
  const reg = new FakeRegistry();
  reg.publish = async () => { throw new Error('boom'); };
  await assert.rejects(publishPlan({ planFile: planFileA, cacheDir: cacheA, recordDir, indexDir, setsFile, registry: reg, dryRun: true, runId: 'failed-run' }), /boom/);
  const files = await readdir(recordDir);
  const failed = await readJson(path.join(recordDir, files.find((f) => f.endsWith('failed-run.json'))));
  assert.equal(failed.error, 'boom');
});

test('version bumps: metadata-only is a patch, an added asset a minor, a removed asset a major', async () => {
  const cache = path.join(work, 'cache-c');
  const reset = () => { git(repo, 'reset', '-q', '--hard', base); git(repo, 'clean', '-fdq'); };
  const commit = (msg) => { git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', msg); };
  const rabbit = path.join(repo, 'assets/rabbit-church-bells');

  const text = await readFile(path.join(rabbit, 'asset.yaml'), 'utf8');
  await writeFile(path.join(rabbit, 'asset.yaml'), text.replace('on a transparent background.', 'on a transparent background, drawn in the margin.'));
  commit('metadata');
  let p = await plan(cache);
  assert.deepEqual([p.sets[0].bump, p.sets[0].current, p.sets[0].next], ['patch', '1.0.0', '1.0.1']);
  assert.deepEqual([p.sets[0].added, p.sets[0].changed, p.sets[0].removed], [[], ['rabbit-church-bells'], []]);
  assert.deepEqual(p.packages.map((x) => x.version), ['1.0.1', '1.0.1', '1.0.0']);
  assert.equal(p.index.next, '1.0.0', 'the index is new in this fake registry');
  assert.deepEqual(p.bootstrapNeeded, ['@ranx729/ducktape-assets']);
  const built = await readJson(path.join(cache, 'build/fixture-set/manifest.json'));
  assert.deepEqual([built.version, built.cdn], ['1.0.1', `https://cdn.jsdelivr.net/npm/${PKG}@1.0.1/`]);

  reset();
  await cp(rabbit, path.join(repo, 'assets/rabbit-two'), { recursive: true });
  const two = path.join(repo, 'assets/rabbit-two/asset.yaml');
  await writeFile(two, (await readFile(two, 'utf8')).replace('id: rabbit-church-bells', 'id: rabbit-two'));
  commit('added');
  p = await plan(cache);
  assert.deepEqual([p.sets[0].bump, p.sets[0].next, p.sets[0].added, p.sets[0].removed], ['minor', '1.1.0', ['rabbit-two'], []]);

  reset();
  await rm(rabbit, { recursive: true });
  commit('removed');
  p = await plan(cache);
  assert.deepEqual([p.sets[0].bump, p.sets[0].next, p.sets[0].removed], ['major', '2.0.0', ['rabbit-church-bells']]);
  reset();
});

test('draft assets are left out of the packages and listed in the manifest; a set with only drafts is excluded', async () => {
  const cache = path.join(work, 'cache-draft');
  const reset = () => { git(repo, 'reset', '-q', '--hard', base); git(repo, 'clean', '-fdq'); };
  const commit = (msg) => { git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', msg); };
  const setDraft = async (name) => {
    const f = path.join(repo, 'assets', name, 'asset.yaml');
    await writeFile(f, (await readFile(f, 'utf8')).replace('status: approved', 'status: draft'));
  };
  await setDraft('stepped-ribbon');
  commit('draft ribbon');
  const empty = new FakeRegistry();
  let p = await planSets({ setsFile, cacheDir: cache, indexDir, registry: empty, builtAt: '2026-11-02T00:00:00.000Z', jobs: 2 });
  assert.deepEqual(p.sets[0].drafts, ['stepped-ribbon']);
  assert.match(summaryMarkdown(p), /\| drafts \|[\s\S]*\| 1 \|/);
  const manifest = await readJson(path.join(cache, 'build/fixture-set/manifest.json'));
  assert.deepEqual(Object.keys(manifest.assets), ['rabbit-church-bells']);
  assert.deepEqual(manifest.drafts, ['stepped-ribbon']);
  const files = (await readdir(path.join(cache, 'stage/fixture-set'), { recursive: true })).filter((f) => f.includes('stepped-ribbon'));
  assert.deepEqual(files, [], 'no file of a draft asset in any package');

  await setDraft('rabbit-church-bells');
  commit('all drafts');
  p = await planSets({ setsFile, cacheDir: cache, indexDir, registry: empty });
  assert.deepEqual(p.packages, []);
  assert.deepEqual(p.excluded, [{ set: 'fixture-set', reason: 'no approved assets' }]);
  reset();
});

test('a set that fails validation is excluded with its reason and the rest of the plan stands', async () => {
  const bad = path.join(work, 'bad-origin', 'x');
  await mkdir(bad, { recursive: true });
  git(path.dirname(bad), 'init', '-q', '-b', 'main');
  await writeFile(path.join(path.dirname(bad), 'set.yaml'), 'id: broken\n');
  git(path.dirname(bad), 'add', '-A');
  git(path.dirname(bad), 'commit', '-q', '-m', 'x');
  const sets = path.join(work, 'sets-bad.yaml');
  await writeFile(sets, YAML.stringify({ sets: [{ id: 'broken', repo: path.dirname(bad), status: 'active' }, { id: 'frozen-one', repo: path.dirname(bad), status: 'frozen' }] }));
  const p = await planSets({ setsFile: sets, cacheDir: path.join(work, 'cache-d'), indexDir, registry: new FakeRegistry() });
  assert.deepEqual(p.packages, []);
  assert.equal(p.excluded.length, 1);
  assert.equal(p.excluded[0].set, 'broken');
  assert.match(p.excluded[0].reason, /validation failed/);
});

// ---- check-cdn ----

async function cdnFake(cache, { status = () => 200, tamper = () => false } = {}) {
  const served = new Map();
  for (const p of planA.packages.filter((x) => x.set)) {
    const dir = path.join(cache, p.dir);
    const doc = await readJson(path.join(dir, p.kind === 'delivery' ? 'manifest.json' : 'package.json'));
    served.set(`https://cdn.jsdelivr.net/npm/${p.name}@${p.version}/${p.kind === 'delivery' ? 'manifest.json' : 'package.json'}`, doc);
  }
  served.set('https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets@1.0.0/package.json', { name: '@ranx729/ducktape-assets', version: '1.0.0' });
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    const s = status(url);
    if (s !== 200 || !served.has(url)) return { status: s === 200 ? 404 : s, json: async () => ({}) };
    const doc = structuredClone(served.get(url));
    if (tamper(url)) (doc.ducktape ?? doc).contentHash = 'sha256:bad';
    return { status: 200, json: async () => doc };
  };
  return { fetchFn, seen };
}
const quick = { retries: 3, delayMs: 0, sleep: async () => {} };

test('check-cdn passes on matching hashes, appends to the release record, and flags a mismatch', async () => {
  const targets = await targetsFromPlan(planA, indexDir);
  const { fetchFn, seen } = await cdnFake(cacheA);
  const outcome = await checkCdn({ targets, fetchFn, ...quick });
  assert.equal(outcome.ok, true, formatTable(outcome));
  assert.equal(outcome.level, null);
  assert.equal(seen.length, 3);
  assert.ok(seen[0].endsWith('/manifest.json') && seen.slice(1).every((u) => u.endsWith('/package.json')));
  const file = await recordOutcome(recordDir, 'test-run', outcome);
  assert.equal(path.basename(file), '2026-11-02-test-run.json');
  assert.equal((await readJson(file)).cdn.ok, true);
  assert.equal((await readJson(file)).dryRun, true, 'the existing record is extended, not replaced');

  const bad = await checkCdn({ targets, fetchFn: (await cdnFake(cacheA, { tamper: (u) => u.includes('masters') })).fetchFn, ...quick });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.results.map((r) => r.result), ['ok', 'mismatch', 'ok']);
  assert.equal(bad.level, null);
});

test('check-cdn classifies one refused package as level 0 and a 403 on everything as level 1, after bounded retries', async () => {
  const targets = await targetsFromPlan(planA, indexDir);
  const one = await checkCdn({ targets, fetchFn: (await cdnFake(cacheA, { status: (u) => (u.includes('-masters@') ? 403 : 200) })).fetchFn, ...quick });
  assert.equal(one.ok, false);
  assert.equal(one.level, 0);
  const { fetchFn, seen } = await cdnFake(cacheA, { status: () => 403 });
  const all = await checkCdn({ targets, fetchFn, ...quick });
  assert.equal(all.ok, false);
  assert.equal(all.level, 1);
  assert.equal(seen.length, 3 * 3, 'three packages, three tries each');
  assert.ok(all.results.every((r) => r.result === 'http-403' && r.attempts === 3));
  assert.match(formatTable(all), /Level 1/);
  // A package that appears late (CDN propagation) passes on a later try.
  let n = 0;
  const late = await checkCdn({ targets: targets.slice(0, 1), fetchFn: async (u) => (++n < 3 ? { status: 404, json: async () => ({}) } : (await cdnFake(cacheA)).fetchFn(u)), ...quick });
  assert.deepEqual([late.ok, late.results[0].attempts], [true, 3]);
});

// Migration map completeness (Testing policy): the importer on a tiny synthetic old catalog, plus new-set --local and readme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import YAML from 'yaml';
import { importMedievalOrnaments } from '../src/import.mjs';
import { newSet } from '../src/new-set.mjs';
import { generateReadme } from '../src/readme.mjs';
import { loadValidators } from '../src/schemas.mjs';
import { validateSet } from '../src/validate.mjs';
import { exists } from '../src/setfiles.mjs';
import { fixture, tempDir } from './helpers.mjs';

const png = (w, h, [r, g, b, a]) => sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: a } } }).png().toBuffer();
const quiet = { log: () => {} };

// A tiny old catalog shaped like images.json with one checkout, plus a plan over it.
async function makeOld() {
  const root = await tempDir('ducktape-old-');
  const co = path.join(root, 'old', 'tmp', 'resource-checkouts', 'decorations-001');
  for (const d of ['png', 'webp', 'svg']) await mkdir(path.join(co, d), { recursive: true });
  await writeFile(path.join(co, 'package.json'), JSON.stringify({ name: '@ranx729/medieval-ornaments-assets-decorations-001', version: '0.1.5' }));
  const files = {
    'png/demo-fleuron.png': await png(8, 8, [200, 30, 30, 255]),
    'png/demo-ribbon.png': await png(24, 6, [30, 30, 200, 128]),
    'png/demo-ribbon-corner.png': await png(6, 6, [30, 200, 30, 255]),
    'png/demo-ribbon-rotated.png': await png(6, 24, [30, 30, 200, 128]),
    'png/demo-bells.png': await png(10, 12, [90, 90, 90, 200]),
  };
  for (const [rel, buf] of Object.entries(files)) await writeFile(path.join(co, rel), buf);
  await writeFile(path.join(co, 'svg/demo-fleuron.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const prov = (id) => ({ institution: 'The Walters Art Museum', title: id, object_identifier: 'W.102, fol. 1r', date: 'ca. 1300', record_url: 'https://art.thewalters.org/object/W.102/', image_rights: 'CC0 1.0', method: 'native-source-extraction' });
  const boiler = 'Complete image; no verified repeating unit or frame atlas. Preserve its proportions.';
  const rec = (name, extra) => ({
    name, description: `A demo piece called ${name} used to test the importer, on a transparent background.`, categories: ['floral'], subjects: ['demo', 'Leaf Curl'],
    facing: 'unclear', colors: ['red'], composition: 'single-ornament', png: `png/${name}.png`, webp: `webp/${name}.webp`, kind: 'standalone', repeat_axis: 'none',
    components: {}, reference: 'walters-w102-1r', derivation: 'native-source-extraction', provenance: prov(name), usage_notes: [boiler, `Specific note for ${name}.`], ...extra,
  });
  const catalog = [
    rec('demo-fleuron', { asset_type: 'decoration', width: 8, height: 8, png_bytes: files['png/demo-fleuron.png'].length, svg: 'svg/demo-fleuron.svg', derivation: 'native-source-extraction' }),
    rec('demo-ribbon', {
      asset_type: 'border', repeat_axis: 'x', kind: 'repeat-tile', width: 24, height: 6, png_bytes: files['png/demo-ribbon.png'].length, border_image_slice_percent: 25,
      components: {
        corner: { png: 'png/demo-ribbon-corner.png', width: 6, height: 6, png_bytes: files['png/demo-ribbon-corner.png'].length },
        rotated_tile: { png: 'png/demo-ribbon-rotated.png', width: 6, height: 24, png_bytes: files['png/demo-ribbon-rotated.png'].length },
      },
    }),
    rec('demo-bells', { asset_type: 'illustration', facing: 'front', width: 10, height: 12, png_bytes: files['png/demo-bells.png'].length }),
  ];
  // 30 more records only so the boilerplate line passes the "more than 20 records" threshold
  for (let i = 0; i < 21; i++) catalog.push(rec(`filler-${i}`, { asset_type: 'illustration', width: 1, height: 1, png_bytes: 1 }));
  await writeFile(path.join(root, 'old', 'images.json'), JSON.stringify(catalog));
  await writeFile(path.join(root, 'old', 'package.json'), JSON.stringify({ name: '@ranx729/medieval-ornaments', version: '0.12.0' }));

  const row = (old, id, status, notes = '', wave = 1) => ({ old, set: 'demo-set', id: id && `demo-set/${id}`, group: null, wave, status, notes });
  const plan = [
    row('demo-bells', 'bells', 'moved'),
    row('demo-fleuron', 'fleuron', 'moved'),
    row('demo-fleuron#svg', null, 'dropped', 'auto-traced SVG of the raster master'),
    row('demo-ribbon', 'ribbon', 'moved'),
    row('demo-ribbon#corner', 'ribbon#corner', 'merged', 'true master component'),
    row('demo-ribbon#rotated_tile', null, 'dropped', 'generated rotated tile'),
    { ...row('demo-too-long', null, 'renamed', 'id candidate is 49 chars; shorten by hand'), id: null },
    row('filler-0', 'filler-0', 'moved', '', 2), // another wave: must be ignored
  ];
  await writeFile(path.join(root, 'plan.yaml'), YAML.stringify({ entries: plan }));
  return { root, old: path.join(root, 'old'), plan: path.join(root, 'plan.yaml'), rows: plan };
}

test('import: migration map completeness on a synthetic catalog', async () => {
  const { root, old, plan, rows } = await makeOld();
  const out = path.join(root, 'out');
  const map = path.join(root, 'medieval-ornaments.json');
  const report = await importMedievalOrnaments({ plan, old, out, map, wave: 1, ...quiet });
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /demo-too-long/);

  const doc = JSON.parse(await readFile(map, 'utf8'));
  assert.equal(doc.schema, 1);
  const key = (e) => (e.old.component ? `${e.old.name}#${e.old.component}` : e.old.name);
  const keys = doc.entries.map(key);
  const expected = rows.filter((r) => r.wave === 1 && r.id !== null || (r.wave === 1 && r.status === 'dropped')).map((r) => r.old);
  assert.deepEqual([...keys].sort(), [...expected].sort(), 'every non-skipped old name has exactly one map entry');
  assert.equal(new Set(keys).size, keys.length);

  for (const e of doc.entries) {
    if (e.status === 'dropped') { assert.equal(e.new, null); continue; }
    assert.match(e.old.masterSha256, /^[0-9a-f]{64}$/);
    assert.equal(e.verified, 'pixels-identical');
    assert.equal(e.new.version, null);
    assert.equal(e.new.package, '@ranx729/ducktape-assets-demo-set');
    assert.equal(e.old.package, '@ranx729/medieval-ornaments-assets-decorations-001');
  }
  assert.equal(doc.entries.find((e) => e.old.name === 'demo-ribbon' && e.old.component === 'corner').status, 'merged');

  const repo = path.join(out, 'ducktape-assets-demo-set');
  delete process.env.DUCKTAPE_ALLOW_REPO_NAME;
  const problems = await validateSet(repo);
  assert.ok(problems.length > 0);
  for (const p of problems) assert.match(p.message, /^unknown subject /, `${p.where}: ${p.message}`);
  assert.deepEqual(YAML.parse(await readFile(path.join(repo, 'vocab-additions.yaml'), 'utf8')).subjects, ['demo', 'leaf-curl']);

  const set = YAML.parse(await readFile(path.join(repo, 'set.yaml'), 'utf8'));
  assert.equal(set.kind, 'historical');
  assert.equal(set.license.artwork, 'CC0-1.0');
  const ribbon = YAML.parse(await readFile(path.join(repo, 'assets/ribbon/asset.yaml'), 'utf8'));
  assert.deepEqual(ribbon.render, { tile: { axis: 'x', period: 1 }, frame: { corner: 'corner', slice: 25 } });
  assert.equal(ribbon.type, 'border');
  assert.equal(ribbon.status, 'draft');
  assert.equal(ribbon.review, 'pending');
  assert.deepEqual(ribbon.usage_notes, ['Specific note for demo-ribbon.']);
  assert.ok(await exists(path.join(repo, 'assets/ribbon/corner.png')));
  assert.equal(YAML.parse(await readFile(path.join(repo, 'assets/bells/asset.yaml'), 'utf8')).facing, 'viewer');
  assert.equal(YAML.parse(await readFile(path.join(repo, 'assets/fleuron/asset.yaml'), 'utf8')).type, 'ornament');
  assert.ok(!(await exists(path.join(repo, 'assets/filler-0'))), 'rows of another wave are not imported');
  assert.ok(await exists(path.join(repo, 'README.md')));
  assert.ok(await exists(path.join(repo, 'SOURCES.md')));

  // idempotent: a second run gives the same map
  const before = await readFile(map, 'utf8');
  await importMedievalOrnaments({ plan, old, out, map, wave: 1, ...quiet });
  assert.equal(await readFile(map, 'utf8'), before);
});

test('import: --dry-run writes nothing and counts per set', async () => {
  const { root, old, plan } = await makeOld();
  const out = path.join(root, 'out');
  const map = path.join(root, 'medieval-ornaments.json');
  const lines = [];
  const report = await importMedievalOrnaments({ plan, old, out, map, wave: 1, dryRun: true, log: (m) => lines.push(m) });
  assert.equal(await exists(out), false);
  assert.equal(await exists(map), false);
  assert.deepEqual(report.sets.get('demo-set'), { assets: 3, components: 1, dropped: 2, skipped: 1, bytes: report.sets.get('demo-set').bytes });
  assert.ok(lines.some((l) => l.startsWith('demo-set\t3\t1\t2\t1')));
});

test('new-set --local creates the repo from the template and registers it', async () => {
  const dir = await tempDir('ducktape-newset-');
  const registry = path.join(dir, 'sets.yaml');
  await writeFile(registry, '# registry\nsets: []\n');
  const dest = await newSet({ id: 'demo-set', title: 'Demo set', kind: 'authored', local: dir, registry, today: '2026-10-26' }, quiet);
  assert.equal(path.basename(dest), 'ducktape-assets-demo-set');
  const set = YAML.parse(await readFile(path.join(dest, 'set.yaml'), 'utf8'));
  const { set: validate } = await loadValidators();
  assert.ok(validate(set), JSON.stringify(validate.errors));
  assert.equal(set.license.artwork, 'CC-BY-4.0');
  assert.ok(await exists(path.join(dest, '.github/workflows/ci.yml')));
  const reg = await readFile(registry, 'utf8');
  assert.match(reg, /# registry/);
  assert.deepEqual(YAML.parse(reg).sets, [{ id: 'demo-set', status: 'active', added: '2026-10-26' }]);
  await assert.rejects(newSet({ id: 'demo-set', title: 'x', kind: 'authored', local: dir, registry }, quiet), /already exists/);
  for (const bad of ['Masters', 'masters', 'a-part2', 'has_underscore', 'x'.repeat(49)]) {
    await assert.rejects(newSet({ id: bad, title: 'x', kind: 'authored', local: dir, registry }, quiet), /set id/, bad);
  }
  assert.deepEqual((await readdir(dir)).sort(), ['ducktape-assets-demo-set', 'sets.yaml']);
});

test('new-set --github calls gh with the documented arguments (injected runner)', async () => {
  const dir = await tempDir('ducktape-newset-');
  const calls = [];
  await newSet({ id: 'demo-gh', title: 'Demo', kind: 'imported', local: dir, github: true, registry: null }, { log: () => {}, exec: async (cmd, args) => { calls.push([cmd, ...args].join(' ')); } });
  assert.ok(calls.includes('gh repo create adrian729/ducktape-assets-demo-gh --public --source . --push'));
});

test('readme: README, LICENSE and SOURCES on the fixture set, idempotent', async () => {
  const dir = await tempDir('ducktape-readme-');
  const repo = path.join(dir, 'ducktape-assets-fixture-set');
  await cp(fixture, repo, { recursive: true });
  const manifest = path.join(dir, 'manifest.json');
  await writeFile(manifest, JSON.stringify({
    version: '1.2.0', cdn: 'https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-fixture-set@1.2.0/',
    assets: { 'rabbit-church-bells': { width: 823, height: 960, sources: { webp: [{ w: 256, path: 'webp/rabbit-church-bells-256.webp' }, { w: 512, path: 'webp/rabbit-church-bells-512.webp' }] } } },
  }));
  const written = await generateReadme(repo, { manifestPath: manifest });
  assert.deepEqual(written, ['README.md', 'LICENSE.md', 'SOURCES.md']);
  const readme = await readFile(path.join(repo, 'README.md'), 'utf8');
  assert.match(readme, /^<!-- Generated/);
  assert.match(readme, /https:\/\/cdn\.jsdelivr\.net\/npm\/@ranx729\/ducktape-assets-fixture-set@1\.2\.0\/webp\/rabbit-church-bells-512\.webp/);
  assert.match(readme, /\| `rabbit-church-bells` \| Rabbit ringing church bells \| illustration \| 823 × 960 \| 194v \| approved \|/);
  assert.ok(readme.indexOf('`rabbit-church-bells`') < readme.indexOf('`stepped-ribbon`'), 'sorted by id');
  assert.match(await readFile(path.join(repo, 'LICENSE.md'), 'utf8'), /MIT/);
  assert.match(await readFile(path.join(repo, 'SOURCES.md'), 'utf8'), /Walters Art Museum, W\.82/);
  const snapshot = await Promise.all(written.map((f) => readFile(path.join(repo, f), 'utf8')));
  await generateReadme(repo, { manifestPath: manifest });
  assert.deepEqual(await Promise.all(written.map((f) => readFile(path.join(repo, f), 'utf8'))), snapshot);
  // without a manifest the URL scheme is shown instead of a made-up version
  await generateReadme(repo);
  assert.match(await readFile(path.join(repo, 'README.md'), 'utf8'), /@<version>/);
});

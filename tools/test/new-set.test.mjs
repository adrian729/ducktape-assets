// Set scaffolding and README generation (Testing policy): new-set --local and --github, and readme on the fixture set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import YAML from 'yaml';
import { newSet } from '../src/new-set.mjs';
import { generateReadme } from '../src/readme.mjs';
import { loadValidators } from '../src/schemas.mjs';
import { exists } from '../src/setfiles.mjs';
import { fixture, tempDir } from './helpers.mjs';

const quiet = { log: () => {} };

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

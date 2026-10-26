import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateIndex, writeIndex } from '../src/generate.mjs';
import { createResolver } from '../src/resolver.mjs';
import { manifests, loadManifest } from './fixture.mjs';

const input = Object.entries(manifests).map(([setId, manifest]) => ({ setId, manifest }));

// Silent failure prevented: the catalog lists URLs the resolver would never emit.
test('generateIndex: catalog URLs equal what the resolver emits', async () => {
  const out = generateIndex({ manifests: input, generatedAt: '2026-11-02T00:00:00.000Z' });
  assert.deepEqual(Object.keys(out.index.sets), ['floral-borders', 'numbered-plate', 'walters-w102']);
  const s = out.index.sets['walters-w102'];
  assert.deepEqual([s.assets, s.parts, s.status, s.cdn], [1, ['@ranx729/ducktape-assets-walters-w102-part2'], 'active', 'https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-walters-w102@1.0.0/']);
  assert.equal(s.mastersCdn, 'https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-walters-w102-masters@1.0.0/');

  const r = createResolver({ index: out.index, loadManifest });
  await r.index();
  assert.equal(out.catalog.assets.length, 3);
  for (const c of out.catalog.assets) {
    const { asset, setId } = await r.get(c.id);
    for (const [fmt, files] of Object.entries(asset.sources)) {
      if (!Array.isArray(files)) assert.equal(c.urls[fmt], r.url(files, setId));
      else for (const f of files) assert.equal(c.urls[fmt][f.w], r.url(f, setId), `${c.id} ${fmt} ${f.w}`);
    }
    assert.equal(c.set, setId);
    assert.ok(!JSON.stringify(c).includes('sha256'));
  }
  const rabbit = out.catalog.assets.find((c) => c.id === 'walters-w102/rabbit-church-bells');
  assert.match(rabbit.urls.webp[768], /-part2@1\.0\.0\/webp\/rabbit-church-bells-768\.webp$/);
  assert.equal(rabbit.urls.webp[768], (await r.image(rabbit.id, { width: 320, dpr: 2 })).src);
  const ribbon = out.catalog.assets.find((c) => c.set === 'numbered-plate');
  assert.ok(ribbon.urls.rotated.webp[32] && ribbon.urls.atlas.avif[96]);
  assert.deepEqual(ribbon.render.frame, { corner: 'corner', slice: 33.3 });

  // unchanged sets keep the previous timestamp
  const again = generateIndex({ manifests: input, previous: out.index, generatedAt: '2030-01-01T00:00:00.000Z' });
  assert.equal(again.index.generatedAt, '2026-11-02T00:00:00.000Z');
});

test('writeIndex smoke: README, AGENTS, sets/ in a temp dir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dta-index-'));
  try {
    await writeIndex(dir, generateIndex({ manifests: input }));
    assert.deepEqual((await readdir(dir)).sort(), ['AGENTS.md', 'README.md', 'catalog.json', 'index.json', 'sets']);
    assert.deepEqual((await readdir(join(dir, 'sets'))).sort(), ['floral-borders.json', 'numbered-plate.json', 'walters-w102.json']);
    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    assert.match(readme, /\| `walters-w102` \| Set walters-w102 \| Summary of walters-w102\. \| 1 \| CC0 \| \[repo\]\(https:\/\/github\.com\/adrian729\/ducktape-assets-walters-w102\) \|/);
    assert.match(readme, /Three ways to use an asset/);
    assert.match(await readFile(join(dir, 'AGENTS.md'), 'utf8'), /Never use `@latest`/);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'sets/walters-w102.json'), 'utf8')), manifests['walters-w102']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

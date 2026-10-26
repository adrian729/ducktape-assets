// Place 2 of the Testing policy: ladder and manifest generation. Also covers the volume assignment, which decides
// the manifest's `package` fields. Silent failure each guards: a tooling change alters rungs, the AVIF decision,
// the geometry derivatives or the package of a file across every set, with no error.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { buildSet } from '../src/build.mjs';
import { loadManifestValidator } from '../src/schemas.mjs';
import { assignPackages } from '../src/volumes.mjs';
import { fixture, tempDir, useFixtureVocab, allFiles } from './helpers.mjs';

let out, manifest;
before(async () => {
  await useFixtureVocab();
  out = await tempDir('ducktape-build-');
  ({ manifest } = await buildSet(fixture, out, { version: '1.2.3', concurrency: 2 }));
});

const widths = (files) => files.map((f) => f.w);

test('rungs are the ladder up to the master width plus the native width, never upscaled', async () => {
  const rabbit = manifest.assets['rabbit-church-bells'];
  assert.equal(rabbit.width, 300);
  assert.deepEqual(widths(rabbit.sources.webp), [64, 96, 128, 192, 256, 300]);
  const tile = manifest.assets['stepped-ribbon'];
  assert.deepEqual(widths(tile.sources.webp), [64, 96, 128, 135]);
  assert.equal(tile.resolutionLimited, true);
  for (const [name, file] of [['rabbit-church-bells', 'master.png'], ['stepped-ribbon', 'tile.png']]) {
    const stats = await sharp(path.join(fixture, 'assets', name, file)).ensureAlpha().stats();
    assert.equal(manifest.assets[name].transparent, stats.channels[3].min < 255, name);
  }
  assert.equal(rabbit.transparent, true);
  assert.equal(rabbit.sources.webp[0].path, 'webp/rabbit-church-bells-64.webp');
});

test('AVIF is kept only when the top rung is at most 85 percent of WebP', () => {
  for (const [name, a] of Object.entries(manifest.assets)) {
    const topWebp = a.sources.webp.at(-1).bytes;
    assert.equal(a.encoding.webpTopBytes, topWebp, name);
    assert.equal(a.encoding.avif, a.encoding.avifTopBytes <= 0.85 * topWebp, name);
    assert.equal(Boolean(a.sources.avif), a.encoding.avif, name);
    if (a.sources.avif) assert.deepEqual(widths(a.sources.avif), widths(a.sources.webp), name);
  }
  assert.equal(manifest.assets['rabbit-church-bells'].encoding.avif, true);
});

test('manifest validates, names packages from the set id and records the pinned tooling', async () => {
  const { validate, errorsText } = await loadManifestValidator();
  assert.ok(validate(JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'))), errorsText(validate.errors));
  assert.equal(manifest.package, '@ranx729/ducktape-assets-fixture-set');
  assert.equal(manifest.mastersPackage, '@ranx729/ducktape-assets-fixture-set-masters');
  assert.equal(manifest.cdn, 'https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-fixture-set@1.2.3/');
  assert.equal(manifest.tooling.concurrency, 1);
  assert.match(manifest.inputsHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(manifest.parts, undefined);
});

test('tile gets a rotated ladder and frame gets an atlas with the authored slice', async () => {
  const a = manifest.assets['stepped-ribbon'];
  assert.equal(a.render.tile.axis, 'x');
  const rotated = a.render.tile.rotated.webp;
  assert.ok(rotated.length >= 3);
  assert.deepEqual(rotated.at(-1), { ...rotated.at(-1), w: 59, h: 135 }); // 135x59 tile, turned 90 degrees
  const meta = await sharp(path.join(out, rotated.at(-1).path)).metadata();
  assert.deepEqual([meta.width, meta.height], [59, 135]);

  assert.equal(a.render.frame.corner, 'corner');
  assert.equal(a.render.frame.slice, 33.3);
  const atlas = a.render.frame.atlas.webp;
  assert.deepEqual(widths(atlas), [64, 96, 128, 177]); // corner 59 px is 33.3 percent of 177 px
  for (const f of atlas) assert.ok(Math.abs(f.w - f.h) <= 1, 'the atlas is square');
  assert.ok(a.components.corner.master.path.endsWith('stepped-ribbon.corner.webp'));
  assert.deepEqual(widths(a.components.corner.sources.webp), [59]);
});

test('every listed file exists with the listed size and hash, under a measured palette and thumbhash', async () => {
  for (const a of Object.values(manifest.assets)) {
    assert.ok(a.palette.length >= 1 && a.palette.length <= 5);
    assert.ok(a.palette.every((c) => /^#[0-9a-f]{6}$/.test(c)));
    assert.ok(a.thumbhash.length > 10);
    for (const f of [...allFiles(a), a.master, ...Object.values(a.components ?? {}).map((c) => c.master)]) {
      const bytes = await readFile(path.join(out, f.path));
      assert.equal(bytes.length, f.bytes, f.path);
    }
  }
});

test('volume assignment is sticky, fills the newest part and never exceeds the limit', () => {
  const file = (p, bytes, pkg) => ({ path: p, bytes, ...(pkg ? { package: pkg } : {}) });
  const existing = { assets: { a: { sources: { webp: [file('webp/a-1', 60), file('webp/a-2', 30), file('webp/a-3', 50, 'part2')] }, render: {} } } };
  const next = [
    { path: 'webp/a-1', bytes: 70 }, // grew; still part1
    { path: 'webp/a-2', bytes: 30 },
    { path: 'webp/a-3', bytes: 50 },
    { path: 'webp/b-1', bytes: 40 }, { path: 'webp/b-2', bytes: 40 }, { path: 'webp/b-3', bytes: 40 },
  ];
  const result = assignPackages(existing, next, { limit: 100 });
  assert.equal(result.get('webp/a-1'), 'part1');
  assert.equal(result.get('webp/a-2'), 'part1');
  assert.equal(result.get('webp/a-3'), 'part2');
  assert.deepEqual(['webp/b-1', 'webp/b-2', 'webp/b-3'].map((p) => result.get(p)), ['part2', 'part3', 'part3']);
  assert.deepEqual([...assignPackages(existing, [...next].reverse(), { limit: 100 })], [...result]);

  const fresh = assignPackages(null, Array.from({ length: 10 }, (_, i) => ({ path: `f${i}`, bytes: 30 })), { limit: 100 });
  const totals = {};
  for (const [p, name] of fresh) totals[name] = (totals[name] ?? 0) + 30;
  assert.deepEqual(totals, { part1: 90, part2: 90, part3: 90, part4: 30 });
});

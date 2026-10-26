import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copy } from '../src/copy.mjs';
import { writeTree } from './fixture.mjs';

const config = {
  pin: '@ranx729/ducktape-assets@0.0.0',
  assets: [
    'walters-w102/rabbit-church-bells',
    { id: 'numbered-plate/stepped-ribbon', formats: ['webp'], max: 192 },
    { id: 'floral-borders/floral-border', widths: [200], formats: ['webp', 'svg'], masters: true },
  ],
};

// Silent failure prevented: an app ships a corrupted or wrong file, or re-downloads everything on each run.
test('copy: writes exactly the chosen files, verifies sha256, is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dta-copy-'));
  try {
    const { tree, index } = await writeTree(root);
    const out = join(root, 'out');
    const first = await copy({ config, out, index, base: tree });
    assert.equal(first.skipped, 0);
    assert.equal(first.copied, first.files.length);
    for (const rel of [
      'walters-w102/webp/rabbit-church-bells-768.webp', // part2 file, found without knowing about the split
      'numbered-plate/webp/stepped-ribbon-96.webp',
      'numbered-plate/webp/stepped-ribbon-192.webp',
      'numbered-plate/tiles/stepped-ribbon-rotated-192.webp',
      'floral-borders/masters/floral-border.webp',
      'floral-borders/svg/floral-border.svg',
      'floral-borders/webp/floral-border-256.webp', // smallest rung >= 200
    ])
      assert.ok(first.files.includes(rel), rel);
    assert.ok(!first.files.includes('numbered-plate/webp/stepped-ribbon-384.webp'), 'max 192 excludes 384');
    assert.ok(!first.files.includes('numbered-plate/avif/stepped-ribbon-96.avif'), 'formats excludes avif');
    assert.ok(!first.files.some((f) => f.includes('rabbit-church-bells') && f.includes('masters')), 'no masters unless asked');
    assert.equal(await readFile(join(out, 'floral-borders/masters/floral-border.webp'), 'utf8'), 'fixture bytes of masters/floral-border.webp');

    const m = JSON.parse(await readFile(join(out, 'ducktape.manifest.json'), 'utf8'));
    const rabbit = m.assets['walters-w102/rabbit-church-bells'];
    assert.deepEqual([rabbit.width, rabbit.height, rabbit.license, rabbit.attribution], [1024, 1100, 'CC0', 'Walters Art Museum, W.102']);
    assert.equal(rabbit.thumbhash, '3OcRJYB4d3h/iIeHeEh3eIhw+j2w');
    assert.equal(rabbit.files.sources.webp.at(-1).path, 'walters-w102/webp/rabbit-church-bells-768.webp');
    assert.equal(m.assets['floral-borders/floral-border'].files.master.path, 'floral-borders/masters/floral-border.webp');

    const second = await copy({ config, out, index, base: tree });
    assert.equal(second.copied, 0);
    assert.equal(second.skipped, first.copied);

    // a damaged source file is refused and nothing wrong is written
    await rm(join(out, 'walters-w102'), { recursive: true });
    await writeFile(join(tree, 'walters-w102/webp/rabbit-church-bells-768.webp'), 'tampered');
    await assert.rejects(copy({ config, out, index, base: tree }), /sha256 mismatch/);
    const left = await readdir(join(out, 'walters-w102/webp')).catch(() => []);
    assert.ok(!left.includes('rabbit-church-bells-768.webp'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cli: copy reads ducktape.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dta-cli-'));
  try {
    const { tree, index } = await writeTree(root);
    await writeFile(join(root, 'ducktape.json'), JSON.stringify({ out: 'assets-out', assets: ['floral-borders/floral-border'] }));
    const bin = new URL('../bin/ducktape-assets.mjs', import.meta.url).pathname;
    const { stdout } = await promisify(execFile)(process.execPath, [bin, 'copy', '--config', join(root, 'ducktape.json'), '--out', join(root, 'o'), '--index', index, '--base', tree]);
    assert.match(stdout, /\d+ copied, 0 up to date/);
    assert.ok((await readdir(join(root, 'o'))).includes('ducktape.manifest.json'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

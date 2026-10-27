import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodeResolver } from '../src/node.mjs';

// The package's own data, read from disk: no fetch, hashes straight from the committed manifests.
test('createNodeResolver(): resolves from the shipped index and set manifests without network', async () => {
  globalThis.fetch = () => { throw new Error('fetch must not be called'); };
  const assets = await createNodeResolver({ formats: ['webp'] });
  const img = await assets.image('walters-w102/rabbit-church-bells', { width: 256, dpr: 1 });
  assert.match(img.src, /ducktape-assets-walters-w102@\d+\.\d+\.\d+\/webp\/rabbit-church-bells-256\.webp$/);
  assert.equal(img.file.sha256.length, 64);
  // The shipped manifests are whatever the last publish produced; only the shape is asserted here.
  assert.match(img.attribution, /^Walters Art Museum W\.102/);
  assert.equal(img.license.artwork, 'CC0-1.0');
  assert.deepEqual([img.set, img.package], ['walters-w102', '@ranx729/ducktape-assets-walters-w102']);
  assert.ok(img.src.includes(`@${img.version}/`));
});

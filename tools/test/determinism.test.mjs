// Place 3 of the Testing policy: determinism. Silent failure it guards: output bytes drift between two builds of the
// same inputs (a thread count, a timestamp, an unsorted key), so every publisher run would republish every set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSet } from '../src/build.mjs';
import { fixture, tempDir, useFixtureVocab, allFiles } from './helpers.mjs';

test('two builds of the same set have the same contentHash, inputsHash and per-file sha256', async () => {
  await useFixtureVocab();
  const [a, b] = await Promise.all([0, 1].map(async () => (await buildSet(fixture, await tempDir('ducktape-det-'), { concurrency: 2 })).manifest));
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.inputsHash, b.inputsHash);
  // The credit is bare (licence lives in `license`), and an asset repeats it only when its holding differs.
  assert.equal(a.attribution, 'Walters Art Museum W.82');
  assert.ok(Object.values(a.assets).every((x) => x.attribution === undefined));
  const hashes = (m) => Object.values(m.assets).flatMap((x) => [...allFiles(x), x.master]).map((f) => [f.path, f.sha256]);
  const first = hashes(a);
  assert.ok(first.length > 30);
  assert.deepEqual(first, hashes(b));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, cp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { validateSet } from '../src/validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'ducktape-assets-fixture-set');
const vocabDir = path.resolve(here, '../../schemas/vocab');

// The fixture uses subjects that are not in the seed vocabulary; point validation at a temporary copy that has them.
async function withVocab(subjects) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ducktape-schemas-'));
  await cp(path.resolve(here, '../../schemas'), dir, { recursive: true });
  await writeFile(path.join(dir, 'vocab', 'subjects.yaml'), subjects.map((s) => `- ${s}`).join('\n') + '\n');
  process.env.DUCKTAPE_SCHEMAS_DIR = dir;
  return dir;
}

test('the fixture set is valid', async () => {
  await withVocab(['rabbit', 'bells', 'ribbon']);
  const problems = await validateSet(fixture);
  assert.deepEqual(problems, []);
});

test('unknown subject, missing master and bad related are reported', async () => {
  await withVocab(['rabbit', 'ribbon']);
  const dir = await mkdtemp(path.join(tmpdir(), 'ducktape-assets-fixture-set-'));
  const copy = path.join(dir, 'ducktape-assets-fixture-set');
  await cp(fixture, copy, { recursive: true });
  const f = path.join(copy, 'assets', 'rabbit-church-bells', 'asset.yaml');
  const text = (await readFile(f, 'utf8')).replace('master: master.png', 'master: nope.png').replace('fixture-set/stepped-ribbon', 'fixture-set/missing');
  await writeFile(f, text);
  const messages = (await validateSet(copy)).map((p) => p.message);
  assert.ok(messages.some((m) => m.includes('unknown subject "bells"')));
  assert.ok(messages.some((m) => m.includes('"nope.png" not found')));
  assert.ok(messages.some((m) => m.includes('fixture-set/missing')));
});

test('schema rejects an unknown field and a bad facing', async () => {
  await withVocab(['rabbit', 'bells', 'ribbon']);
  const dir = await mkdtemp(path.join(tmpdir(), 'ducktape-assets-fixture-set-'));
  const copy = path.join(dir, 'ducktape-assets-fixture-set');
  await cp(fixture, copy, { recursive: true });
  const f = path.join(copy, 'assets', 'rabbit-church-bells', 'asset.yaml');
  await writeFile(f, (await readFile(f, 'utf8')).replace('facing: left', 'facing: upwards\nwidth: 100'));
  const messages = (await validateSet(copy)).map((p) => p.message).join('\n');
  assert.match(messages, /facing/);
  assert.match(messages, /additional propert/);
});

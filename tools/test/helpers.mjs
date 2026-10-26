// Shared by the build tests: the fixture set and a temporary copy of schemas/ whose vocabulary has the fixture's subjects.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = path.join(here, 'fixtures', 'ducktape-assets-fixture-set');

export async function useFixtureVocab() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ducktape-schemas-'));
  await cp(path.resolve(here, '../../schemas'), dir, { recursive: true });
  await writeFile(path.join(dir, 'vocab', 'subjects.yaml'), ['rabbit', 'bells', 'ribbon'].map((s) => `- ${s}`).join('\n') + '\n');
  process.env.DUCKTAPE_SCHEMAS_DIR = dir;
}

export const tempDir = (prefix) => mkdtemp(path.join(tmpdir(), prefix));

export function allFiles(asset) {
  const out = [];
  const ladder = (l) => { if (l) out.push(...(l.avif ?? []), ...(l.webp ?? []), ...(l.svg ? [l.svg] : [])); };
  ladder(asset.sources);
  ladder(asset.render.tile?.rotated);
  ladder(asset.render.frame?.atlas);
  for (const c of Object.values(asset.components ?? {})) ladder(c.sources);
  return out;
}

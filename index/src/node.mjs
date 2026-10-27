// Node-only helpers. Kept apart so the resolver stays browser-safe.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResolver } from './resolver.mjs';

/** loadManifest for createResolver: reads `sets/<set>.json` beside a local index.json. */
export function fsManifestLoader(indexPath) {
  const dir = dirname(indexPath);
  return async (setId) => JSON.parse(await readFile(join(dir, 'sets', `${setId}.json`), 'utf8'));
}

/**
 * A resolver over the data shipped in this package (or a local copy of it), with no network at all:
 * the index and every set manifest are read from disk, so build scripts work offline and get the same
 * hashes and bytes the publisher recorded. Options are those of createResolver plus `indexPath`.
 */
export async function createNodeResolver({ indexPath = fileURLToPath(new URL('../index.json', import.meta.url)), ...options } = {}) {
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  return createResolver({ index, loadManifest: fsManifestLoader(indexPath), ...options });
}

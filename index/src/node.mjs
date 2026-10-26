// Node-only helpers. Kept apart so the resolver stays browser-safe.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** loadManifest for createResolver: reads `sets/<set>.json` beside a local index.json. */
export function fsManifestLoader(indexPath) {
  const dir = dirname(indexPath);
  return async (setId) => JSON.parse(await readFile(join(dir, 'sets', `${setId}.json`), 'utf8'));
}

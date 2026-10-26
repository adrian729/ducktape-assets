// Helpers shared by `import`, `new-set` and `readme`: set id rules, the set repository template, YAML output.
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
export const templateDir = () => process.env.DUCKTAPE_TEMPLATE_DIR ?? path.resolve(here, '../../template');
export const exists = (p) => stat(p).then(() => true, () => false);

export const RESERVED_IDS = ['gallery', 'template', 'tools', 'index', 'masters'];
export const KINDS = ['authored', 'historical', 'imported'];
export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Same rules as set.schema.json: pattern, 48 characters, reserved words, no trailing part<n>. Returns an error text or null.
export function checkSetId(id) {
  if (typeof id !== 'string' || id.length === 0) return 'set id is required';
  if (id.length > 48) return `set id "${id}" is longer than 48 characters`;
  if (!ID_PATTERN.test(id)) return `set id "${id}" must match [a-z0-9]+(-[a-z0-9]+)*`;
  if (RESERVED_IDS.includes(id)) return `set id "${id}" is a reserved word (${RESERVED_IDS.join(', ')})`;
  if (/(^|-)part[0-9]+$/.test(id)) return `set id "${id}" must not end in part<n> (reserved for volume packages)`;
  return null;
}

export const repoDirName = (id) => `ducktape-assets-${id}`;

// Copies template/ into dest. Refuses an existing dest unless allowExisting (then only missing files are added).
export async function copyTemplate(dest, { allowExisting = false } = {}) {
  if (await exists(dest)) {
    if (!allowExisting) throw new Error(`${dest} already exists`);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(templateDir(), dest, { recursive: true, force: false, errorOnExist: false });
}

export const toYaml = (obj) => YAML.stringify(obj, { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });

export const LICENSE_URLS = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/legalcode',
  'LicenseRef-PDM': 'https://creativecommons.org/publicdomain/mark/1.0/',
};

export function defaultLicense(kind) {
  if (kind === 'authored') return { artwork: 'CC-BY-4.0', notes: 'Attribution to adrian729.' };
  if (kind === 'historical') return { artwork: 'CC0-1.0', notes: 'Extracted from public domain or CC0 source objects; see SOURCES.md.' };
  return { artwork: 'CC-BY-4.0', notes: 'Origin unrecorded; attribution to adrian729. Removed on any rights claim.' };
}

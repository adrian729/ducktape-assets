// Loads the JSON Schemas and vocabularies shipped in the main repository's schemas/ directory.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
// Read at call time so tests can point at a temporary copy.
export const schemasDir = () => process.env.DUCKTAPE_SCHEMAS_DIR ?? path.resolve(here, '../../schemas');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function loadVocab() {
  const read = async (name) => YAML.parse(await readFile(path.join(schemasDir(), 'vocab', name), 'utf8')) ?? [];
  return {
    categories: new Set(await read('categories.yaml')),
    colors: new Set(await read('colors.yaml')),
    subjects: new Set(await read('subjects.yaml')),
  };
}

export async function loadValidators() {
  // strictRequired is off because conditional subschemas (if/then) require properties declared on the parent.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  addFormats(ajv);
  const set = await readJson(path.join(schemasDir(), 'set.schema.json'));
  const asset = await readJson(path.join(schemasDir(), 'asset.schema.json'));
  ajv.addSchema(set, 'set.schema.json');
  ajv.addSchema(asset, 'asset.schema.json');
  return {
    set: ajv.getSchema('set.schema.json'),
    asset: ajv.getSchema('asset.schema.json'),
    errorsText: (errors) => ajv.errorsText(errors, { separator: '\n  ' }),
  };
}

export async function loadManifestValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  addFormats(ajv);
  const validate = ajv.compile(await readJson(path.join(schemasDir(), 'manifest.schema.json')));
  return { validate, errorsText: (errors) => ajv.errorsText(errors, { separator: '\n  ' }) };
}

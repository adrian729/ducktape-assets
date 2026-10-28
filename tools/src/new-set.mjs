// `new-set <id> --title ... --kind ... [--summary ...] [--license ...] [--local <parent-dir>] [--github] [--registry sets.yaml]`
// Creates ducktape-assets-<id>/ from the template, fills set.yaml and registers the set in the main repo's sets.yaml.
// --github additionally initialises git and runs `gh repo create ... --push`; that path is implemented but never exercised by the tests.
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import YAML from 'yaml';
import { checkSetId, copyTemplate, defaultLicense, exists, KINDS, repoDirName, toYaml } from './setfiles.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultRegistry = () => path.resolve(here, '../../sets.yaml');

export function buildSetYaml({ id, title, summary, kind, license }) {
  const lic = license ? { artwork: license } : defaultLicense(kind);
  return toYaml({
    id, title,
    summary: summary ?? 'One sentence saying what this set contains and where it comes from.',
    kind,
    author: 'adrian729',
    maintainer: 'https://github.com/adrian729/ducktape-assets/issues',
    license: lic,
    tags: [],
  });
}

// Adds { id, status: active, added } to the registry, keeping comments. Throws on a duplicate id.
export async function registerSet(registryPath, id, today) {
  const doc = YAML.parseDocument(await readFile(registryPath, 'utf8'));
  let sets = doc.get('sets');
  if (!sets || !YAML.isSeq(sets)) { doc.set('sets', doc.createNode([])); sets = doc.get('sets'); }
  if (sets.items.some((i) => (i.get ? i.get('id') : i.id) === id)) throw new Error(`set "${id}" is already registered in ${registryPath}`);
  // One flow-style entry per line: scripts/owner-npm-bootstrap.sh lists active sets with a sed over exactly this form.
  const node = doc.createNode({ id, status: 'active', added: today });
  node.flow = true;
  sets.add(node);
  sets.flow = false;
  await writeFile(registryPath, String(doc));
}

export async function newSet(opts, { exec = run, log = console.log } = {}) {
  const { id, title, summary, kind, license, local, github = false, registry = defaultRegistry() } = opts;
  const idError = checkSetId(id);
  if (idError) throw new Error(idError);
  if (!title) throw new Error('new-set needs --title');
  if (!KINDS.includes(kind)) throw new Error(`new-set needs --kind ${KINDS.join('|')}`);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const parent = path.resolve(local ?? '.');
  const dest = path.join(parent, repoDirName(id));
  if (await exists(dest)) throw new Error(`${dest} already exists`);
  if (registry && (await exists(registry))) {
    const doc = YAML.parse(await readFile(registry, 'utf8'));
    if ((doc?.sets ?? []).some((s) => s.id === id)) throw new Error(`set "${id}" is already registered in ${registry}`);
  }

  await copyTemplate(dest);
  await writeFile(path.join(dest, 'set.yaml'), buildSetYaml({ id, title, summary, kind, license }));
  log(`created ${dest}`);

  if (github) {
    const name = `adrian729/${repoDirName(id)}`;
    await exec('git', ['init', '-b', 'main'], { cwd: dest });
    await exec('git', ['add', '-A'], { cwd: dest });
    await exec('git', ['commit', '-m', `Create set ${id} from template`], { cwd: dest });
    await exec('gh', ['repo', 'create', name, '--public', '--source', '.', '--push'], { cwd: dest });
    log(`created and pushed ${name}`);
  }

  if (registry) {
    if (await exists(registry)) { await registerSet(registry, id, today); log(`registered ${id} in ${registry}`); }
    else log(`registry ${registry} not found; set not registered`);
  }
  return dest;
}

export async function runNewSet(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      title: { type: 'string' }, summary: { type: 'string' }, kind: { type: 'string' }, license: { type: 'string' },
      local: { type: 'string' }, github: { type: 'boolean', default: false }, registry: { type: 'string' },
    },
  });
  if (!values.local && !values.github) throw new Error('new-set needs --local <parent-dir> or --github');
  await newSet({ id: positionals[0], ...values });
}

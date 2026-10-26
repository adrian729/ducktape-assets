// `validate <set-repo-dir>`: schemas, vocabularies, id rules, master files, provenance and licence completeness.
// Returns a list of problems; empty means valid. Never throws on bad input, only on missing files.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { loadValidators, loadVocab } from './schemas.mjs';

const exists = async (p) => stat(p).then(() => true, () => false);

export async function validateSet(repoDir) {
  const problems = [];
  const problem = (where, message) => problems.push({ where, message });
  const { set: validateSetYaml, asset: validateAssetYaml, errorsText } = await loadValidators();
  const vocab = await loadVocab();

  const setFile = path.join(repoDir, 'set.yaml');
  if (!(await exists(setFile))) return [{ where: 'set.yaml', message: 'missing' }];
  const set = YAML.parse(await readFile(setFile, 'utf8'));
  if (!validateSetYaml(set)) problem('set.yaml', errorsText(validateSetYaml.errors));
  const setId = set?.id;
  const repoName = path.basename(path.resolve(repoDir));
  if (setId && repoName !== `ducktape-assets-${setId}` && !process.env.DUCKTAPE_ALLOW_REPO_NAME) {
    problem('set.yaml', `repository directory "${repoName}" does not match set id "${setId}" (expected ducktape-assets-${setId}; set DUCKTAPE_ALLOW_REPO_NAME=1 for registered exceptions)`);
  }

  const assetsDir = path.join(repoDir, 'assets');
  if (!(await exists(assetsDir))) { problem('assets/', 'missing directory'); return problems; }
  const entries = (await readdir(assetsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (entries.length === 0) problem('assets/', 'no assets');

  const ids = new Set();
  const allRelated = [];
  for (const dir of entries) {
    const where = `assets/${dir}/asset.yaml`;
    const file = path.join(assetsDir, dir, 'asset.yaml');
    if (!(await exists(file))) { problem(where, 'missing'); continue; }
    let asset;
    try { asset = YAML.parse(await readFile(file, 'utf8')); } catch (e) { problem(where, `YAML: ${e.message}`); continue; }
    if (!validateAssetYaml(asset)) problem(where, errorsText(validateAssetYaml.errors));
    if (!asset || typeof asset !== 'object') continue;

    if (asset.id !== dir) problem(where, `id "${asset.id}" does not match directory "${dir}"`);
    if (ids.has(asset.id)) problem(where, `duplicate id "${asset.id}"`);
    ids.add(asset.id);

    for (const c of asset.categories ?? []) if (!vocab.categories.has(c)) problem(where, `unknown category "${c}"`);
    for (const c of asset.colors ?? []) if (!vocab.colors.has(c)) problem(where, `unknown color "${c}"`);
    for (const s of asset.subjects ?? []) if (!vocab.subjects.has(s)) problem(where, `unknown subject "${s}" (add it to schemas/vocab/subjects.yaml in this PR)`);

    const masters = [['master', asset.master], ...Object.entries(asset.components ?? {}).map(([k, v]) => [`components.${k}.master`, v?.master])];
    for (const [field, f] of masters) {
      if (typeof f !== 'string') continue;
      if (!(await exists(path.join(assetsDir, dir, f)))) problem(where, `${field} file "${f}" not found`);
    }
    if (asset.render?.frame && !asset.components?.[asset.render.frame.corner]) {
      problem(where, `render.frame.corner "${asset.render.frame.corner}" is not a component`);
    }

    if (set?.kind === 'historical' && !asset.provenance) problem(where, 'provenance is required in a historical set');
    if (asset.provenance === null && set?.kind !== 'imported') problem(where, 'provenance: null is allowed only in sets of kind imported');
    if (asset.status === 'approved' && asset.review === 'pending') problem(where, 'approved asset still has review: pending');

    for (const r of asset.related ?? []) allRelated.push({ where, asset: r.asset });
  }
  for (const r of allRelated) {
    const [relSet, relId] = r.asset.split('/');
    if (relSet === setId && !ids.has(relId)) problem(r.where, `related asset "${r.asset}" does not exist in this set`);
  }
  return problems;
}

export function formatProblems(problems) {
  if (problems.length === 0) return 'valid';
  return problems.map((p) => `${p.where}: ${p.message}`).join('\n');
}

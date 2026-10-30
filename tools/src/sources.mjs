// `sources add <set-repo-dir> <file>... [--tag sources-<date>] [--note ...] [--repo owner/name]`
// `sources pull <set-repo-dir> [--out <dir>] [--repo owner/name]`
// Cold storage for raw inputs (scans, AI generation outputs, traces): each file is attached to a GitHub Release of the
// set repository and listed in sources.yaml with its sha256, which is what `provenance.source_sha256` names. Never
// needed to build. Runs locally with a logged-in `gh`; nothing here runs in CI. `pull` downloads every listed file and
// verifies its hash, which is the level 3 recovery of the CDN contingency.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import YAML from 'yaml';
import { exists } from './setfiles.mjs';

const run = promisify(execFile);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const RELEASE_NOTES = 'Cold-storage inputs (scans, AI generation outputs, traces) of this set, listed in sources.yaml with their hashes. Never needed to build; kept so that an asset can be re-extracted.';
const EMPTY = '# Cold-storage inputs (scans, AI outputs, traces) attached to GitHub Releases of this repository, with hashes.\n# Managed by `ducktape-assets-tools sources add`. Not needed to build.\nsources: []\n';

async function loadInventory(repoDir, repo) {
  const set = YAML.parse(await readFile(path.join(repoDir, 'set.yaml'), 'utf8'));
  const file = path.join(repoDir, 'sources.yaml');
  const doc = YAML.parseDocument((await exists(file)) ? await readFile(file, 'utf8') : EMPTY);
  if (!YAML.isSeq(doc.get('sources'))) doc.set('sources', doc.createNode([]));
  return { set, file, doc, repo: repo ?? `adrian729/ducktape-assets-${set.id}`, entries: doc.get('sources').toJSON() ?? [] };
}

export async function sourcesAdd(repoDir, files, { tag, note, repo, today = new Date().toISOString().slice(0, 10), exec = run, log = console.log } = {}) {
  if (!files.length) throw new Error('sources add needs at least one file');
  const inv = await loadInventory(repoDir, repo);
  const release = tag ?? `sources-${today}`;
  const seq = inv.doc.get('sources');
  let ensured = false;
  const ensureRelease = async () => {
    if (ensured) return;
    try { await exec('gh', ['release', 'view', release, '-R', inv.repo]); } catch {
      await exec('gh', ['release', 'create', release, '-R', inv.repo, '--title', `Sources ${release.replace(/^sources-/, '')}`, '--notes', RELEASE_NOTES]);
      log(`created release ${release} on ${inv.repo}`);
    }
    ensured = true;
  };
  const added = [];
  for (const f of files) {
    const bytes = await readFile(f);
    const hash = sha256(bytes);
    const name = path.basename(f);
    const dup = inv.entries.find((e) => e.sha256 === hash);
    if (dup) { log(`${name}: already listed as ${dup.file} in ${dup.release}; skipped`); continue; }
    if (inv.entries.some((e) => e.file === name && e.release === release)) throw new Error(`${name} is already in ${release} with different bytes; rename the file`);
    await ensureRelease();
    await exec('gh', ['release', 'upload', release, f, '-R', inv.repo, '--clobber']);
    const entry = { file: name, sha256: hash, bytes: bytes.length, release, added: today, ...(note ? { note } : {}) };
    const node = inv.doc.createNode(entry);
    node.flow = true; // one entry per line, like sets.yaml
    seq.add(node);
    inv.entries.push(entry);
    added.push(entry);
    log(`${name}: ${bytes.length} bytes, sha256 ${hash}, in ${release}`);
  }
  seq.flow = false;
  await writeFile(inv.file, inv.doc.toString({ lineWidth: 0 }));
  return added;
}

export async function sourcesPull(repoDir, { out, repo, exec = run, log = console.log } = {}) {
  const inv = await loadInventory(repoDir, repo);
  const dir = path.resolve(out ?? `sources-${inv.set.id}`);
  await mkdir(dir, { recursive: true });
  for (const e of inv.entries) {
    await exec('gh', ['release', 'download', e.release, '-R', inv.repo, '-p', e.file, '-D', dir, '--clobber']);
    const got = sha256(await readFile(path.join(dir, e.file)));
    if (got !== e.sha256) throw new Error(`${e.file}: sha256 ${got} does not match sources.yaml (${e.sha256})`);
    log(`${e.file}: verified`);
  }
  return { dir, count: inv.entries.length };
}

export async function runSources(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { tag: { type: 'string' }, note: { type: 'string' }, out: { type: 'string' }, repo: { type: 'string' } } });
  const [sub, dir = '.', ...files] = positionals;
  if (sub === 'add') {
    const added = await sourcesAdd(dir, files, { tag: values.tag, note: values.note, repo: values.repo });
    console.log(`${added.length} source(s) added to ${path.join(dir, 'sources.yaml')}; name them in provenance.source_sha256`);
  } else if (sub === 'pull') {
    const r = await sourcesPull(dir, { out: values.out, repo: values.repo });
    console.log(`${r.count} source(s) in ${r.dir}, every hash verified`);
  } else throw new Error('usage: sources add <set-repo-dir> <file>... | sources pull <set-repo-dir> [--out <dir>]');
}

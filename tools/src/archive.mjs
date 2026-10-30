// `archive --plan plan.json [--cache dir] [--record releases] [--index index] [--tag run-<id>]`
// Packs every package the run published into its npm tarball and attaches them all to one GitHub Release of the main
// repository (tag `run-<id>`), then notes the release in the run's record. This is the archive of record if npm ever
// refuses the project (CDN contingency, level 2): a tarball holds the whole package tree, and `deploy-cdn` can be fed
// from it. Decided 2026-10-30: the Release lives on the main repository, which the publish job writes with its own
// token; one per set repository would need a cross-repository credential, which the invariants forbid.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAIN_REPO } from './pack.mjs';

const exec_ = promisify(execFile);
const run = (cmd, args, opts) => exec_(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });

export const archivable = (record) => record.packages.filter((p) => p.result === 'published');

export async function findRecord(recordDir, runId) {
  const name = (await readdir(recordDir)).find((f) => f.endsWith(`-${runId}.json`));
  if (!name) throw new Error(`no release record for run ${runId} in ${recordDir}`);
  const file = path.join(recordDir, name);
  return { file, record: JSON.parse(await readFile(file, 'utf8')) };
}

export async function archiveRun({ planFile, cacheDir = '.ducktape-cache', recordDir = 'releases', indexDir = 'index', runId = process.env.GITHUB_RUN_ID ?? 'local', tag = `run-${runId}`, repo = MAIN_REPO, exec = run, log = () => {} }) {
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  const { file, record } = await findRecord(recordDir, runId);
  const targets = archivable(record);
  if (!targets.length) { log('nothing was published in this run; no archive'); return { tag: null, assets: [], file }; }
  const tarDir = path.resolve(cacheDir, 'tarballs');
  await rm(tarDir, { recursive: true, force: true });
  await mkdir(tarDir, { recursive: true });
  const assets = [];
  for (const p of targets) {
    const dir = p.kind === 'index' ? indexDir : path.join(cacheDir, plan.packages.find((x) => x.name === p.name)?.dir ?? '');
    const { stdout } = await exec('npm', ['pack', '--json', '--pack-destination', tarDir], { cwd: dir });
    const filename = JSON.parse(stdout)[0].filename;
    const buf = await readFile(path.join(tarDir, filename));
    assets.push({ name: p.name, version: p.version, file: filename, bytes: buf.length, sha256: 'sha256:' + createHash('sha256').update(buf).digest('hex') });
    log(`packed ${p.name}@${p.version}: ${(buf.length / 1e6).toFixed(1)} MB`);
  }
  const notes = [
    'Tarballs of every package this publisher run published, as `npm pack` wrote them: the archive of record if npm ever refuses the project (docs/vault/Design/CDN contingency.md, level 2).',
    '', `Release record: \`releases/${path.basename(file)}\`.`, '',
    '| package | version | bytes | sha256 |', '| --- | --- | --- | --- |',
    ...assets.map((a) => `| ${a.name} | ${a.version} | ${a.bytes} | ${a.sha256} |`),
  ].join('\n');
  await exec('gh', ['release', 'create', tag, '-R', repo, '--title', `Publisher run ${runId}`, '--notes', notes, ...assets.map((a) => path.join(tarDir, a.file))]);
  record.archive = { tag, url: `https://github.com/${repo}/releases/tag/${tag}`, assets };
  await writeFile(file, JSON.stringify(record, null, 2) + '\n');
  log(`archived ${assets.length} package(s) in ${record.archive.url}`);
  return { tag, assets, file };
}

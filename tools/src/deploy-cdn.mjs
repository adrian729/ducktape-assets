// `deploy-cdn [--index index] [--records releases] [--sets a,b] [--work .ducktape-cdn] [--account <subdomain>] [--months 12] [--dry-run]`
// CDN contingency, level 1: one Cloudflare Worker with static assets per set, named `ducktape-assets-<set>`, serving
// `/<version>/<path>` for the delivery package, its parts and the masters package folded into one tree, with
// `_headers` for `immutable` and CORS. A deployment replaces the Worker's whole tree, so every run lays out every
// retained version: the versions pinned by the index releases of the last N months (release records) plus the
// current pin, capped by Cloudflare's 20,000 files per Worker. Needs CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID
// when the token does not imply one); `--dry-run` only lays the trees out and prints the commands, which is how the
// step is exercised without an account. The index then switches bases through DUCKTAPE_CDN_TEMPLATE (publish.mjs).
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec_ = promisify(execFile);
const run = (cmd, args, opts) => exec_(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });

export const WRANGLER = '4.156.0';
export const FILE_LIMIT = 20_000;
const HEADERS = '/*\n  Cache-Control: public, max-age=31536000, immutable\n  Access-Control-Allow-Origin: *\n';
export const workerName = (set) => `ducktape-assets-${set}`;
export const workerBase = (set, account, version) => `https://${workerName(set)}.${account}.workers.dev/${version}/`;
// The template the index switches to when the fallback is live; `<set>` and `<version>` are substituted.
export const cdnTemplate = (account) => `https://ducktape-assets-<set>.${account}.workers.dev/<version>/`;

// { set: [version, ...] } to keep on the fallback host.
export async function retainedVersions({ indexDir = 'index', recordDir = 'releases', months = 12, now = new Date() } = {}) {
  const index = JSON.parse(await readFile(path.join(indexDir, 'index.json'), 'utf8'));
  const out = {};
  for (const [set, e] of Object.entries(index.sets)) out[set] = new Set([e.version]);
  const since = new Date(now);
  since.setMonth(since.getMonth() - months);
  for (const f of (await readdir(recordDir).catch(() => [])).filter((x) => x.endsWith('.json')).sort()) {
    const r = JSON.parse(await readFile(path.join(recordDir, f), 'utf8'));
    if (r.dryRun || r.index?.result !== 'published' || !r.index.pins || new Date(r.startedAt) < since) continue;
    for (const [set, v] of Object.entries(r.index.pins)) if (out[set]) out[set].add(v);
  }
  return Object.fromEntries(Object.entries(out).map(([s, v]) => [s, [...v].sort()]));
}

async function fetchTree(pkg, version, dest, exec) {
  const tmp = await mkdtemp(path.join(tmpdir(), 'ducktape-cdn-'));
  try {
    const { stdout } = await exec('npm', ['pack', `${pkg}@${version}`, '--json', '--pack-destination', tmp]);
    await mkdir(dest, { recursive: true });
    await exec('tar', ['-xzf', path.join(tmp, JSON.parse(stdout)[0].filename), '-C', dest, '--strip-components=1', 'package']);
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

async function treeStats(dir) {
  let files = 0, bytes = 0;
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    files += 1;
    bytes += (await stat(path.join(e.parentPath ?? e.path, e.name))).size;
  }
  return { files, bytes };
}

export async function layoutSet({ set, entry, versions, work, exec = run, log = () => {} }) {
  const root = path.join(work, workerName(set));
  const dist = path.join(root, 'dist');
  await rm(root, { recursive: true, force: true });
  for (const v of versions) {
    const dest = path.join(dist, v);
    await fetchTree(entry.package, v, dest, exec);
    // That version's own manifest says which parts and masters packages it had; the current index entry may differ.
    const m = JSON.parse(await readFile(path.join(dest, 'manifest.json'), 'utf8'));
    for (const p of [...(m.parts ?? []), m.mastersPackage, ...(m.mastersParts ?? [])]) await fetchTree(p, v, dest, exec);
    await rm(path.join(dest, 'package.json'), { force: true }); // the last tarball's package.json; not an asset
    log(`${set}@${v}: laid out`);
  }
  await writeFile(path.join(dist, '_headers'), HEADERS);
  const config = path.join(root, 'wrangler.jsonc');
  await writeFile(config, JSON.stringify({ name: workerName(set), compatibility_date: '2026-10-01', assets: { directory: './dist' } }, null, 2) + '\n');
  return { config, dist, ...(await treeStats(dist)) };
}

export async function deployCdn({ indexDir = 'index', recordDir = 'releases', sets = [], work = '.ducktape-cdn', account, months = 12, dryRun = false, exec = run, fetchFn = fetch, log = () => {} } = {}) {
  const index = JSON.parse(await readFile(path.join(indexDir, 'index.json'), 'utf8'));
  const retained = await retainedVersions({ indexDir, recordDir, months });
  const chosen = Object.keys(index.sets).filter((s) => !sets.length || sets.includes(s));
  if (!dryRun && !process.env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is not set (see docs/vault/Design/CDN contingency.md); use --dry-run to lay the trees out only');
  const rows = [];
  for (const set of chosen) {
    const versions = retained[set];
    const laid = await layoutSet({ set, entry: index.sets[set], versions, work, exec, log });
    const row = { set, versions, files: laid.files, bytes: laid.bytes, deployed: false, verified: null, error: null };
    if (laid.files > FILE_LIMIT) row.error = `${laid.files} files, over the ${FILE_LIMIT} per Worker; shorten --months`;
    else if (dryRun) log(`dry run: npx --yes wrangler@${WRANGLER} deploy --config ${laid.config}`);
    else {
      await exec('npx', ['--yes', `wrangler@${WRANGLER}`, 'deploy', '--config', laid.config], { env: process.env });
      row.deployed = true;
      if (account) {
        const url = workerBase(set, account, index.sets[set].version) + 'manifest.json';
        const res = await fetchFn(url);
        const cc = res.headers?.get('cache-control') ?? '';
        row.verified = res.status === 200 && cc.includes('immutable') && res.headers?.get('access-control-allow-origin') === '*';
        row.url = url;
      }
    }
    rows.push(row);
  }
  return { rows, ok: rows.every((r) => !r.error && (dryRun || (r.deployed && r.verified !== false))), template: account ? cdnTemplate(account) : null };
}

export function formatDeployTable({ rows, ok, template }) {
  const lines = ['| set | versions | files | MB | deployed | verified |', '| --- | --- | --- | --- | --- | --- |'];
  for (const r of rows) lines.push(`| ${r.set} | ${r.versions.join(', ')} | ${r.files} | ${(r.bytes / 1e6).toFixed(1)} | ${r.error ? r.error : r.deployed ? 'yes' : 'dry run'} | ${r.verified === null ? '-' : r.verified ? 'ok' : 'FAILED'} |`);
  lines.push('', ok ? 'OK' : 'NOT OK', ...(template ? ['', `Index base template for the switch: DUCKTAPE_CDN_TEMPLATE=${template}`] : []));
  return lines.join('\n');
}

// `check-cdn`: verify that jsDelivr serves what was published (see docs/vault/Design/CDN contingency.md).
// Delivery packages are checked through manifest.json, every other package through package.json (the `ducktape`
// block carries the hashes). Failures are classified: level 0 = some packages refused (403), level 1 = every
// package refused (project-level block). Other failures (404 after the retries, hash mismatch) have no level.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CDN = 'https://cdn.jsdelivr.net/npm';
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const readJsonIf = async (file) => readFile(file, 'utf8').then(JSON.parse, () => null);
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function targetsFromPlan(plan, indexDir) {
  const indexPkg = await readJsonIf(path.join(indexDir, 'package.json'));
  return plan.packages.map((p) => {
    const expected = p.kind === 'index'
      ? (indexPkg?.version === p.version ? indexPkg.ducktape ?? {} : {})
      : { inputsHash: p.inputsHash, contentHash: p.contentHash };
    return { name: p.name, version: p.version, kind: p.kind, expected };
  });
}

// Every pinned package of index/index.json, plus the index package itself.
export async function targetsFromIndex(indexDir) {
  const index = await readJsonIf(path.join(indexDir, 'index.json'));
  const out = [];
  for (const [setId, s] of Object.entries(index?.sets ?? {})) {
    const manifest = await readJsonIf(path.join(indexDir, 'sets', `${setId}.json`));
    const expected = { inputsHash: manifest?.inputsHash, contentHash: s.contentHash ?? manifest?.contentHash };
    out.push({ name: s.package, version: s.version, kind: 'delivery', expected });
    for (const n of s.parts ?? []) out.push({ name: n, version: s.version, kind: 'delivery-part', expected });
    out.push({ name: s.mastersPackage, version: s.version, kind: 'masters', expected });
    for (const n of s.mastersParts ?? []) out.push({ name: n, version: s.version, kind: 'masters-part', expected });
  }
  const pkg = await readJsonIf(path.join(indexDir, 'package.json'));
  if (pkg && pkg.version !== '0.0.0') out.push({ name: pkg.name, version: pkg.version, kind: 'index', expected: pkg.ducktape ?? {} });
  return out;
}

async function checkOne(t, { fetchFn, retries, delayMs, sleep }) {
  const file = t.kind === 'delivery' ? 'manifest.json' : 'package.json';
  const url = `${CDN}/${t.name}@${t.version}/${file}`;
  let last = { result: 'error', http: null, detail: 'no attempt' };
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url);
      if (res.status === 200) {
        const doc = await res.json();
        const found = file === 'manifest.json' ? doc : doc.ducktape ?? {};
        const bad = ['inputsHash', 'contentHash'].filter((k) => t.expected[k] && found[k] !== t.expected[k]);
        if (file === 'package.json' && doc.version !== t.version) bad.push('version');
        return bad.length
          ? { ...t, url, attempts: attempt, http: 200, result: 'mismatch', detail: `differs from the plan: ${bad.join(', ')}` }
          : { ...t, url, attempts: attempt, http: 200, result: 'ok', detail: '' };
      }
      last = { result: `http-${res.status}`, http: res.status, detail: `HTTP ${res.status}` };
    } catch (e) {
      last = { result: 'error', http: null, detail: e.message };
    }
    if (attempt < retries) await sleep(delayMs);
  }
  return { ...t, url, attempts: retries, ...last };
}

export function classifyFailures(results) {
  const failed = results.filter((r) => r.result !== 'ok');
  const blocked = results.filter((r) => r.http === 403);
  let level = null;
  if (blocked.length) level = blocked.length === results.length && results.length >= 2 ? 1 : 0;
  return { failed, level };
}

export const LEVEL_MESSAGES = {
  0: 'Level 0 (one or more packages refused, not all): correct the build, republish as a new patch version, republish the index. See docs/vault/Design/CDN contingency.md.',
  1: 'Level 1 (jsDelivr refuses every package): arm plan B, Cloudflare Workers Static Assets (CDN_PROVIDER=cloudflare, see docs/vault/Design/CDN contingency.md).',
};

export async function checkCdn({ targets, fetchFn = fetch, retries = 6, delayMs = 10_000, sleep = defaultSleep, concurrency = 8 }) {
  const results = new Array(targets.length);
  let next = 0;
  const worker = async () => { while (next < targets.length) { const i = next++; results[i] = await checkOne(targets[i], { fetchFn, retries, delayMs, sleep }); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  const { failed, level } = classifyFailures(results);
  return { checkedAt: new Date().toISOString(), ok: failed.length === 0, level, results: results.map(({ expected, ...r }) => r) };
}

export function formatTable(outcome) {
  const rows = [['package', 'version', 'file', 'result', 'tries'], ...outcome.results.map((r) => [r.name, r.version, r.kind === 'delivery' ? 'manifest.json' : 'package.json', r.result === 'ok' ? 'ok' : `${r.result}${r.detail && r.result === 'mismatch' ? ` (${r.detail})` : ''}`, String(r.attempts)])];
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = rows.map((r) => r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd());
  lines.splice(1, 0, w.map((n) => '-'.repeat(n)).join('  '));
  if (!outcome.ok && outcome.level !== null) lines.push('', LEVEL_MESSAGES[outcome.level]);
  return lines.join('\n');
}

// Appends the outcome to this run's release record (the file whose name ends in -<runId>.json), creating one if absent.
export async function recordOutcome(recordDir, runId, outcome, date = new Date().toISOString().slice(0, 10)) {
  await mkdir(recordDir, { recursive: true });
  const existing = (await readdir(recordDir)).find((f) => f.endsWith(`-${runId}.json`));
  const file = path.join(recordDir, existing ?? `${date}-${runId}.json`);
  const record = (await readJsonIf(file)) ?? { schema: 1, runId: String(runId) };
  record.cdn = outcome;
  await writeFile(file, json(record));
  return file;
}

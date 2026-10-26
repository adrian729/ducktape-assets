// Ducktape Assets Phase 0 spike: sharp AVIF vs WebP, timing, determinism.
// Usage: node bench.mjs <outDir> <resultsJson> [--concurrency=N] [--only=name1,name2] [--max-rung=W] [--no-lossless]
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MED = '/home/ranx729/projects/medieval-ornaments';
const args = process.argv.slice(2);
const [outDir, resultsPath] = args;
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
if (opt.concurrency) sharp.concurrency(Number(opt.concurrency));
const maxRung = opt['max-rung'] ? Number(opt['max-rung']) : Infinity;

const BORDERS = [
  // strips / repeat tiles
  'gold-quatrefoil-vine', 'red-berry-vine', 'rosselli-foliate-border', 'white-curling-vine-on-blue-repeat',
  'upright-palmettes-and-four-lobed-scroll-cycle', 'gray-red-blue-lobed-leaves-in-gold-medallions-cycle',
  'opposed-blue-red-leaves-with-gray-interlace-cycle', 'white-foliate-wave-on-blue',
  // frames
  'ivy-manuscript-frame', 'hoefnagel-strapwork-frame', 'isabella-gold-floral-frame', 'palmette-scroll-printer-frame',
  // corners
  'ivy-corner', 'illuminated-acanthus-corner', 'oak-leaf-corner-flourish', 'illuminated-acanthus-corner-top-right',
  // dividers
  'briar-divider', 'gold-lozenge-divider-center', 'gold-cinquefoil-divider-end', 'illuminated-acanthus-divider-center',
];
const catalog = JSON.parse(fs.readFileSync(`${MED}/images.json`, 'utf8'));
const byName = new Map(catalog.map(e => [e.name, e]));
const findPng = name => {
  for (const d of fs.readdirSync(`${MED}/tmp/resource-checkouts`)) {
    const p = `${MED}/tmp/resource-checkouts/${d}/png/${name}.png`;
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no master ' + name);
};
const illustrations = catalog.filter(e => e.asset_type === 'illustration' && e.has_transparency)
  .sort((a, b) => b.width - a.width).slice(0, 10).map(e => e.name);
let selection = [...BORDERS.map(n => ({ name: n, group: 'border' })), ...illustrations.map(n => ({ name: n, group: 'illustration' }))];
if (opt.only) { const s = new Set(opt.only.split(',')); selection = selection.filter(x => s.has(x.name)); }
for (const s of selection) {
  const e = byName.get(s.name); if (!e) throw new Error('not in catalog ' + s.name);
  if (!e.has_transparency || (s.group === 'border' && e.asset_type === 'illustration')) throw new Error('bad pick ' + s.name);
}

const LADDER = [64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const now = () => Number(process.hrtime.bigint()) / 1e9;
const AVIF_GUARD_S = 120;

const results = [];
const t0all = now();
for (const { name, group } of selection) {
  const png = findPng(name);
  const pngBytes = fs.statSync(png).size;
  const meta = await sharp(png).metadata();
  const W = meta.width, H = meta.height;
  const widths = LADDER.filter(w => w <= W && w <= maxRung);
  if (W < 2048 && W <= maxRung && !widths.includes(W)) widths.push(W);
  widths.sort((a, b) => a - b);
  const top = widths.at(-1);
  console.error(`[${group}] ${name} ${W}x${H} png=${pngBytes} rungs=${widths.join(',')}`);
  const dir = path.join(outDir, name); fs.mkdirSync(dir, { recursive: true });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  const files = [];
  const assetStart = now();
  let avifSkipped = [];
  async function enc(kind, w) {
    const file = `${name}-${w}${kind === 'webp-lossless' ? '-lossless' : ''}.${kind === 'avif' ? 'avif' : 'webp'}`;
    let p = raw();
    if (w !== W) p = p.resize({ width: w, kernel: 'lanczos3', withoutEnlargement: true });
    if (kind === 'webp') p = p.webp({ quality: 82, alphaQuality: 100, effort: 6 });
    else if (kind === 'webp-lossless') p = p.webp({ lossless: true, effort: 6 });
    else p = p.avif({ quality: 60, effort: w <= 256 ? 6 : 4 });
    const t = now();
    const { data: buf, info: oi } = await p.toBuffer({ resolveWithObject: true });
    const sec = now() - t;
    fs.writeFileSync(path.join(dir, file), buf);
    files.push({ file, kind, width: w, height: oi.height, bytes: buf.length, sec, sha256: sha(buf) });
  }
  // top rung first (needed for the rule), then the rest ascending
  await enc('webp', top); await enc('avif', top);
  for (const w of widths.slice(0, -1)) await enc('webp', w);
  for (const w of widths.slice(0, -1)) {
    if (now() - assetStart > AVIF_GUARD_S) { avifSkipped.push(w); continue; }
    await enc('avif', w);
  }
  if (!opt['no-lossless']) await enc('webp-lossless', Math.min(W, 2048));
  const totalSec = now() - assetStart;
  results.push({ name, group, master: { width: W, height: H, pngBytes }, widths, top, totalSec, avifSkipped, files });
  console.error(`   total ${totalSec.toFixed(1)}s${avifSkipped.length ? ' SKIPPED AVIF ' + avifSkipped : ''}`);
}
const totalSec = now() - t0all;
fs.writeFileSync(resultsPath, JSON.stringify({ versions: sharp.versions, concurrency: sharp.concurrency(), totalSec, results }, null, 1));
console.error(`done ${totalSec.toFixed(1)}s`);

// node analyze.mjs results-run1.json [results-run2.json]
import fs from 'node:fs';
const R = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const kb = b => (b / 1024).toFixed(0);
const sum = a => a.reduce((x, y) => x + y, 0);
const rows = R.results.map(a => {
  const f = k => a.files.filter(x => x.kind === k);
  const w = f('webp').find(x => x.width === a.top), v = f('avif').find(x => x.width === a.top);
  const ratio = v.bytes / w.bytes;
  const webpLadder = sum(f('webp').map(x => x.bytes));
  const avifLadder = sum(f('avif').map(x => x.bytes));
  const ll = f('webp-lossless')[0];
  return { a, w, v, ratio, keep: ratio <= 0.85, webpLadder, avifLadder, ll };
});
console.log('| group | asset | master | top | WebP B | AVIF B | ratio | decision | ladder WebP only KB | ladder WebP+AVIF KB | ladder s |');
console.log('|--|--|--|--|--|--|--|--|--|--|--|');
for (const r of rows) console.log(`| ${r.a.group[0]} | ${r.a.name.slice(0, 44)} | ${r.a.master.width}x${r.a.master.height} | ${r.a.top} | ${r.w.bytes} | ${r.v.bytes} | ${r.ratio.toFixed(3)} | ${r.keep ? 'AVIF' : 'WebP only'} | ${kb(r.webpLadder)} | ${kb(r.webpLadder + r.avifLadder)} | ${r.a.totalSec.toFixed(1)} |`);
for (const g of ['border', 'illustration']) {
  const s = rows.filter(r => r.a.group === g);
  const ratios = s.map(r => r.ratio).sort((a, b) => a - b);
  console.log(`${g}: AVIF wins ${s.filter(r => r.keep).length}/${s.length}; ratio min ${ratios[0].toFixed(3)} median ${ratios[Math.floor(ratios.length / 2)].toFixed(3)} max ${ratios.at(-1).toFixed(3)}; ratios in (0.85,0.95]: ${s.filter(r => r.ratio > .85 && r.ratio <= .95).length}; >=1: ${s.filter(r => r.ratio >= 1).length}; sec/asset mean ${(sum(s.map(r => r.a.totalSec)) / s.length).toFixed(1)}`);
  console.log(`  total ladder KB: WebP only ${kb(sum(s.map(r => r.webpLadder)))}, AVIF only ${kb(sum(s.map(r => r.avifLadder)))}, both ${kb(sum(s.map(r => r.webpLadder + r.avifLadder)))}; if rule applied (keep AVIF only where wins) ${kb(sum(s.map(r => r.webpLadder + (r.keep ? r.avifLadder : 0))))}`);
}
// timing per AVIF file
const av = R.results.flatMap(a => a.files.filter(f => f.kind === 'avif'));
for (const [lbl, fn] of [['<=256', f => f.width <= 256], ['>256', f => f.width > 256]]) {
  const s = av.filter(fn); console.log(`AVIF ${lbl}: n=${s.length} mean ${(sum(s.map(f => f.sec)) / s.length).toFixed(2)}s max ${Math.max(...s.map(f => f.sec)).toFixed(1)}s`);
}
for (const w of [512, 1024, 1536, 2048]) { const s = av.filter(f => f.width === w); if (s.length) console.log(`  AVIF @${w}: n=${s.length} mean ${(sum(s.map(f => f.sec)) / s.length).toFixed(1)}s`); }
const wp = R.results.flatMap(a => a.files.filter(f => f.kind === 'webp'));
console.log(`WebP lossy mean ${(sum(wp.map(f => f.sec)) / wp.length).toFixed(2)}s; @2048 ${(() => { const s = wp.filter(f => f.width >= 1949); return s.length ? (sum(s.map(f => f.sec)) / s.length).toFixed(2) : 'n/a' })()}s`);
console.log('skipped AVIF:', R.results.filter(a => a.avifSkipped.length).map(a => a.name + ':' + a.avifSkipped));
console.log('total build s', R.totalSec.toFixed(0), 'files', R.results.reduce((n, a) => n + a.files.length, 0));
console.log('\nillustration lossless vs PNG');
console.log('| asset | master | PNG KB | lossless WebP KB | ratio | lossy WebP top KB | AVIF top KB |\n|--|--|--|--|--|--|--|');
for (const r of rows.filter(r => r.a.group === 'illustration')) console.log(`| ${r.a.name.slice(0, 44)} | ${r.a.master.width}x${r.a.master.height} | ${kb(r.a.master.pngBytes)} | ${kb(r.ll.bytes)} (${r.ll.width}w) | ${(r.ll.bytes / r.a.master.pngBytes).toFixed(3)} | ${kb(r.w.bytes)} | ${kb(r.v.bytes)} |`);
const il = rows.filter(r => r.a.group === 'illustration');
console.log('sum PNG MB', (sum(il.map(r => r.a.master.pngBytes)) / 1048576).toFixed(1), 'sum lossless MB', (sum(il.map(r => r.ll.bytes)) / 1048576).toFixed(1));
if (process.argv[3]) {
  const B = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const m = new Map(); for (const a of R.results) for (const f of a.files) m.set(a.name + '/' + f.file, f.sha256);
  let n = 0, diff = [];
  for (const a of B.results) for (const f of a.files) { n++; if (m.get(a.name + '/' + f.file) !== f.sha256) diff.push(a.name + '/' + f.file); }
  console.log(`determinism: compared ${n} files, ${diff.length} differ`, diff);
}

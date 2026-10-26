// node webp-effort.mjs <shard> <nshards> <out.json>  : WebP q82 aq100 effort 4 vs 6 at 512..2048
import sharp from 'sharp';
import fs from 'node:fs';
const [shard, nsh, outPath] = process.argv.slice(2);
const MED = '/home/ranx729/projects/medieval-ornaments';
const src = fs.readFileSync('bench.mjs', 'utf8');
const BORDERS = eval(src.match(/const BORDERS = (\[[\s\S]*?\]);/)[1]);
const cat = JSON.parse(fs.readFileSync(`${MED}/images.json`, 'utf8'));
const ill = cat.filter(e => e.asset_type === 'illustration' && e.has_transparency).sort((a, b) => b.width - a.width).slice(0, 10).map(e => e.name);
const names = [...BORDERS, ...ill].filter((_, i) => i % Number(nsh) === Number(shard));
const find = n => { for (const d of fs.readdirSync(`${MED}/tmp/resource-checkouts`)) { const p = `${MED}/tmp/resource-checkouts/${d}/png/${n}.png`; if (fs.existsSync(p)) return p; } };
const now = () => Number(process.hrtime.bigint()) / 1e9;
const out = [];
for (const name of names) {
  const { data, info } = await sharp(find(name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const ws = [512, 768, 1024, 1536, 2048].filter(w => w <= W);
  for (const w of ws) {
    const r = { name, width: w };
    for (const e of [6, 4]) {
      const t = now();
      const b = await sharp(data, { raw: { width: W, height: info.height, channels: info.channels } })
        .resize({ width: w, kernel: 'lanczos3' }).webp({ quality: 82, alphaQuality: 100, effort: e }).toBuffer();
      r['e' + e] = { bytes: b.length, sec: now() - t };
    }
    out.push(r); console.error(name, w, r.e6.bytes, r.e4.bytes);
  }
}
fs.writeFileSync(outPath, JSON.stringify(out));

// `build --preview`: one static contact sheet, no scripts, no external requests. Each card paints the asset's
// ThumbHash (decoded to an inline PNG data URL) under its 256 px WebP, so the placeholder is visible while it loads.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { thumbHashToDataURL } from 'thumbhash';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const sum = (files = []) => files.reduce((s, f) => s + f.bytes, 0);

// The rung closest to 256 px without going over, else the smallest one.
function pick256(webp) {
  const under = webp.filter((f) => f.w <= 256);
  return under.length ? under[under.length - 1] : webp[0];
}

export async function writePreview(outDir, manifest) {
  const cards = Object.entries(manifest.assets).map(([id, a]) => {
    const webp = a.sources.webp ?? [];
    const shown = webp.length ? pick256(webp) : null;
    const placeholder = thumbHashToDataURL([...Buffer.from(a.thumbhash, 'base64')]);
    const enc = a.encoding;
    const avifLine = enc
      ? `${enc.avif ? 'AVIF kept' : 'WebP only'} (top rung ${kb(enc.avifTopBytes)} AVIF vs ${kb(enc.webpTopBytes)} WebP, ratio ${(enc.avifTopBytes / enc.webpTopBytes).toFixed(2)})`
      : 'no raster ladder';
    const img = shown ? `<img src="${esc(shown.path)}" width="${shown.w}" height="${shown.h}" loading="lazy" alt="${esc(a.title)}">` : '';
    return `<figure class="card">
<div class="frame" style="aspect-ratio:${a.width}/${a.height};background-image:url(${placeholder})">${img}</div>
<figcaption><strong>${esc(a.title)}</strong>
<span>${esc(id)} &middot; ${esc(a.type)} &middot; ${a.width}&times;${a.height}${a.transparent ? ' &middot; alpha' : ''}</span>
<span>${esc(avifLine)}</span>
<span>WebP ladder ${kb(sum(a.sources.webp))}${a.sources.avif ? `, AVIF ladder ${kb(sum(a.sources.avif))}` : ''}</span>
<span class="sw">${a.palette.map((c) => `<i style="background:${c}" title="${c}"></i>`).join('')}</span></figcaption>
</figure>`;
  });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(manifest.set)} preview</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1c1c1c;--muted:#666;--card:#f3f1ec;--check:#e4e1da}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--muted:#aaa;--card:#222;--check:#2c2c2c}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 4px}p.meta{margin:0 0 16px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{margin:0;background:var(--card);border-radius:6px;padding:8px}
.frame{background-size:cover;background-color:var(--check);border-radius:4px;overflow:hidden;max-height:300px}
.frame img{display:block;width:100%;height:100%;object-fit:contain}
figcaption{display:flex;flex-direction:column;gap:2px;margin-top:6px;font-size:12px;color:var(--muted)}
figcaption strong{color:var(--fg);font-size:13px}
.sw{display:flex;gap:3px;margin-top:2px}.sw i{width:16px;height:10px;border-radius:2px;border:1px solid #8884}
</style></head><body>
<h1>${esc(manifest.title)}</h1>
<p class="meta">${esc(manifest.set)} ${esc(manifest.version)} &middot; ${cards.length} assets &middot; inputs ${esc(manifest.inputsHash.slice(0, 19))} &middot; built ${esc(manifest.builtAt)}</p>
<div class="grid">
${cards.join('\n')}
</div></body></html>
`;
  await writeFile(path.join(outDir, 'preview.html'), html);
}

// Build-time resolver. Pure functions over index.json and per-set manifests; no DOM, no dependencies.
import { fileUrl, packageCdn } from './urls.mjs';
import { selectRungs, pickByDimension, dprList, maxOf } from './rungs.mjs';
import { thumbHashToDataUrl } from './thumbhash.mjs';

const MIME = { avif: 'image/avif', webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg', svg: 'image/svg+xml' };
const mime = (fmt) => MIME[fmt] ?? `image/${fmt}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cssUrl = (u) => `url("${u.replace(/"/g, '%22')}")`;
const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
    .join(' ');

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * @param {object} [options]
 * @param {object|string} [options.index]  index.json object, or its URL. Default: the index.json shipped in this package.
 * @param {string} [options.base]          Self-hosted tree (`<base>/<set>/<path>`), e.g. the output of the copy command.
 * @param {string[]} [options.formats]     Preference order. The last one present is the <img> fallback.
 * @param {Record<string,string>} [options.pin]  Per-set version override, { setId: '1.2.0' }.
 * @param {number|number[]} [options.dpr]  Highest density of interest (default 3).
 * @param {(setId: string, ctx: {entry: object, cdn: string}) => Promise<object>} [options.loadManifest]
 *        Default fetches `<cdn>manifest.json`. In Node, `fsManifestLoader` from `@ranx729/ducktape-assets/node` reads sets/<set>.json.
 */
export function createResolver({ index, base, formats = ['avif', 'webp'], pin = {}, dpr, loadManifest } = {}) {
  let idx = index && typeof index === 'object' ? index : null;
  let idxPromise;
  const manifests = new Map();

  function getIndex() {
    idxPromise ??= (async () => {
      if (idx) return idx;
      idx =
        typeof index === 'string'
          ? await getJson(index)
          : (await import('../index.json', { with: { type: 'json' } })).default;
      return idx;
    })();
    return idxPromise;
  }

  const splitId = (id) => {
    const i = id.indexOf('/');
    if (i < 1 || i === id.length - 1) throw new Error(`asset id must be "<set>/<asset>", got "${id}"`);
    return [id.slice(0, i), id.slice(i + 1)];
  };

  async function entryOf(setId) {
    const entry = (await getIndex()).sets[setId];
    if (!entry) throw new Error(`unknown set "${setId}"`);
    return entry;
  }

  const urlOf = (entry, file, setId) => fileUrl(entry, file, { setId, base, version: pin[setId] });

  function manifestOf(setId) {
    if (!manifests.has(setId)) {
      manifests.set(
        setId,
        (async () => {
          const entry = await entryOf(setId);
          const cdn = packageCdn(entry, undefined, pin[setId] ?? entry.version);
          const m = await (loadManifest ? loadManifest(setId, { entry, cdn }) : getJson(`${cdn}manifest.json`));
          return m;
        })(),
      );
    }
    return manifests.get(setId);
  }

  /** Everything known about one asset: { id, setId, assetId, entry, manifest, asset }. */
  async function get(id) {
    const [setId, assetId] = splitId(id);
    const entry = await entryOf(setId);
    const manifest = await manifestOf(setId);
    const asset = manifest.assets[assetId];
    if (!asset) throw new Error(`unknown asset "${id}"`);
    return { id, setId, assetId, entry, manifest, asset };
  }

  /** Synchronous; the index must already be loaded (any awaited call loads it) unless `base` is set. */
  function url(file, setId) {
    if (!setId) throw new Error('url(file, setId): setId is required');
    if (!base && !idx) throw new Error('index not loaded yet; await any resolver call first or pass index');
    return urlOf(idx?.sets[setId], file, setId);
  }

  const licenseOf = ({ asset, manifest }) => ({ ...manifest.license, artwork: asset.license ?? manifest.license.artwork });
  const attributionOf = ({ asset, manifest }) => asset.attribution ?? manifest.attribution ?? '';

  async function image(id, { width, sizes, dpr: d, placeholder = true } = {}) {
    const ctx = await get(id);
    const { setId, entry, asset } = ctx;
    const maxDpr = maxOf(d ?? dpr, 3);
    const sources = [];
    const files = [];
    const fileOf = (fmt, r) => ({ format: fmt, url: urlOf(entry, r, setId), path: r.path, width: r.w, height: r.h, bytes: r.bytes, sha256: r.sha256, ...(r.package ? { package: r.package } : {}) });
    let fallback;
    let fallbackFmt;
    for (const fmt of formats) {
      const ladder = asset.sources?.[fmt];
      if (!Array.isArray(ladder) || !ladder.length) continue;
      const sel = selectRungs(ladder, width, { maxDpr });
      sources.push({ type: mime(fmt), srcset: sel.rungs.map((r) => `${urlOf(entry, r, setId)} ${r.w}w`).join(', ') });
      files.push(...sel.rungs.map((r) => fileOf(fmt, r)));
      fallback = sel;
      fallbackFmt = fmt;
    }
    if (!fallback) throw new Error(`${id}: none of the formats ${formats.join(', ')} is available`);
    const out = {
      src: urlOf(entry, fallback.src, setId),
      srcset: sources[sources.length - 1].srcset,
      sources,
      // The chosen files with their bytes and sha256, for build scripts that record or verify what they reference.
      // `file` is the one behind `src`; `files` lists every rung of every format in the srcsets.
      file: fileOf(fallbackFmt, fallback.src),
      files,
      sizes: sizes ?? (width ? `${width}px` : '100vw'),
      width: asset.width,
      height: asset.height,
      thumbhash: asset.thumbhash,
      alt: '',
      description: asset.description,
      license: licenseOf(ctx),
      attribution: attributionOf(ctx),
      resolutionLimited: Boolean(width && asset.width < width),
    };
    if (placeholder && asset.thumbhash) out.placeholderDataUrl = thumbHashToDataUrl(asset.thumbhash);
    if (asset.sources?.svg) out.svg = urlOf(entry, asset.sources.svg, setId);
    return out;
  }

  /** `<picture>` markup. `extra` is added to the <img>. */
  function picture(img, extra = {}) {
    const lead = img.sources.slice(0, -1);
    const style = [img.placeholderDataUrl && `background: url(${img.placeholderDataUrl}) center / cover`, extra.style]
      .filter(Boolean)
      .join('; ');
    const { style: _s, ...rest } = extra;
    const tag = `<img ${attrs({ src: img.src, srcset: img.srcset, sizes: img.sizes, width: img.width, height: img.height, alt: img.alt, ...rest, style: style || null })}>`;
    if (!lead.length) return tag;
    const srcs = lead.map((s) => `  <source ${attrs({ type: s.type, srcset: s.srcset, sizes: img.sizes })}>`);
    return `<picture>\n${srcs.join('\n')}\n  ${tag}\n</picture>`;
  }

  /** `<link rel="preload">` for an above-the-fold image, in the most preferred format. */
  function preload(img) {
    const s = img.sources[0];
    return `<link ${attrs({ rel: 'preload', as: 'image', type: s.type, href: img.src, imagesrcset: s.srcset, imagesizes: img.sizes, fetchpriority: 'high' })}>`;
  }

  /** image-set() candidates over the preferred formats, one entry per (format, density), deduplicated by URL. */
  function imageSet(entry, setId, ladder, key, thickness, dprs, geom) {
    const parts = [];
    let ref;
    for (const fmt of formats) {
      const files = ladder?.[fmt];
      if (!Array.isArray(files) || !files.length) continue;
      const seen = new Set();
      for (const x of dprs) {
        const f = pickByDimension(files, key, geom(x));
        ref ??= f;
        const u = urlOf(entry, f, setId);
        if (seen.has(u)) continue;
        seen.add(u);
        parts.push(`${cssUrl(u)} type("${mime(fmt)}") ${x}x`);
      }
    }
    return { set: parts.length ? `image-set(${parts.join(', ')})` : null, ref };
  }

  /** CSS declarations for a repeating border (`render.tile`). Prefers the SVG of the chosen ladder. */
  async function tile(id, { axis, thickness, dpr: d } = {}) {
    const { setId, entry, asset } = await get(id);
    const t = asset.render?.tile;
    if (!t) throw new Error(`${id} has no render.tile`);
    axis ??= t.axis;
    const ladder = axis === t.axis ? asset.sources : t.rotated;
    const key = axis === 'x' ? 'h' : 'w'; // thickness dimension in the displayed orientation
    thickness ??= t.axis === 'x' ? asset.height : asset.width;
    let image, ref;
    if (ladder?.svg) {
      ref = ladder.svg;
      image = cssUrl(urlOf(entry, ref, setId));
    } else {
      ({ set: image, ref } = imageSet(entry, setId, ladder, key, thickness, dprList(d ?? dpr, [1, 2]), (x) => thickness * x));
    }
    if (!image) throw new Error(`${id}: no ${axis}-axis ladder in formats ${formats.join(', ')}`);
    const len = Math.round(thickness * (axis === 'x' ? ref.w / ref.h : ref.h / ref.w) * 100) / 100;
    return [
      `background-image: ${image};`,
      `background-repeat: ${axis === 'x' ? 'round no-repeat' : 'no-repeat round'};`,
      `background-size: ${axis === 'x' ? `${len}px ${thickness}px` : `${thickness}px ${len}px`};`,
    ].join('\n');
  }

  /** `border-image` rule for a frame (`render.frame`): the atlas rung whose slice region covers `thickness` at each density. */
  async function frame(id, { thickness, dpr: d } = {}) {
    const { setId, entry, asset } = await get(id);
    const f = asset.render?.frame;
    if (!f) throw new Error(`${id} has no render.frame`);
    // Composed atlases record one percentage; ready-made frames record four (top right bottom left) because a uniform
    // pixel slice is a different share of the width and of the height. The CSS value and the coverage maths follow.
    const slice = f.slice;
    const sliceCss = typeof slice === 'number' ? `${slice}%` : `${slice.top}% ${slice.right}% ${slice.bottom}% ${slice.left}%`;
    const sliceW = typeof slice === 'number' ? slice : slice.left; // share of the atlas width that must cover `thickness`
    const atlas = f.atlas;
    const dprs = dprList(d ?? dpr, [1, 2, 3]);
    const smallest = Object.values(atlas).find(Array.isArray)?.[0];
    thickness ??= smallest ? Math.round((smallest.w * sliceW) / 100) : 16;
    // the slice region (sliceW% of the atlas width) must map onto `thickness` css px at density x
    const need = (x) => (thickness * x * 100) / sliceW;
    let value;
    if (atlas.svg) value = cssUrl(urlOf(entry, atlas.svg, setId));
    else value = imageSet(entry, setId, atlas, 'w', thickness, dprs, need).set;
    if (!value) throw new Error(`${id}: no atlas in formats ${formats.join(', ')}`);
    const fmt = formats.find((x) => atlas[x]?.length);
    const atlasSrcset = fmt
      ? [...new Set(dprs.map((x) => pickByDimension(atlas[fmt], 'w', need(x))))]
          .map((r) => `${urlOf(entry, r, setId)} ${r.w}w`)
          .join(', ')
      : '';
    const css = [`border-style: solid;`, `border-width: ${thickness}px;`, `border-image: ${value} ${sliceCss} round;`].join('\n');
    return { css, slice, sliceCss, atlasSrcset };
  }

  /** Paths of the files the copy command writes for an asset (all rungs), for flows that import local files. */
  async function local(id, { dir = '' } = {}) {
    const { setId, assetId, asset } = await get(id);
    const at = (file) => [dir.replace(/\/+$/, ''), setId, file.path].filter(Boolean).join('/');
    const ladderPaths = (l) =>
      l && Object.fromEntries(Object.entries(l).map(([k, v]) => [k, Array.isArray(v) ? v.map((f) => ({ w: f.w, h: f.h, path: at(f) })) : { w: v.w, h: v.h, path: at(v) }]));
    const files = { sources: ladderPaths(asset.sources) };
    if (asset.render?.tile?.rotated) files.rotated = ladderPaths(asset.render.tile.rotated);
    if (asset.render?.frame?.atlas) files.atlas = ladderPaths(asset.render.frame.atlas);
    files.master = at(asset.master ?? { path: `masters/${assetId}.webp` });
    return { id, width: asset.width, height: asset.height, thumbhash: asset.thumbhash, files };
  }

  return { image, picture, preload, tile, frame, local, url, get, index: getIndex, manifest: manifestOf };
}

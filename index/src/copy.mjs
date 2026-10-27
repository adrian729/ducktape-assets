// Pick-and-copy flow: fetch exactly the chosen files into the project, verify their sha256, write ducktape.manifest.json.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createResolver } from './resolver.mjs';
import { fsManifestLoader } from './node.mjs';

const isUrl = (s) => /^https?:\/\//.test(s);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ASC = (a, b) => a.w - b.w;

/** Read a location that is either an http(s) URL or a local path. */
async function load(loc) {
  if (isUrl(loc)) {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(loc);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        last = e;
      }
    }
    throw new Error(`${loc}: ${last.message}`);
  }
  return readFile(loc.replace(/^file:\/\//, ''));
}

const normalize = (a) => (typeof a === 'string' ? { id: a } : a);

/** The chosen files of one ladder: formats, then `widths` (smallest rung >= each, never upscale), then `max`. */
function chooseLadder(ladder, spec) {
  const formats = spec.formats ?? ['avif', 'webp', 'svg'];
  const out = {};
  for (const fmt of formats) {
    const v = ladder?.[fmt];
    if (!v) continue;
    if (!Array.isArray(v)) {
      out[fmt] = v;
      continue;
    }
    const l = [...v].sort(ASC);
    let sel = spec.widths ? [...new Set(spec.widths.map((w) => l.find((f) => f.w >= w) ?? l[l.length - 1]))] : l;
    if (spec.max) sel = sel.filter((f) => f.w <= spec.max);
    if (!sel.length) sel = [l[0]];
    out[fmt] = sel.sort(ASC);
  }
  return out;
}

/** What to copy for one asset, grouped by role. Masters come from the masters package. */
export function chooseFiles(asset, assetId, spec) {
  // `masters: true` alone means "I encode my own images": only the master is copied. Add formats, widths or max to
  // get ladder files as well.
  const wantsLadder = !spec.masters || spec.formats || spec.widths || spec.max;
  const ladderSpec = wantsLadder ? spec : { ...spec, formats: [] };
  const roles = { sources: chooseLadder(asset.sources, ladderSpec) };
  if (asset.render?.tile?.rotated) roles.rotated = chooseLadder(asset.render.tile.rotated, ladderSpec);
  if (asset.render?.frame?.atlas) roles.atlas = chooseLadder(asset.render.frame.atlas, ladderSpec);
  if (spec.masters) roles.master = { package: 'masters', ...(asset.master ?? { path: `masters/${assetId}.webp` }) };
  return roles;
}

/** The authored geometry of an asset without the generated ladders: what a build script needs to place it. */
function geometryOf(asset) {
  const r = asset.render ?? {};
  const out = {};
  if (r.image) out.image = {};
  if (r.tile) out.tile = { axis: r.tile.axis, period: r.tile.period ?? 1 };
  if (r.frame) out.frame = { slice: r.frame.slice, ...(r.frame.slicePx ? { slicePx: r.frame.slicePx } : {}), ...(r.frame.corner ? { corner: r.frame.corner } : {}) };
  return out;
}

/**
 * @param {object} o
 * @param {{pin?: string, out?: string, assets: Array<string|object>}} o.config
 * @param {string} o.out        Destination directory.
 * @param {string} [o.index]    Local path or URL of index.json. Default: the pin's package on jsDelivr.
 * @param {string} [o.base]     Directory or URL laid out as `<base>/<set>/<path>` to read files from instead of the CDN (tests, mirrors).
 */
export async function copy({ config, out, index, base, log = () => {} }) {
  if (!index) {
    if (!config.pin) throw new Error('config needs a "pin" like "@ranx729/ducktape-assets@1.0.0" (or pass --index)');
    index = `https://cdn.jsdelivr.net/npm/${config.pin}/index.json`;
  }
  const indexJson = JSON.parse(await load(index));
  const resolver = createResolver({ index: indexJson, base, loadManifest: isUrl(index) ? undefined : fsManifestLoader(index) });

  const plan = new Map(); // local relative path -> { url, sha256, bytes }
  const summary = {};
  for (const spec of config.assets.map(normalize)) {
    const { setId, assetId, asset, manifest, entry } = await resolver.get(spec.id);
    const roles = chooseFiles(asset, assetId, spec);
    const local = (file) => `${setId}/${file.path}`;
    const place = (file) => {
      plan.set(local(file), { url: resolver.url(file, setId), sha256: file.sha256 });
      return { w: file.w, h: file.h, path: local(file) };
    };
    const files = {};
    for (const [role, v] of Object.entries(roles)) {
      if (v.path) files[role] = place(v);
      else files[role] = Object.fromEntries(Object.entries(v).map(([fmt, f]) => [fmt, Array.isArray(f) ? f.map(place) : place(f)]));
    }
    const master = asset.master ?? null;
    summary[spec.id] = {
      set: setId,
      version: entry.version,
      title: asset.title,
      description: asset.description,
      type: asset.type,
      width: asset.width,
      height: asset.height,
      // The master may be capped below the native size; coordinates measured on it must say so.
      ...(master ? { master: { width: master.w, height: master.h } } : {}),
      transparent: asset.transparent ?? null,
      thumbhash: asset.thumbhash,
      render: geometryOf(asset),
      ...(asset.components ? { components: Object.fromEntries(Object.entries(asset.components).map(([k, c]) => [k, { width: c.width, height: c.height, ...(c.description ? { description: c.description } : {}) }])) } : {}),
      license: asset.license ?? manifest.license.artwork,
      attribution: asset.attribution ?? manifest.attribution ?? '',
      files,
    };
  }

  let copied = 0, skipped = 0;
  const queue = [...plan.entries()];
  const worker = async () => {
    for (let item; (item = queue.shift()); ) {
      const [rel, { url, sha256: want }] = item;
      const dest = join(out, rel);
      const have = await readFile(dest).then(sha256, () => null);
      if (have === want) {
        skipped++;
        continue;
      }
      const buf = await load(url);
      const got = sha256(buf);
      if (got !== want) throw new Error(`${url}: sha256 mismatch (expected ${want}, got ${got})`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      copied++;
      log(`copied ${rel}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  await mkdir(out, { recursive: true });
  const manifest = { schema: 1, pin: config.pin ?? null, assets: summary };
  await writeFile(join(out, 'ducktape.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { copied, skipped, files: [...plan.keys()].sort(), manifest };
}

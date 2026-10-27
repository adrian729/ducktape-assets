// `build <set-repo-dir> --out <dir>`: validate, encode every asset, write the generated manifest.
// The output directory holds the delivery tree (avif/ webp/ svg/ tiles/ frames/ manifest.json) and the masters
// tree (masters/). The publisher packs them by glob; package assignment is recorded in the manifest, not in folders.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import YAML from 'yaml';
import { validateSet, formatProblems } from './validate.mjs';
import { loadManifestValidator } from './schemas.mjs';
import { ENCODING, decodeRaw, encode, encodeMaster, ladderWidths, paletteOf, resizeRaw, sha256, thumbhashOf, transparentFlag } from './images.mjs';
import { composeAtlas, rotate } from './compose.mjs';
import { FIRST, assignPackages, checkPackageSizes } from './volumes.mjs';
import { writePreview } from './preview.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCOPE = '@ranx729';

export const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
const stableJson = (v) => JSON.stringify(sortKeys(v), null, 2) + '\n';

// ---- master checks (the "What the build refuses" list) ----

async function inspectMaster(file, label, { main }) {
  if (file.endsWith('.svg')) return { vector: true };
  const meta = await sharp(file).metadata();
  if (!['png', 'webp'].includes(meta.format)) throw new Error(`${label}: master is ${meta.format}; only lossless PNG or WebP (or hand-made SVG) are accepted`);
  if (!['srgb', 'b-w', 'rgb16', 'grey16'].includes(meta.space)) throw new Error(`${label}: colour space ${meta.space} is not sRGB; convert the master first`);
  if (meta.icc && !meta.icc.toString('latin1').includes('sRGB')) throw new Error(`${label}: embedded colour profile is not sRGB; convert the master first`);
  // TODO: refuse lossy WebP masters; sharp does not report lossy versus lossless for WebP input.
  // Components (a corner can be 60 px) are exempt from the minimum size; only the asset master is checked.
  if (main && Math.max(meta.width, meta.height) < 64) throw new Error(`${label}: master is ${meta.width}x${meta.height}, smaller than 64 px on its long side`);
  return { vector: false, width: meta.width, height: meta.height };
}

// Rasterises a hand-made SVG at 2048 px wide; the SVG itself is copied through.
// TODO: svgo optimisation with a pinned config (keep viewBox, drop editor metadata, 3-decimal precision) before the copy.
async function rasteriseSvg(buf) {
  const meta = await sharp(buf).metadata();
  const raw = await decodeRaw(buf, { density: Math.min(100000, (72 * ENCODING.vectorRasterWidth) / meta.width) });
  return { raw: await resizeRaw(raw, ENCODING.vectorRasterWidth), width: Math.round(meta.width), height: Math.round(meta.height) };
}

// ---- ladders ----

// Encodes one ladder. `transform` maps each resized rung (the rotated tile); `pathFor(format, w)` names the files
// after the width of the file itself. `avifKept` is null to decide here (encode the top rung in both formats and keep
// AVIF when bytes <= 0.85 x WebP), or the decision of the asset this ladder derives from.
async function makeLadder(ctx, assetId, raw, { pathFor, transform = null, avifKept = null }) {
  const rungs = [];
  for (const w of ladderWidths(raw.width)) {
    let r = await resizeRaw(raw, w);
    if (transform) r = await transform(r);
    if (!rungs.some((x) => x.width === r.width)) rungs.push(r);
  }
  const entry = async (format, r, buf) => ctx.emit(pathFor(format, r.width), buf, r.width, r.height, assetId);
  const webp = [];
  for (const r of rungs) webp.push(await entry('webp', r, await encode(r, 'webp', r.width)));
  const top = rungs[rungs.length - 1];
  const topWebp = webp[webp.length - 1];
  const avif = [];
  let topAvifBytes = 0;
  let keep = avifKept;
  const topBuf = keep === false ? null : await encode(top, 'avif', top.width);
  if (topBuf) topAvifBytes = topBuf.length;
  if (keep === null) keep = topAvifBytes <= ENCODING.avif.keepRatio * topWebp.bytes;
  if (keep) {
    for (const r of rungs) avif.push(await entry('avif', r, r === top ? topBuf : await encode(r, 'avif', r.width)));
  }
  // Rejected top-rung AVIF is discarded; it was only measured.
  const ladder = { webp };
  if (avif.length) ladder.avif = avif;
  return { ladder, encoding: { avif: keep, webpTopBytes: topWebp.bytes, avifTopBytes: topAvifBytes } };
}

async function masterEntry(ctx, assetId, name, raw) {
  const { buf, width, height } = await encodeMaster(raw);
  return ctx.emit(`masters/${name}.webp`, buf, width, height, assetId, 'masters');
}

// ---- one asset ----

async function buildAsset(ctx, dir, asset) {
  const id = asset.id;
  const fromDir = (f) => path.join(ctx.repoDir, 'assets', dir, f);
  const refuse = (m) => { throw new Error(`assets/${dir}: ${m}`); };

  // Load the primary master and the components into pixels (or rasterised vectors).
  const load = async (file, label, main) => {
    const info = await inspectMaster(fromDir(file), `assets/${dir}/${file}`, { main });
    const bytes = await readFile(fromDir(file));
    ctx.inputs[`assets/${dir}/${file}`] = sha256(bytes);
    if (info.vector) {
      const r = await rasteriseSvg(bytes);
      return { vector: true, svg: bytes, raw: r.raw, width: r.width, height: r.height };
    }
    const raw = await decodeRaw(bytes);
    return { vector: false, raw, width: raw.width, height: raw.height };
  };
  const main = await load(asset.master, id, true);
  const components = {};
  for (const [name, c] of Object.entries(asset.components ?? {})) components[name] = { ...c, loaded: await load(c.master, `${id}.${name}`, false) };

  if (asset.render?.tile) {
    const { axis } = asset.render.tile;
    const along = axis === 'x' ? main.width : main.height, across = axis === 'x' ? main.height : main.width;
    if (along / across < 1.5) refuse(`render.tile axis ${axis} but the master is ${main.width}x${main.height} (length/thickness ${(along / across).toFixed(2)} < 1.5); it is probably not a strip`);
  }

  const out = {};
  for (const k of ['title', 'description', 'type', 'categories', 'subjects', 'colors', 'facing', 'view', 'composition', 'period', 'region', 'style', 'group', 'status', 'deprecated_by', 'quality', 'usage_notes', 'display_width', 'related', 'provenance']) {
    if (asset[k] !== undefined) out[k] = asset[k];
  }
  if (asset.license) out.license = asset.license;
  out.width = main.width;
  out.height = main.height;
  out.resolutionLimited = main.width < 1024;
  out.transparent = await transparentFlag(main.raw);
  out.palette = await paletteOf(main.raw);
  out.thumbhash = await thumbhashOf(main.raw);

  const rungPath = (name) => (format, w) => `${format}/${name}-${w}.${format}`;
  const primary = await makeLadder(ctx, id, main.raw, { pathFor: rungPath(id) });
  out.sources = primary.ladder;
  out.encoding = primary.encoding;
  if (main.vector) {
    out.sources.svg = ctx.emit(`svg/${id}.svg`, main.svg, main.width, main.height, id); // copied through, see the svgo TODO in rasteriseSvg
    out.master = ctx.emit(`masters/${id}.svg`, main.svg, main.width, main.height, id, 'masters');
  } else {
    out.master = await masterEntry(ctx, id, id, main.raw);
  }

  const compOut = {};
  for (const [name, c] of Object.entries(components)) {
    const l = await makeLadder(ctx, id, c.loaded.raw, { pathFor: rungPath(`${id}.${name}`) });
    compOut[name] = {
      ...(c.description ? { description: c.description } : {}),
      master: c.loaded.vector ? ctx.emit(`masters/${id}.${name}.svg`, c.loaded.svg, c.loaded.width, c.loaded.height, id, 'masters') : await masterEntry(ctx, id, `${id}.${name}`, c.loaded.raw),
      sources: l.ladder,
      encoding: l.encoding,
    };
  }
  if (Object.keys(compOut).length) out.components = compOut;

  // render: the authored geometry plus the generated files. Derivatives reuse the asset's AVIF decision.
  const render = {};
  if (asset.render.image) render.image = asset.render.image;
  if (asset.render.tile) {
    const rotated = await makeLadder(ctx, id, main.raw, {
      transform: (r) => rotate(r, 90),
      avifKept: primary.encoding.avif,
      pathFor: (format, w) => `tiles/${id}-rotated-${w}.${format}`,
    });
    render.tile = { axis: asset.render.tile.axis, period: asset.render.tile.period ?? 1, rotated: rotated.ladder };
  }
  if (asset.render.frame?.slice_px) {
    // A ready-made complete frame: the image ladder is the atlas. The slice is uniform in master pixels, so the
    // percentages differ per axis; they are recorded as CSS expects them (top right bottom left).
    const px = asset.render.frame.slice_px;
    if (px * 2 >= Math.min(main.width, main.height)) refuse(`render.frame.slice_px ${px} is not smaller than half of the master (${main.width}x${main.height})`);
    const pct = (n) => Math.round((px * 10000) / n) / 100;
    const v = pct(main.height), h = pct(main.width);
    render.frame = { slice: { top: v, right: h, bottom: v, left: h }, slicePx: px, atlas: primary.ladder };
  } else if (asset.render.frame) {
    const { corner, slice } = asset.render.frame;
    if (!components[corner]) refuse(`render.frame.corner "${corner}" is not a component`);
    const axis = asset.render.tile?.axis ?? (main.width >= main.height ? 'x' : 'y');
    const atlasRaw = await composeAtlas(components[corner].loaded.raw, main.raw, { axis, slice });
    const atlas = await makeLadder(ctx, id, atlasRaw, { avifKept: primary.encoding.avif, pathFor: (format, w) => `frames/${id}-atlas-${w}.${format}` });
    render.frame = { corner, slice, atlas: atlas.ladder };
  }
  out.render = render;
  return out;
}

// ---- the inputs hash (the publish gate) ----

export async function toolingInfo() {
  const toolsVersion = JSON.parse(await readFile(path.join(here, '..', 'package.json'), 'utf8')).version;
  return { tools: toolsVersion, sharp: sharp.versions.sharp, libvips: sharp.versions.vips, concurrency: sharp.concurrency() };
}

// masters: { 'assets/<dir>/<file>': sha256 }, yaml: { 'set.yaml' | 'assets/<dir>/asset.yaml': text }.
export function hashInputs({ masters, yaml, tooling }) {
  return 'sha256:' + createHash('sha256').update(stableJson({ masters, yaml, encoding: ENCODING, tooling })).digest('hex');
}

// The same hash buildSet stores in the manifest, computed without encoding anything: hashes the masters and YAML
// files. Assumes a valid set (the planner validates first).
export async function computeInputsHash(repoDir, { includeDrafts = false } = {}) {
  const setText = await readFile(path.join(repoDir, 'set.yaml'), 'utf8');
  const yaml = { 'set.yaml': setText };
  const masters = {};
  const dirs = (await readdir(path.join(repoDir, 'assets'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const dir of dirs) {
    const text = await readFile(path.join(repoDir, 'assets', dir, 'asset.yaml'), 'utf8');
    const asset = YAML.parse(text);
    if (asset.status === 'draft' && !includeDrafts) continue; // drafts are not published, so they are not inputs
    yaml[`assets/${dir}/asset.yaml`] = text;
    const files = [asset.master, ...Object.values(asset.components ?? {}).map((c) => c.master)];
    for (const f of files) masters[`assets/${dir}/${f}`] = sha256(await readFile(path.join(repoDir, 'assets', dir, f)));
  }
  return hashInputs({ masters, yaml, tooling: await toolingInfo() });
}

// ---- the set ----

export async function buildSet(repoDir, outDir, options = {}) {
  const { version = '0.0.0', preview = false, concurrency = availableParallelism(), previous: previousOption = null, includeDrafts = false, log = () => {}, builtAt = new Date().toISOString() } = options;
  const previous = typeof previousOption === 'string' ? JSON.parse(await readFile(previousOption, 'utf8')) : previousOption;
  const problems = await validateSet(repoDir);
  if (problems.length) throw new Error(`validation failed, nothing built:\n${formatProblems(problems)}`);

  if (!path.relative(path.resolve(outDir), path.resolve(repoDir)).startsWith('..')) throw new Error('refusing to build into the set repository or one of its parents');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const setText = await readFile(path.join(repoDir, 'set.yaml'), 'utf8');
  const set = YAML.parse(setText);
  const dirs = (await readdir(path.join(repoDir, 'assets'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const yamlTexts = { 'set.yaml': setText };
  const assets = [];
  const drafts = [];
  for (const dir of dirs) {
    const text = await readFile(path.join(repoDir, 'assets', dir, 'asset.yaml'), 'utf8');
    const asset = YAML.parse(text);
    if (asset.status === 'draft') { drafts.push(asset.id); if (!includeDrafts) continue; }
    yamlTexts[`assets/${dir}/asset.yaml`] = text;
    assets.push({ dir, asset });
  }
  drafts.sort();

  const files = []; // { path, bytes, asset, tree, entry }
  const ctx = {
    repoDir,
    inputs: {},
    emitted(p, buf, w, h, assetId, tree = 'delivery') {
      const entry = { w, h, path: p, bytes: buf.length, sha256: sha256(buf) };
      files.push({ path: p, bytes: buf.length, asset: assetId, tree, entry });
      return entry;
    },
    emit(p, buf, w, h, assetId, tree = 'delivery') {
      const entry = ctx.emitted(p, buf, w, h, assetId, tree);
      pendingWrites.push(mkdir(path.dirname(path.join(outDir, p)), { recursive: true }).then(() => writeFile(path.join(outDir, p), buf)));
      return entry;
    },
  };
  const pendingWrites = [];

  // A small pool of assets in parallel; each sharp call is single-threaded (images.mjs).
  const built = new Map();
  let next = 0;
  const worker = async () => {
    while (next < assets.length) {
      const { dir, asset } = assets[next++];
      const t = Date.now();
      built.set(asset.id, await buildAsset(ctx, dir, asset));
      log(`built ${asset.id} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, assets.length)) }, worker));
  await Promise.all(pendingWrites);

  // Volume packages: sticky assignment per tree, then the size guard.
  const warnings = [];
  const packages = { delivery: [], masters: [] };
  for (const tree of ['delivery', 'masters']) {
    const treeFiles = files.filter((f) => f.tree === tree);
    const assignment = assignPackages(previous, treeFiles, { kind: tree });
    for (const f of treeFiles) if (assignment.get(f.path) !== FIRST) f.entry.package = assignment.get(f.path);
    const guard = checkPackageSizes(treeFiles, assignment, { label: tree === 'delivery' ? 'delivery package' : 'masters package' });
    warnings.push(...guard.warnings);
    const names = [...new Set(assignment.values())].filter((n) => n !== FIRST).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
    packages[tree] = names;
  }

  const tooling = await toolingInfo();

  const inputsHash = hashInputs({ masters: ctx.inputs, yaml: yamlTexts, tooling });

  const pkg = `${SCOPE}/ducktape-assets-${set.id}`;
  const manifest = {
    schema: 1,
    set: set.id,
    title: set.title,
    summary: set.summary,
    kind: set.kind,
    version,
    package: pkg,
    ...(packages.delivery.length ? { parts: packages.delivery.map((n) => `${pkg}-${n}`) } : {}),
    mastersPackage: `${pkg}-masters`,
    ...(packages.masters.length ? { mastersParts: packages.masters.map((n) => `${pkg}-masters-${n}`) } : {}),
    cdn: `https://cdn.jsdelivr.net/npm/${pkg}@${version}/`,
    license: { artwork: set.license.artwork, ...(set.license.notes ? { notes: set.license.notes } : {}) },
    // One line a consumer may show. Historical sets credit the institution and object; authored and imported sets credit
    // the author (CC-BY needs a name, and "origin unrecorded" imports are attributed to the author by owner decision).
    attribution: set.origin?.institution
      ? `${set.origin.institution}${set.origin.object_identifier ? ` ${set.origin.object_identifier}` : ''} (${set.license.artwork})`
      : `${set.author} (${set.license.artwork})`,
    ...(set.period ? { period: set.period } : {}), ...(set.region ? { region: set.region } : {}), ...(set.style ? { style: set.style } : {}),
    ...(drafts.length ? { drafts } : {}),
    inputsHash,
    tooling,
    builtAt,
    assets: Object.fromEntries(assets.map(({ asset }) => [asset.id, built.get(asset.id)]).sort(([a], [b]) => (a < b ? -1 : 1))),
  };

  // contentHash: sorted output paths and bytes (integrity only, never the publish gate).
  const hash = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(f.path + '\0');
    hash.update(await readFile(path.join(outDir, f.path)));
  }
  manifest.contentHash = 'sha256:' + hash.digest('hex');

  const { validate, errorsText } = await loadManifestValidator();
  const sorted = sortKeys(JSON.parse(JSON.stringify(manifest)));
  if (!validate(sorted)) throw new Error(`generated manifest does not match manifest.schema.json:\n  ${errorsText(validate.errors)}`);
  await writeFile(path.join(outDir, 'manifest.json'), stableJson(sorted));
  if (preview) await writePreview(outDir, sorted);
  return { manifest: sorted, warnings, outDir, fileCount: files.length, bytes: files.reduce((s, f) => s + f.bytes, 0) };
}

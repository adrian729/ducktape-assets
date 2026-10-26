// `import medieval-ornaments --plan migration/plan.yaml --old <dir> --poly <dir> --out <dir> [--wave 1] [--sets a,b] [--dry-run]`
// One-off importer for the old artwork (see docs/vault/Design/Migration.md). For every plan row with a target set it copies the master,
// writes a DRAFT asset.yaml (status: draft, review: pending), verifies the pixels and appends to migration/medieval-ornaments.json.
// Master resolution (checkout index, homepage-art pieces, logo frame from the SVG data URI) follows spikes/importer-dry-run/plan.mjs.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import YAML from 'yaml';
import { generateReadme } from './readme.mjs';
import { loadVocab } from './schemas.mjs';
import { copyTemplate, exists, repoDirName, toYaml } from './setfiles.mjs';

const MAX_ID = 48;
const ORIGIN_NOTE = 'Origin unrecorded; attribution to adrian729. Removed on any rights claim.';
const ORIGIN_NOTE_LICENSE = ORIGIN_NOTE;
const AUTHORED = new Set(['illuminated-acanthus', 'shaggy-bestiary', 'authored-ornaments', 'brand']);
const IMPORTED = new Set(['medieval-cutouts', 'numbered-plate', 'floral-vector-borders', 'supplied-sheets']);
// Wave definitions that are not expressible as plan.yaml wave numbers alone (Migration.md, decided 2026-10-26): the whole of these sets.
export const WAVE_SETS = { 1: ['illuminated-acanthus', 'medieval-cutouts', 'walters-w102'] };
const BOILERPLATE_MIN = 20; // usage_notes lines occurring in more than this many old records are dropped
const KEPT_COMPONENT = (k) => k === 'corner' || k === 'bar' || /^corner-(top|bottom)-(left|right)$/.test(k);
const METHODS = new Set(['native-source-extraction', 'native-ink-extraction', 'native-source-repeat', 'ai-assisted-extraction', 'ai-assisted-source-mask',
  'mixed-source-extraction', 'independent-ai-interpretation', 'reference-guided-ai-generation', 'hand-drawn', 'hand-vector']);

// ---------- small helpers ----------
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tokens = (name) => new Set(name.split('-'));
const humanize = (id) => { const s = id.replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const canonInstitution = (s) => s.replace(/^The\s+/, '').trim();

async function rgbaHash(file) {
  const { data } = await sharp(file, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return sha(data);
}

function mapRights(text) {
  if (!text) return null;
  if (/^CC0\b/i.test(text)) return 'CC0-1.0';
  if (/^Public Domain Mark/i.test(text)) return 'LicenseRef-PDM';
  return null;
}

// ---------- old catalog ----------
function buildOldIndex(oldDir) {
  const index = new Map(); // "png/x.png" -> [{ file, size, pkg, version }]
  const add = (rel, file, pkg, version) => {
    if (!index.has(rel)) index.set(rel, []);
    index.get(rel).push({ file, size: fs.statSync(file).size, pkg, version });
  };
  const scan = (root, pkg, version) => {
    for (const sub of ['png', 'webp', 'svg']) {
      const dir = path.join(root, sub);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isFile()) add(`${sub}/${f}`, full, pkg, version);
      }
    }
  };
  const co = path.join(oldDir, 'tmp/resource-checkouts');
  if (fs.existsSync(co)) {
    for (const name of fs.readdirSync(co).sort()) {
      let pkg = name, version = null;
      try { const j = JSON.parse(fs.readFileSync(path.join(co, name, 'package.json'), 'utf8')); pkg = j.name ?? name; version = j.version ?? null; } catch { /* no package.json */ }
      scan(path.join(co, name), pkg, version);
    }
  }
  scan(oldDir, null, null); // fallback: the old repo's own png/ webp/ svg/ folders
  return index;
}
function findFile(index, rel, bytes) {
  const c = index.get(rel);
  if (!c) return null;
  return (bytes != null && c.find((x) => x.size === bytes)) || c[0];
}

function sourceInfo(oldDir) {
  let runtimeVersion = null, commit = null;
  try { runtimeVersion = JSON.parse(fs.readFileSync(path.join(oldDir, 'package.json'), 'utf8')).version ?? null; } catch { /* not a package */ }
  try { commit = execFileSync('git', ['-C', oldDir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a git checkout */ }
  return { runtime: '@ranx729/medieval-ornaments', runtimeVersion, catalog: commit ? `images.json@${commit}` : 'images.json' };
}

// ---------- local additions (polyhymnia) ----------
function loadPoly(polyDir) {
  const art = new Map();
  const cat = JSON.parse(fs.readFileSync(path.join(polyDir, 'packages/homepage-art/catalog.json'), 'utf8'));
  for (const d of cat) art.set(d.name, d);
  let artPkg = { name: 'homepage-art', version: null };
  try { artPkg = JSON.parse(fs.readFileSync(path.join(polyDir, 'packages/homepage-art/package.json'), 'utf8')); } catch { /* optional */ }
  const logoSvg = path.join(polyDir, 'src/assets/logo/polyhymnia-logo-acanthus.svg');
  const logoJson = path.join(polyDir, 'src/assets/logo/polyhymnia-logo-acanthus.json');
  return { dir: polyDir, art, artPkg, logoSvg: fs.existsSync(logoSvg) ? logoSvg : null, logoJson: fs.existsSync(logoJson) ? logoJson : null };
}

// ---------- drafting ----------
const typeByName = (name, assetType, repeatAxis) => {
  const t = tokens(name);
  const has = (...w) => w.some((x) => t.has(x));
  if (assetType === 'border') {
    if (repeatAxis === 'x' || repeatAxis === 'y') return 'border';
    if (has('corner')) return 'corner';
    if (has('divider', 'rule', 'separator')) return 'divider';
    return 'frame';
  }
  if (assetType === 'illustration') return 'illustration';
  if (has('corner')) return 'corner';
  if (has('divider', 'rule', 'separator')) return 'divider';
  if (has('initial', 'letter')) return 'initial';
  if (has('banner', 'ribbon')) return 'banner';
  if (has('frame')) return 'frame';
  return 'ornament';
};

const FACING = { unclear: 'none', front: 'viewer' };

function normProvenance(p, rightsMode) {
  if (!p) return null;
  const out = { method: p.method };
  if (p.institution) out.institution = canonInstitution(p.institution);
  if (p.title) out.object_title = p.title;
  if (p.object_identifier) out.object_identifier = String(p.object_identifier);
  if (p.date != null) out.date = String(p.date);
  if (typeof p.artist === 'string' && p.artist) out.artist = p.artist;
  if (p.record_url) out.record_url = p.record_url;
  if (p.image_url) out.image_url = p.image_url;
  const spdx = mapRights(p.image_rights);
  if (spdx) out.image_rights = spdx;
  else if (p.image_rights) out.rights_text = p.image_rights;
  if (p.rights_url) out.rights_url = p.rights_url;
  if (p.source_sha256) out.source_sha256 = p.source_sha256;
  return out;
}

function renderFor(rec, keptKeys) {
  const render = {};
  if (rec.repeat_axis === 'x' || rec.repeat_axis === 'y') render.tile = { axis: rec.repeat_axis, period: 1 };
  const corner = keptKeys.includes('corner') ? 'corner' : keptKeys.find((k) => k.startsWith('corner-'));
  if (corner) {
    const s = rec.border_image_slice_percent;
    render.frame = { corner, slice: typeof s === 'number' && s > 0 && s <= 50 ? Math.round(s * 100) / 100 : 33.3 };
  }
  if (!Object.keys(render).length) render.image = {};
  return render;
}

function cleanSubjects(list) {
  return [...new Set((list ?? []).map(slugify).filter(Boolean))];
}

const COLOR_WORDS = ['beige', 'black', 'blue', 'brown', 'cream', 'gold', 'gray', 'green', 'orange', 'pink', 'purple', 'red', 'tan', 'white', 'yellow'];

// Draft for a design of the old catalog.
function draftFromOld(rec, ctx) {
  const { row, assetId, keptKeys, compFiles, ext, setKind, boiler } = ctx;
  const a = {
    id: assetId,
    title: humanize(assetId),
    description: clip(rec.description ?? humanize(assetId), 600),
    type: typeByName(rec.name, rec.asset_type, rec.repeat_axis),
    categories: rec.categories ?? [],
    subjects: cleanSubjects(rec.subjects),
    colors: rec.colors ?? [],
    facing: FACING[rec.facing] ?? rec.facing ?? 'none',
    composition: rec.composition,
  };
  if (row.group) a.group = slugify(row.group);
  a.render = renderFor(rec, keptKeys);
  if (keptKeys.length) {
    a.components = {};
    for (const k of keptKeys.sort()) a.components[k] = { master: compFiles[k], description: `${humanize(k)} component.` };
  }
  const notes = (rec.usage_notes ?? []).filter((n) => (boiler.get(n) ?? 0) <= BOILERPLATE_MIN);
  if (notes.length) a.usage_notes = notes;
  a.status = 'draft';
  a.review = 'pending';
  a.created = ctx.today;
  a.master = `master.${ext}`;
  let prov = normProvenance(rec.provenance);
  if (!prov && setKind !== 'historical') {
    const m = rec.derivation === 'vector-reconstruction' ? 'hand-vector' : rec.derivation;
    if (METHODS.has(m)) prov = { method: m };
    else if (setKind === 'imported') prov = null;
    else prov = undefined;
  }
  if (prov !== undefined) a.provenance = prov;
  a.license = ctx.assetLicense ?? null;
  return a;
}

function draftFromPolyArt(d, ctx) {
  const { assetId, ext, setKind } = ctx;
  const desc = d.description ?? humanize(assetId);
  const lower = `${assetId} ${desc}`.toLowerCase();
  const colors = COLOR_WORDS.filter((c) => new RegExp(`\\b${c}\\b`).test(lower));
  const skip = new Set(['top', 'bottom', 'left', 'right', 'upper', 'lower', 'finished', 'simple']);
  const subjects = cleanSubjects(['acanthus', ...assetId.split('-').filter((t) => !skip.has(t) && t !== 'illuminated')]);
  const notes = [...(d.usage_notes ?? [])];
  const uses = d.uses ?? [];
  if (uses.includes('frame') && d.border_image_slice_percent) notes.push(`Drawn as a complete frame; border-image slice is about ${Math.round(d.border_image_slice_percent * 100) / 100}% but it has no separate corner component yet.`);
  const a = {
    id: assetId, title: humanize(assetId), description: clip(desc, 600),
    type: typeByName(assetId, 'decoration', 'none'),
    categories: ['botanical', 'scrollwork'],
    subjects: subjects.length ? subjects : ['acanthus'],
    colors: colors.length ? colors : ['gold'],
    facing: 'none', composition: 'single-ornament',
  };
  if (ctx.row.group) a.group = slugify(ctx.row.group);
  a.render = { image: {} };
  if (notes.length) a.usage_notes = notes;
  Object.assign(a, { status: 'draft', review: 'pending', created: ctx.today, master: `master.${ext}` });
  if (setKind === 'imported') a.provenance = null;
  a.license = null;
  return a;
}

function draftLogo(ctx) {
  const { assetId, ext } = ctx;
  return {
    id: assetId, title: 'Polyhymnia logo frame',
    description: 'A complete rounded illuminated-acanthus medallion frame with an empty transparent centre, drawn as the frame of the Polyhymnia homepage logo.',
    type: 'frame', categories: ['botanical', 'scrollwork'], subjects: ['acanthus', 'frame', 'medallion', 'logo'], colors: ['blue', 'red', 'gold', 'green'],
    facing: 'none', composition: 'single-ornament', render: { image: {} },
    usage_notes: ['Leave the centre empty and overlay the portrait in code.'],
    status: 'draft', review: 'pending', created: ctx.today, master: `master.${ext}`,
    provenance: { method: 'reference-guided-ai-generation' }, license: null,
  };
}

// ---------- the importer ----------
export async function importMedievalOrnaments(opts) {
  const { plan: planPath, old: oldDir, poly: polyDir, out: outDir, wave, sets: setFilter, dryRun = false } = opts;
  const log = opts.log ?? ((m) => console.log(m));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  if (!planPath || !oldDir || !outDir) throw new Error('import needs --plan, --old and --out');
  const mapPath = opts.map ?? path.join(path.dirname(path.resolve(planPath)), 'medieval-ornaments.json');

  const plan = YAML.parse(await readFile(planPath, 'utf8')).entries;
  const catalog = new Map(JSON.parse(await readFile(path.join(oldDir, 'images.json'), 'utf8')).map((x) => [x.name, x]));
  const boiler = new Map();
  for (const x of catalog.values()) for (const n of x.usage_notes ?? []) boiler.set(n, (boiler.get(n) ?? 0) + 1);
  const index = buildOldIndex(oldDir);
  const poly = polyDir ? loadPoly(polyDir) : null;
  const vocab = await loadVocab();

  const report = { sets: new Map(), warnings: [], errors: [], unplaced: 0, entries: [] };
  const warn = (m) => report.warnings.push(m);
  const setReport = (s) => { if (!report.sets.has(s)) report.sets.set(s, { assets: 0, components: 0, dropped: 0, skipped: 0, bytes: 0 }); return report.sets.get(s); };

  // select rows
  const waveSets = wave != null ? (WAVE_SETS[wave] ?? []) : [];
  const wanted = setFilter?.length ? new Set(setFilter) : null;
  const rows = plan.filter((r) => {
    if (wave != null && r.wave !== wave && !waveSets.includes(r.set)) return false;
    if (wanted && !wanted.has(r.set)) return false;
    return true;
  });
  const placed = rows.filter((r) => r.set);
  report.unplaced = rows.length - placed.length;

  const assetRows = placed.filter((r) => !r.old.includes('#'));
  const compRows = new Map(); // asset name -> [rows]
  for (const r of placed) {
    if (!r.old.includes('#')) continue;
    const [n] = r.old.split('#');
    if (!compRows.has(n)) compRows.set(n, []);
    compRows.get(n).push(r);
  }
  const bySet = new Map();
  for (const r of assetRows) { if (!bySet.has(r.set)) bySet.set(r.set, []); bySet.get(r.set).push(r); }

  const mapEntries = [];
  const setInfo = new Map(); // set -> { recs, vocabMissing:Set, rights:[], institutions }

  for (const [setId, setRows] of [...bySet].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sr = setReport(setId);
    const info = { drafts: [], provs: [], titles: [], subjectsMissing: new Set() };
    setInfo.set(setId, info);
    const repoDir = path.join(outDir, repoDirName(setId));
    const packageName = `@ranx729/ducktape-assets-${setId}`;
    const newBase = { set: setId, package: packageName, version: null, mastersPackage: `${packageName}-masters` };

    // first pass: kind needs provenance of all records in the set
    const kindOf = () => {
      if (AUTHORED.has(setId)) return 'authored';
      if (IMPORTED.has(setId)) return 'imported';
      const hasInst = setRows.some((r) => catalog.get(r.old)?.provenance?.institution);
      return hasInst ? 'historical' : 'imported';
    };
    const setKind = kindOf();
    info.kind = setKind;
    info.license = setLicense(setKind, setRows.filter((r) => r.id && r.status !== 'dropped').map((r) => catalog.get(r.old)?.provenance));
    if (!dryRun) await copyTemplate(repoDir, { allowExisting: true });

    for (const row of setRows.sort((a, b) => a.old.localeCompare(b.old))) {
      const oldName = row.old;
      const dropped = row.status === 'dropped';
      const rec = catalog.get(oldName);
      const polyArt = poly?.art.get(oldName);
      const isLogo = oldName === 'polyhymnia-logo-acanthus';

      if (dropped) {
        sr.dropped++;
        mapEntries.push({ old: { name: oldName }, new: null, status: 'dropped', verified: 'n/a', notes: row.notes ?? '' });
        continue;
      }
      if (!row.id) { sr.skipped++; warn(`${setId}: "${oldName}" has no id in the plan (over ${MAX_ID} characters or unplaced); shorten it by hand in plan.yaml. Skipped, with its components.`); continue; }
      const assetId = row.id.split('/')[1];
      if (!assetId || assetId.length > MAX_ID) { sr.skipped++; warn(`${setId}: "${oldName}" id "${row.id}" is invalid; skipped.`); continue; }

      // resolve the master
      let master = null; // { kind:'file'|'buffer', file?, buf?, ext, pkg, version, rel, svg }
      if (isLogo) {
        if (!poly?.logoSvg) { sr.skipped++; warn(`${setId}: "${oldName}" needs --poly with the logo SVG; skipped.`); continue; }
        const m = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(fs.readFileSync(poly.logoSvg, 'utf8'));
        if (!m) { sr.skipped++; warn(`${setId}: no PNG data URI in the logo SVG; skipped.`); continue; }
        const buf = Buffer.from(m[1], 'base64');
        if (poly.logoJson) {
          const want = JSON.parse(fs.readFileSync(poly.logoJson, 'utf8')).generatedFrame?.sha256;
          if (want && want !== sha(buf)) warn(`${setId}: logo frame sha256 does not match its descriptor`);
        }
        master = { kind: 'buffer', buf, ext: 'png', pkg: poly.artPkg.name, version: poly.artPkg.version ?? null, rel: 'src/assets/logo/polyhymnia-logo-acanthus.svg#data-uri', bytes: buf.length };
      } else if (polyArt) {
        const png = path.join(poly.dir, 'output/imagegen', `${oldName}.png`);
        const web = path.join(poly.dir, 'packages/homepage-art', polyArt.webp);
        const f = fs.existsSync(png) ? png : fs.existsSync(web) ? web : null;
        if (!f) { sr.skipped++; warn(`${setId}: "${oldName}" master not found in polyhymnia; skipped.`); continue; }
        master = { kind: 'file', file: f, ext: path.extname(f).slice(1), pkg: poly.artPkg.name, version: poly.artPkg.version ?? null, rel: path.relative(poly.dir, f), bytes: fs.statSync(f).size };
      } else if (rec) {
        const hand = rec.svg && rec.derivation === 'vector-reconstruction';
        const f = hand ? findFile(index, rec.svg) : findFile(index, rec.png, rec.png_bytes) ?? findFile(index, rec.webp, rec.webp_bytes);
        if (!f) { sr.skipped++; warn(`${setId}: master of "${oldName}" not found on disk; skipped.`); continue; }
        const rel = hand ? rec.svg : fs.existsSync(f.file) && f.file.endsWith('.png') ? rec.png : rec.webp;
        master = { kind: 'file', file: f.file, ext: path.extname(f.file).slice(1), pkg: f.pkg, version: f.version, rel, bytes: f.size, svg: hand };
      } else if (polyDir == null && /^illuminated-acanthus-/.test(oldName)) {
        sr.skipped++; warn(`${setId}: "${oldName}" is a polyhymnia local addition; pass --poly. Skipped.`); continue;
      } else {
        sr.skipped++; warn(`${setId}: "${oldName}" is neither in images.json nor in polyhymnia; skipped.`); continue;
      }

      // components named by merged plan rows
      const comps = []; // { key, row, file, ext, rel, pkg, version, bytes }
      const droppedComps = [];
      for (const cr of compRows.get(oldName) ?? []) {
        const key = cr.old.split('#')[1];
        if (cr.status === 'dropped' || !KEPT_COMPONENT(key)) { droppedComps.push(cr); continue; }
        const c = rec?.components?.[key];
        const hand = c?.svg && rec.derivation === 'vector-reconstruction';
        const f = c && (hand ? findFile(index, c.svg) : findFile(index, c.png, c.png_bytes) ?? findFile(index, c.webp, c.webp_bytes));
        if (!f) { warn(`${setId}: component "${cr.old}" not found on disk; skipped.`); sr.skipped++; continue; }
        comps.push({ key, row: cr, file: f.file, ext: path.extname(f.file).slice(1), rel: `${path.basename(path.dirname(f.file))}/${path.basename(f.file)}`, pkg: f.pkg, version: f.version, bytes: f.size, svg: hand });
      }

      sr.assets++;
      sr.components += comps.length;
      sr.bytes += master.bytes + comps.reduce((n, c) => n + c.bytes, 0);

      const compFiles = Object.fromEntries(comps.map((c) => [c.key, `${c.key}.${c.ext}`]));
      const spdx = mapRights(rec?.provenance?.image_rights);
      const assetLicense = info.license.artwork === 'LicenseRef-per-asset' ? spdx : null;
      const ctx = { row, assetId, keptKeys: comps.map((c) => c.key), compFiles, ext: master.ext, setKind, boiler, today, assetLicense };
      const draft = isLogo ? draftLogo(ctx) : polyArt ? draftFromPolyArt(polyArt, ctx) : draftFromOld(rec, ctx);
      if (setKind === 'imported') draft.usage_notes = [...(draft.usage_notes ?? []), ORIGIN_NOTE];
      info.drafts.push(draft);
      const rawRights = rec?.provenance?.image_rights;
      info.provs.push({ id: assetId, spdx: mapRights(rawRights), has: !!rawRights, inst: rec?.provenance?.institution, objid: rec?.provenance?.object_identifier, oldSets: rec?.sets });
      for (const s of draft.subjects) if (!vocab.subjects.has(s)) info.subjectsMissing.add(s);

      // the dropped components of this asset are recorded in the map
      for (const cr of droppedComps) {
        sr.dropped++;
        mapEntries.push({ old: { name: oldName, component: cr.old.split('#')[1] }, new: null, status: 'dropped', verified: 'n/a', notes: cr.notes ?? '' });
      }

      if (dryRun) continue;

      // write: master, components, asset.yaml
      const assetDir = path.join(repoDir, 'assets', assetId);
      await mkdir(assetDir, { recursive: true });
      const masterDest = path.join(assetDir, `master.${master.ext}`);
      let oldHash, verified, vnote = '';
      if (master.kind === 'buffer') {
        await writeFile(masterDest, master.buf);
        const tmp = master.buf;
        oldHash = sha((await sharp(tmp, { limitInputPixels: false }).ensureAlpha().raw().toBuffer()));
      } else {
        await copyFile(master.file, masterDest);
        oldHash = master.ext === 'svg' ? sha(fs.readFileSync(master.file)) : await rgbaHash(master.file);
      }
      const verify = async (dest, ext) => {
        if (ext === 'svg') return sha(fs.readFileSync(dest)) === oldHash ? ['manual', ' svg copied byte-identically'] : [null, ''];
        return (await rgbaHash(dest)) === oldHash ? ['pixels-identical', ''] : [null, ''];
      };
      [verified, vnote] = await verify(masterDest, master.ext);
      if (!verified) { report.errors.push(`${setId}/${assetId}: copied master differs from the old master`); verified = 'FAILED'; }
      await writeFile(path.join(assetDir, 'asset.yaml'), toYaml(draft));

      const notesBase = [row.notes, vnote.trim(), polyArt || isLogo ? 'metadata drafted from the polyhymnia catalog and the id only; review fully' : ''].filter(Boolean).join('; ');
      mapEntries.push({
        old: { name: oldName, ...(master.pkg ? { package: master.pkg } : {}), ...(master.version ? { version: master.version } : {}), path: master.rel, masterSha256: oldHash },
        new: { id: row.id, ...newBase }, status: row.status === 'renamed' ? 'renamed' : 'moved', verified, notes: notesBase,
      });

      for (const c of comps) {
        const dest = path.join(assetDir, `${c.key}.${c.ext}`);
        await copyFile(c.file, dest);
        const h = c.ext === 'svg' ? sha(fs.readFileSync(c.file)) : await rgbaHash(c.file);
        const [v, vn] = await (async () => {
          if (c.ext === 'svg') return sha(fs.readFileSync(dest)) === h ? ['manual', 'svg copied byte-identically'] : [null, ''];
          return (await rgbaHash(dest)) === h ? ['pixels-identical', ''] : [null, ''];
        })();
        if (!v) report.errors.push(`${setId}/${assetId}#${c.key}: copied component differs from the old one`);
        mapEntries.push({
          old: { name: oldName, component: c.key, ...(c.pkg ? { package: c.pkg } : {}), ...(c.version ? { version: c.version } : {}), path: c.rel, masterSha256: h },
          new: { id: c.row.id, ...newBase }, status: 'merged', verified: v ?? 'FAILED', notes: [c.row.notes, vn].filter(Boolean).join('; '),
        });
      }
    }

    // component rows whose asset row was not selected/handled are not recorded (their asset was skipped)
    if (!dryRun && info.drafts.length) {
      await writeFile(path.join(repoDir, 'set.yaml'), toYaml(buildSet(setId, info, catalog, setRows)));
      await writeFile(path.join(repoDir, 'vocab-additions.yaml'),
        '# Subjects used by the drafts of this set that are not in schemas/vocab/subjects.yaml.\n# Add the ones kept after review to the global vocabulary in the same PR; never merged automatically.\n'
        + toYaml({ subjects: [...info.subjectsMissing].sort() }));
      await generateReadme(repoDir);
    }
  }

  report.entries = mapEntries;
  if (!dryRun && mapEntries.length) await appendMap(mapPath, mapEntries, sourceInfo(oldDir));
  report.mapPath = mapPath;
  report.setInfo = setInfo;
  printReport(report, dryRun, log);
  return report;
}

// ---------- set.yaml ----------
function buildSet(setId, info, catalog, setRows) {
  const kind = info.kind;
  const provs = info.provs;
  const insts = [...new Set(provs.map((p) => p.inst).filter(Boolean).map(canonInstitution))];
  const oldSetName = (() => {
    for (const p of provs) { const s = p.oldSets?.at(-1)?.name; if (s) return s; }
    return null;
  })();
  const base = { id: setId, title: '', summary: '', kind, author: 'adrian729', maintainer: 'https://github.com/adrian729/ducktape-assets/issues' };
  const n = info.drafts.length;
  if (kind === 'historical') {
    const inst = insts[0] ?? 'Unknown institution';
    const idents = [...new Set(provs.map((p) => (p.objid ? String(p.objid).split(',')[0].trim() : null)).filter(Boolean))];
    const objId = idents[0] ?? setId;
    base.title = clip(`${inst} ${objId}`, 120);
    base.summary = clip(`Draft set of ${n} ornament${n === 1 ? '' : 's'} and figures extracted from ${objId}, held by ${insts.join(' and ') || inst}.`, 300);
    base.origin = { institution: inst, object_identifier: objId };
  } else {
    const t = oldSetName ?? humanize(setId);
    base.title = clip(t, 120);
    base.summary = clip(kind === 'authored'
      ? `Draft set of ${n} authored ornament${n === 1 ? '' : 's'} imported from the old library's ${oldSetName ?? setId} collection.`
      : `Draft set of ${n} piece${n === 1 ? '' : 's'} imported from the old library's ${oldSetName ?? setId} collection; origin not recorded.`, 300);
  }
  base.license = info.license;
  base.tags = [];
  return base;
}

// Set licence from the old rights statements: authored -> CC-BY-4.0; one SPDX id for every asset -> that; nothing recorded -> unrecorded; else per asset.
function setLicense(kind, provenances) {
  if (kind === 'authored') return { artwork: 'CC-BY-4.0', notes: 'Attribution to adrian729.' };
  if (kind === 'imported') return { artwork: 'CC-BY-4.0', notes: ORIGIN_NOTE_LICENSE };
  const rights = provenances.map((p) => p?.image_rights).filter(Boolean);
  if (rights.length === 0) return { artwork: 'LicenseRef-unrecorded', notes: 'Origin and rights were not recorded in the old catalog; settle them in review before approval.' };
  const spdx = new Set(rights.map(mapRights));
  if (spdx.size === 1 && [...spdx][0] && rights.length === provenances.length) {
    const id = [...spdx][0];
    return id === 'CC0-1.0' ? { artwork: id, notes: 'Extracted from CC0 source objects; see SOURCES.md.' } : { artwork: id };
  }
  return { artwork: 'LicenseRef-per-asset', notes: "Rights differ per asset; see each asset's provenance (image_rights or rights_text) and LICENSE.md." };
}

// ---------- migration map ----------
const entryKey = (e) => `${e.old.name}#${e.old.component ?? ''}`;
async function appendMap(mapPath, entries, source) {
  let doc = { schema: 1, source, entries: [] };
  if (await exists(mapPath)) doc = JSON.parse(await readFile(mapPath, 'utf8'));
  doc.source = { ...doc.source, ...source };
  const byKey = new Map((doc.entries ?? []).map((e) => [entryKey(e), e]));
  for (const e of entries) byKey.set(entryKey(e), e);
  doc.entries = [...byKey.values()].sort((a, b) => entryKey(a).localeCompare(entryKey(b)));
  await mkdir(path.dirname(mapPath), { recursive: true });
  await writeFile(mapPath, JSON.stringify(doc, null, 2) + '\n');
}

function printReport(report, dryRun, log) {
  log(`${dryRun ? 'DRY RUN (nothing written)' : 'import done'}`);
  log(['set', 'assets', 'components', 'dropped', 'skipped', 'master MB'].join('\t'));
  const t = { assets: 0, components: 0, dropped: 0, skipped: 0, bytes: 0 };
  for (const [s, r] of [...report.sets].sort((a, b) => a[0].localeCompare(b[0]))) {
    log([s, r.assets, r.components, r.dropped, r.skipped, (r.bytes / 1e6).toFixed(2)].join('\t'));
    for (const k of Object.keys(t)) t[k] += r[k];
  }
  log(['TOTAL', t.assets, t.components, t.dropped, t.skipped, (t.bytes / 1e6).toFixed(2)].join('\t'));
  if (report.unplaced) log(`rows without a target set (triage, not imported): ${report.unplaced}`);
  for (const [s, info] of [...report.setInfo].sort((a, b) => a[0].localeCompare(b[0]))) {
    log(`${s}: kind ${info.kind}, licence ${info.license.artwork}, ${info.subjectsMissing.size} subjects not in the global vocabulary`);
  }
  for (const w of report.warnings) log(`warning: ${w}`);
  for (const e of report.errors) log(`ERROR: ${e}`);
}

export async function runImport(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      plan: { type: 'string' }, old: { type: 'string' }, poly: { type: 'string' }, out: { type: 'string' }, map: { type: 'string' },
      wave: { type: 'string' }, sets: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
    },
  });
  if (positionals[0] !== 'medieval-ornaments') throw new Error('usage: import medieval-ornaments --plan <plan.yaml> --old <dir> [--poly <dir>] --out <dir> [--wave n] [--sets a,b] [--dry-run]');
  const report = await importMedievalOrnaments({
    plan: values.plan, old: values.old, poly: values.poly, out: values.out, map: values.map, dryRun: values['dry-run'],
    wave: values.wave != null ? Number(values.wave) : undefined,
    sets: values.sets ? values.sets.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  });
  if (report.errors.length) process.exitCode = 1;
}

// Phase 0 spike: dry-run importer for medieval-ornaments -> Ducktape Assets set plan.
// Read-only on all inputs. Writes only ../../migration/plan.yaml and ../../migration/README.md.
// Usage: node plan.mjs [--no-write]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const MO = process.env.MO_DIR ?? '/home/ranx729/projects/medieval-ornaments';
const CHECKOUTS = path.join(MO, 'tmp/resource-checkouts');
const POLY = process.env.POLY_DIR ?? '/home/ranx729/projects/polyhymnia/polyhymnia-ear-training';
const WRITE = !process.argv.includes('--no-write');

// ---------- constants (stated in the output) ----------
const LADDER = [64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048];
const WEBP_BPP = 0.10;       // lossy WebP q82, bytes per pixel at rung size
const AVIF_BPP = 0.07;       // AVIF, bytes per pixel at rung size
const AVIF_MIN_ASSET_W = 256; // AVIF only when asset (master) width > 256
const MASTER_BPP = 0.9;      // lossless master
const MASTER_CAP = 2048;     // long side cap of lossless master
const MB = 1e6;              // decimal MB
const PKG_WARN = 100 * MB, PKG_FAIL = 120 * MB;
const MAX_ID = 48;
const EXTRA_GROUP_LIMIT = 40;
const RESERVED = new Set(['gallery', 'template', 'tools', 'index', 'masters']);
const isReserved = (s) => RESERVED.has(s) || /^part\d+$/.test(s);

// Wave-1 allowlist, from Investigation/Consumers.md
const ALLOW_POLY = [
  'illuminated-acanthus-headpiece', 'illuminated-acanthus-corner', 'illuminated-acanthus-corner-top-right',
  'illuminated-acanthus-corner-bottom-left', 'illuminated-acanthus-corner-bottom-right',
  'illuminated-acanthus-divider-start', 'illuminated-acanthus-divider-center', 'illuminated-acanthus-divider-end',
  'illuminated-acanthus-section-fleuron', 'illuminated-acanthus-horizontal-flourish', 'illuminated-acanthus-rosette',
  'anafiles', 'bunny-trumpet', 'donkey-organist', 'animal-musicians-ensemble', 'musicians-and-dancers',
  'cat-reading-book', 'animal-choir-landscape', 'polyhymnia', 'walters-horse-flute-drum',
];
const ALLOW_ELDER = ['rabbit-reading-book', 'flying-pig', 'snail', 'weird-dog'];

// Set sizes stated in Migration.md (for contradiction report)
const DOC_COUNT = {
  'walters-w82': 62, 'walters-w171': 44, 'walters-w73': 26, 'walters-w88': 13, 'walters-w7': 7, 'walters-w186': 12,
  'walters-w148': 5, 'cma-1524-psalter': 77, 'cma-2014-22': 16, 'cma-1950-154': 7, 'cma-2005-206': 15,
  'cma-2006-13': 6, 'cma-2011-53': 6, 'cma-2003-171': 5, 'cma-1953-24': 4, 'cma-1963-256': 6,
  'met-livre-nouveau-de-fleurs': 46, 'met-latomus-lace': 18, 'met-hopfer-friezes': 10, 'met-du-cerceau': 13,
  'met-schoen-modelbuch': 22, 'met-acanthus-prints': 5, 'met-356741': 8, 'mkg-de-bry-alphabet': 11,
  'nga-ornament-prints': 8, 'openn-lewis-e-m': 35, 'gessner-historiae-animalium': 18, 'fuchs-1542-herbal': 7,
  'getty-ms20': 4, 'illuminated-acanthus': 33, 'shaggy-bestiary': 16, 'medieval-cutouts': 41,
  'numbered-plate': 38, 'floral-vector-borders': 6, 'supplied-sheets': 24,
};

// ---------- image header readers ----------
function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(64);
  fs.readSync(fd, b, 0, 64, 0);
  fs.closeSync(fd);
  return parseHeader(b);
}
function parseHeader(b) {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { fmt: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const t = b.toString('ascii', 12, 16);
    if (t === 'VP8X') return { fmt: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === 'VP8L') { const v = b.readUInt32LE(21); return { fmt: 'webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (t === 'VP8 ') return { fmt: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  throw new Error('unknown image header');
}

// ---------- ladder estimate ----------
function rungsFor(W) {
  const out = [];
  for (const r of LADDER) { const w = Math.min(r, W); if (!out.includes(w)) out.push(w); if (r >= W) break; }
  return out;
}
function estimate(W, H) {
  let webp = 0, avif = 0, webpCap = 0, avifCap = 0;
  const long = Math.max(W, H);
  for (const w of rungsFor(W)) {
    const h = Math.max(1, Math.round((H * w) / W));
    webp += WEBP_BPP * w * h;
    if (W > AVIF_MIN_ASSET_W) avif += AVIF_BPP * w * h;
    if (Math.max(w, h) <= MASTER_CAP) { // alternative: also honour the 2048 long-side cap on rungs
      webpCap += WEBP_BPP * w * h;
      if (W > AVIF_MIN_ASSET_W) avifCap += AVIF_BPP * w * h;
    }
  }
  const s = Math.min(1, MASTER_CAP / long);
  const master = MASTER_BPP * W * s * H * s;
  return { delivery: webp + avif, deliveryCap: webpCap + avifCap, master };
}

// ---------- load inputs ----------
const designs = JSON.parse(fs.readFileSync(path.join(MO, 'images.json'), 'utf8'));
const lockPresent = fs.existsSync(path.join(MO, 'resource-lock.json'));
const registryPresent = fs.existsSync(path.join(MO, 'resource-registry.json'));

// index of master files in the 29 checkouts
const index = new Map(); // "png/x.png" -> [{co, file, size}]
const checkoutNames = fs.readdirSync(CHECKOUTS).sort();
for (const co of checkoutNames) {
  for (const sub of ['png', 'webp']) {
    const dir = path.join(CHECKOUTS, co, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      const key = `${sub}/${f}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ co, file: full, size: st.size });
    }
  }
}
function findFile(rel, expectBytes) {
  const c = index.get(rel);
  if (!c) return null;
  const hit = (expectBytes != null && c.find((x) => x.size === expectBytes)) || c[0];
  return { ...hit, candidates: c.length, bytesMatch: expectBytes == null ? null : hit.size === expectBytes };
}

// ---------- placement ----------
const slug = (s) => s.replace(/-set$/, '');
const stats = { weakGroupSets: new Set() };
function placeByHistory(x) {
  const ids = (x.sets || []).map((s) => s.id);
  const top = ids[0], last = ids.at(-1);
  if (top === 'illuminated-acanthus') return { set: 'illuminated-acanthus', group: null };
  if (top === 'shaggy-bestiary-creatures') return { set: 'shaggy-bestiary', group: null };
  if (top === 'cleveland-1524-psalter-prayerbook') {
    const m = /^cma-(\d{4}-\d+)-([a-z])-set$/.exec(last);
    return { set: 'cma-1524-psalter', group: `${m[1]}-${m[2]}` };
  }
  let m;
  if ((m = /^cma-(\d{4}-\d+)(?:-([a-z]))?-set$/.exec(last))) return { set: `cma-${m[1]}`, group: m[2] ?? null, weak: true };
  if (top === 'fuchs-1542-herbal') return { set: 'fuchs-1542-herbal', group: null };
  if (top === 'gessner-historiae-animalium') {
    return { set: 'gessner-historiae-animalium', group: ids.length > 1 ? 'lion-627095' : null };
  }
  if (top === 'livre-nouveau-de-fleurs') return { set: 'met-livre-nouveau-de-fleurs', group: slug(last).replace(/^met-/, '') };
  const metMap = {
    'met-338721-set': ['met-du-cerceau', '338721'], 'met-387622-set': ['met-du-cerceau', '387622'],
    'met-364800-set': ['met-acanthus-prints', '364800'], 'met-377606-set': ['met-acanthus-prints', '377606'],
    'met-368267-set': ['met-latomus-lace', null], 'met-399648-set': ['met-hopfer-friezes', null],
    'met-680571-set': ['met-schoen-modelbuch', '680571'], 'met-680623-set': ['met-schoen-modelbuch', '680623'],
    'met-681251-set': ['met-schoen-modelbuch', '681251'], 'met-681253-set': ['met-schoen-modelbuch', '681253'],
    'met-681256-set': ['met-schoen-modelbuch', '681256'],
    'mkg-dc00101865-set': ['mkg-de-bry-alphabet', null],
    'nga-3305-set': ['nga-ornament-prints', '3305'], 'nga-3375-set': ['nga-ornament-prints', '3375'],
    'nga-3513-set': ['nga-ornament-prints', '3513'],
  };
  if (metMap[last]) return { set: metMap[last][0], group: metMap[last][1] };
  if ((m = /^openn-lewis-e-m-(.+)-set$/.exec(last))) return { set: 'openn-lewis-e-m', group: m[1] };
  if ((m = /^walters-(w\d+)-(.+?)(?:-set)?$/.exec(last))) return { set: `walters-${m[1]}`, group: m[2] };
  return null;
}
function placeByReference(x) {
  const r = x.reference;
  let m;
  if (r === 'medieval-cutouts') return { set: 'medieval-cutouts', group: null };
  if (r === 'numbered-ornament-plate') return { set: 'numbered-plate', group: null };
  if (r === 'six-border-styles') return { set: 'floral-vector-borders', group: null };
  if (['blue-sheet', 'painted-sheet', 'five-painted-panels', 'stencil-sheet', 'tall-floral-sheet'].includes(r)) return { set: 'supplied-sheets', group: r };
  if (/^cleveland-1963-256/.test(r)) return { set: 'cma-1963-256', group: null };
  if (/^getty-ms20-/.test(r)) return { set: 'getty-ms20', group: null };
  if (r === 'met-356741') return { set: 'met-356741', group: null };
  if (/^fitzwilliam-ms1-2005/.test(r)) return { set: 'fitzwilliam-ms1-2005', group: null };
  if ((m = /^walters-(w\d+)-(.+)$/.exec(r))) return { set: `walters-${m[1]}`, group: m[2] };
  if ((m = /^openn-lewis-e-m-(.+)$/.exec(r))) return { set: 'openn-lewis-e-m', group: m[1] };
  return null;
}
function authoredLeftover(x) {
  if (!(x.reference === 'authored-additions' || x.reference === 'illustration-additions')) return null;
  const text = `${x.name} ${x.description}`.toLowerCase();
  const subj = new Set(x.subjects), col = new Set(x.colors);
  const acanthusStyle = /gold floral fram/.test(text) || (col.has('blue') && col.has('red') && col.has('gold') && subj.has('acanthus'));
  const bestiary = ['rabbit', 'dog', 'cat', 'hare', 'creature', 'beast'].some((k) => subj.has(k));
  if (acanthusStyle) return { set: 'illuminated-acanthus', group: null, test: 'acanthus' };
  if (bestiary) return { set: 'shaggy-bestiary', group: null, test: 'bestiary' };
  let g = col.size === 1 && col.has('black') ? 'black-penwork' : /^gold-/.test(x.name) ? 'gold-dividers' : subj.has('book') ? 'book' : 'other';
  if (subj.has('book')) g = 'book';
  return { set: 'authored-ornaments', group: g, test: 'none' };
}

const placed = []; // {x, set, group, how, notes[]}
const triage = [];
for (const x of designs) {
  let p = null, how = '';
  if (x.sets && x.sets.length) { p = placeByHistory(x); how = 'sets'; }
  else {
    p = authoredLeftover(x); how = 'authored-keyword';
    if (!p && !x.provenance) { p = placeByReference(x); how = 'reference-legacy'; }
    else if (!p) { p = placeByReference(x); how = 'reference-provenance'; }
  }
  if (p) placed.push({ x, ...p, how, notes: p.test ? [`style test: ${p.test}`] : [] });
  else triage.push({ x });
}
// weak groups (cma leaf letters): null when the set has a single group
{
  const per = new Map();
  for (const p of placed) if (p.weak) { if (!per.has(p.set)) per.set(p.set, new Set()); per.get(p.set).add(p.group); }
  for (const p of placed) if (p.weak && per.get(p.set).size < 2) p.group = null;
}
// accession-family join / suggestions for single-object leftovers
const famOf = (id) => id.replace(/\s*\(.*\)$/, '');
const prefOf = (id) => famOf(id).split('.').slice(0, -1).join('.');
const famSets = new Map(), prefSets = new Map();
for (const p of placed) {
  const pr = p.x.provenance; if (!pr) continue;
  const inst = pr.institution.replace(/^The /, '');
  const k = `${inst}|${famOf(pr.object_identifier)}`; if (!famSets.has(k)) famSets.set(k, new Set()); famSets.get(k).add(p.set);
  const k2 = `${inst}|${prefOf(pr.object_identifier)}`; if (!prefSets.has(k2)) prefSets.set(k2, new Set()); prefSets.get(k2).add(p.set);
}
const stillTriage = [];
for (const t of triage) {
  const pr = t.x.provenance;
  if (!pr) { t.reason = `no set, no provenance, reference "${t.x.reference}" not in the set plan`; stillTriage.push(t); continue; }
  const inst = pr.institution.replace(/^The /, '');
  const fs_ = famSets.get(`${inst}|${famOf(pr.object_identifier)}`);
  if (fs_ && fs_.size === 1) {
    const set = [...fs_][0];
    placed.push({ x: t.x, set, group: t.x.reference.replace(/^[a-z]+-/, ''), how: 'accession-family', notes: [`joined ${set}: same accession family ${famOf(pr.object_identifier)}`] });
    continue;
  }
  const ps = prefSets.get(`${inst}|${prefOf(pr.object_identifier)}`);
  t.reason = `single object ${pr.object_identifier} (${inst}); reference "${t.x.reference}" has no set in the plan`;
  if (ps) t.suggest = [...ps].sort().join(' | ');
  stillTriage.push(t);
}

// ---------- ids ----------
const INST_PREFIX = { 'walters-': true };
function newId(p) {
  let n = p.x.name;
  const tried = [`${p.set}-`, p.set === 'shaggy-bestiary' ? 'shaggy-bestiary-' : null, p.set.startsWith('walters-') ? 'walters-' : null].filter(Boolean);
  for (const pre of tried) if (n.startsWith(pre) && n.length > pre.length) { n = n.slice(pre.length); break; }
  return n;
}

// ---------- resolve masters ----------
const issues = { missing: [], dimMismatch: [], bytesMismatch: [], dup: 0, badIds: [], reserved: [], idCollisions: [] };
const entries = []; // one per asset
function resolveOld(p) {
  const x = p.x;
  const e = { old: x.name, set: p.set, group: p.group, how: p.how, notes: [...p.notes], comps: [], source: 'medieval-ornaments' };
  e.idCand = newId(p);
  const png = findFile(x.png, x.png_bytes);
  const web = findFile(x.webp, x.webp_bytes);
  const f = png || web;
  if (!f) { issues.missing.push(x.name); e.missing = true; e.W = x.width; e.H = x.height; e.nativeBytes = x.png_bytes; e.masterFmt = 'none'; }
  else {
    const h = readHeader(f.file);
    e.W = h.w; e.H = h.h; e.nativeBytes = f.size; e.masterFmt = h.fmt; e.masterFile = f.file; e.checkout = f.co;
    if (f.candidates > 1) issues.dup++;
    if (h.w !== x.width || h.h !== x.height) issues.dimMismatch.push(`${x.name}: disk ${h.w}x${h.h} vs images.json ${x.width}x${x.height}`);
    if (f.bytesMatch === false) issues.bytesMismatch.push(x.name);
    if (!png) e.notes.push('png master missing; using lossless webp');
  }
  // components
  for (const [key, c] of Object.entries(x.components || {})) {
    const comp = { key, old: `${x.name}#${key}` };
    if (['corner', 'bar'].includes(key) || /^corner-(top|bottom)-(left|right)$/.test(key)) {
      comp.keep = true;
      const cf = findFile(c.png, c.png_bytes) || findFile(c.webp, c.webp_bytes);
      if (cf) { const h = readHeader(cf.file); comp.W = h.w; comp.H = h.h; comp.bytes = cf.size; }
      else { comp.W = c.width; comp.H = c.height; comp.bytes = c.png_bytes; comp.missing = true; issues.missing.push(comp.old); }
    } else {
      comp.keep = false;
      comp.why = { border_image: 'generated border-image atlas; geometry goes to render.frame', rotated_tile: 'generated rotated tile; geometry goes to render.tile',
        reference_crop: 'generated reference crop', rotated_bar: 'generated rotation of bar' }[key] ?? 'generated component';
    }
    e.comps.push(comp);
  }
  e.svg = x.svg ? (x.derivation === 'vector-reconstruction' ? 'hand' : 'traced') : null;
  e.derivation = x.derivation;
  return e;
}
for (const p of placed) entries.push(resolveOld(p));

// local additions: polyhymnia homepage-art + logo
const homeCat = JSON.parse(fs.readFileSync(path.join(POLY, 'packages/homepage-art/catalog.json'), 'utf8'));
for (const d of homeCat) {
  const pngPath = path.join(POLY, 'output/imagegen', `${d.name}.png`);
  const webPath = path.join(POLY, 'packages/homepage-art', d.webp);
  const e = { old: d.name, set: 'illuminated-acanthus', group: null, how: 'polyhymnia-homepage-art', notes: ['polyhymnia packages/homepage-art/catalog.json'], comps: [], source: 'polyhymnia homepage-art' };
  e.idCand = d.name.replace(/^illuminated-acanthus-/, '');
  const wh = readHeader(webPath);
  if (wh.w !== d.width || wh.h !== d.height) issues.dimMismatch.push(`${d.name}: webp ${wh.w}x${wh.h} vs catalog ${d.width}x${d.height}`);
  if (fs.existsSync(pngPath)) {
    const h = readHeader(pngPath);
    e.W = h.w; e.H = h.h; e.nativeBytes = fs.statSync(pngPath).size; e.masterFmt = 'png'; e.masterFile = pngPath;
    if (h.w !== wh.w || h.h !== wh.h) e.notes.push(`output/imagegen png is ${h.w}x${h.h}; delivered cropped lossless webp is ${wh.w}x${wh.h}; the png is the uncropped generation, decide which is the master`);
  } else {
    e.W = wh.w; e.H = wh.h; e.nativeBytes = fs.statSync(webPath).size; e.masterFmt = 'webp'; e.masterFile = webPath;
    e.notes.push('no png in output/imagegen; lossless webp from packages/homepage-art is the only master');
  }
  e.derivation = 'local';
  entries.push(e);
}
{
  const svgPath = path.join(POLY, 'src/assets/logo/polyhymnia-logo-acanthus.svg');
  const desc = JSON.parse(fs.readFileSync(path.join(POLY, 'src/assets/logo/polyhymnia-logo-acanthus.json'), 'utf8'));
  const svg = fs.readFileSync(svgPath, 'utf8');
  const m = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(svg);
  const buf = Buffer.from(m[1], 'base64');
  const h = parseHeader(buf);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const e = { old: 'polyhymnia-logo-acanthus', set: 'illuminated-acanthus', group: null, how: 'polyhymnia-logo', comps: [], source: 'polyhymnia logo', derivation: 'local',
    notes: [`PNG extracted from data URI in polyhymnia-logo-acanthus.svg (no standalone PNG on disk); descriptor ${desc.generatedFrame.width}x${desc.generatedFrame.height}; sha256 ${sha === desc.generatedFrame.sha256 ? 'matches' : 'DOES NOT match'} descriptor`] };
  e.idCand = 'polyhymnia-logo-acanthus'; e.W = h.w; e.H = h.h; e.nativeBytes = buf.length; e.masterFmt = 'png';
  if (h.w !== desc.generatedFrame.width || h.h !== desc.generatedFrame.height) issues.dimMismatch.push(`polyhymnia-logo-acanthus: png ${h.w}x${h.h} vs descriptor`);
  entries.push(e);
}

// finalize ids + estimates
for (const e of entries) {
  const c = e.idCand;
  e.long = c.length > MAX_ID;
  e.id = e.long ? null : c;
  e.renamedByHand = e.long;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c)) issues.badIds.push(`${e.old} -> ${c}`);
  if (isReserved(c) || isReserved(e.set)) issues.reserved.push(`${e.set}/${c}`);
  const est = estimate(e.W, e.H);
  e.delivery = est.delivery; e.deliveryCap = est.deliveryCap; e.master = est.master;
  for (const cp of e.comps) if (cp.keep) { const ce = estimate(cp.W, cp.H); e.delivery += ce.delivery; e.deliveryCap += ce.deliveryCap; e.master += ce.master; e.nativeBytes += cp.bytes ?? 0; }
}
{ // id collisions
  const seen = new Map();
  for (const e of entries) { const k = `${e.set}/${e.idCand}`; if (seen.has(k)) issues.idCollisions.push(`${k}: ${seen.get(k)} & ${e.old}`); else seen.set(k, e.old); }
}
entries.sort((a, b) => (a.set + '/' + a.old).localeCompare(b.set + '/' + b.old));

// ---------- wave 1 ----------
const allow = new Map(); // old name -> consumer
for (const n of ALLOW_POLY) allow.set(n, 'polyhymnia');
for (const n of ALLOW_ELDER) allow.set(n, 'elder-scrolls');
const byOld = new Map(entries.map((e) => [e.old, e]));
const notFound = [...allow.keys()].filter((n) => !byOld.has(n)).sort();
for (const e of entries) e.wave = 2;
const selected = new Map(); // old -> reason
for (const e of entries) if (e.set === 'illuminated-acanthus') { e.wave = 1; selected.set(e.old, 'set'); }
for (const e of entries) if (e.source === 'polyhymnia homepage-art') { e.wave = 1; selected.set(e.old, 'set'); }
for (const n of allow.keys()) { const e = byOld.get(n); if (e) { e.wave = 1; selected.set(n, 'allow'); } }
const allowGroups = new Set(entries.filter((e) => allow.has(e.old) && e.group != null).map((e) => `${e.set}|${e.group}`));
for (const e of entries) if (e.wave === 2 && e.group != null && allowGroups.has(`${e.set}|${e.group}`)) { e.wave = 1; selected.set(e.old, 'group'); }
// allowlisted-with-null-group in a set that had a single group (info)
const allowInSingleGroupSets = [...allow.keys()].map((n) => byOld.get(n)).filter((e) => e && e.group == null && e.set !== 'illuminated-acanthus' && entries.filter((o) => o.set === e.set).length > 1).map((e) => `${e.old} (${e.set})`);

// ---------- per-set aggregation ----------
const sets = new Map();
for (const e of entries) {
  if (!sets.has(e.set)) sets.set(e.set, { id: e.set, n: 0, groups: new Set(), delivery: 0, deliveryCap: 0, master: 0, native: 0, w1: 0 });
  const s = sets.get(e.set);
  s.n++; if (e.group) s.groups.add(e.group); s.delivery += e.delivery; s.deliveryCap += e.deliveryCap; s.master += e.master; s.native += e.nativeBytes;
  if (e.wave === 1) s.w1++;
}
const parts = (b) => Math.max(1, Math.ceil(b / PKG_FAIL));
const fmt = (b) => (b / MB).toFixed(3);

// ---------- output ----------
const L = [];
const out = (s = '') => L.push(s);
out('== Ducktape Assets importer dry-run (Phase 0 spike) ==');
out(`inputs: ${designs.length} designs in images.json; ${checkoutNames.length} resource checkouts; resource-registry.json ${registryPresent ? 'present' : 'absent'}, resource-lock.json ${lockPresent ? 'present' : 'absent'}`);
out(`local additions: ${homeCat.length} homepage-art designs + 1 logo frame`);
out('');
out('-- constants --');
out(`webp ladder widths: ${LADDER.join(',')} (rung = min(width, master width); the last rung is the master width)`);
out(`lossy WebP q82 = ${WEBP_BPP} byte/px at rung size; AVIF = ${AVIF_BPP} byte/px, counted for assets with master width > ${AVIF_MIN_ASSET_W} (all rungs)`);
out(`lossless master = ${MASTER_BPP} byte/px after capping long side at ${MASTER_CAP}`);
out(`1 MB = ${MB} bytes; package guard warn ${PKG_WARN / MB} MB, fail ${PKG_FAIL / MB} MB; true-master components (corner*, bar) are added to the asset estimate`);
out('delivery estimate = literal model above. delivery(2048-longside-cap) additionally drops rungs whose long side exceeds 2048 (only matters for tall masters).');
out('');
out('-- per set --');
const header = ['set', 'assets', 'groups', 'wave1', 'delivery_MB', 'deliv_cap2048_MB', 'masters_MB(est)', 'native_MB', 'parts(deliv/masters)', 'needs-part2'];
out(header.join('\t'));
const sortedSets = [...sets.values()].sort((a, b) => a.id.localeCompare(b.id));
let T = { n: 0, delivery: 0, deliveryCap: 0, master: 0, native: 0, w1: 0 };
for (const s of sortedSets) {
  const pd = parts(s.delivery), pm = parts(s.master);
  const flag = s.delivery > PKG_FAIL || s.master > PKG_FAIL ? 'YES' : s.delivery > PKG_WARN || s.master > PKG_WARN ? 'warn(>100MB)' : 'no';
  out([s.id, s.n, s.groups.size, s.w1, fmt(s.delivery), fmt(s.deliveryCap), fmt(s.master), fmt(s.native), `${pd}/${pm}`, flag].join('\t'));
  T.n += s.n; T.delivery += s.delivery; T.deliveryCap += s.deliveryCap; T.master += s.master; T.native += s.native; T.w1 += s.w1;
}
out('');
out(`TOTAL: ${T.n} assets in ${sets.size} sets; delivery ${fmt(T.delivery)} MB (with 2048 long-side rung cap: ${fmt(T.deliveryCap)} MB); masters est ${fmt(T.master)} MB; native master bytes on disk ${fmt(T.native)} MB (incl. true-master components)`);
const oldPlaced = entries.filter((e) => e.source === 'medieval-ornaments').length;
out(`old designs placed: ${oldPlaced}; triage: ${stillTriage.length}; sum ${oldPlaced + stillTriage.length} (expected ${designs.length}); local additions placed: ${entries.length - oldPlaced}; sets over the 100 MB warn line: ${sortedSets.filter((s) => s.delivery > PKG_WARN || s.master > PKG_WARN).length}`);
out(`homepage-art with png/webp size note: ${entries.filter((e) => e.notes.some((n) => n.includes('uncropped'))).length}; webp-only homepage-art: ${entries.filter((e) => e.notes.some((n) => n.includes('no png in output'))).length}`);
out('');
out('-- groups per set --');
for (const s of sortedSets) if (s.groups.size) out(`${s.id}: ${[...s.groups].sort().join(', ')}`);
out('');
out(`-- triage (${stillTriage.length}) -- never a catch-all set`);
for (const t of stillTriage.sort((a, b) => a.x.name.localeCompare(b.x.name)))
  out(`${t.x.name}\t[${t.x.reference}]\t${t.reason}${t.suggest ? `\tsuggest: ${t.suggest}` : ''}`);
out('');
out('-- placed by accession family (joined an existing set) --');
for (const e of entries.filter((e) => e.how === 'accession-family')) out(`${e.old} -> ${e.set} group ${e.group}`);
out('');
out('-- authored leftovers: style test --');
for (const e of entries.filter((e) => e.how === 'authored-keyword')) out(`${e.old} -> ${e.set}${e.group ? ' group ' + e.group : ''}`);
out('');
out(`-- ids over ${MAX_ID} chars after stripping (id left null in plan.yaml, importer refuses to guess): ${entries.filter((e) => e.long).length} --`);
for (const e of entries.filter((e) => e.long)) out(`${e.set}\t${e.idCand.length}\t${e.idCand}`);
out('');
out('-- checks --');
out(`missing masters: ${issues.missing.length} ${issues.missing.join(', ')}`);
out(`dimension mismatches (disk vs catalog): ${issues.dimMismatch.length}`); for (const m of issues.dimMismatch) out('  ' + m);
out(`master byte-size differs from images.json png_bytes: ${issues.bytesMismatch.length} ${issues.bytesMismatch.join(', ')}`);
out(`designs whose master exists in more than one checkout: ${issues.dup}`);
out(`invalid id characters: ${issues.badIds.length} ${issues.badIds.join('; ')}`);
out(`reserved-word hits: ${issues.reserved.length} ${issues.reserved.join('; ')}`);
out(`id collisions inside a set: ${issues.idCollisions.length} ${issues.idCollisions.join('; ')}`);
out('');
out('-- counts vs Migration.md --');
for (const [k, v] of Object.entries(DOC_COUNT).sort()) {
  const s = sets.get(k); const got = s ? s.n : 0;
  if (got !== v) out(`${k}: doc ${v}, importer ${got}`);
}
for (const s of sortedSets) if (!(s.id in DOC_COUNT)) out(`${s.id}: ${s.n} (set not in Migration.md plan)`);
out('');
// wave 1
const w1 = entries.filter((e) => e.wave === 1);
const w1sets = new Map();
for (const e of w1) {
  if (!w1sets.has(e.set)) w1sets.set(e.set, { n: 0, allow: 0, group: 0, set: 0, delivery: 0, master: 0 });
  const s = w1sets.get(e.set); s.n++; s[selected.get(e.old)]++; s.delivery += e.delivery; s.master += e.master;
}
out(`-- wave 1: ${w1.length} assets in ${w1sets.size} sets --`);
out(['set', 'assets', 'allowlisted', 'group-rule extras', 'complete-set', 'delivery_MB', 'masters_MB(est)', 'flag'].join('\t'));
let W = { n: 0, d: 0, m: 0 };
for (const [id, s] of [...w1sets].sort()) {
  out([id, s.n, s.allow, s.group, s.set, fmt(s.delivery), fmt(s.master), s.group > EXTRA_GROUP_LIMIT ? `EXTRA>${EXTRA_GROUP_LIMIT}` : ''].join('\t'));
  W.n += s.n; W.d += s.delivery; W.m += s.master;
}
out(`wave 1 total: ${W.n} assets, delivery ${fmt(W.d)} MB, masters est ${fmt(W.m)} MB`);
out(`wave-1 allowlist names not found in images.json: ${notFound.length} ${notFound.join(', ')}`);
out(`allowlisted assets with group=null whose set has other assets (group rule yields nothing): ${allowInSingleGroupSets.length}`);
for (const a of allowInSingleGroupSets) out('  ' + a);
out('');
out('-- wave 1 list --');
for (const e of w1) out(`${e.set}/${e.id ?? e.idCand}\t(old ${e.old})\t${e.group ?? '-'}\t${selected.get(e.old)}${allow.has(e.old) ? ':' + allow.get(e.old) : ''}`);
out('');

// cross-check polyhymnia selection file
try {
  const sel = JSON.parse(fs.readFileSync(path.join(POLY, 'scripts/ornament-selection.json'), 'utf8'));
  const designsInSel = new Set(sel.map((s) => s.design));
  const allowSet = new Set(ALLOW_POLY);
  const homeNames = new Set(homeCat.map((d) => d.name));
  const inSelNotAllow = [...designsInSel].filter((d) => !allowSet.has(d) && !homeNames.has(d)).sort();
  const inAllowNotSel = ALLOW_POLY.filter((d) => !designsInSel.has(d)).sort();
  out(`-- ornament-selection.json cross-check: ${sel.length} entries (Consumers.md says 32) --`);
  out(`in selection file but not in Consumers allowlist/homepage-art: ${inSelNotAllow.join(', ') || '(none)'}`);
  out(`in Consumers allowlist but not in selection file: ${inAllowNotSel.join(', ') || '(none)'}`);
  out(`homepage-art designs in selection file: ${[...homeNames].filter((n) => designsInSel.has(n)).length} of ${homeNames.size}`);
} catch (err) { out('selection cross-check skipped: ' + err.message); }

console.log(L.join('\n'));

// ---------- plan.yaml ----------
const q = (v) => (v === null || v === undefined ? 'null' : JSON.stringify(v));
const rows = [];
const dropNote = (x) => x;
for (const e of entries) {
  const base = e.id ? `${e.set}/${e.id}` : null;
  const notes = [...e.notes];
  let status = 'moved';
  if (e.long) { status = 'renamed'; notes.push(`id candidate "${e.idCand}" is ${e.idCand.length} chars (> ${MAX_ID}); shorten by hand`); }
  if (e.idCand !== e.old && !e.long) notes.push(`prefix stripped from "${e.old}"`);
  if (e.svg === 'hand') notes.push('hand-made vector: the svg is the master (copied as master.svg); png kept for the raster ladder');
  if (e.svg === 'traced') notes.push('png is the master; traced svg dropped (see #svg entry)');
  if (e.missing) notes.push('MASTER MISSING on disk');
  if (e.wave === 1) notes.push(`wave 1 (${selected.get(e.old)}${allow.has(e.old) ? ', ' + allow.get(e.old) : ''})`);
  rows.push({ old: e.old, set: e.set, id: base, group: e.group, wave: e.wave, status, notes: notes.join('; ') });
  for (const c of e.comps) {
    if (c.keep) rows.push({ old: c.old, set: e.set, id: base ? `${base}#${c.key}` : null, group: e.group, wave: e.wave, status: 'merged', notes: 'true master component, folded into the asset as component ' + c.key });
    else rows.push({ old: c.old, set: e.set, id: null, group: e.group, wave: e.wave, status: 'dropped', notes: c.why });
  }
  if (e.svg === 'traced') rows.push({ old: `${e.old}#svg`, set: e.set, id: null, group: e.group, wave: e.wave, status: 'dropped', notes: 'auto-traced SVG of the raster master; no delivery value' });
}
for (const t of stillTriage.sort((a, b) => a.x.name.localeCompare(b.x.name)))
  rows.push({ old: t.x.name, set: null, id: null, group: null, wave: 2, status: 'moved', notes: `TRIAGE: ${t.reason}${t.suggest ? '; suggested set: ' + t.suggest : ''}` });
rows.sort((a, b) => a.old.localeCompare(b.old));
const y = ['# Generated by spikes/importer-dry-run/plan.mjs. Hand-adjustable; TEMPORARY (see README.md).',
  `# ${rows.length} rows; triage rows have set: null and must be placed by hand.`, 'entries:'];
for (const r of rows) {
  y.push(`  - old: ${q(r.old)}`, `    set: ${q(r.set)}`, `    id: ${q(r.id)}`, `    group: ${q(r.group)}`, `    wave: ${r.wave}`, `    status: ${r.status}`, `    notes: ${q(r.notes)}`);
}
if (WRITE) {
  const dir = path.join(REPO, 'migration');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.yaml'), y.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'README.md'),
    '# migration/\n\nThis directory is temporary. It holds the set plan (`plan.yaml`) for importing the old `medieval-ornaments` catalog and, later, the old-to-new lookup map. Nothing imports it: no package exports it, and the index, catalog and resolver do not know it exists. It is deleted at a dated milestone once polyhymnia and elder-scrolls have moved to the new ids.\n\n`plan.yaml` is generated by `spikes/importer-dry-run/plan.mjs` and is meant to be hand-adjusted (triage rows, ids over 48 characters).\n');
  console.error(`wrote ${rows.length} rows to migration/plan.yaml`);
}

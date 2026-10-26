// Volume packages: sticky file-to-package assignment and the per-package size guard.
export const MB = 1_000_000;
export const WARN_BYTES = 100 * MB;
export const FAIL_BYTES = 120 * MB;
export const FIRST = 'part1'; // the first package; the manifest omits the `package` field for it

const partNumber = (name) => Number(name.slice(4));

// existing: a previous manifest or null. files: [{ path, bytes }] (delivery files, or masters files).
// Returns Map<path, 'part1' | 'part2' | ...>. An existing file keeps its package for life (even when it grew);
// a new file goes to the newest part when it fits under `limit`, otherwise a new part is opened. Files are
// visited in path order, so the result does not depend on the input order. Files of a removed asset are
// simply absent from the new list and free no room (parts are never rebalanced).
export function assignPackages(existing, files, { limit = WARN_BYTES, kind = 'delivery' } = {}) {
  const previous = new Map();
  for (const f of existingFiles(existing, kind)) previous.set(f.path, f.package ?? FIRST);
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const result = new Map();
  const used = new Map([[FIRST, 0]]);
  let newest = Math.max(1, ...[...previous.values()].map(partNumber));
  for (const f of sorted) {
    const kept = previous.get(f.path);
    if (!kept) continue;
    result.set(f.path, kept);
    used.set(kept, (used.get(kept) ?? 0) + f.bytes);
  }
  for (const f of sorted) {
    if (result.has(f.path)) continue;
    let name = `part${newest}`;
    const room = (used.get(name) ?? 0) + f.bytes <= limit;
    if (!room && (used.get(name) ?? 0) > 0) { newest += 1; name = `part${newest}`; }
    result.set(f.path, name);
    used.set(name, (used.get(name) ?? 0) + f.bytes);
  }
  return result;
}

// Every file entry a manifest lists for one tree: delivery (ladders, svg, rotated, atlas) or masters.
export function existingFiles(manifest, kind) {
  if (!manifest) return [];
  const out = [];
  const ladder = (l) => { if (!l) return; for (const f of [...(l.avif ?? []), ...(l.webp ?? []), ...(l.svg ? [l.svg] : [])]) out.push(f); };
  for (const a of Object.values(manifest.assets ?? {})) {
    if (kind === 'masters') {
      if (a.master) out.push(a.master);
      for (const c of Object.values(a.components ?? {})) if (c.master) out.push(c.master);
      continue;
    }
    ladder(a.sources);
    ladder(a.render?.tile?.rotated);
    ladder(a.render?.frame?.atlas);
    for (const c of Object.values(a.components ?? {})) ladder(c.sources);
  }
  return out;
}

// files: [{ path, bytes, asset }], assignment: Map. Returns per-package totals and throws over the fail limit.
export function checkPackageSizes(files, assignment, { label, warn = WARN_BYTES, fail = FAIL_BYTES } = {}) {
  const totals = new Map();
  for (const f of files) {
    const name = assignment.get(f.path) ?? FIRST;
    const t = totals.get(name) ?? { bytes: 0, byAsset: new Map() };
    t.bytes += f.bytes;
    t.byAsset.set(f.asset, (t.byAsset.get(f.asset) ?? 0) + f.bytes);
    totals.set(name, t);
  }
  const warnings = [];
  for (const [name, t] of totals) {
    const largest = [...t.byAsset].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, b]) => `${a} (${(b / MB).toFixed(1)} MB)`).join(', ');
    const where = `${label} ${name}: ${(t.bytes / MB).toFixed(1)} MB`;
    if (t.bytes > fail) throw new Error(`${where} exceeds the ${fail / MB} MB limit; largest assets: ${largest}`);
    if (t.bytes > warn) warnings.push(`${where} exceeds ${warn / MB} MB; largest assets: ${largest}`);
  }
  return { totals: new Map([...totals].map(([k, v]) => [k, v.bytes])), warnings };
}

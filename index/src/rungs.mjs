// Rung selection. Pure functions over ladders: arrays of { w, h, path, ... }.

const asc = (key) => (a, b) => a[key] - b[key];

/**
 * From the smallest rung >= width up to the smallest rung >= width * maxDpr, never upscaling
 * (a missing rung falls back to the top one). `src` is the smallest rung >= width * srcDpr.
 * Without a width the whole ladder is returned and `src` is the largest rung up to 1024.
 */
export function selectRungs(ladder, width, { maxDpr = 3, srcDpr = 2 } = {}) {
  const l = [...ladder].sort(asc('w'));
  const top = l[l.length - 1];
  if (!width) return { rungs: l, src: [...l].reverse().find((r) => r.w <= 1024) ?? l[0] };
  const lo = l.find((r) => r.w >= width) ?? top;
  const hi = l.find((r) => r.w >= width * maxDpr) ?? top;
  const rungs = l.filter((r) => r.w >= lo.w && r.w <= hi.w);
  const src = l.find((r) => r.w >= width * Math.min(srcDpr, maxDpr)) ?? top;
  return { rungs, src };
}

/** Smallest file whose `key` dimension ('w' or 'h') covers `need` (half a pixel of tolerance), else the largest. */
export function pickByDimension(files, key, need) {
  const l = [...files].sort(asc(key));
  return l.find((f) => f[key] >= need - 0.5) ?? l[l.length - 1];
}

/** Normalise a dpr option: a number n means 1..n, an array is used as given. */
export function dprList(d, fallback) {
  const v = d ?? fallback;
  if (Array.isArray(v)) return [...new Set(v)].sort((a, b) => a - b);
  return Array.from({ length: Math.max(1, Math.ceil(v)) }, (_, i) => i + 1);
}

export const maxOf = (d, fallback) => Math.max(...dprList(d, fallback));

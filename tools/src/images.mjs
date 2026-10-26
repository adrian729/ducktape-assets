// Raster primitives: the ladder, the encoders with their pinned settings, and the measurements.
// Everything that decides output bytes lives in ENCODING so it can be hashed into inputsHash.
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

// sharp runs every operation on libuv's thread pool (default 4 threads). Several assets are built at once with one
// libvips thread each, so the pool must be at least as large as the asset pool; this only works if set before the
// pool is first used, which is why it sits at import time.
process.env.UV_THREADPOOL_SIZE ??= String(Math.max(4, availableParallelism()));

// Determinism: libaom output changes with its thread count (Encoding benchmark), so one thread per
// encode; parallelism comes from building several assets at once.
sharp.concurrency(1);

export const ENCODING = {
  pipeline: 1, // bump when composition or measurement code changes in a way the settings below do not show
  ladder: [64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048],
  webp: { quality: 82, alphaQuality: 100, effort: 4, effortLarge: 4, largeMinWidth: 512 }, // effort 4 everywhere: 3-4 % more bytes than 6 for 15-46x less time; small rungs are too few bytes to matter
  avif: { quality: 60, effort: 4, effortSmall: 6, smallMaxWidth: 256, keepRatio: 0.85 },
  master: { maxLongSide: 2048, lossless: true, exact: true, effort: 6 },
  vectorRasterWidth: 2048,
  paletteColors: 5,
  paletteThumb: 64,
  thumbhashThumb: 100,
  atlas: 'corner+tile, 3x3, tile fitted to whole repeats per edge, mirrored corners',
};

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Rungs not exceeding the master width, plus the native width when it is under the top rung. Never upscale.
export function ladderWidths(width, ladder = ENCODING.ladder) {
  const top = ladder[ladder.length - 1];
  const widths = ladder.filter((w) => w <= width);
  if (width < top && !widths.includes(width)) widths.push(width);
  return widths;
}

// Decoded once as straight 8-bit sRGB RGBA, then every rung resizes from the raw pixels.
export async function decodeRaw(input, options) {
  const { data, info } = await sharp(input, options).ensureAlpha().toColourspace('srgb').raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const fromRaw = (raw) => sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } });

// Lanczos3 (sharp default) with premultiplied alpha; width only, aspect preserved; metadata is stripped by default.
export async function resizeRaw(raw, width) {
  if (width === raw.width) return raw;
  const { data, info } = await fromRaw(raw).resize({ width, kernel: 'lanczos3' }).raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function encode(raw, format, width) {
  const img = fromRaw(raw);
  const buf = format === 'avif'
    ? await img.avif({ quality: ENCODING.avif.quality, effort: width <= ENCODING.avif.smallMaxWidth ? ENCODING.avif.effortSmall : ENCODING.avif.effort }).toBuffer()
    : await img.webp({ quality: ENCODING.webp.quality, alphaQuality: ENCODING.webp.alphaQuality, effort: width >= ENCODING.webp.largeMinWidth ? ENCODING.webp.effortLarge : ENCODING.webp.effort }).toBuffer();
  return buf;
}

export async function encodeMaster(raw) {
  const long = Math.max(raw.width, raw.height);
  let out = raw;
  if (long > ENCODING.master.maxLongSide) {
    const k = ENCODING.master.maxLongSide / long;
    out = await resizeRaw(raw, Math.max(1, Math.round(raw.width * k)));
  }
  const { lossless, exact, effort } = ENCODING.master;
  const buf = await fromRaw(out).webp({ lossless, exact, effort }).toBuffer();
  return { buf, width: out.width, height: out.height };
}

export async function transparentFlag(raw) {
  for (let i = 3; i < raw.data.length; i += 4) if (raw.data[i] < 255) return true;
  return false;
}

async function thumbnail(raw, size) {
  const { data, info } = await fromRaw(raw).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function thumbhashOf(raw) {
  const t = await thumbnail(raw, ENCODING.thumbhashThumb);
  return Buffer.from(rgbaToThumbHash(t.width, t.height, t.data)).toString('base64');
}

// Median cut on a 64 px thumbnail: split the box with the widest channel range at its median until
// there are five boxes; each colour is its box's mean, ordered by pixel count. Transparent pixels are ignored.
export async function paletteOf(raw, count = ENCODING.paletteColors) {
  const t = await thumbnail(raw, ENCODING.paletteThumb);
  let px = [];
  for (let i = 0; i < t.data.length; i += 4) if (t.data[i + 3] >= 128) px.push([t.data[i], t.data[i + 1], t.data[i + 2]]);
  if (px.length === 0) for (let i = 0; i < t.data.length; i += 4) px.push([t.data[i], t.data[i + 1], t.data[i + 2]]);
  const range = (box) => {
    let best = { channel: 0, span: -1 };
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0;
      for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
      if (hi - lo > best.span) best = { channel: c, span: hi - lo };
    }
    return best;
  };
  const boxes = [px];
  while (boxes.length < count) {
    let pick = -1, pickSpan = 0;
    boxes.forEach((b, i) => { const r = range(b); if (b.length > 1 && r.span > pickSpan) { pick = i; pickSpan = r.span; } });
    if (pick < 0) break;
    const box = boxes[pick];
    const { channel } = range(box);
    box.sort((a, b) => a[channel] - b[channel] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const mid = box.length >> 1;
    boxes.splice(pick, 1, box.slice(0, mid), box.slice(mid));
  }
  const hex = (n) => n.toString(16).padStart(2, '0');
  return boxes
    .sort((a, b) => b.length - a.length)
    .map((b) => '#' + [0, 1, 2].map((c) => hex(Math.round(b.reduce((s, p) => s + p[c], 0) / b.length))).join(''))
    .filter((c, i, all) => all.indexOf(c) === i);
}

export { fromRaw };

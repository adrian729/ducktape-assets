// Geometry derivatives built from masters: the 90 degree rotated tile and the nine-slice frame atlas.
import sharp from 'sharp';
import { fromRaw, resizeRaw } from './images.mjs';

const toRaw = async (img) => {
  const { data, info } = await img.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

// One operation per call, through raw pixels, so the order of rotate/flip/flop is never ambiguous.
export const rotate = (raw, angle) => toRaw(fromRaw(raw).rotate(angle));
export const flip = (raw) => toRaw(fromRaw(raw).flip());
export const flop = (raw) => toRaw(fromRaw(raw).flop());
export const transpose = async (raw) => flop(await rotate(raw, 90));

const fill = (raw, width, height) => toRaw(fromRaw(raw).resize({ width, height, fit: 'fill', kernel: 'lanczos3' }));

// A strip `length` x `thickness` made of whole repeats of the tile: the tile is scaled to the thickness,
// the repeat count is the nearest whole number to length / scaled length (at least 1), and each repeat is
// stretched by a few percent at most to land exactly on `length`, so CSS can repeat or round the cell seamlessly.
async function edgeStrip(tile, length, thickness) {
  const scaledLength = Math.max(1, Math.round((tile.width * thickness) / tile.height));
  const n = Math.max(1, Math.round(length / scaledLength));
  const pieces = [];
  for (let i = 0; i < n; i++) {
    const left = Math.round((length * i) / n);
    const w = Math.round((length * (i + 1)) / n) - left;
    pieces.push({ input: (await fill(tile, w, thickness)).data, raw: { width: w, height: thickness, channels: 4 }, left, top: 0 });
  }
  return toRaw(sharp({ create: { width: length, height: thickness, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(pieces));
}

// Frame atlas composition rule (nine-slice for CSS border-image, slice = `slice` percent of each side).
//   - The tile is made horizontal (an axis "y" tile is rotated 90 degrees first).
//   - The corner is the top-left piece, cw x ch. The atlas is W x H with W = cw * 100 / slice and H = ch * 100 / slice,
//     so each corner cell is exactly `slice` percent of its side. The centre cell stays transparent.
//   - Top edge: edgeStrip() of the tile, (W - 2 cw) x ch. Left edge: the top-edge construction on (H - 2 ch) x cw,
//     transposed (mirrored across the main diagonal). Bottom edge = top flipped vertically; right edge = left flopped.
//   - Corners: top-left as authored, top-right flopped, bottom-left flipped, bottom-right flipped and flopped.
//   Everything is mirror-symmetric around the frame, matching how mitred corners are drawn.
// Composed at master resolution (scaled down only when the atlas would exceed 4096 px), then laddered like any master.
export async function composeAtlas(cornerRaw, tileRaw, { axis, slice }) {
  const maxSide = 4096;
  let corner = cornerRaw;
  let tile = axis === 'y' ? await rotate(tileRaw, 90) : tileRaw;
  const probeW = Math.round((corner.width * 100) / slice);
  const probeH = Math.round((corner.height * 100) / slice);
  const k = Math.min(1, maxSide / Math.max(probeW, probeH));
  if (k < 1) {
    corner = await fill(corner, Math.max(1, Math.round(corner.width * k)), Math.max(1, Math.round(corner.height * k)));
    tile = await fill(tile, Math.max(1, Math.round(tile.width * k)), Math.max(1, Math.round(tile.height * k)));
  }
  const cw = corner.width, ch = corner.height;
  const W = Math.round((cw * 100) / slice), H = Math.round((ch * 100) / slice);
  const midW = W - 2 * cw, midH = H - 2 * ch;
  const layers = [];
  const put = (raw, left, top) => layers.push({ input: raw.data, raw: { width: raw.width, height: raw.height, channels: 4 }, left, top });
  put(corner, 0, 0);
  put(await flop(corner), W - cw, 0);
  const bottomLeft = await flip(corner);
  put(bottomLeft, 0, H - ch);
  put(await flop(bottomLeft), W - cw, H - ch);
  if (midW > 0) {
    const top = await edgeStrip(tile, midW, ch);
    put(top, cw, 0);
    put(await flip(top), cw, H - ch);
  }
  if (midH > 0) {
    const left = await transpose(await edgeStrip(tile, midH, cw));
    put(left, 0, ch);
    put(await flop(left), W - cw, ch);
  }
  return toRaw(sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers));
}

export { resizeRaw };

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResolver } from '../src/resolver.mjs';
import { index, loadManifest } from './fixture.mjs';

const R = (o = {}) => createResolver({ index, loadManifest, ...o });
const W = 'https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-walters-w102@1.0.0/';
const P2 = 'https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-walters-w102-part2@1.0.0/';
const ID = 'walters-w102/rabbit-church-bells';

// Silent failure prevented: a blurry or oversized image with no error.
test('image(): rung selection at width 320 for dpr 2 and 3, src, part2 URLs', async () => {
  const a = R();
  const two = await a.image(ID, { width: 320, dpr: 2 });
  // smallest rung >= 320 is 384; smallest rung >= 640 is 768 (lives in part2)
  assert.equal(two.sources[0].type, 'image/avif');
  assert.equal(two.sources[0].srcset, `${W}avif/rabbit-church-bells-384.avif 384w, ${P2}avif/rabbit-church-bells-768.avif 768w`);
  assert.equal(two.srcset, `${W}webp/rabbit-church-bells-384.webp 384w, ${P2}webp/rabbit-church-bells-768.webp 768w`);
  assert.equal(two.src, `${P2}webp/rabbit-church-bells-768.webp`);
  assert.equal(two.sizes, '320px');
  assert.deepEqual([two.width, two.height, two.alt, two.resolutionLimited], [1024, 1100, '', false]);
  assert.equal(two.license.artwork, 'CC0');
  assert.equal(two.attribution, 'Walters Art Museum, W.102');
  assert.equal(two.set, 'walters-w102');
  assert.match(two.package, /ducktape-assets-walters-w102$/);
  assert.ok(two.src.includes(`@${two.version}/`));

  const three = await a.image(ID, { width: 320, dpr: 3 });
  // 320 x 3 = 960: avif goes up to its 1024 rung, webp has none above 768 and stops there (never upscale)
  assert.equal(three.sources[0].srcset.split(', ').length, 3);
  assert.match(three.sources[0].srcset, /1024w$/);
  assert.equal(three.srcset.split(', ').length, 2);
  assert.match(three.srcset, /768w$/);
  assert.equal(three.src, two.src, 'src never goes beyond 2x');
  assert.match(three.placeholderDataUrl, /^data:image\/png;base64,iVBORw0KGgo/);
});

test('image(): resolutionLimited when the master is smaller than the request', async () => {
  const img = await R().image('floral-borders/floral-border', { width: 320 });
  assert.equal(img.resolutionLimited, true);
  assert.equal(img.srcset.split(', ').length, 1);
  assert.match(img.srcset, /floral-border-300\.webp 300w$/);
  assert.equal(img.src.endsWith('webp/floral-border-300.webp'), true);
});

test('picture() and preload() markup', async () => {
  const a = R();
  const img = await a.image(ID, { width: 320, dpr: 2, sizes: '(max-width: 600px) 90vw, 320px' });
  const html = a.picture(img, { loading: 'lazy', decoding: 'async' });
  assert.match(html, /^<picture>\n  <source type="image\/avif" srcset="[^"]*384\.avif 384w[^"]*" sizes="\(max-width: 600px\) 90vw, 320px">\n  <img src="[^"]*-768\.webp" srcset="/);
  assert.match(html, /width="1024" height="1100" alt="" loading="lazy" decoding="async" style="background: url\(data:image\/png;base64,/);
  assert.match(html, /<\/picture>$/);
  const link = a.preload(img);
  assert.match(link, /^<link rel="preload" as="image" type="image\/avif" href="[^"]+" imagesrcset="[^"]*384\.avif 384w[^"]*" imagesizes="\(max-width: 600px\) 90vw, 320px" fetchpriority="high">$/);
});

test('tile(): picks the rotated ladder when the axis differs, and the svg when present', async () => {
  const a = R();
  const x = await a.tile('numbered-plate/stepped-ribbon', { thickness: 24, dpr: [1, 2] });
  assert.match(x, /image-set\(url\("[^"]*avif\/stepped-ribbon-192\.avif"\) type\("image\/avif"\) 1x, url\("[^"]*avif\/stepped-ribbon-384\.avif"\) type\("image\/avif"\) 2x, url\("[^"]*webp\/stepped-ribbon-192\.webp"\)/);
  assert.match(x, /background-repeat: round no-repeat;/);
  assert.match(x, /background-size: 144px 24px;/);
  assert.doesNotMatch(x, /rotated/);

  const y = await a.tile('numbered-plate/stepped-ribbon', { axis: 'y', thickness: 24, dpr: [1, 2] });
  assert.match(y, /tiles\/stepped-ribbon-rotated-192\.avif"\) type\("image\/avif"\) 1x, url\("[^"]*rotated-384\.avif"\) type\("image\/avif"\) 2x/);
  assert.match(y, /background-repeat: no-repeat round;/);
  assert.match(y, /background-size: 24px 144px;/);

  const svg = await a.tile('floral-borders/floral-border', { thickness: 25 });
  assert.match(svg, /background-image: url\("[^"]*svg\/floral-border\.svg"\);/);
  assert.doesNotMatch(svg, /image-set/);
  assert.match(svg, /background-size: 150px 25px;/);
  const rot = await a.tile('floral-borders/floral-border', { axis: 'y', thickness: 25, dpr: [1] });
  assert.match(rot, /rotated-300\.webp/, 'no rotated svg, so the raster rotated ladder');
});

test('frame(): picks the atlas rung whose slice covers the thickness at each density', async () => {
  const fr = await R().frame('numbered-plate/stepped-ribbon', { thickness: 32, dpr: [1, 2] });
  assert.equal(fr.slice, 33.3);
  assert.match(fr.css, /border-width: 32px;/);
  assert.match(fr.css, /border-image: image-set\(url\("[^"]*frames\/stepped-ribbon-atlas-96\.avif"\) type\("image\/avif"\) 1x, url\("[^"]*atlas-192\.avif"\) type\("image\/avif"\) 2x, .*\) 33\.3% round;/);
  assert.equal(fr.atlasSrcset.split(', ').length, 2);
  assert.match(fr.atlasSrcset, /atlas-96\.avif 96w, .*atlas-192\.avif 192w$/);
});

test('url(): base override ignores the package; masters and parts resolve from the index', async () => {
  const a = R();
  await a.index();
  const file = { path: 'webp/x-768.webp', package: 'part2' };
  assert.equal(a.url(file, 'walters-w102'), `${P2}webp/x-768.webp`);
  assert.equal(a.url({ path: 'masters/x.webp', package: 'masters' }, 'walters-w102'), 'https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-walters-w102-masters@1.0.0/masters/x.webp');
  assert.equal(a.url({ path: 'a.avif' }, 'walters-w102'), `${W}a.avif`);
  assert.equal(R({ base: '/assets/' }).url(file, 'walters-w102'), '/assets/walters-w102/webp/x-768.webp');
  assert.equal(R({ base: 'https://example.com/a' }).url(file, 'walters-w102'), 'https://example.com/a/walters-w102/webp/x-768.webp');
  const img = await R({ base: '/assets/' }).image(ID, { width: 128 });
  assert.equal(img.src, '/assets/walters-w102/webp/rabbit-church-bells-256.webp');
  // pin overrides one set's version
  const pinned = R({ pin: { 'walters-w102': '1.0.1' } });
  const pinnedImg = await pinned.image(ID, { width: 128 });
  assert.match(pinnedImg.src, /ducktape-assets-walters-w102@1\.0\.1\/webp\/rabbit-church-bells-256\.webp$/);
  assert.equal(pinnedImg.version, '1.0.1');
});

test('local(): copied paths', async () => {
  const l = await R().local('numbered-plate/stepped-ribbon', { dir: 'src/assets/ducktape' });
  assert.equal(l.files.sources.webp[0].path, 'src/assets/ducktape/numbered-plate/webp/stepped-ribbon-96.webp');
  assert.equal(l.files.master, 'src/assets/ducktape/numbered-plate/masters/stepped-ribbon.webp');
});

// Build scripts record what they reference: every rung in the srcsets with its bytes and hash, and the file behind src.
test('image(): file and files carry path, bytes and sha256 of the chosen rungs', async () => {
  const a = R();
  const img = await a.image(ID, { width: 320, dpr: 2 });
  assert.equal(img.file.url, img.src);
  assert.equal(img.file.format, 'webp');
  assert.deepEqual([img.file.width, typeof img.file.bytes, img.file.sha256.length], [768, 'number', 64]);
  assert.deepEqual(img.files.map((f) => `${f.format}:${f.width}`), ['avif:384', 'avif:768', 'webp:384', 'webp:768']);
  assert.ok(img.files.every((f) => f.url && f.path && f.sha256));
});

// Ready-made frames record four percentages (a uniform pixel slice is a different share of width and height);
// the CSS value must carry all four and the coverage maths must use the width share.
test('frame(): a ready-made frame with per-side slice percentages', async () => {
  const idx = structuredClone(index);
  const a = R({ index: idx, loadManifest: async (setId, ctx) => {
    const m = structuredClone(await loadManifest(setId, ctx));
    if (setId === 'numbered-plate') {
      const s = m.assets['stepped-ribbon'];
      s.render.frame = { slice: { top: 14.6, right: 10.68, bottom: 14.6, left: 10.68 }, slicePx: 146, atlas: s.sources };
    }
    return m;
  } });
  const fr = await a.frame('numbered-plate/stepped-ribbon', { thickness: 20, dpr: [1] });
  assert.equal(fr.sliceCss, '14.6% 10.68% 14.6% 10.68%');
  assert.match(fr.css, /border-image: image-set\(.*\) 14\.6% 10\.68% 14\.6% 10\.68% round;/);
  // 20 css px must be covered by 10.68 % of the atlas width: 20 / 0.1068 = 187 px, so the 192 rung
  assert.match(fr.atlasSrcset, /stepped-ribbon-192\.\w+ 192w$/);
});

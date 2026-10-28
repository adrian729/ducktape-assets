# Design: delivery and consumption

Status: proposed, 2026-10-26, revised the same day after owner review. See [[Image pipeline]] for what exists on the CDN, [[Research/Hosting and CDN]] for the verified limits, and [[Decisions/ADR-007 No browser runtime, a build-time resolver instead]].

This is the note that matters most. Everything else exists so that an app, a static page or an agent can take one asset and use it in under a minute, without downloading anything it did not ask for.

## Three ways to use an asset

Every asset is addressable individually. No flow installs image bytes into `node_modules`, and no flow downloads a set to use one asset from it.

1. **Paste a URL.** Any HTML, CSS or Markdown references one file on jsDelivr, for example `https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-walters-w102@1.2.0/webp/rabbit-church-bells-512.webp`. Only that file is transferred. The catalog (below) lists the exact URL of every width and format, so nothing has to be guessed.
2. **Pick and copy.** A project keeps a small `ducktape.json` listing the asset ids it wants, with optional widths, formats and `masters: true`. `npx @ranx729/ducktape-assets copy` fetches exactly those files from the CDN into the project (default `src/assets/ducktape/`), verifies every SHA-256 against the manifest, and writes `ducktape.manifest.json` beside them with dimensions, thumbhash, licence and attribution per asset. Re-running is idempotent; bumping a pin re-fetches only what changed. This is what polyhymnia and elder-scrolls do by hand today, and it is the recommended flow for any app with its own build pipeline. Masters are fetched the same way, file by file from the masters package on jsDelivr, so an app that re-encodes its own images never installs a masters package either.
3. **Resolve in code.** `npm i @ranx729/ducktape-assets` installs the index package: metadata and a resolver, a few hundred KB, zero images. `assets.image(id, { width })` returns `src`, `srcset`, `sizes`, width, height, thumbhash and licence. Bytes come from the CDN at request time, or from flow 2 when `base` points at the copied directory.

```json
{
  "pin": "@ranx729/ducktape-assets@3.4.0",
  "out": "src/assets/ducktape",
  "assets": [
    "walters-w102/rabbit-church-bells",
    { "id": "numbered-plate/stepped-ribbon", "formats": ["avif", "webp"], "max": 1024 },
    { "id": "illuminated-acanthus/divider-center", "masters": true }
  ]
}
```

Installing a set's delivery package directly with npm works too (it is a normal package), but it pulls the whole set and is never the documented path.

## Finding an asset without visiting a set repo

The index package is the only place an agent or a person has to look. It is published to npm and committed verbatim to the main repo under `index/`, so it is readable on GitHub without installing anything.

- `README.md`: the three flows above, the URL scheme, and a table of every set with title, one-line summary, asset count, licence and a link to its repo and gallery page.
- `AGENTS.md`: the same for agents, in imperative form: how to search `catalog.json`, how to write `ducktape.json`, what the licence block requires, what never to do (no `@latest` URLs, no masters on a page).
- `catalog.json`: every asset of every set with id, title, description, type, categories, subjects, colours, width, height, render capabilities, thumbhash, licence and attribution, and the exact CDN URL of each width and format. One search finds an asset and its URL. Measured at 3.9 KB per asset, about 2.7 MB for the whole library.
- `sets/<set>.json`: a verbatim copy of each set's published manifest, so volume packages, hashes and component files are all known without the set repo.
- `index.json`: the pins, which the resolver and the copy command use.

The gallery renders the same files, so what an agent reads and what a person browses never diverge.

## URLs

`https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-<set>@<version>/<format>/<asset>-<w>.<ext>`

Exact-version URLs are immutable. jsDelivr caches them for a year at the edge and keeps them permanently in origin storage, serves them over HTTP/2 and HTTP/3 with `Cache-Control: public, max-age=31536000, immutable`, with CORS enabled and the correct `Content-Type` for AVIF and WebP. The resolver never emits a `@latest` or range URL. All assets of a page come from one origin, so one connection, one `preconnect`.

The host is only the `cdn` base in `index.json`; if jsDelivr ever refuses the project, [[CDN contingency]] switches it without touching set versions or consumers who copied their files.

When a set is too large for one package it is published as several volume packages (`…-<set>`, `…-<set>-part2`, see [[Repository layout]]). The manifest records the package of every file, and the catalog, the resolver and the copy command all emit the right URL, so a consumer never notices the split.

## The resolver (`@ranx729/ducktape-assets`)

Pure functions, no DOM, no dependencies, ES module, a few KB. Works in Node at build time and in the browser if someone wants it there.

```js
import { createResolver } from '@ranx729/ducktape-assets';

const assets = createResolver();                    // uses index.json pins; manifests loaded lazily (fetch in browser, fs in Node)
const img = await assets.image('walters-w102/rabbit-church-bells', { width: 320, sizes: '(max-width: 600px) 90vw, 320px' });
// {
//   src:     'https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-walters-w102@1.0.0/webp/rabbit-church-bells-768.webp',   // smallest rung >= width x 2
//   sources: [ { type: 'image/avif', srcset: '…-384.avif 384w, …-768.avif 768w, …-1024.avif 1024w' },
//              { type: 'image/webp', srcset: '…-384.webp 384w, …-768.webp 768w' } ],
//   sizes:   '(max-width: 600px) 90vw, 320px',
//   width: 1211, height: 1299,                      // intrinsic ratio for CLS
//   thumbhash: '3OcRJYB4d3h/iIeHeEh3eIhw+j2w', placeholderDataUrl: 'data:image/png;base64,…',
//   alt: '',                                        // decorative by default; description available as img.description
//   license: { artwork: 'CC0', attribution: 'Walters Art Museum, W.82' }
// }
assets.picture(img, { loading: 'lazy', decoding: 'async' })   // → HTML string for static sites
assets.frame('numbered-plate/stepped-ribbon', { thickness: 32, dpr: [1, 2, 3] })  // → { imageSet, slice, width, height } for CSS border-image
assets.tile('numbered-plate/stepped-ribbon', { axis: 'y', thickness: 24 })        // → rotated tile URLs and period
```

Options: `base` (self-hosted mirror or the `/gh/` fallback), `formats` (`['avif','webp']` default), `pin` (override a set version), `dpr` (which density candidates to include in `srcset` when using `x` descriptors instead of `w`).

Rung selection: for a requested CSS width `w` and the maximum DPR of interest (default 3 for `srcset` candidates, 2 for `src`), include every rung from the smallest rung ≥ `w` up to the smallest rung ≥ `w × dpr`, never upscale, and if the master is smaller than `w`, return the master's top rung and set `resolutionLimited: true` so a build can warn.

## Patterns for consumers

**Static HTML page** (the elder-scrolls case): run the resolver in a build script or paste the gallery's generated `<picture>`:

```html
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<picture>
  <source type="image/avif" srcset="…-128.avif 128w, …-256.avif 256w, …-384.avif 384w" sizes="128px">
  <img src="…-256.webp" srcset="…-128.webp 128w, …-384.webp 384w" sizes="128px" width="1211" height="1299" alt="" loading="lazy" decoding="async" style="background: url(data:image/png;base64,…) center / cover">
</picture>
```

Above-the-fold hero: `loading="eager" fetchpriority="high"` and a `<link rel="preload" as="image" imagesrcset imagesizes>`; the resolver emits that tag too.

**Vite or Next app that encodes its own images** (the polyhymnia case): list the assets in `ducktape.json` with `masters: true` (which copies only the masters), run the copy command, import the copied lossless masters through `vite-imagetools` or `next/image`, and read `ducktape.manifest.json` for type, dimensions, transparency and geometry. Verified on polyhymnia 2026-10-27: 31 masters, one `ducktape.json`, the resolver was not needed at all.

**App that is happy with our ladder**: list the assets with the widths it needs, copy, let the bundler hash and serve them from the app's own origin. Or skip the copy and use the CDN URLs.

**Self-hosting a whole selection**: the same copy command with `--out public/assets` writes the files; pass `base: '/assets/'` to the resolver (a trimmed `index.json` for this case is a later addition, not in the first copy command).

## Repeats, frames, dividers and vectors

Agreed with the owner on 2026-10-26. The pipeline does the geometry once; consumers only place files with CSS. No runtime JavaScript anywhere.

- **Repeating borders** (`render.tile`): the master is one repeat; the build makes its ladder plus a rotated copy for the other axis. Use `background-image: image-set(url(…-96.avif) type('image/avif') 1x, url(…-192.avif) type('image/avif') 2x); background-repeat: round;` along `axis`, with `background-size` derived from the wanted thickness and the tile's aspect. `tile()` returns that CSS; the copy command fetches the files. One repeat is also available as a plain `<picture>`.
- **Frames** (`render.frame`): either a strip plus a corner component, or (added 2026-10-27 for polyhymnia's floral frame) a ready-made complete frame image declared with `slice_px`, whose own ladder is the atlas and whose slice is recorded per side (top right bottom left) because a uniform pixel slice is a different share of width and height. For the composed kind the build composes a nine-slice atlas at every ladder width and records `slice`. Use `border-image: image-set(…atlas…) <slice> round;` with the consumer's `border-width`; the resolver picks the rung whose slice region covers the thickness at the wanted density (a 32 px frame at 1x with slice 33.3 % picks the 96 px atlas), never a master. `frame()` returns the rule; the gallery shows every frame live with the CSS to copy. First real composed frames on 2026-10-28 (`met-356741`): the foliate tile plus its corner composes cleanly with matching mitres. The composition mirrors the top edge onto the bottom and the sides, which is right for symmetric foliage and wrong for figurative friezes: the mask frame's bottom masks hang upside down and its side masks lie sideways. Known limit, recorded on that asset; a figurative frieze is better delivered as a divider and tile than as a frame until the composer gains a rotate mode, which nothing asks for yet.
- **Dividers and multi-part pieces**: complete images, not repeats. Start, centre and end are separate assets linked with `related: companion`, and the usage note says how to join them, typically a CSS rule in a matching colour. Placed as images.
- **Hand-made SVGs** (the floral border styles, the brand lockups): delivered as an optimised SVG plus a raster ladder made from it. For tiling and frames the SVG is the preferred file because `background-image` and `border-image` accept it and it is sharp at any density; the resolver prefers it when present. The raster ladder serves thumbnails and `<img srcset>`. Traced SVGs of paintings stay banned.

## Performance budget the design targets

For a typical content page showing one hero decoration, one frame and four small illustrations:

| Item | Old library (measured) | Target |
| --- | --- | --- |
| Image bytes, DPR 2 | 2.5 to 3.3 MB per polyhymnia page before it re-encoded; gallery 5 MB | under 400 KB |
| Requests to image CDN | one per element plus up to 29 package roots | one origin, one request per element |
| CLS | 0.44 before fixes | 0 (dimensions always known) |
| Placeholder | none | thumbhash painted before first byte |
| Largest single file | 48 MB SVG, 22 MB WebP master | under 1 MB (2048 px AVIF of the largest painting) |

These are checked by the gallery's Lighthouse run in its own CI, which is the only place performance is measured, on real pages with real assets.

## Why no React components, no browser runtime

Both consumers already own their image components and pipelines and want data, not elements (see [[Investigation/Consumers]]). A component would need to be right for Vite hashing, Next's image loader, SSR, Tailwind, and service-worker caching at once. The resolver gives every framework the same facts and lets the app render. If a React helper is ever wanted, it is a single file that calls the resolver and returns `<picture>`, published separately.

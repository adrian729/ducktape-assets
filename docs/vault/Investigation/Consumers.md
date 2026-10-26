# Investigation: how the assets are actually consumed

Two real consumers of `medieval-ornaments` exist locally. Both were inspected on 2026-10-26. Neither runs the library's JavaScript in the browser, and neither uses the React components. This is the single most important input to the new design: consumers want **bytes plus metadata**, resolved at **build time**.

## polyhymnia-ear-training

Vite 8, React 19, TypeScript, Tailwind v4, TanStack Router SPA on GitHub Pages with a service worker. Images go through `vite-imagetools` and `sharp` at build time.

- It does **not** depend on `@ranx729/medieval-ornaments`. Only the resource packages are installed, all as `devDependencies`: `borders-004`, `decorations-001`, `decorations-009`, `decorations-010`, `illustrations-001`, `illustrations-002`, plus a local `link:packages/homepage-art` for art that had not yet been upstreamed.
- A hand-curated `scripts/ornament-selection.json` (30 entries) declares `group`, local `name`, `package`, `design`, `role`, the widths it wants, `format` and `quality`. A Vite plugin reads each package's `catalog.json`, finds the lossless WebP master, and generates typed modules with `vite-imagetools` imports. The app encodes its own AVIF (quality 60 to 82) and lossy WebP at exactly the widths it renders, at 1x, 2x and 3x.
- Catalog fields it reads: `name`, `webp`, `width`, `height`, `has_transparency`, `uses`, `border_image_slice_percent`, `components.border_image`, `components.rotated_tile`, `repeat_axis`, `title_flourishes`. Everything else the package ships is ignored: PNGs, the 128/256/512/768 variants, traced SVGs, `ornaments.css`, runtime JS.
- Its own components render the art: `OrnamentImage` wraps a `ResponsiveImage` with `srcset`, `sizes`, intrinsic `width`/`height` and eager/lazy placement. `BorderFrame` uses CSS `border-image` with `image-set()` at 1x/2x/3x for two thicknesses. `Divider` uses a repeating background.
- Why no React components from the library: no written rationale exists anywhere (searched `AGENTS.md`, docs, full git history). The root package was never a dependency. Adjacent rules explain it well enough: assets are "declared and generated, never hand-imported", colour art must go through `ResponsiveImage` (enforced by a test), and build-time sizing cut image bytes per page from 2.5 to 3.3 MB down to 0.6 to 1.1 MB. The library's components bring their own element API, injected CSS, fixed variant sizes and CDN fetches, none of which fit a Vite-hashed, service-worker-cached, Tailwind-styled app. Inference, but a confident one.
- Pain points recorded in commits and config: exact version pins that keep moving between numbered packages (`borders-001` to `borders-004` for the same art, "both masters are byte-identical"), tarballs that 404 on the registry for minutes after publishing (worked around with pnpm `minimumReleaseAgeExclude`), art that lives locally because upstreaming is slow, packages installed but unused, and local renames because upstream names are long or inconsistent (`-centre` vs `-center`, `walters-horse-flute-drum` vs `horse-pipe-and-tabor`).

## elder-scrolls

A parchment/scroll CSS library whose demo page shows four illustrations. It pins `@ranx729/medieval-ornaments@0.11.0` as a dev dependency only.

- A refresh script (`scripts/resolve-demo-illustrations.mjs`) runs at build time. It imports each design's resolver, asks for 1x and 2x WebP variants at the displayed width, downloads only each resource package's `resource-manifest.json`, verifies the manifest hash against the runtime's pin, and writes `demo-assets/illustrations/sources.json` with version-pinned jsDelivr URLs, dimensions, byte counts and SHA-256 per variant.
- The built HTML is plain `<img>` with `src`/`srcset`/`sizes`, explicit dimensions, one eager and three lazy. No runtime, catalog or archive ships in the page. An offline build embeds the four 256px files after verifying their hashes.
- Its README states the licensing problem plainly: "The source collection has no established blanket artwork license; Elder Scrolls' MIT license does not grant a separate license to these illustrations."

## What both consumers want

| Need | polyhymnia | elder-scrolls |
| --- | --- | --- |
| Lossless master at native resolution | yes, re-encodes itself | no, wants pre-made variants |
| Pre-made size variants on a CDN | no | yes (128/256 WebP) |
| Intrinsic width/height for CLS | yes | yes |
| Transparency flag | yes | implicitly |
| Frame slice / tile / repeat axis metadata | yes | no |
| Stable name and stable file path inside a package | yes | yes |
| Version-pinned, immutable URLs | n/a | yes |
| Integrity hashes per file | no | yes |
| Runtime JS in the browser | no | no |
| React components | no | no |
| Descriptions, titles, search | no | descriptions only as records |

Conclusions for the new design:

1. The deliverable is **data**: masters, generated variants, and a precise manifest. A tiny, optional, framework-free resolver that turns a name plus a wanted size into URLs is useful. Components are not.
2. Consumers select by **name**, and pin by **version**. Names must be stable forever, and a name must never move between packages without a recorded migration.
3. Both consumers built the same machinery twice (manifest reading, variant selection, hash verification). That machinery belongs in the library's build-time helper, not in the browser.
4. The 404-after-publish and moving-package pains come from publishing many packages under exact pins. Grouping by set and publishing immutable content-addressed versions removes most of it.

## Migration inputs

Every name below must appear in the migration map. The polyhymnia local names stay stable, so migrating that app means editing only `package` and `design` per entry in `scripts/ornament-selection.json`.

polyhymnia (package suffix after `@ranx729/medieval-ornaments-assets-`, design name, note):

- decorations-001: `illuminated-acanthus-headpiece`; `illuminated-acanthus-corner`, `illuminated-acanthus-corner-top-right`, `illuminated-acanthus-corner-bottom-left`, `illuminated-acanthus-corner-bottom-right` (selected, unused)
- decorations-010: `illuminated-acanthus-divider-start`, `illuminated-acanthus-divider-center`, `illuminated-acanthus-divider-end`, `illuminated-acanthus-section-fleuron`, `illuminated-acanthus-horizontal-flourish`, `illuminated-acanthus-rosette`
- illustrations-001: `anafiles`, `bunny-trumpet`, `donkey-organist`, `animal-musicians-ensemble`, `musicians-and-dancers`, `cat-reading-book`, `animal-choir-landscape`
- illustrations-002: `polyhymnia`, `walters-horse-flute-drum`
- `homepage-art` (18 designs in `packages/homepage-art/catalog.json`; the selection file now names them under a `…-assets-polyhymnia` package, so the local package was renamed or partly upstreamed; checked again 2026-10-26): used are `illuminated-acanthus-module-sprig`, `illuminated-acanthus-saltarello-upper-simple`, `illuminated-acanthus-saltarello-lower-simple`, `illuminated-acanthus-ornate-inner-frame`, `illuminated-acanthus-inward-growth-{top-left,top-right,bottom-left,bottom-right}`, `illuminated-acanthus-title-ivy`, `illuminated-acanthus-floral-frame` (frame role); unused variants are `frame-growth-{four corners}`, `saltarello-{upper,lower}`, `saltarello-{upper,lower}-finished`. All 18 go into `illuminated-acanthus` in wave 1, per the owner.
- borders-004 and decorations-009 are installed but no longer selected.

elder-scrolls (illustrations-001): `rabbit-reading-book`, `flying-pig`, `snail`, `weird-dog`.

## medieval-cutouts

The origin of 41 illustrations, later absorbed into `medieval-ornaments` with names preserved. Asset-only repo with PNG and lossless WebP, 128/256/512/768 variants, an `images.json` catalog, served from `raw.githubusercontent.com`. Nothing consumes it directly any more. It matters only as provenance for the migration map.

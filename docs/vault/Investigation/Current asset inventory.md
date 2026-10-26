# Investigation: what exists today, in bytes

Measured 2026-10-26 on the local `medieval-ornaments` checkout and its 29 resource repos under `tmp/resource-checkouts/`. These numbers size the new system.

## Catalog

- `images.json` has **726 entries** (the README says 161 "designs" and 541 "reviewed assets" in different places; the three numbers count different things and nothing reconciles them). Only 49 entries carry `author: adrian729`; the other 677 have no author field at all.
- 29 resource repos on GitHub, all public, named `medieval-ornaments-assets-{borders,decorations,illustrations}-NNN`: 6 borders, 10 decorations, 13 illustrations. On-disk git sizes range from 15 MB to 220 MB per repo.
- The runtime package `@ranx729/medieval-ornaments` has 18 published versions (0.1.0 to 0.12.0).

## Bytes by role across all 29 resource repos

| Role | Files | Size |
| --- | --- | --- |
| `sources/` (scans, tiles, traces, prompts) | 1001 | 1451 MB |
| `png/` masters (native resolution, lossless) | 1199 | 1043 MB |
| `webp/` masters (native resolution, lossless) | 1199 | 732 MB |
| `svg/` (auto-traced from rasters) | 255 | 703 MB |
| `png/{128,256,512,768}` variants | 2920 | 386 MB |
| `webp/{128,256,512,768}` variants | 2920 | 265 MB |
| manifests, licences, readmes | 232 | 7 MB |
| **Total** | 9726 | **4587 MB** |

Delivered (non-source) files: 8493 files, 3128 MB. Size distribution of delivered files:

| < 100 KB | 100 to 500 KB | 500 KB to 1 MB | 1 to 5 MB | 5 to 10 MB | 10 to 20 MB | > 20 MB |
| --- | --- | --- | --- | --- | --- | --- |
| 5030 | 2382 | 548 | 440 | 48 | 25 | 20 |

## What the big files are

Every file over 20 MB is either an auto-traced SVG (20 to 48 MB each; `armored-rhinoceros.svg` 47 MB, `elephant.svg` 44 MB, `horse.svg` 33 MB) or a native-resolution lossless master (`complete-circular-wind-diagram` 5422x5503 at 27 MB PNG / 22 MB WebP; `may-calendar-fixed-floral-frame` 3947x5928 at 28 MB). Masters go up to 7787 px on the long side.

The traced SVGs are vectorisations of painted rasters. They are larger than the rasters they trace, render slower, and polyhymnia ignores them. They have no delivery value. Hand-drawn vector sets (the 6 floral border styles) are a different matter and stay SVG.

## Encoding experiment

The eight largest masters were re-encoded with Pillow 12.3 (libwebp, libavif) at capped long sides. Lossless WebP at 2048 px is 1.2 to 4.1 MB; lossy WebP q82 is 0.3 to 1.5 MB; AVIF q60 is 0.2 to 0.9 MB. At 1024 px AVIF is 60 to 340 KB.

| Master | Native | PNG | WebP lossless @2048 | WebP q82 @2048 | AVIF q60 @2048 | AVIF q60 @1024 |
| --- | --- | --- | --- | --- | --- | --- |
| may-calendar-fixed-floral-frame | 3947x5928 | 29.3 MB | 2816 KB | 447 KB | 283 KB | 82 KB |
| complete-circular-wind-diagram | 5422x5503 | 27.3 MB | 4101 KB | 1459 KB | 803 KB | 336 KB |
| acanthus-vase-between-two-female-chimeras | 2626x5200 | 23.6 MB | 2926 KB | 832 KB | 433 KB | 155 KB |
| acanthus-scroll-with-copper-vase | 7787x2376 | 18.9 MB | 1255 KB | 344 KB | 193 KB | 61 KB |
| acanthus-panel-with-two-lovers | 4055x2739 | 18.8 MB | 4096 KB | 1542 KB | 898 KB | 320 KB |
| complete-apostle-city-scene | 3769x3137 | 17.1 MB | 3990 KB | 691 KB | 429 KB | 133 KB |
| donkey-organist | 1211x1299 | 2.5 MB | 1733 KB | 457 KB | 201 KB | 140 KB |
| donkey-rooster-lute-player | 1121x1403 | 1.3 MB | 969 KB | 272 KB | 123 KB | 82 KB |

Conclusions:

1. Nothing we would ever send to a browser needs to exceed a few MB. The 20 MB jsDelivr file limit and the 150 MB package limit are non-issues once delivery variants are capped and lossy, and traced SVGs are dropped.
2. AVIF is roughly 40 to 60 % smaller than lossy WebP on this painted, transparent art. It must be the primary format with WebP as fallback.
3. Native-resolution masters are archival. Nobody renders a 5500 px image. Masters belong in git (per set) or in release archives, not on the CDN. A capped lossless "web master" (2048 px) is enough for build-time consumers such as polyhymnia, whose largest requested width is 1536 px.
4. Today's 4.6 GB would shrink to well under 1 GB of delivery bytes with AVIF+WebP at a 2048 px cap, and the remainder is archival.

## Local tooling available

Node 26.7, npm 11.19, Python 3.15 with Pillow 12.3 (WebP and AVIF encoders present), `cwebp`, `gh` 2.98. Missing locally: `sharp` (install per project), `avifenc`, `oxipng`, `svgo`, ImageMagick, `git-lfs`. CI will use `sharp` (libvips) regardless of what is installed here.

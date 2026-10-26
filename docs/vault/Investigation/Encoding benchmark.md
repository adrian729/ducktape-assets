# Investigation: encoding benchmark (Phase 0)

Run 2026-10-26 with `spikes/encoding/bench.mjs` on real masters of the old library: 20 transparent borders, frames, corners and dividers, and the 10 widest painted illustrations (2651 to 5422 px). Versions: sharp 0.35.5, libvips 8.18.7, libaom 3.15.1, libwebp 1.6.0, Node 26.7.0, on an i7-1165G7 laptop (4 cores). Re-run: `cd spikes/encoding && npm i && node bench.mjs out/run1 results-run1.json && node analyze.mjs results-run1.json`. Raw results are the `results-*.json` files beside it.

Settings measured: lossy WebP quality 82 effort 6; AVIF quality 60, effort 6 at or below 256 px and 4 above; lossless WebP effort 6 capped at 2048; Lanczos3 from one RGBA decode of the master; ladder `64 … 2048` plus the native width under 2048.

## The AVIF rule, measured

Keep AVIF when its top-rung bytes are at most 85 % of WebP's.

| Group | AVIF wins | Ratio min / median / max | Ladder KB, WebP only | Ladder KB, AVIF only |
| --- | --- | --- | --- | --- |
| 20 borders, frames, corners, dividers | 16 of 20 | 0.30 / 0.52 / 1.03 | 10,401 | 5,756 |
| 10 painted illustrations | 10 of 10 | 0.53 / 0.64 / 0.77 | 12,656 | 6,670 |

- Frames, corners and dividers are the strongest AVIF wins (ratios 0.30 to 0.52). Painted scenes win by about a third.
- The four losers are all small or fine-detail repeat tiles (ratios 0.885, 0.936, 0.973, 1.032). "Borders lose" as a class is wrong; only noisy repeat tiles lose.
- Nothing sits in the band the threshold could flip except one tile at 0.885. The 15 % rule stays.

## Build time

| Encode | Mean seconds per file |
| --- | --- |
| AVIF, at or below 256 px, effort 6 | 0.45 |
| AVIF, above 256 px, effort 4 | 3.7 (512 px 1.3, 1024 px 3.4, 1536 px 6.5, 2048 px 13.4) |
| Lossy WebP, effort 6 | 4.2 (10.3 at 2048 px) |

Whole ladder per asset: borders mean 48 s, illustrations mean 92 s; the 5422 px wind diagram took 208 s, large frames 110 to 120 s. All 30 assets, 608 files, took 31 minutes on one thread. WebP effort 6 at the top rungs cost as much as AVIF effort 4, so it was tuned next.

## WebP effort 4 versus 6 (follow-up, same 30 assets, `webp-effort.mjs`)

| Rung | Bytes, effort 4 over effort 6 (mean) | Worst case | Seconds, effort 6 | Seconds, effort 4 |
| --- | --- | --- | --- | --- |
| 512 | 1.034 | 1.089 | 6.4 | 0.14 |
| 768 | 1.043 | 1.121 | 10.6 | 0.23 |
| 1024 | 1.043 | 1.123 | 10.2 | 0.36 |
| 1536 | 1.033 | 1.093 | 15.6 | 0.54 |
| 2048 | 1.036 | 1.079 | 13.3 | 0.88 |

Decision 2026-10-26: lossy WebP uses effort 4 at every rung (first 512 px and above; then everywhere, after the build's fixture showed effort 6 still taking 5.5 s per rung at 384 px while small rungs are too few bytes for 4 % to matter). The tooling test suite dropped from 26 s to 8 s with that change. Cost 3 to 4 % of WebP bytes; gain 15 to 46x per file, roughly two thirds of the whole-ladder build time. Results in `results-webp-effort.json`.

## Determinism

- Two full builds on one machine: 608 of 608 files byte-identical, across lossy WebP, AVIF and lossless WebP.
- sharp's default `concurrency()` on glibc Linux without jemalloc is 1 thread, which is what both runs used.
- With `concurrency(8)` versus 1: 30 of 89 AVIF files differ; every WebP file is identical. libaom's multi-threaded path changes bytes.
- Cross-machine, same day: the first set CI run on a GitHub `ubuntu-24.04` runner produced the same `contentHash` as the laptop for the W.102 set (60 files incl. AVIF), with the pinned sharp build from the lockfile.
- Consequence: the build pins `sharp.concurrency(1)` and records it in the manifest's `tooling` block; parallelism comes from building several assets at once, not from threads. The inputs-hash gate stays the publish decision; `contentHash` remains integrity only.

## Masters package

Capped lossless WebP at 2048 px for the 10 illustrations: 21.5 MB against 80.6 MB of PNG (27 %), matching the earlier Pillow figures. The masters-package estimate in [[Importer dry run]] holds.

## Correction to the dry run's constants

The dry run assumed 0.10 byte per pixel for lossy WebP; measured top rungs run from about 0.09 (clean corners) to 0.35 (the dense wind diagram), typically 0.15 to 0.18 for painted scenes. Delivery estimates in [[Importer dry run]] are therefore low by roughly 1.5 to 2x for illustration-heavy sets: read its 273 MB total as 400 to 550 MB, and its largest set (39 MB) as 60 to 80 MB. Still no set reaches the 100 MB warning; the volume-package mechanism stays unused by the migration. The plan script should take its constants from `results-run1.json` on the next run.

# ADR-005: AVIF first, lossy WebP fallback, lossless only for masters

Status: proposed, 2026-10-26.

## Context

The old library delivered lossless PNG and lossless WebP only, with a ladder that stopped at 768 px and then jumped to the native master. The rule "do not lower raster fidelity" was applied to delivery. Measured on the eight largest masters, AVIF at quality 60 is 40 to 60 % smaller than lossy WebP at quality 82 and more than 95 % smaller than the lossless master at the same 2048 px cap. Browser support for AVIF is universal among evergreen browsers in 2026; WebP covers the rest.

## Decision

- Delivery formats: AVIF (q60) and WebP (q82). No PNG, no lossless, no JPEG on the CDN.
- WebP is always built, at the full ladder, because it is the universal fallback and decodes 2.5 to 5x faster than AVIF (measured 2026-10-26).
- AVIF is built per asset only when it wins: the build encodes the top rung in both formats and keeps the AVIF ladder only if it is at least 15 % smaller than WebP there. Painted art wins by 40 to 60 %; noisy transparent borders sometimes lose, and then they get WebP only. The manifest says which formats exist, so the resolver never guesses.
- The AVIF ladder, when built, is the full ladder; WebP is the full ladder in both cases.
- Ladder: 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048, never above the master, plus a native-size rung for small masters.
- Lossless is reserved for masters: native in git, capped at 2048 px in the masters package.
- Hand-made SVG is delivered optimised and also rasterised to the ladder. Auto-tracing is banned.
- Quality values are set-level overridable in `set.yaml` (`encoding: { avif: 60, webp: 82 }`) for art that needs it; the default is not changed per asset.

## Alternatives

- **JPEG XL**: Chrome ships decoding from version 155 (announced 2026-10-06), Firefox still behind a preference. Revisit in 2027; adding a format is a patch republish.
- **AVIF everywhere regardless of measurement**: rejected after the benchmark showed it losing on a transparent noisy border and costing several times the decode time on pages with dozens of ornaments.
- **Keep lossless delivery for "fidelity"**: rejected; a lossless 768 px tile is not more faithful than an AVIF 2048 px one at the same display size, and it is ten times the bytes.
- **Only AVIF**: rejected; the fallback costs little in the package and protects old browsers and some image tooling.

## Consequences

- Consumers that need lossless use the masters package.
- The encoder versions are pinned for determinism; upgrades republish every set as a patch, which the plan table makes visible.

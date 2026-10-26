# ADR-007: no browser runtime and no React components; one pure resolver

Status: proposed, 2026-10-26. Evidence in [[Investigation/Consumers]].

## Context

The old library shipped a vanilla DOM controller, React components (2,178 generated files), a vendoring CLI and 4,422 generated modules. Neither real consumer used any of it: polyhymnia reads `catalog.json` at build time and encodes its own images with vite-imagetools; elder-scrolls runs a build script that writes pinned CDN URLs into static HTML. Both built the same manifest-reading and variant-picking logic themselves.

## Decision

- The index package exports a dependency-free resolver: name plus wanted size in, URLs, `srcset`, `sizes`, intrinsic dimensions, thumbhash, licence out. It also renders a `<picture>` string and a preload tag for static sites, and has a `local()` mode returning `node_modules` paths for bundler pipelines.
- No components, no CSS file, no CLI that writes into consumer projects. A `copy` command for self-hosting is tooling, not runtime.
- The gallery is the reference consumer and the integration check.

## Alternatives

- **Keep React components as an optional entry.** Rejected: they would be unused, and keeping them correct across Vite, Next, SSR and Tailwind is a product in itself. A one-file React helper can be published separately later if a real consumer asks.
- **Ship only data, no resolver.** Rejected: both consumers reimplemented the same logic; the resolver is where ladder-selection correctness is tested once.

## Consequences

- The index package is a few KB plus JSON loaded on demand.
- Performance in a consumer is the consumer's own `sizes`, `loading` and placement choices, informed by the resolver's output.

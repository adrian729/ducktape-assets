// Hand-written fixture: three sets, four assets. File bytes are derived from the path, so hashes are real.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const bytesOf = (path) => Buffer.from(`fixture bytes of ${path}`);
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** A manifest file entry. */
function f(path, w, h, pkg) {
  const b = bytesOf(path);
  return { w, h, path, bytes: b.length, sha256: sha(b), ...(pkg && { package: pkg }) };
}
const master = (path, w, h) => {
  const b = bytesOf(path);
  return { path, w, h, bytes: b.length, sha256: sha(b), package: 'masters' };
};
const TH = '3OcRJYB4d3h/iIeHeEh3eIhw+j2w';

const base = (set, extra = {}) => ({
  schema: 1,
  set,
  title: `Set ${set}`,
  summary: `Summary of ${set}.`,
  version: '1.0.0',
  package: `@ranx729/ducktape-assets-${set}`,
  mastersPackage: `@ranx729/ducktape-assets-${set}-masters`,
  cdn: `https://cdn.jsdelivr.net/npm/@ranx729/ducktape-assets-${set}@1.0.0/`,
  license: { artwork: 'CC0' },
  attribution: 'Walters Art Museum, W.102',
  inputsHash: `sha256:${'a'.repeat(64)}`,
  contentHash: `sha256:${'b'.repeat(64)}`,
  tooling: { tools: '0.0.0', sharp: '0.35.5', libvips: '8.18.7', concurrency: 1 },
  builtAt: '2026-11-02T10:12:00Z',
  ...extra,
});

const common = { categories: ['animals'], subjects: ['rabbit'], colors: ['grey'], facing: 'left', composition: 'single-figure', status: 'approved', transparent: true, palette: ['#2a4f8f'], thumbhash: TH };

export const manifests = {
  'walters-w102': base('walters-w102', {
    parts: ['@ranx729/ducktape-assets-walters-w102-part2'],
    assets: {
      'rabbit-church-bells': {
        ...common,
        title: 'Rabbit ringing church bells',
        description: 'A grey rabbit pulls two bell ropes, facing left, on a transparent background.',
        type: 'illustration',
        render: { image: {} },
        width: 1024,
        height: 1100,
        master: master('masters/rabbit-church-bells.webp', 1024, 1100),
        sources: {
          avif: [f('avif/rabbit-church-bells-128.avif', 128, 137), f('avif/rabbit-church-bells-256.avif', 256, 275), f('avif/rabbit-church-bells-384.avif', 384, 413), f('avif/rabbit-church-bells-768.avif', 768, 825, 'part2'), f('avif/rabbit-church-bells-1024.avif', 1024, 1100, 'part2')],
          webp: [f('webp/rabbit-church-bells-128.webp', 128, 137), f('webp/rabbit-church-bells-256.webp', 256, 275), f('webp/rabbit-church-bells-384.webp', 384, 413), f('webp/rabbit-church-bells-768.webp', 768, 825, 'part2')],
        },
        components: {},
      },
    },
  }),
  'numbered-plate': base('numbered-plate', {
    assets: {
      'stepped-ribbon': {
        ...common,
        title: 'Stepped ribbon border',
        description: 'A horizontal ribbon border that repeats along x.',
        type: 'border',
        facing: 'none',
        width: 384,
        height: 64,
        master: master('masters/stepped-ribbon.webp', 384, 64),
        render: {
          tile: {
            axis: 'x',
            period: 1,
            rotated: {
              avif: [f('tiles/stepped-ribbon-rotated-96.avif', 16, 96), f('tiles/stepped-ribbon-rotated-192.avif', 32, 192), f('tiles/stepped-ribbon-rotated-384.avif', 64, 384)],
              webp: [f('tiles/stepped-ribbon-rotated-96.webp', 16, 96), f('tiles/stepped-ribbon-rotated-192.webp', 32, 192), f('tiles/stepped-ribbon-rotated-384.webp', 64, 384)],
            },
          },
          frame: {
            corner: 'corner',
            slice: 33.3,
            atlas: {
              avif: [f('frames/stepped-ribbon-atlas-96.avif', 96, 96), f('frames/stepped-ribbon-atlas-192.avif', 192, 192), f('frames/stepped-ribbon-atlas-384.avif', 384, 384)],
              webp: [f('frames/stepped-ribbon-atlas-96.webp', 96, 96), f('frames/stepped-ribbon-atlas-192.webp', 192, 192), f('frames/stepped-ribbon-atlas-384.webp', 384, 384)],
            },
          },
        },
        sources: {
          avif: [f('avif/stepped-ribbon-96.avif', 96, 16), f('avif/stepped-ribbon-192.avif', 192, 32), f('avif/stepped-ribbon-384.avif', 384, 64)],
          webp: [f('webp/stepped-ribbon-96.webp', 96, 16), f('webp/stepped-ribbon-192.webp', 192, 32), f('webp/stepped-ribbon-384.webp', 384, 64)],
        },
        components: { corner: { description: 'Mitred corner.', master: master('masters/stepped-ribbon.corner.webp', 64, 64), sources: { webp: [f('webp/stepped-ribbon.corner-64.webp', 64, 64)] } } },
      },
    },
  }),
  'floral-borders': base('floral-borders', {
    assets: {
      'floral-border': {
        ...common,
        title: 'Floral border',
        description: 'A hand-made floral border, repeats along x.',
        type: 'border',
        facing: 'none',
        width: 300,
        height: 50,
        master: master('masters/floral-border.webp', 300, 50),
        render: {
          tile: { axis: 'x', period: 1, rotated: { webp: [f('tiles/floral-border-rotated-300.webp', 50, 300)] } },
        },
        sources: {
          svg: f('svg/floral-border.svg', 300, 50),
          webp: [f('webp/floral-border-128.webp', 128, 21), f('webp/floral-border-256.webp', 256, 43), f('webp/floral-border-300.webp', 300, 50)],
        },
        components: {},
      },
    },
  }),
};

export const index = {
  schema: 1,
  generatedAt: '2026-11-02T10:12:00Z',
  sets: Object.fromEntries(
    Object.entries(manifests).map(([id, m]) => [
      id,
      {
        version: m.version,
        package: m.package,
        parts: m.parts ?? [],
        mastersPackage: m.mastersPackage,
        mastersParts: [],
        cdn: m.cdn,
        mastersCdn: m.cdn.replace(m.package, m.mastersPackage),
        assets: Object.keys(m.assets).length,
        license: m.license,
        contentHash: m.contentHash,
        status: 'active',
      },
    ]),
  ),
};

export const loadManifest = async (setId) => manifests[setId];

/** Every file of a manifest, including masters and components. */
export function allFiles(manifest) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.path === 'string' && v.sha256) out.push(v);
      else Object.values(v).forEach(walk);
    }
  };
  walk(manifest.assets);
  return out;
}

/** Write `<root>/<set>/<path>` for every file, plus `<root>/index.json` and `<root>/sets/<set>.json`. */
export async function writeTree(root) {
  const put = async (rel, data) => {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), data);
  };
  for (const [setId, m] of Object.entries(manifests)) {
    for (const file of allFiles(m)) await put(`tree/${setId}/${file.path}`, bytesOf(file.path));
    await put(`idx/sets/${setId}.json`, JSON.stringify(m));
  }
  await put('idx/index.json', JSON.stringify(index));
  return { tree: join(root, 'tree'), index: join(root, 'idx', 'index.json') };
}

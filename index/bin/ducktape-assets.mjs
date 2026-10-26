#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { copy } from '../src/copy.mjs';

const [command, ...rest] = process.argv.slice(2);

const HELP = `usage: ducktape-assets copy [--config ducktape.json] [--out dir]

  --config   project config (default ducktape.json): { pin, out, assets: [ "set/id" | { id, formats?, max?, widths?, masters? } ] }
  --out      destination (default: config "out", else src/assets/ducktape)
  --index    local path or URL of index.json (default: the pin's package on jsDelivr)
  --base     directory or URL laid out as <base>/<set>/<path> to read files from instead of the CDN`;

if (!command || command === '--help' || command === '-h') {
  console.log(HELP);
} else if (command === 'copy') {
  try {
    const { values } = parseArgs({
      args: rest,
      options: { config: { type: 'string', default: 'ducktape.json' }, out: { type: 'string' }, index: { type: 'string' }, base: { type: 'string' } },
    });
    const config = JSON.parse(await readFile(values.config, 'utf8'));
    const out = values.out ?? config.out ?? 'src/assets/ducktape';
    const r = await copy({ config, out, index: values.index, base: values.base, log: (m) => console.log(m) });
    console.log(`${r.copied} copied, ${r.skipped} up to date, manifest at ${out}/ducktape.manifest.json`);
  } catch (e) {
    console.error(`ducktape-assets: ${e.message}`);
    process.exitCode = 1;
  }
} else {
  console.error(`unknown command "${command}"; run with --help`);
  process.exitCode = 2;
}

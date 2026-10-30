#!/usr/bin/env node
// Ducktape Assets tooling. Commands are added as the roadmap phases land; unknown commands say so.
import { parseArgs } from 'node:util';
import { validateSet, formatProblems } from './validate.mjs';

const [command, ...args] = process.argv.slice(2);

const commands = {
  async validate([dir = '.']) {
    const problems = await validateSet(dir);
    console.log(formatProblems(problems));
    process.exitCode = problems.length === 0 ? 0 : 1;
  },

  async build(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        preview: { type: 'boolean', default: false },
        version: { type: 'string', default: '0.0.0' },
        previous: { type: 'string' },
        jobs: { type: 'string' },
        'include-drafts': { type: 'boolean', default: false },
      },
    });
    if (!values.out) throw new Error('build needs --out <dir>');
    const { buildSet } = await import('./build.mjs');
    const t = Date.now();
    const r = await buildSet(positionals[0] ?? '.', values.out, {
      version: values.version,
      preview: values.preview,
      previous: values.previous,
      includeDrafts: values['include-drafts'],
      concurrency: values.jobs ? Number(values.jobs) : undefined,
      log: (m) => console.error(m),
    });
    for (const w of r.warnings) console.error(`warning: ${w}`);
    console.log(`built ${Object.keys(r.manifest.assets).length} assets, ${r.fileCount} files, ${(r.bytes / 1e6).toFixed(2)} MB in ${((Date.now() - t) / 1000).toFixed(1)} s -> ${r.outDir}\ncontentHash ${r.manifest.contentHash}\ninputsHash  ${r.manifest.inputsHash}`);
  },

  // ---- publisher commands: plan, publish, check-cdn ----

  async plan(argv) {
    const { values } = parseArgs({ args: argv, options: {
      sets: { type: 'string', default: '' }, 'sets-file': { type: 'string', default: 'sets.yaml' }, cache: { type: 'string', default: '.ducktape-cache' },
      summary: { type: 'string' }, output: { type: 'string', default: 'plan.json' }, index: { type: 'string', default: 'index' }, jobs: { type: 'string' },
    } });
    const { planSets, writePlan } = await import('./plan.mjs');
    const { createRegistry } = await import('./registry.mjs');
    const plan = await planSets({
      setsFile: values['sets-file'], cacheDir: values.cache, indexDir: values.index, registry: createRegistry(),
      only: values.sets.split(',').map((x) => x.trim()).filter(Boolean), jobs: values.jobs ? Number(values.jobs) : undefined, log: (m) => console.error(m),
    });
    console.log(await writePlan(plan, { output: values.output, summary: values.summary }));
  },

  async publish(argv) {
    const { values } = parseArgs({ args: argv, options: {
      plan: { type: 'string', default: 'plan.json' }, cache: { type: 'string', default: '.ducktape-cache' }, record: { type: 'string', default: 'releases' },
      index: { type: 'string', default: 'index' }, 'sets-file': { type: 'string', default: 'sets.yaml' }, 'dry-run': { type: 'boolean', default: false },
    } });
    const { publishPlan } = await import('./publish.mjs');
    const { createRegistry } = await import('./registry.mjs');
    const { record, file } = await publishPlan({
      planFile: values.plan, cacheDir: values.cache, recordDir: values.record, indexDir: values.index, setsFile: values['sets-file'],
      registry: createRegistry(), dryRun: values['dry-run'], log: (m) => console.error(m),
    });
    console.log(`${record.dryRun ? 'dry run: ' : ''}${record.packages.length} packages -> ${file}`);
  },

  async 'check-cdn'(argv) {
    const { values } = parseArgs({ args: argv, options: {
      plan: { type: 'string' }, record: { type: 'string' }, index: { type: 'string', default: 'index' },
      retries: { type: 'string', default: '6' }, delay: { type: 'string', default: '10' },
    } });
    const { checkCdn, formatTable, recordOutcome, targetsFromIndex, targetsFromPlan } = await import('./check-cdn.mjs');
    const { readFile } = await import('node:fs/promises');
    const targets = values.plan ? await targetsFromPlan(JSON.parse(await readFile(values.plan, 'utf8')), values.index) : await targetsFromIndex(values.index);
    if (!targets.length) { console.log('nothing to check'); return; }
    const outcome = await checkCdn({ targets, retries: Number(values.retries), delayMs: Number(values.delay) * 1000 });
    console.log(formatTable(outcome));
    if (values.record) console.error(`recorded in ${await recordOutcome(values.record, process.env.GITHUB_RUN_ID ?? 'local', outcome)}`);
    process.exitCode = outcome.ok ? 0 : 1;
  },

  async archive(argv) {
    const { values } = parseArgs({ args: argv, options: {
      plan: { type: 'string', default: 'plan.json' }, cache: { type: 'string', default: '.ducktape-cache' }, record: { type: 'string', default: 'releases' },
      index: { type: 'string', default: 'index' }, tag: { type: 'string' },
    } });
    const { archiveRun } = await import('./archive.mjs');
    const r = await archiveRun({ planFile: values.plan, cacheDir: values.cache, recordDir: values.record, indexDir: values.index, tag: values.tag, log: (m) => console.error(m) });
    console.log(r.tag ? `${r.assets.length} tarball(s) attached to release ${r.tag}, noted in ${r.file}` : 'nothing to archive');
  },

  async 'deploy-cdn'(argv) {
    const { values } = parseArgs({ args: argv, options: {
      index: { type: 'string', default: 'index' }, records: { type: 'string', default: 'releases' }, sets: { type: 'string', default: '' }, work: { type: 'string', default: '.ducktape-cdn' },
      account: { type: 'string' }, months: { type: 'string', default: '12' }, 'dry-run': { type: 'boolean', default: false },
    } });
    const { deployCdn, formatDeployTable } = await import('./deploy-cdn.mjs');
    const outcome = await deployCdn({
      indexDir: values.index, recordDir: values.records, sets: values.sets.split(',').map((x) => x.trim()).filter(Boolean), work: values.work,
      account: values.account, months: Number(values.months), dryRun: values['dry-run'], log: (m) => console.error(m),
    });
    console.log(formatDeployTable(outcome));
    process.exitCode = outcome.ok ? 0 : 1;
  },

  async 'new-set'(argv) { const { runNewSet } = await import('./new-set.mjs'); await runNewSet(argv); },
  async readme(argv) { const { runReadme } = await import('./readme.mjs'); await runReadme(argv); },
  async sources(argv) { const { runSources } = await import('./sources.mjs'); await runSources(argv); },
};

if (!command || command === '--help' || command === '-h') {
  console.log(`usage: ducktape-assets-tools <command>\n\ncommands:\n  validate [set-repo-dir]   schemas, vocabularies, ids, masters, provenance, licence\n  build <set-repo-dir> --out <dir> [--preview] [--version x.y.z] [--previous manifest.json] [--jobs n] [--include-drafts]\n  plan [--sets a,b] [--cache dir] [--summary file] [--output plan.json]\n  publish [--plan plan.json] [--cache dir] [--record releases] [--dry-run]\n  check-cdn [--plan plan.json] [--record releases] [--retries 6] [--delay 10]\n  archive [--plan plan.json] [--cache dir] [--record releases] [--tag run-<id>]   tarballs of a run's packages as a GitHub Release of the main repo\n  deploy-cdn [--sets a,b] [--account <subdomain>] [--months 12] [--dry-run]       fallback host (CDN contingency, level 1)\n  new-set <id> --title ... --kind ... [--license ...] [--local <parent-dir>] [--github] [--registry sets.yaml]\n  readme <set-repo-dir> [--manifest manifest.json] [--records <releases-dir>]\n  sources add <set-repo-dir> <file>... [--tag sources-<date>] [--note ...] | sources pull <set-repo-dir> [--out <dir>]\n\nThe npm bootstrap is scripts/owner-npm-bootstrap.sh (needs the owner's passkey); the copy command lives in the index package: npx ducktape-assets copy`);
} else if (commands[command]) {
  try {
    await commands[command](args);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
} else {
  console.error(`unknown command "${command}"; run with --help`);
  process.exitCode = 2;
}

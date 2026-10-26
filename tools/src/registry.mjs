// npm registry client used by plan, publish and bootstrap. Every consumer takes a client object with this shape, so
// tests inject a fake: { view(pkg), publishedInputsHash(pkg), publishedManifest(pkg, version), publish(dir, { dryRun }) }.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = (cmd, args, { cwd } = {}) => new Promise((resolve) => {
  execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout), stderr: String(stderr) }));
});

export const ALREADY_PUBLISHED = /cannot publish over (the )?previously published versions?/i;

export function createRegistry({ exec = run } = {}) {
  const client = {
    // The latest version's package.json fields, or null when the package does not exist (E404).
    async view(pkg) {
      const r = await exec('npm', ['view', pkg, '--json']);
      if (r.error) {
        if (/E404|404 Not Found/i.test(r.stdout + r.stderr)) return null;
        throw new Error(`npm view ${pkg} failed: ${(r.stderr || r.stdout || r.error.message).trim().slice(0, 500)}`);
      }
      if (!r.stdout.trim()) return null;
      const doc = JSON.parse(r.stdout);
      return Array.isArray(doc) ? doc[doc.length - 1] : doc;
    },

    async publishedInputsHash(pkg) {
      return (await client.view(pkg))?.ducktape?.inputsHash ?? null;
    },

    // manifest.json of pkg@version, read from the registry tarball (npm pack + tar).
    async publishedManifest(pkg, version) {
      const dir = await mkdtemp(path.join(tmpdir(), 'ducktape-pack-'));
      try {
        const packed = await exec('npm', ['pack', `${pkg}@${version}`, '--json', '--pack-destination', dir]);
        if (packed.error) throw new Error(`npm pack ${pkg}@${version} failed: ${packed.stderr.trim().slice(0, 500)}`);
        const file = path.join(dir, JSON.parse(packed.stdout)[0].filename);
        const tar = await exec('tar', ['-xzOf', file, 'package/manifest.json']);
        if (tar.error) throw new Error(`${pkg}@${version} has no manifest.json`);
        return JSON.parse(tar.stdout);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    // Publishes the package in `dir`. "Cannot publish over previously published version" is success.
    // Resolves to { status: 'published' | 'already-published' | 'dry-run' }.
    async publish(dir, { dryRun = false } = {}) {
      const r = await exec('npm', ['publish', '--access', 'public', ...(dryRun ? ['--dry-run'] : [])], { cwd: dir });
      if (r.error) {
        if (ALREADY_PUBLISHED.test(r.stdout + r.stderr)) return { status: 'already-published' };
        throw new Error(`npm publish failed in ${dir}: ${(r.stderr || r.stdout).trim().slice(0, 800)}`);
      }
      return { status: dryRun ? 'dry-run' : 'published' };
    },
  };
  return client;
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

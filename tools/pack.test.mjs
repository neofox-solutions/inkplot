// The tarballs a release publishes: every file an `exports` entry points at is in it, the metadata npm shows is present, and the two
// packages agree on a version. Run on its own: node tools/pack.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'inkplot-pack-'));
try {
  const scratchTgz = execFileSync(process.execPath, [join(root, 'tools/pack-scratch.mjs'), out], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  const inkplotTgz = execFileSync('sh', ['-c', `ls ${out}/inkplot-lib/inkplot/*.tgz`]).toString().trim();
  const files = (tgz) => new Set(execFileSync('tar', ['-tzf', tgz]).toString().split('\n').filter(Boolean).map((f) => f.replace(/^package\//, '')));
  const manifest = (tgz) => JSON.parse(execFileSync('tar', ['-xzOf', tgz, 'package/package.json']).toString());

  const lib = manifest(inkplotTgz), have = files(inkplotTgz);
  const targets = (v) => (typeof v === 'string' ? [v] : Object.values(v).flatMap(targets));
  for (const [path, entry] of Object.entries(lib.exports)) for (const t of targets(entry)) assert.ok(have.has(t.replace(/^\.\//, '')), `inkplot: export "${path}" points at ${t}, which is not in the tarball`);
  for (const f of ['LICENSE', 'README.md']) assert.ok(have.has(f), `inkplot: ${f} is missing`);
  assert.deepEqual(Object.keys(lib.exports), ['.', './jsx-runtime', './jsx-dev-runtime', './react', './web-components']);
  assert.equal(lib.license, 'MIT');
  assert.equal(lib.engines, undefined, 'inkplot: the repository\'s Node requirement is for its tooling, not the library');
  assert.match(lib.repository.url, /neofox-solutions\/inkplot\.git$/);
  assert.equal(lib.peerDependencies.react, '>=18');
  assert.ok(![...have].some((f) => /\.test\.|fake-platform/.test(f)), 'inkplot: test files are in the tarball');

  const tool = manifest(scratchTgz), toolFiles = files(scratchTgz);
  assert.equal(tool.version, lib.version);
  assert.equal(tool.dependencies.inkplot, lib.version);
  assert.ok(toolFiles.has('bin.mjs') && toolFiles.has('LICENSE'));
  console.log(`ok pack (inkplot ${lib.version}: ${have.size} files, inkplot-scratch: ${toolFiles.size} files)`);
} finally { rmSync(out, { recursive: true, force: true }); }

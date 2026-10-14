// The tarballs a release publishes: every file an `exports` entry points at is in it, the metadata npm shows is present, and the two
// packages agree on a version. Run on its own: node tools/pack.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vite-plus/test';

test('pack', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const out = mkdtempSync(join(tmpdir(), 'inkplot-pack-'));
  try {
    const scratchTgz = execFileSync(process.execPath, [join(root, 'tools/pack-scratch.mjs'), out], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const inkplotTgz = execFileSync('sh', ['-c', `ls ${out}/inkplot-lib/inkplot/*.tgz`])
      .toString()
      .trim();
    const files = (tgz) =>
      new Set(
        execFileSync('tar', ['-tzf', tgz])
          .toString()
          .split('\n')
          .filter(Boolean)
          .map((f) => f.replace(/^package\//, '')),
      );
    const manifest = (tgz) => JSON.parse(execFileSync('tar', ['-xzOf', tgz, 'package/package.json']).toString());

    const lib = manifest(inkplotTgz),
      have = files(inkplotTgz);
    const targets = (v) => (typeof v === 'string' ? [v] : Object.values(v).flatMap(targets));
    for (const [path, entry] of Object.entries(lib.exports))
      for (const t of targets(entry))
        assert.ok(have.has(t.replace(/^\.\//, '')), `inkplot: export "${path}" points at ${t}, which is not in the tarball`);
    for (const f of ['LICENSE', 'README.md']) assert.ok(have.has(f), `inkplot: ${f} is missing`);
    assert.deepEqual(Object.keys(lib.exports), ['.', './jsx-runtime', './jsx-dev-runtime', './react', './web-components']);
    assert.equal(lib.license, 'MIT');
    assert.equal(lib.engines, undefined, "inkplot: the repository's Node requirement is for its tooling, not the library");
    assert.match(lib.repository.url, /neofox-solutions\/inkplot\.git$/);
    assert.equal(lib.peerDependencies.react, '>=18');
    assert.ok(![...have].some((f) => /\.test\.|fake-platform/.test(f)), 'inkplot: test files are in the tarball');

    const tool = manifest(scratchTgz),
      toolFiles = files(scratchTgz);
    // inkplot-scratch's manifest is published as written (npm resolves no `catalog:`), so its ranges must be the catalog's.
    const catalog = Object.fromEntries(
      [...readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').matchAll(/^ {2}'?([^':\s]+)'?: (\S+)$/gm)].map((m) => [m[1], m[2]]),
    );
    for (const group of [tool.dependencies, tool.optionalDependencies])
      for (const [name, range] of Object.entries(group ?? {}))
        if (name in catalog)
          assert.equal(range, catalog[name], `inkplot-scratch asks for ${name}@${range}; the catalog says ${catalog[name]}`);
    assert.ok('typescript' in catalog && tool.dependencies.typescript === catalog.typescript, 'the catalog is read');
    assert.equal(tool.version, lib.version);
    assert.equal(tool.dependencies.inkplot, lib.version);
    assert.ok(toolFiles.has('bin.mjs') && toolFiles.has('LICENSE'));
    // The command and the skills it installs.
    assert.deepEqual(lib.bin, { inkplot: './bin.mjs' });
    for (const f of [
      'bin.mjs',
      'skill/inkplot/SKILL.md',
      'skill/inkplot/topics/axes.md',
      'skill/inkplot/reference/exports.md',
      'skill/inkplot-data-charts/SKILL.md',
    ])
      assert.ok(have.has(f), `inkplot: ${f} is missing`);
    const stamped = (path) => execFileSync('tar', ['-xzOf', inkplotTgz, `package/${path}`]).toString();
    for (const f of ['skill/inkplot/SKILL.md', 'skill/inkplot-data-charts/SKILL.md']) {
      assert.match(
        stamped(f),
        new RegExp(
          `^---\\nname: [a-z-]+\\ndescription: .+\\nmetadata:\\n  generator: inkplot\\n  version: "${lib.version.replaceAll('.', '\\.')}"\\n---\\n`,
        ),
        f,
      );
      assert.ok(!stamped(f).includes('{{version}}'), `${f}: a version marker is left unfilled`);
    }
    assert.ok(![...have].some((f) => f.startsWith('skill/') && /\.(tsx|jsx)\b/.test(f)));
    assert.ok(
      !/<(Chart|CartesianPlane)\b/.test(stamped('skill/inkplot/SKILL.md')),
      'the shipped library skill is plain TypeScript, not JSX',
    );
    // Run the packed command from where npx would: it lists the tools, installs, and reports the version.
    const ws = mkdtempSync(join(tmpdir(), 'inkplot-bin-'));
    try {
      execFileSync('tar', ['-xzf', inkplotTgz, '-C', ws]);
      const bin = join(ws, 'package/bin.mjs');
      const cli = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: ws, env: { ...process.env, HOME: ws }, encoding: 'utf8' });
      assert.equal(cli(['--version']).stdout.trim(), lib.version);
      const bare = cli([]);
      assert.equal(bare.status, 2);
      assert.match(bare.stderr, /install-skill/);
      assert.match(cli(['install-skill']).stderr, /Tools:[\s\S]*claude-code[\s\S]*Options:/);
      const installed = cli(['install-skill', 'claude-code', '--all']);
      assert.equal(installed.status, 0, installed.stderr);
      assert.match(installed.stdout, new RegExp(`installed inkplot ${lib.version.replaceAll('.', '\\.')} at \\.claude/skills/inkplot`));
      for (const f of ['inkplot/SKILL.md', 'inkplot/topics/axes.md', 'inkplot-data-charts/SKILL.md'])
        assert.ok(existsSync(join(ws, '.claude/skills', f)), f);
      assert.match(cli(['install-skill', 'claude-code', '--all']).stdout, /already installed/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
    // The skill uploads: a zip per skill, each holding one folder named as the skill is, marked with the version.
    // Given a relative folder, as CI does, from the repository root.
    const zips = execFileSync(process.execPath, ['tools/pack-skill-zip.mjs', 'out/pack-test-skill'], { cwd: root })
      .toString()
      .trim()
      .split('\n');
    assert.deepEqual(zips, [
      join(root, 'out/pack-test-skill', `inkplot-data-charts-${lib.version}.zip`),
      join(root, 'out/pack-test-skill', `inkplot-skill-${lib.version}.zip`),
    ]);
    const filesIn = (zip) =>
      execFileSync('unzip', ['-Z1', zip])
        .toString()
        .split('\n')
        .filter((e) => e && !e.endsWith('/'));
    assert.deepEqual(filesIn(zips[0]), ['inkplot-data-charts/SKILL.md']);
    const skillMd = execFileSync('unzip', ['-p', zips[0], 'inkplot-data-charts/SKILL.md']).toString();
    assert.match(skillMd, /^---\nname: inkplot-data-charts\ndescription: .+\nmetadata:\n  generator: inkplot\n  version: ".+"\n---\n/);
    assert.ok(
      skillMd.includes(`npm i inkplot@${lib.version} inkplot-scratch@${lib.version}`),
      'the data-charts skill installs the version it ships with',
    );
    const libraryFiles = filesIn(zips[1]);
    assert.ok(
      libraryFiles.includes('inkplot/SKILL.md') &&
        libraryFiles.includes('inkplot/topics/axes.md') &&
        libraryFiles.every((f) => f.startsWith('inkplot/')),
      libraryFiles.join(),
    );
    console.log(`ok pack (inkplot ${lib.version}: ${have.size} files, inkplot-scratch: ${toolFiles.size} files)`);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(join(root, 'out/pack-test-skill'), { recursive: true, force: true });
  }
});

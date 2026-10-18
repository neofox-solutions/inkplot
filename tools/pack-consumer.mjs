// Builds what a user installs, as a tarball: the library's own modules with the types taken out (and `.ts` import paths
// turned into `.js`), beside their declarations. Not bundled and not minified: a library is bundled by the app that
// uses it, and a stack trace or a class name in an error should read as the source does, line for line. Also in it: the `inkplot` command (cli/), and
// the skills it installs for AI tools (skill/). node tools/pack-consumer.mjs [outdir]
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { bundle } from './bundle.ts';
import { stampSkill } from './stamp-skill.mjs';
import { stripToJs } from './strip-types.mjs';
const root = new URL('../', import.meta.url).pathname;
const out = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : root + 'out/consumer/';
const pkg = out + 'inkplot/';
rmSync(out, { recursive: true, force: true });
mkdirSync(pkg, { recursive: true });
// The declarations come from the compiler. The JavaScript does not: it is each module with its types blanked out (Node's own
// type stripping, `erasableSyntaxOnly` being what makes that possible), so every line is where it is in the source and a stack
// trace from an installed library names the line to open in the repository.
execFileSync(
  process.execPath,
  [root + 'node_modules/typescript/bin/tsc', '-p', root + 'tsconfig.types.json', '--emitDeclarationOnly', '--outDir', pkg + 'dist'],
  { cwd: root, stdio: 'inherit' },
);
const shipped = (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'fake-platform.ts';
for (const f of readdirSync(root + 'src').filter(shipped)) {
  writeFileSync(pkg + 'dist/' + f.replace(/\.ts$/, '.js'), stripToJs(readFileSync(root + 'src/' + f, 'utf8')));
}
// `engines` is not copied from the root package.json (that is what the repository's own tooling needs). The published one is for the CLI:
// `inkplot install-skill` uses fs.cpSync, added in Node 16.7. The library itself runs on Node 16.0.
const dev = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
const bin = await bundle({ entry: root + 'cli/bin.ts', format: 'esm', platform: 'node' });
writeFileSync(pkg + 'bin.mjs', bin.code);
const ex = (e) => ({ types: `./dist/${e}.d.ts`, default: `./dist/${e}.js` });
writeFileSync(
  pkg + 'package.json',
  JSON.stringify(
    {
      name: 'inkplot',
      version: dev.version,
      description: dev.description,
      license: dev.license,
      repository: dev.repository,
      homepage: dev.homepage,
      bugs: dev.bugs,
      keywords: dev.keywords,
      type: 'module',
      engines: { node: '>=16.7' },
      bin: { inkplot: './bin.mjs' },
      sideEffects: false,
      exports: {
        '.': ex('index'),
        './jsx-runtime': ex('jsx-runtime'),
        './jsx-dev-runtime': ex('jsx-dev-runtime'),
        './react': ex('react'),
        './web-components': ex('web-components'),
        './node-worker': ex('node-worker'),
        './worker': ex('worker'),
      },
      types: './dist/index.d.ts',
      peerDependencies: dev.peerDependencies,
      peerDependenciesMeta: dev.peerDependenciesMeta,
    },
    null,
    2,
  ),
);
// The skills: the library's own (plain TypeScript, so the docs an agent reads are the ones for the version installed), and the one for
// turning data into charts with inkplot-scratch. Each is marked with this version.
execFileSync(process.execPath, [root + 'tools/pack-skill.mjs', pkg + 'skill/inkplot', '--ts', '--stamp', dev.version], {
  cwd: root,
  stdio: 'ignore',
});
mkdirSync(pkg + 'skill/inkplot-data-charts', { recursive: true });
writeFileSync(pkg + 'skill/inkplot-data-charts/SKILL.md', stampSkill(readFileSync(root + 'scratch/skill/SKILL.md', 'utf8'), dev.version));
cpSync(root + 'LICENSE', pkg + 'LICENSE');
writeFileSync(pkg + 'README.md', readFileSync(root + 'README.md', 'utf8'));
const tgz = execFileSync('npm', ['pack', '--silent'], { cwd: pkg }).toString().trim();
console.log(pkg + tgz);

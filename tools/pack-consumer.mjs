// Builds what a user installs, as a tarball: the library's own modules with the types taken out (and `.ts` import paths
// turned into `.js`), beside their declarations. Not bundled and not minified: a library is bundled by the app that
// uses it, and a stack trace or a class name in an error should read as the source does. node tools/pack-consumer.mjs [outdir]
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const out = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : root + 'out/consumer/';
const pkg = out + 'inkplot/';
rmSync(out, { recursive: true, force: true });
mkdirSync(pkg, { recursive: true });
execFileSync(process.execPath, [root + 'node_modules/typescript/bin/tsc', '-p', root + 'tsconfig.package.json', '--outDir', pkg + 'dist'], {
  cwd: root,
  stdio: 'inherit',
});
// `engines` is not copied: the Node version in the root package.json is what the repository's own tooling needs, not what the built library needs.
const dev = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
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
      sideEffects: false,
      exports: {
        '.': ex('index'),
        './jsx-runtime': ex('jsx-runtime'),
        './jsx-dev-runtime': ex('jsx-dev-runtime'),
        './react': ex('react'),
        './web-components': ex('web-components'),
      },
      types: './dist/index.d.ts',
      peerDependencies: dev.peerDependencies,
      peerDependenciesMeta: dev.peerDependenciesMeta,
    },
    null,
    2,
  ),
);
cpSync(root + 'LICENSE', pkg + 'LICENSE');
writeFileSync(pkg + 'README.md', readFileSync(root + 'README.md', 'utf8'));
const tgz = execFileSync('npm', ['pack', '--silent'], { cwd: pkg }).toString().trim();
console.log(pkg + tgz);

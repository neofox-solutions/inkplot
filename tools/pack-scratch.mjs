// Builds inkplot-scratch, the command that turns a module of charts into SVG, PNG, JSON or an HTML app, as a tarball.
//   node tools/pack-scratch.mjs [outdir]       prints the path of the tarball (the inkplot one is beside it)
import { bundle } from './bundle.ts';
import { stampSkill } from './stamp-skill.mjs';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : root + 'out/scratch/';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const inkplot = execFileSync(process.execPath, [root + 'tools/pack-consumer.mjs', out + 'inkplot-lib'], { cwd: root })
  .toString()
  .trim();

const pkg = out + 'inkplot-scratch/',
  src = root + 'scratch/';
mkdirSync(pkg + 'src', { recursive: true });
const dev = JSON.parse(readFileSync(root + 'package.json', 'utf8')),
  version = dev.version;
// One version for both packages, the root package.json's: they release together, and the scratch tool depends on exactly the
// library it was tested with. Its own manifest is the rest of what npm shows.
const { name, ...rest } = JSON.parse(readFileSync(src + 'package.json', 'utf8'));
delete rest['//']; // the note to whoever edits the manifest
const manifest = { name, version, ...rest, dependencies: { ...rest.dependencies, inkplot: version } };
const cli = await bundle({
  entry: src + 'src/cli.ts',
  format: 'esm',
  platform: 'node',
  external: ['rolldown', '@resvg/resvg-wasm', 'inkplot'],
});
writeFileSync(pkg + 'bin.mjs', cli.code);
// The sources the page and the figures are built from at run time, against the workspace's own copy of inkplot.
for (const f of ['figures.ts', 'app.ts', 'interact.ts', 'template.html']) cpSync(src + 'src/' + f, pkg + 'src/' + f);
cpSync(src + 'fonts', pkg + 'fonts', { recursive: true });
writeFileSync(pkg + 'package.json', JSON.stringify(manifest, null, 2));
cpSync(root + 'LICENSE', pkg + 'LICENSE');
// The skill an agent reads first; the library's own skill (rules, template, topics) comes with `inkplot`, in node_modules/inkplot/skill.
const skill = stampSkill(readFileSync(src + 'skill/SKILL.md', 'utf8'), version);
mkdirSync(pkg + 'skill', { recursive: true });
writeFileSync(pkg + 'skill/SKILL.md', skill);
// npm shows the README: a short description of the package, while the skill (an agent's instructions) is its own file.
cpSync(src + 'README.md', pkg + 'README.md');
const tgz = execFileSync('npm', ['pack', '--silent'], { cwd: pkg }).toString().trim();
console.log(pkg + tgz);
console.error(`inkplot: ${inkplot}\nversion ${version}`);

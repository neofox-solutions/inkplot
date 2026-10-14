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
const manifest = JSON.parse(readFileSync(src + 'package.json', 'utf8')),
  version = manifest.version;
const dev = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
// The two packages release together: the scratch tool depends on exactly the library it was tested with.
if (version !== dev.version || manifest.dependencies.inkplot !== dev.version)
  throw new Error(`versions differ: inkplot ${dev.version}, inkplot-scratch ${version} (needs inkplot ${manifest.dependencies.inkplot})`);
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
cpSync(src + 'package.json', pkg + 'package.json');
cpSync(root + 'LICENSE', pkg + 'LICENSE');
// The skill an agent reads first; the library's own skill (rules, template, topics) comes with `inkplot`, in node_modules/inkplot/skill.
const skill = stampSkill(readFileSync(src + 'skill/SKILL.md', 'utf8'), version);
mkdirSync(pkg + 'skill', { recursive: true });
writeFileSync(pkg + 'skill/SKILL.md', skill);
writeFileSync(pkg + 'README.md', skill);
const tgz = execFileSync('npm', ['pack', '--silent'], { cwd: pkg }).toString().trim();
console.log(pkg + tgz);
console.error(`inkplot: ${inkplot}\nversion ${version}`);

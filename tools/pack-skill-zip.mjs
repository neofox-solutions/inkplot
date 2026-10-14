// The skills as files to upload where a tool takes uploads (Claude: Customize > Skills > Upload a skill; ChatGPT: Skills > Upload): a zip
// per skill, holding one folder named as the skill is. Prints the paths, one per line. node tools/pack-skill-zip.mjs [outdir]
//   inkplot-data-charts-<version>.zip   the non-technical one: spreadsheets in, charts out (SKILL.md only; it installs inkplot itself)
//   inkplot-skill-<version>.zip         for writing inkplot code (SKILL.md, topics and the reference)
// Both are marked with the version, as `inkplot install-skill` marks what it installs. Needs the `zip` command.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampSkill } from './stamp-skill.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Absolute: `zip` runs inside the staging folder, where a relative path would point somewhere else.
const out = (process.argv[2] ? resolve(process.argv[2]) : root + 'out/skill-zip').replace(/\/?$/, '/');
const version = JSON.parse(readFileSync(root + 'package.json', 'utf8')).version;
const stage = out + 'stage/';
rmSync(out, { recursive: true, force: true });

const source = root + 'scratch/skill/SKILL.md';
const name = /^name: (.+)$/m.exec(readFileSync(source, 'utf8'))?.[1]?.trim();
if (!name) throw new Error('scratch/skill/SKILL.md has no name in its front matter');
mkdirSync(stage + name, { recursive: true });
writeFileSync(stage + name + '/SKILL.md', stampSkill(readFileSync(source, 'utf8'), version));
execFileSync(process.execPath, [root + 'tools/pack-skill.mjs', stage + 'inkplot', '--ts', '--stamp', version], {
  cwd: root,
  stdio: 'ignore',
});

const zips = [];
for (const [folder, file] of [
  [name, `${name}-${version}.zip`],
  ['inkplot', `inkplot-skill-${version}.zip`],
]) {
  execFileSync('zip', ['-qr', out + file, folder], { cwd: stage });
  zips.push(out + file);
}
rmSync(stage, { recursive: true, force: true });
console.log(zips.join('\n'));

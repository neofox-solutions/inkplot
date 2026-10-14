// The non-technical skill as a file to upload in Claude (Customize > Skills > Upload a skill): a zip with one folder, named as the
// skill is, holding its SKILL.md. Prints the path. node tools/pack-skill-zip.mjs [outdir]    (needs the `zip` command)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Absolute: `zip` runs inside the staging folder, where a relative path would point somewhere else.
const out = (process.argv[2] ? resolve(process.argv[2]) : root + 'out/skill-zip').replace(/\/?$/, '/');
const source = root + 'scratch/skill/SKILL.md';
const name = /^name: (.+)$/m.exec(readFileSync(source, 'utf8'))?.[1]?.trim();
if (!name) throw new Error('scratch/skill/SKILL.md has no name in its front matter');
const stage = out + 'stage/';
rmSync(out, { recursive: true, force: true });
mkdirSync(stage + name, { recursive: true });
cpSync(source, stage + name + '/SKILL.md');
const zip = `${out}${name}-${JSON.parse(readFileSync(root + 'package.json', 'utf8')).version}.zip`;
execFileSync('zip', ['-qr', zip, name], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(zip);

// Build the skill folder an agent is given: SKILL.md, topics/*.md and reference/exports.md, with links to pages that are not in it turned into plain text.
//   node tools/pack-skill.mjs [outDir] [--ts] [--stamp version]
//   (default out/skill; --ts: the examples and snippets as plain TypeScript, `new Element(attributes, ...children)`, not JSX;
//   --stamp: mark SKILL.md as written for that version of inkplot, see stamp-skill.mjs)
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { jsxFlavour, typeScriptFlavour } from './jsx-to-new.mjs';
import { stampSkill } from './stamp-skill.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { ts: { type: 'boolean' }, stamp: { type: 'string' } } });
if (positionals.length > 1) throw new Error(`one output folder at most (got ${positionals.join(', ')})`);
if (values.stamp === '') throw new Error('--stamp needs a version');
const ts = values.ts === true,
  version = values.stamp ?? null;
const root = new URL('../docs/', import.meta.url).pathname;
const out = positionals[0] ?? new URL('../out/skill/', import.meta.url).pathname;
const strip = (text) => text.replace(/\[([^\]]+)\]\((?:\.\.\/|\.\/)?(?:guide|extending|start|authoring|README|api\.md)[^)]*\)/g, '$1');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'topics'), { recursive: true });
mkdirSync(join(out, 'reference'), { recursive: true });
const put = async (to, from) => {
  const text = readFileSync(join(root, from), 'utf8');
  const body = strip(ts ? await typeScriptFlavour(text, from) : jsxFlavour(text));
  writeFileSync(join(out, to), version && to === 'SKILL.md' ? stampSkill(body, version) : body);
};
await put('SKILL.md', 'SKILL.md');
for (const f of readdirSync(join(root, 'skill-topics'))) if (f.endsWith('.md')) await put(join('topics', f), join('skill-topics', f));
await put(join('reference', 'exports.md'), join('reference', 'exports.md'));
console.log(out);

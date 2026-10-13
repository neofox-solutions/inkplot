// Build the skill folder an agent is given: SKILL.md, topics/*.md and reference/exports.md, with links to pages that are not in it turned into plain text.
//   node tools/pack-skill.mjs [outDir] [--ts]   (default out/skill; --ts: the examples and snippets as plain TypeScript, `new Element(attributes, ...children)`, not JSX)
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsxFlavour, typeScriptFlavour } from './jsx-to-new.mjs';

const args = process.argv.slice(2), ts = args.includes('--ts');
const root = new URL('../docs/', import.meta.url).pathname;
const out = args.find((a) => !a.startsWith('--')) ?? new URL('../out/skill/', import.meta.url).pathname;
const strip = (text) => text.replace(/\[([^\]]+)\]\((?:\.\.\/|\.\/)?(?:guide|extending|start|authoring|README|api\.md)[^)]*\)/g, '$1');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'topics'), { recursive: true });
mkdirSync(join(out, 'reference'), { recursive: true });
const put = async (to, from) => {
  const text = readFileSync(join(root, from), 'utf8');
  writeFileSync(join(out, to), strip(ts ? await typeScriptFlavour(text, from) : jsxFlavour(text)));
};
await put('SKILL.md', 'SKILL.md');
for (const f of readdirSync(join(root, 'skill-topics'))) if (f.endsWith('.md')) await put(join('topics', f), join('skill-topics', f));
await put(join('reference', 'exports.md'), join('reference', 'exports.md'));
console.log(out);

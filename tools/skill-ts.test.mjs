// The skill in plain TypeScript (`new Element(attributes, ...children)`) is generated from the JSX one, so it has to be right by
// construction: every example is type-checked as written (no JSX runtime), and the complete ones are run and have to draw.
//   node tools/skill-ts.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { blocksOf } from './docs.ts';
import { convertCode, convertInline, jsxFlavour, typeScriptFlavour } from './jsx-to-new.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = (f) => readFileSync(join(root, 'docs', f), 'utf8');

// ─── The converter ───
const norm = (s) => s.replace(/\s+/g, ' ').trim();
assert.equal(norm(await convertCode(`/** @jsxImportSource inkplot */\nimport { Chart } from 'inkplot';\nexport const c = (<Chart theme={t} meta-title="x"><A a-b={0} /><B on /></Chart>) as Chart;`)),
  norm(`import { Chart } from 'inkplot';\n\nexport const c = new Chart({ theme: t, meta: { title: 'x' } }, new A({ a: { b: 0 } }), new B({ on: true }));`));
await assert.rejects(convertCode('const x = <Chart>text</Chart>;'), /no text children/);
await assert.rejects(convertCode('const x = <Chart>{ok && <A />}</Chart>;'), /conditional child/);
assert.equal(convertInline('use `<Axis min={0}>` and `<LinePath><LinearCurve /></LinePath>`, `meta-title`, `include={[0]}`, `styling-output`'),
  "use `new Axis({ min: 0 }, …)` and `new LinePath({}, new LinearCurve())`, `meta: { title }`, `include: [0]`, `styling-output`");
assert.equal(convertInline('```\n`<Axis />` in a fence\n```'), '```\n`<Axis />` in a fence\n```');
const marked = 'a\n<!-- jsx -->\nJ\n<!-- /jsx -->\n<!-- ts -->\nT\n<!-- /ts -->\n| r1 | x | <!-- jsx-only -->\n| r2 | y | <!-- ts-only -->\n';
assert.equal(jsxFlavour(marked), 'a\nJ\n| r1 | x |\n');
assert.equal(await typeScriptFlavour(marked), 'a\nT\n| r2 | y |\n');

// ─── The pages ───
const pages = [['SKILL.md', 'SKILL.md'], ...readdirSync(join(root, 'docs/skill-topics')).filter((f) => f.endsWith('.md')).map((f) => [`skill-topics/${f}`, f])];
const out = join(root, 'out', 'skill-ts-check');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const blocks = [];
for (const [path, name] of pages) {
  const text = await typeScriptFlavour(docs(path), path);
  assert.ok(!/<!-- (\/?(jsx|ts)|jsx-only|ts-only) -->/.test(text), `${path}: a marker is left in the TypeScript flavour`);
  assert.ok(!/<!-- (\/?(jsx|ts)|jsx-only|ts-only) -->/.test(jsxFlavour(docs(path))), `${path}: a marker is left in the JSX flavour`);
  for (const b of blocksOf(text, path)) {
    if (b.jsx !== 'react') assert.ok(!/<\/?[A-Z]\w*[\s/>]/.test(b.code), `${path}:${b.line} [${b.id}]: JSX is left in a TypeScript example`);
    blocks.push({ ...b, name });
  }
}
assert.ok(blocks.length > 15, `found the examples (${blocks.length})`);

// Type-check each as written: no JSX runtime but React's, for the one example that is React's.
const ext = (b) => (b.language === 'tsx' ? 'tsx' : 'ts');
const header = (b) => (b.jsx === 'react' ? '/** @jsxImportSource react */\n' : '');
for (const b of blocks) writeFileSync(join(out, `${b.id}.${ext(b)}`), header(b) + b.code);
writeFileSync(join(out, 'tsconfig.json'), JSON.stringify({
  extends: '../../tsconfig.json',
  compilerOptions: { jsx: 'react-jsx', paths: { inkplot: ['../../src/index.ts'], 'inkplot/*': ['../../src/*.ts'] }, types: ['node'], typeRoots: ['../../node_modules/@types'] },
  include: ['*.ts', '*.tsx'],
}));
const tsc = spawnSync('npx', ['tsc', '-p', out], { cwd: root, encoding: 'utf8' });
if (tsc.status !== 0) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  assert.fail('a TypeScript example does not compile:\n' + (tsc.stdout + tsc.stderr).split('\n').map((l) => {
    const m = /^(?:out\/skill-ts-check\/|)([\w-]+)\.tsx?\((\d+),(\d+)\): (.*)$/.exec(l), b = m && byId.get(m[1]);
    return b ? `${b.file}:${b.line + Number(m[2])}  [${b.id}] ${m[4]}` : l;
  }).join('\n'));
}

// Run the complete ones (they export `chart`): each has to draw.
let ran = 0;
for (const b of blocks.filter((x) => x.jsx !== 'react' && /^export const chart\b/m.test(x.code))) {
  const where = `${b.file}:${b.line} [${b.id}]`;
  const entry = `import * as example_ from 'example'; import { Chart, toSvgString } from 'inkplot';
    if (!(example_.chart instanceof Chart)) throw new Error('export const chart is not a Chart');
    export const svg = toSvgString(example_.chart, { width: ${b.width ?? 640}, height: ${b.height} });`;
  const result = await build({
    stdin: { contents: entry, resolveDir: out, loader: 'js' }, bundle: true, write: false, format: 'esm', target: 'es2022', logLevel: 'silent', platform: 'node',
    alias: { inkplot: join(root, 'src/index.ts'), example: join(out, `${b.id}.${ext(b)}`) }, loader: { '.ts': 'ts' },
  }).catch((e) => assert.fail(`${where}: ${e.message}`));
  const file = join(out, `${b.id}.mjs`);
  writeFileSync(file, result.outputFiles[0].text);
  const { svg } = await import(pathToFileURL(file).href);
  assert.match(svg, /^<svg[\s>]/, `${where}: draws an svg`);
  assert.ok(/<(path|rect|circle|line|text)\b/.test(svg) && !/NaN|Infinity/.test(svg), `${where}: the chart drew nothing, or NaN`);
  ran++;
}
console.log(`ok skill in TypeScript (${blocks.length} examples, ${ran} run)`);

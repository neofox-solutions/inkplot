// The documentation's code is real: every `live` and `check` block is type-checked against the library, and every `live` block
// is compiled, run, and has to draw a chart. A change that breaks the documented API breaks this test, naming the page and line.
//
//   node tools/docs.test.ts            check everything
//   node tools/docs.test.ts --sheet    also write out/docs-sheet.html: every live example drawn, to look at
//   node tools/docs.test.ts --sheet=planes  only the pages whose path contains that
//   node tools/docs.test.ts --no-links do not check that links resolve (while writing)
import assert from 'node:assert/strict';
import { expected as expectedSkillFiles, coverage as skillCoverage, TOPICS as SKILL_TOPICS } from './skill-topics.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { STRUCTURE, load, reference } from './api.ts';
import { allBlocks, anchorOf, blocksOf, linkProblems, markdownFiles, parseInfo, type DocBlock } from './docs.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (name: string) => join(root, 'src', name);

// ─── The reader of blocks ───
{
  const info = parseInfo('tsx live title="A first chart" height=260 dark', 'x');
  assert.equal(info.language, 'tsx');
  assert.deepEqual([...info.flags], ['live', 'dark']);
  assert.equal(info.values.get('title'), 'A first chart');
  assert.equal(info.values.get('height'), '260');
  assert.throws(() => parseInfo('tsx live titel="x"', 'x'), /unknown key 'titel'/);
  assert.throws(() => parseInfo('tsx lve', 'x'), /unknown flag 'lve'/);
  const md = ['# T', '```ts', 'const a = 1;', '```', '', '````tsx live title="One"', '```', 'inner', '```', '````', '  ```tsx check title="Two words"', '  let b;', '  ```'].join('\n');
  const found = blocksOf(md, 'x.md');
  assert.deepEqual(found.map((b) => [b.id, b.kind, b.line, b.height]), [['one', 'live', 6, 260], ['two-words', 'check', 11, 260]]);
  assert.equal(found[0]!.code, '```\ninner\n```\n', 'a longer fence holds a shorter one');
  assert.equal(found[1]!.code, 'let b;\n', 'an indented block loses its indent');
  assert.throws(() => blocksOf('```tsx live\nx\n```\n', 'x.md'), /needs title/);
  assert.equal(blocksOf('```tsx check title="r" jsx=react\nx\n```\n', 'x.md')[0]!.jsx, 'react');
  assert.throws(() => blocksOf('```tsx check title="r" jsx=vue\nx\n```\n', 'x.md'), /jsx must be/);
  assert.throws(() => blocksOf('```tsx live title="x"\nx\n', 'x.md'), /never closed/);
  assert.throws(() => blocksOf('```js live title="x"\nx\n```\n', 'x.md'), /'tsx' or 'ts'/);
  assert.throws(() => blocksOf('```ts dark\nx\n```\n', 'x.md'), /not 'live' or 'check'/);
}

assert.equal(anchorOf('Plot x/y pairs'), 'plot-xy-pairs');
assert.equal(anchorOf('The `Axis` class (1)'), 'the-axis-class-1');
assert.equal(anchorOf('Pointer listener'), 'pointer-listener');

// ─── The documentation ───
// `--no-links` skips this while pages are still being written.
const problems = process.argv.includes('--no-links') ? [] : linkProblems(root);
assert.deepEqual(problems, [], `links that go nowhere:\n${problems.join('\n')}`);

const blocks = allBlocks(root);
const out = join(root, 'out', 'docs-check');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (blocks.length) {
  // Type-check: one project, one file per block, so the errors name the block.
  const ext = (b: DocBlock) => (b.language === 'tsx' ? 'tsx' : 'ts');
  // A block for React's JSX gets the pragma that says so; it shifts the block's lines by one.
  const header = (b: DocBlock) => (b.jsx === 'react' ? '/** @jsxImportSource react */\n' : '');
  for (const b of blocks) writeFileSync(join(out, `${b.id}.${ext(b)}`), header(b) + b.code);
  writeFileSync(join(out, 'tsconfig.json'), JSON.stringify({
    extends: '../../tsconfig.json',
    compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'inkplot', paths: { inkplot: ['../../src/index.ts'], 'inkplot/*': ['../../src/*.ts'] }, types: ['node'], typeRoots: ['../../node_modules/@types'] },
    include: ['*.ts', '*.tsx'],
  }));
  const tsc = spawnSync('npx', ['tsc', '-p', out], { cwd: root, encoding: 'utf8' });
  if (tsc.status !== 0) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const text = (tsc.stdout + tsc.stderr).split('\n').map((l) => {
      const m = /^(?:out\/docs-check\/|)([\w-]+)\.tsx?\((\d+),(\d+)\): (.*)$/.exec(l);
      const b = m && byId.get(m[1]!);
      return b ? `${b.file}:${b.line + Number(m![2]) - header(b).split('\n').length + 1}:${m![3]}  [${b.id}] ${m![4]}` : l;
    }).join('\n');
    assert.fail(`documentation code does not compile:\n${text}`);
  }

  // Run: each live block is bundled with a small main that builds its chart and draws it to a string.
  const sheet: { block: DocBlock; svg: string }[] = [];
  // A `check` block that exports a `chart` (the complete examples of SKILL.md) is run too: compiling is not enough to know it draws.
  const runs = blocks.filter((x) => x.kind === 'live' || ((x.file.endsWith('SKILL.md') || x.file.includes('skill-topics/')) && x.jsx !== 'react' && /^export const chart\b/m.test(x.code)));
  for (const b of runs) {
    const where = `${b.file}:${b.line} [${b.id}]`;
    const entry = `import * as example_ from 'example'; import { Chart, toSvgString } from 'inkplot';
      const chart = typeof example_.default === 'function' ? example_.default() : example_.chart;
      if (!(chart instanceof Chart)) throw new Error('the default export must return a Chart, not ' + String(chart && chart.constructor && chart.constructor.name));
      export const svg = toSvgString(chart, { width: ${b.width ?? 640}, height: ${b.height} });`;
    const result = await build({
      stdin: { contents: entry, resolveDir: out, loader: 'js' }, bundle: true, write: false, format: 'esm', target: 'es2022', logLevel: 'silent',
      jsx: 'automatic', jsxImportSource: 'inkplot', platform: 'node',
      alias: { inkplot: src('index.ts'), 'inkplot/jsx-runtime': src('jsx-runtime.ts'), 'inkplot/jsx-dev-runtime': src('jsx-dev-runtime.ts'), example: join(out, `${b.id}.${b.language}`) },
      plugins: [], loader: { '.tsx': 'tsx', '.ts': 'ts' },
    }).catch((e: Error) => assert.fail(`${where}: does not compile: ${e.message}`));
    const file = join(out, `${b.id}.mjs`);
    writeFileSync(file, result.outputFiles[0]!.text);
    let svg: string;
    try { ({ svg } = await import(pathToFileURL(file).href) as { svg: string }); } catch (e) { assert.fail(`${where}: ${(e as Error).message}`); }
    assert.match(svg, /^<svg[\s>]/, `${where}: draws an svg`);
    assert.ok(/<(path|rect|circle|line|text)\b/.test(svg), `${where}: the chart drew nothing`);
    assert.ok(!/NaN|undefined|Infinity/.test(svg.replace(/aria-[^"]*"[^"]*"/g, '')), `${where}: the drawing contains NaN or undefined`);
    sheet.push({ block: b, svg });
  }

  const sheetArg = process.argv.find((a) => a === '--sheet' || a.startsWith('--sheet='));
  if (sheetArg) {
    const only = sheetArg.split('=')[1] ?? '';
    // Each example is bundled alone, so each starts its ids (clip paths, gradients) from the same numbers; on one page they must differ.
    const cell = ({ block: b, svg: raw }: { block: DocBlock; svg: string }, n: number) => {
      const svg = raw.replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${id}_${n}"`).replace(/#([\w-]+)\)/g, (_, id: string) => `#${id}_${n})`);
      return `<figure style="margin:0;background:${b.dark ? '#16181d' : '#fff'};padding:8px;border:1px solid #ccc"><figcaption style="font:12px sans-serif;color:${b.dark ? '#ccc' : '#444'}">${b.file}:${b.line} — ${b.title}</figcaption>${svg}</figure>`; };
    writeFileSync(join(root, 'out', 'docs-sheet.html'), `<!doctype html><meta charset=utf-8><body style="margin:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(660px,1fr));gap:12px">${sheet.filter((x) => x.block.file.includes(only)).map((x, i) => cell(x, i)).join('\n')}`);
  }
}
// ─── Generated pages are current ───
{
  const { registry } = load();
  assert.deepEqual(registry.filter((n) => !(n in STRUCTURE)), [], 'tools/api.ts: STRUCTURE needs an entry for every class in the registry');
  assert.deepEqual(Object.keys(STRUCTURE).filter((n) => !registry.includes(n)), [], 'tools/api.ts: STRUCTURE names a class that is not in the registry');
  const fresh = (path: string, text: string) => {
    const file = join(root, path);
    assert.ok(existsSync(file) && readFileSync(file, 'utf8') === text, `${path} is out of date: run  node tools/api.ts > ${path}`);
  };
  fresh('docs/reference/api.md', reference() + '\n');
  // A code fence is on a line of its own: one glued to a sentence is not a fence, and the example inside it would be neither checked nor shown as code.
  for (const f of markdownFiles(join(root, 'docs'))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => assert.ok(!/\S.*```/.test(line) || /^\s*>/.test(line) || /`{4}/.test(line) || (line.match(/```/g) ?? []).length % 2 === 0, `${relative(root, f)}:${i + 1}: a code fence must start its own line`));
  }
  // The skill: a core file and topic files whose generated parts (attributes, the topic index) are current, with every element in exactly one place.
  for (const [path, text] of expectedSkillFiles()) {
    assert.ok(readFileSync(path, 'utf8') === text, `${relative(root, path)} is out of date: run  node tools/skill-topics.ts`);
  }
  const cover = skillCoverage();
  assert.deepEqual(cover, { missing: [], twice: [], unknown: [] }, 'tools/skill-topics.ts: every element of the registry must be in CORE or in exactly one topic');
  for (const t of Object.values(SKILL_TOPICS)) assert.ok(existsSync(join(root, 'docs/skill-topics', t.file)), `skill topic file ${t.file} is missing`);
}
console.log(`ok docs (${blocks.filter((b) => b.kind === 'live').length} live, ${blocks.filter((b) => b.kind === 'check').length} check)`);

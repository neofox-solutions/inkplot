#!/usr/bin/env node
// inkplot-scratch: turn a module that default-exports charts into SVG, PNG, JSON facts or a single-file HTML app.
//   inkplot-scratch source.ts [--check] [--svg dir] [--png dir] [--html file] [--json file|-]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type BuildOptions, type Plugin, build, formatMessages } from 'esbuild';

const USAGE = `inkplot-scratch <source.ts|tsx> [options]

  The source module ends with:  export default [chart1, chart2];
  (an item may also be { chart, name?, caption? }; a lone chart is one figure)

  --check            type-check, render every chart, and print what each holds (the default when no output is asked for)
  --svg <dir>        one SVG file per chart:  01-histogram.svg, 02-box.svg, …
  --png <dir>        one PNG file per chart (needs @resvg/resvg-wasm; fonts are bundled)
  --html <file>      one self-contained interactive page with every chart, copy/download buttons and stats
  --json <file|->    the facts as JSON (series, point counts, axis ranges, warnings), for writing prose from
  --width <px> --height <px>   size for charts that do not set their own (default 640 by 400)
  --scale <n>        PNG pixels per CSS pixel (default 2)
  --background <css> PNG background (default white; "none" for transparent)
  --title <text>     page title for --html (default: the file name)
  --static           --html without the added pan/zoom, crosshair and tooltip (a figure can opt out with interactive: false)
  --no-typecheck     skip tsc (not recommended)

Type errors print to stderr exactly as \`tsc\` prints them; exit status 1 means fix the source and run again.`;

// A function declaration (not a const arrow): only then does the compiler know that code after a call to `fail` is unreachable.
function fail(text: string, code = 1): never { process.stderr.write(text.endsWith('\n') ? text : text + '\n'); return process.exit(code); }

// ── arguments ──
const flags = new Set(['--check', '--no-typecheck', '--static']), valued = new Set(['--svg', '--png', '--html', '--json', '--width', '--height', '--scale', '--background', '--title']);
const on = new Set<string>(), values = new Map<string, string>(), positional: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
  const a = process.argv[i]!;
  if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  if (flags.has(a)) on.add(a);
  else if (valued.has(a)) { const v = process.argv[++i]; if (v === undefined) fail(`${a} needs a value\n\n${USAGE}`, 2); values.set(a, v); }
  else if (a.startsWith('--')) fail(`unknown option ${a}\n\n${USAGE}`, 2);
  else positional.push(a);
}
const sourceArg = positional[0];
if (positional.length !== 1 || !sourceArg) fail(`give exactly one source file\n\n${USAGE}`, 2);
const num = (name: string): number | undefined => {
  const v = values.get(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!(n > 0) || !Number.isFinite(n)) fail(`${name} must be a number above 0, not "${v}"`, 2);
  return n;
};
const width = num('--width'), height = num('--height');
const size = { ...(width && { width }), ...(height && { height }) };
const source = resolve(sourceArg), workspace = process.cwd();
if (!existsSync(source)) fail(`no such file: ${sourceArg}`, 2);
const wantsOutput = ['--svg', '--png', '--html', '--json'].some((k) => values.has(k));
const check = on.has('--check') || !wantsOutput;

const here = dirname(fileURLToPath(import.meta.url));
// In the package the TypeScript sources the page is built from sit in ./src; in the repository they sit beside this file.
const assets = existsSync(join(here, 'figures.ts')) ? here : join(here, 'src');

// ── 1. type-check, saying what tsc says ──
if (!on.has('--no-typecheck')) {
  // `typescript/bin/tsc` is not in the package's exports, so find the package and read where its `tsc` is.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the shape of a JSON file we just read (`typescript/package.json`)
  const find = (from: string) => { try { const json = createRequire(from).resolve('typescript/package.json'); return join(dirname(json), (JSON.parse(readFileSync(json, 'utf8')) as { bin: { tsc: string } }).bin.tsc); } catch { return null; } };
  const tsc = find(join(workspace, 'x.js')) ?? find(import.meta.url) ?? fail('typescript is not installed here. Run: npm i inkplot-scratch typescript');
  const r = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false', '--strict', '--noUncheckedIndexedAccess', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
    '--lib', 'es2022,dom', '--jsx', 'react-jsx', '--jsxImportSource', 'inkplot', '--resolveJsonModule', '--allowImportingTsExtensions', '--skipLibCheck', '--esModuleInterop', source], { cwd: workspace, encoding: 'utf8' });
  if (r.status !== 0) {
    const said = (r.stdout + r.stderr).trim();
    // tsc prints "error TS…" for a problem in the source; anything else is tsc itself failing (TypeScript 7 is a native binary, in an optional dependency).
    fail(said + (/error TS\d+/.test(said) ? '' : '\n\nThis is tsc failing to run, not a problem in your source. If it names a missing @typescript/… package, the install skipped optional dependencies: run npm i again without --omit=optional. To go on without type-checking, add --no-typecheck.') + '\n');
  }
}

// ── 2. bundle the source (one copy of inkplot, the one in the workspace) and run it ──
const oneInkplot = (): Plugin => ({
  name: 'one-inkplot',
  setup(b) {
    b.onResolve({ filter: /^inkplot(\/|$)/ }, async (args) => {
      if (args.pluginData === 'inkplot') return undefined;
      const r = await b.resolve(args.path, { resolveDir: workspace, kind: args.kind, pluginData: 'inkplot' });
      return r.errors.length ? { errors: [{ text: `cannot find "${args.path}" from ${workspace}. Run: npm i inkplot` }] } : { path: r.path };
    });
  },
});
const common: BuildOptions = {
  bundle: true, write: false, jsx: 'automatic', jsxImportSource: 'inkplot', plugins: [oneInkplot()], logLevel: 'silent', target: 'es2022',
  loader: { '.csv': 'text', '.tsv': 'text', '.txt': 'text' }, absWorkingDir: workspace,
};
const bundle = async (extra: BuildOptions, entry: string): Promise<string> => {
  try {
    const out = await build({ ...common, ...extra, stdin: { contents: entry, resolveDir: dirname(source), loader: 'ts', sourcefile: 'inkplot-scratch-entry.ts' } });
    return out.outputFiles?.[0]?.text ?? fail('esbuild produced no output');
  } catch (e) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- esbuild's build failure carries `errors`, which its types do not declare on `Error`
    const errors = (e as { errors?: Parameters<typeof formatMessages>[0] }).errors;
    if (!errors) throw e;
    return fail((await formatMessages(errors, { kind: 'error', color: false, terminalWidth: 100 })).join('\n'));
  }
};
const q = JSON.stringify;
const tmp = mkdtempSync(join(tmpdir(), 'inkplot-scratch-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const nodeCode = await bundle({ platform: 'node', format: 'esm', sourcemap: 'inline', sourcesContent: false },
  `import * as user from ${q(source)};\nimport { checkText, figuresOf, factsOf, svgOf } from ${q(join(assets, 'figures.ts'))};\nexport { checkText, factsOf, svgOf };\nexport const figures = figuresOf(user);\n`);
const file = join(tmp, 'run.mjs');
writeFileSync(file, nodeCode);
process.setSourceMapsEnabled(true);
type Run = { figures: { id: string; title: string }[]; factsOf(f: unknown, size?: object): Facts; svgOf(f: unknown, size?: object): string; checkText(f: Facts): string };
type Facts = { id: string; problems: string[] } & Record<string, unknown>;
/** What is known of a thrown value: user code may throw anything, not only an Error. */
const describeThrown = (e: unknown) => e instanceof Error ? { message: e.message, stack: e.stack ?? '' } : { message: String(e), stack: '' };
let run: Run;
// oxlint-disable-next-line typescript/consistent-type-assertions -- the user's module is checked against `Run` right after, in `figures.ts`
try { run = (await import(pathToFileURL(file).href)) as Run; } catch (e) {
  const err = describeThrown(e);
  // Frames in the person's own files first (the source map points them at the .ts lines); else the first few that are not ours or node's.
  const all = err.stack.split('\n').slice(1).filter((l) => !l.includes('node:internal') && !l.includes('bin.mjs'));
  const mine = all.filter((l) => l.includes(dirname(source)) && !l.includes('node_modules'));
  fail(`error: ${err.message}\n${(mine.length ? mine : all).slice(0, 6).join('\n')}\n`);
}

// ── 3. outputs ──
const kb = (path: string) => `${(statSync(path).size / 1024).toFixed(1)} KB`;
const shown = (path: string) => relative(workspace, path) || path;
const figures = run.figures;
let svgs: string[];
let facts: Facts[];
try {
  facts = figures.map((f) => run.factsOf(f, size));
  svgs = figures.map((f) => run.svgOf(f, size));
} catch (e) {
  const err = describeThrown(e);
  fail(`error while drawing: ${err.message}\n${err.stack.split('\n').slice(1).filter((l) => l.includes(source)).slice(0, 4).join('\n')}\n`);
}

if (check) for (const f of facts) console.log(run.checkText(f));
const dir = (path: string) => { const d = resolve(path); mkdirSync(d, { recursive: true }); return d; };
const written: string[] = [];
const svgDir = values.get('--svg'), pngDir = values.get('--png'), jsonPath = values.get('--json'), htmlPath = values.get('--html');
if (svgDir !== undefined) {
  const d = dir(svgDir);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
  figures.forEach((f, i) => { const p = join(d, `${f.id}.svg`); writeFileSync(p, svgs[i]!); written.push(`${shown(p)} (${kb(p)})`); });
}
if (pngDir !== undefined) {
  const d = dir(pngDir);
  const { renderer } = await import('./png.ts');
  const draw = await renderer(workspace, values.get('--background'), num('--scale') ?? 2);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
  figures.forEach((f, i) => { const p = join(d, `${f.id}.png`); writeFileSync(p, draw(svgs[i]!)); written.push(`${shown(p)} (${kb(p)})`); });
}
if (jsonPath !== undefined) {
  const text = JSON.stringify(facts, null, 2) + '\n';
  if (jsonPath === '-') process.stdout.write(text);
  else { const p = resolve(jsonPath); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); written.push(`${shown(p)} (${kb(p)})`); }
}
if (htmlPath !== undefined) {
  const title = values.get('--title') ?? basename(source, extname(source));
  // Whitespace and syntax are minified, names are not: an error that says which element it wanted is worth a few KB.
  const script = await bundle({ platform: 'browser', format: 'iife', minifyWhitespace: true, minifySyntax: true },
    `import * as user from ${q(source)};\nimport { mount } from ${q(join(assets, 'app.ts'))};\nmount(user, ${q(title)}, { interactive: ${on.has('--static') ? 'false' : 'true'} });\n`);
  const template = readFileSync(join(assets, 'template.html'), 'utf8');
  const html = template.replace('/*SCRIPT*/', () => script.replace(/<\/(script)/gi, '<\\/$1')).replace('<title>Charts</title>', () => `<title>${title.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)}</title>`);
  const p = resolve(htmlPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html);
  written.push(`${shown(p)} (${kb(p)})`);
}
for (const w of written) (jsonPath === '-' ? process.stderr : process.stdout).write(`wrote ${w}\n`);
for (const f of facts) for (const p of f.problems) process.stderr.write(`warning: ${f.id}: ${p}\n`);

// Builds playground.html: strips the types from every module in src/, inlines each as its own script element,
// and wires them together with an import map (see the template). The library code in the page is the library's code.
//   node build-playground.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { transformSync } from 'rolldown/utils';
import { fileURLToPath } from 'node:url';
import { bundle } from './tools/bundle.ts';

const here = (p: string) => new URL(p, import.meta.url);
const read = (p: string) => readFileSync(here(p), 'utf8');

// The framework adapters need a framework or a page of custom elements, which this page is not; they have their own tests.
const ADAPTERS = ['react.ts', 'web-components.ts', 'style-names.ts', 'adapt.ts', 'node-worker.ts'];
const files = readdirSync(here('./src/'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'fake-platform.ts' && !ADAPTERS.includes(f))
  .sort();
// The public specifier for a module: `inkplot` for the barrel, `inkplot/<name>` for the rest.
const specifier = (file: string) => (file === 'index.ts' ? 'inkplot' : `inkplot/${file.replace(/\.ts$/, '')}`);

let bytes = 0,
  scripts = '';
for (const file of files) {
  const ts = read(`./src/${file}`);
  const js = stripTypeScriptTypes(ts, { mode: 'strip' })
    .replace(/[ \t]+$/gm, '')
    .replace(/(from\s+)'\.\/([\w-]+)\.ts'/g, (_, from, name) => `${from}'${specifier(`${name}.ts`)}'`);
  if (/<\/script|<!--/i.test(js)) throw new Error(`${file} contains a sequence that would end its script element`);
  bytes += js.length;
  scripts += `<script type="text/plain" data-module="${specifier(file)}">${js}</script>\n`;
}

// The page's JSX demo: compiled here against the library's JSX runtime, and loaded like a library module.
const jsxDemo = transformSync('jsx-demo.jsx', read('./playground/jsx-demo.jsx'), {
  lang: 'jsx',
  jsx: { runtime: 'automatic', importSource: 'inkplot' },
  target: 'es2022',
}).code;
if (/<\/script|<!--/i.test(jsxDemo)) throw new Error('the JSX demo contains a sequence that would end its script element');
scripts += `<script type="text/plain" data-module="playground/jsx-demo">${jsxDemo}</script>\n`;

// The record behind the headline chart: plain data, loaded like a library module.
const gistemp = read('./playground/gistemp.js');
if (/<\/script|<!--/i.test(gistemp)) throw new Error('the temperature record contains a sequence that would end its script element');
scripts += `<script type="text/plain" data-module="playground/gistemp">${gistemp}</script>\n`;

// The worker for the Big data demo: the library's own `serveWorker` with the classes the demo sends, as a classic script (a module
// worker cannot start from a blob in a page that is opened from a file).
const workerBundle = await bundle({
  contents: `import { FlatDataSource, Decimator, MinMaxKernel, M4Kernel, LttbKernel, StrideKernel } from 'inkplot';
import { serveWorker } from 'inkplot/worker';
serveWorker({ FlatDataSource, Decimator, MinMaxKernel, M4Kernel, LttbKernel, StrideKernel });`,
  resolveDir: fileURLToPath(here('./')),
  type: 'js',
  format: 'iife',
  platform: 'browser',
  minify: true,
  alias: { inkplot: fileURLToPath(here('./src/index.ts')), 'inkplot/worker': fileURLToPath(here('./src/worker.ts')) },
});
if (/<\/script|<!--/i.test(workerBundle.code)) throw new Error('the worker contains a sequence that would end its script element');
scripts += `<script type="text/plain" id="ink-worker">${workerBundle.code}</script>\n`;

const app = read('./playground/app.js');
if (/<\/script/i.test(app)) throw new Error('the app contains </script');

const info = `${files.length} modules · ${(bytes / 1024).toFixed(0)} KB inlined · built ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;
const html = read('./playground/template.html')
  .replace('/*LIBRARY*/', () => scripts)
  .replace('/*APP*/', () => app.replace('__BUILD_INFO__', info));
writeFileSync(here('./playground.html'), html);
console.log(`playground.html  ${(html.length / 1024).toFixed(0)} KB  (${info})`);

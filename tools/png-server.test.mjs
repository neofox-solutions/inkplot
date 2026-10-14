// The "Make a PNG on a server" recipe, run as written: the js block under that heading in docs/start/recipes.md is
// extracted, pointed at the repo's own source and a font on this machine, and its output checked to be a real PNG with ink in it.
//   pnpm vp run png-server:test
// Needs `@resvg/resvg-wasm` (a devDependency; or RESVG_WASM_DIR=/path/to/package) and a TTF (or INKPLOT_TEST_FONT); skips, saying so, when either is missing.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

test('png-server', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const wasmDir = process.env.RESVG_WASM_DIR ?? join(root, 'node_modules/@resvg/resvg-wasm');
  const font = [
    process.env.INKPLOT_TEST_FONT,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/opentype/inter/Inter-Regular.otf',
    '/Library/Fonts/Arial.ttf',
    join(root, 'scratch/fonts/Inter-Regular.otf'),
  ].find((f) => f && existsSync(f));
  if (!existsSync(join(wasmDir, 'index_bg.wasm')) || !font) {
    const why = !font ? 'no font (set INKPLOT_TEST_FONT)' : 'pnpm add -D @resvg/resvg-wasm (or set RESVG_WASM_DIR)';
    if (process.env.CI) throw new Error(`png-server cannot run in CI: ${why}`); // a skipped test must not read as a pass in CI
    t.skip(why);
  }

  const docs = readFileSync(join(root, 'docs/start/recipes.md'), 'utf8');
  const section = docs.slice(docs.indexOf('## Make a PNG on a server'));
  const code = /```js\n([\s\S]*?)```/.exec(section)?.[1];
  assert(code, 'the recipe has a js block');

  const dir = mkdtempSync(join(tmpdir(), 'inkplot-png-server-'));
  mkdirSync(join(dir, 'node_modules/@resvg'), { recursive: true });
  symlinkSync(wasmDir, join(dir, 'node_modules/@resvg/resvg-wasm'));
  const run = code
    .replace(`'inkplot'`, `'${pathToFileURL(join(root, 'src/index.ts')).href}'`)
    .replace(`new URL('./Inter-Regular.ttf', import.meta.url)`, `'${font}'`)
    .replace(`defaultFontFamily: 'Inter'`, `defaultFontFamily: 'DejaVu Sans'`);
  assert(run.includes('src/index.ts') && run.includes(font), 'the recipe was pointed at the repo and a font');
  writeFileSync(join(dir, 'recipe.mjs'), run);
  writeFileSync(
    join(dir, 'main.mjs'),
    `
import { renderPng } from './recipe.mjs';
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from '${pathToFileURL(join(root, 'src/index.ts')).href}';
const chart = () => new Chart({ theme: lightTheme }, new CartesianPlane({}, new Axis({ title: 'Month' }, new LinearScale()), new Axis({}, new LinearScale()),
  new DomainSeries({}, new FlatDataSource({ data: [3, 5, 4, 8, 6] }), new LinePath({}, new LinearCurve()))));
const a = renderPng(chart(), { width: 400, height: 250, scale: 2 });
const b = renderPng(chart(), { width: 400, height: 250, scale: 1 }); // a second call: WASM is initialised once and reused
process.stdout.write(JSON.stringify([Array.from(a.subarray(0, 8)), Array.from(a.subarray(16, 24)), a.length, b.length]));
`,
  );
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [join(dir, 'main.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [sig, ihdr, big, small] = JSON.parse(r.stdout);
  assert.deepEqual(sig, [137, 80, 78, 71, 13, 10, 26, 10], 'a PNG signature');
  const dim = (b) => [(b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3], (b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]];
  assert.deepEqual(dim(ihdr), [800, 500], 'scale 2 of 400 by 250');
  assert(big > small && small > 1000, `real pixels, bigger at a larger scale (${big} / ${small})`);
});

// The React adapter in headless Chromium: a small React app is bundled with the library (esbuild) and driven through its buttons.
//   node react.test.mjs
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from './tools/browser.mjs';
import { test } from 'vite-plus/test';

test('react', async () => {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  const bundled = await build({
    entryPoints: [here('./playground/react-test/app.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'error',
    alias: {
      inkplot: here('./src/index.ts'),
      'inkplot/react': here('./src/react.ts'),
      'inkplot/jsx-runtime': here('./src/jsx-runtime.ts'),
      'inkplot/jsx-dev-runtime': here('./src/jsx-dev-runtime.ts'),
    },
  });
  const dir = mkdtempSync(tmpdir() + '/inkplot-react-');
  writeFileSync(
    `${dir}/index.html`,
    `<!doctype html><meta charset="utf-8"><div id="app"></div><script>${bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const problems = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.goto(pathToFileURL(`${dir}/index.html`).href);
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForSelector('#react svg path');
  await settle();

  const lines = () =>
    page.evaluate(() => [...document.querySelectorAll('#react svg path[stroke-width="3"]')].map((p) => p.getAttribute('stroke')));
  const labels = () => page.evaluate(() => [...document.querySelectorAll('#react svg text')].map((t) => t.textContent));
  assert.deepEqual(await lines(), ['#2a6fdb', '#d9534f'], 'two series from state');
  assert.ok(
    !(await labels()).includes('Index'),
    'the axis title is not drawn unless `title` is set; meta-title is its name for assistive technology',
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('#react svg [aria-label="Index"]') !== null),
    true,
    'meta-title reached the DOM',
  );

  await page.click('#add');
  await settle();
  assert.deepEqual(await lines(), ['#2a6fdb', '#d9534f', '#2e9e6b'], 'a series added by state');
  await page.click('#drop');
  await page.click('#drop');
  await settle();
  assert.deepEqual(await lines(), ['#2a6fdb'], 'and removed again');
  const before = await labels();
  await page.click('#log');
  await settle();
  assert.notDeepEqual(await labels(), before, 'swapping the scale changed the ticks');
  await page.click('#log');
  await settle();
  assert.deepEqual(await labels(), before, 'and back');

  // The platform follows the host div as React resizes it.
  assert.equal(await page.evaluate(() => document.querySelector('#react svg').getAttribute('width')), '600');
  await page.click('#narrow');
  await settle();
  await settle();
  assert.equal(await page.evaluate(() => document.querySelector('#react svg').getAttribute('width')), '300');

  // A chart built with the vanilla JSX runtime, shown through ChartView.
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll('#vanilla svg path')].map((p) => p.getAttribute('stroke')).filter((c) => c === '#2e9e6b'),
    ),
    ['#2e9e6b'],
  );
  await page.screenshot({ path: new URL('./shots/react.png', import.meta.url).pathname });
  await browser.close();
  assert.deepEqual(problems, [], 'no console errors or warnings');
});

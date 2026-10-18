// The Web Components adapter in headless Chromium, with the page written as plain HTML (what pre-rendering gives):
// the library is bundled once, the tags are defined, and the markup draws, follows attribute changes and DOM edits, and emits events.
//   node webcomponents.test.mjs
import { bundle } from './tools/bundle.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from './tools/browser.mjs';
import { test } from 'vite-plus/test';

test('webcomponents', async () => {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  const bundled = await bundle({
    resolveDir: here('./'),
    type: 'js',
    contents: `
      import * as L from './src/index.ts';
      import { defineElements } from './src/web-components.ts';
      defineElements({ Chart: L.Chart, ChartTitle: L.ChartTitle, CartesianPlane: L.CartesianPlane, Axis: L.Axis, LinearScale: L.LinearScale, LogScale: L.LogScale,
        DomainSeries: L.DomainSeries, FlatDataSource: L.FlatDataSource, LinePath: L.LinePath, LinearCurve: L.LinearCurve, PointerListener: L.PointerListener, Legend: L.Legend }, { prefix: 'ch' });
      document.querySelector('ch-chart').props = { theme: L.lightTheme };
      window.ready = true;`,
    format: 'iife',
    platform: 'browser',
  });
  const html = `<!doctype html><meta charset="utf-8">
<style>ch-chart { display: block; width: 600px; height: 280px }</style>
<ch-chart id="chart" meta-title="Sales by month">
  <ch-chart-title text="Sales"></ch-chart-title>
  <ch-cartesian-plane id="plane">
    <ch-axis orientation="bottom" tickcount="4" meta-title="Month"><ch-linear-scale></ch-linear-scale></ch-axis>
    <ch-axis orientation="left" nice style-ticklabel-size="14"><ch-linear-scale></ch-linear-scale></ch-axis>
    <ch-domain-series id="a" name="2024">
      <ch-flat-data-source data="[1,3,2,5,4]" regulardomain-start="0" regulardomain-step="1"></ch-flat-data-source>
      <ch-line-path stroke="#2a6fdb" strokewidth="3"><ch-linear-curve></ch-linear-curve></ch-line-path>
    </ch-domain-series>
    <ch-pointer-listener id="listener"></ch-pointer-listener>
  </ch-cartesian-plane>
  <ch-legend></ch-legend>
</ch-chart>
<script>${bundled.code.replace(/<\/script/gi, '<\\/script')}</script>`;
  const dir = mkdtempSync(tmpdir() + '/inkplot-wc-');
  writeFileSync(`${dir}/index.html`, html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const problems = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.goto(pathToFileURL(`${dir}/index.html`).href);
  await page.waitForFunction(() => window.ready);
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await settle();

  const svg = (js) =>
    page.evaluate(`(() => { const svg = document.querySelector('#chart').shadowRoot.querySelector('svg'); return (${js})(svg); })()`);
  const lines = () =>
    svg((s) =>
      [...s.querySelectorAll('path[stroke-width="3"]')]
        .filter((p) => (p.getAttribute('d') ?? '').length > 40)
        .map((p) => p.getAttribute('stroke')),
    );
  assert.equal(await svg((s) => s.getAttribute('width')), '600', 'drawn at the size the page gave the tag');
  assert.deepEqual(await lines(), ['#2a6fdb'], 'the series from the markup: strokewidth found strokeWidth');
  assert.equal(await svg((s) => s.querySelector('[aria-label="Month"]') !== null), true, 'meta-title became the axis name');
  assert.ok(
    await svg((s) => [...s.querySelectorAll('g[font-size="14"]')].length > 0),
    'style-ticklabel-size reached the labels of the second axis',
  );
  await page.screenshot({ path: new URL('./shots/webcomponents.png', import.meta.url).pathname });

  // An attribute changed in the page reaches the chart.
  await page.evaluate(() => document.querySelector('#a ch-line-path').setAttribute('stroke', '#d9534f'));
  await settle();
  await settle();
  assert.deepEqual(await lines(), ['#d9534f'], 'a changed attribute is drawn');

  // A series added to the markup, with JS, joins the chart in place; removed, it goes.
  await page.evaluate(() => {
    const copy = document.querySelector('#a').cloneNode(true);
    copy.id = 'b';
    copy.querySelector('ch-line-path').setAttribute('stroke', '#2e9e6b');
    document.querySelector('#plane').insertBefore(copy, document.querySelector('#a'));
  });
  await settle();
  await settle();
  assert.deepEqual(await lines(), ['#2e9e6b', '#d9534f'], 'in document order');
  await page.evaluate(() => document.querySelector('#b').remove());
  await settle();
  await settle();
  assert.deepEqual(await lines(), ['#d9534f']);

  // Events: a listener on the tag receives the chart's callbacks as DOM events.
  await page.evaluate(() => {
    window.clicks = [];
    document.querySelector('#listener').addEventListener('ch-click', (e) => window.clicks.push(e.detail.type ?? 'click'));
  });
  const box = await page.evaluate(() => {
    const r = document.querySelector('#chart').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await settle();
  assert.ok((await page.evaluate(() => window.clicks.length)) >= 1, 'a click on the plot reached the listener tag as an event');

  // A real removal and return of the whole chart.
  await page.evaluate(() => {
    window.saved = document.querySelector('#chart');
    window.saved.remove();
  });
  assert.equal(await page.evaluate(() => window.saved.element.isAttached), false);
  await page.evaluate(() => document.body.append(window.saved));
  await settle();
  assert.deepEqual(await lines(), ['#d9534f'], 'drawn again when it returns');
  await browser.close();
  assert.deepEqual(problems, [], 'no console errors or warnings');
});

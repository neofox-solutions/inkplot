// Touch, trackpad pinch and axis strips in headless Chromium, with real pointer, touch and wheel events.
//   node touch.test.mjs
import { bundle } from './tools/bundle.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from './tools/browser.mjs';
import { test } from 'vite-plus/test';

test('touch', async () => {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  const bundled = await bundle({
    entry: here('./playground/touch-test/app.ts'),
    format: 'iife',
    platform: 'browser',
    alias: { inkplot: here('./src/index.ts') },
  });
  const dir = mkdtempSync(tmpdir() + '/inkplot-touch-');
  writeFileSync(
    `${dir}/index.html`,
    `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="host" style="width:800px;height:400px"></div><script>${bundled.code.replace(/<\/script/gi, '<\\/script')}</script>`,
  );

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
  const problems = [];
  const open = async (hash) => {
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    await page.goto(pathToFileURL(`${dir}/index.html`).href + hash);
    await page.waitForSelector('svg path');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page;
  };
  const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const span = (page, axis) =>
    page.evaluate((a) => {
      const r = window[a].range;
      return r.max - r.min;
    }, axis);
  const sessions = new WeakMap();
  const touches = async (page, points, type) => {
    if (!sessions.has(page)) sessions.set(page, await context.newCDPSession(page));
    await sessions.get(page).send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  };

  {
    // Trackpad pinch: wheel events with ctrlKey and small deltas must zoom usefully.
    const page = await open('');
    const before = await span(page, 'xAxis');
    await page.evaluate(() => {
      const svg = document.querySelector('svg');
      for (let i = 0; i < 10; i++)
        svg.dispatchEvent(
          new WheelEvent('wheel', { deltaY: -4, ctrlKey: true, clientX: 400, clientY: 150, bubbles: true, cancelable: true }),
        );
    });
    await settle(page);
    const ratio = (await span(page, 'xAxis')) / before;
    assert.ok(ratio < 0.55 && ratio > 0.35, `ten 4px pinch steps zoom to under half: ${ratio}`);
    // Over the bottom axis strip only x zooms.
    const y0 = await span(page, 'yAxis');
    const box = await page.evaluate(() => {
      const p = window.chart.children?.[0] ?? [...window.chart][0];
      return { ...p.rect };
    });
    await page.evaluate((b) => {
      const svg = document.querySelector('svg');
      svg.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -200, clientX: b.x + 100, clientY: b.y + b.height + 8, bubbles: true, cancelable: true }),
      );
    }, box);
    await settle(page);
    assert.equal(await span(page, 'yAxis'), y0, 'a wheel turn on the x axis strip leaves y alone');
    await page.close();
  }

  {
    // Two fingers pinch; one finger leaves the page to scroll (touch-action allows it).
    const page = await open('');
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.querySelector('svg')).touchAction),
      'pan-x pan-y',
      'the page keeps one-finger scrolling',
    );
    const box = await page.evaluate(() => ({ ...[...window.chart][0].rect }));
    const cx = box.x + box.width / 2,
      cy = box.y + box.height / 2;
    const before = await span(page, 'xAxis');
    await touches(
      page,
      [
        [cx - 50, cy],
        [cx + 50, cy],
      ],
      'touchStart',
    );
    for (let i = 1; i <= 6; i++)
      await touches(
        page,
        [
          [cx - 50 - i * 20, cy],
          [cx + 50 + i * 20, cy],
        ],
        'touchMove',
      );
    await touches(page, [], 'touchEnd');
    await settle(page);
    const after = await span(page, 'xAxis');
    assert.ok(after < before * 0.7, `two spreading fingers zoom in: ${before} → ${after}`);
    assert.equal((await span(page, 'yAxis')) > 0, true);
    await page.close();
  }

  {
    // A chart nothing in it listens to is a picture: the page keeps every touch and the wheel.
    const page = await open('#static');
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.querySelector('svg')).touchAction),
      'auto',
      'a static chart does not trap touches',
    );
    assert.equal(await page.evaluate(() => window.chart.input), null, 'and has no input host');
    await page.close();
  }

  {
    const page = await open('#always');
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.querySelector('svg')).touchAction),
      'none',
      "touch: 'always' takes every touch",
    );
    const box = await page.evaluate(() => ({ ...[...window.chart][0].rect }));
    const cx = box.x + box.width / 2,
      cy = box.y + box.height / 2;
    await touches(
      page,
      [
        [cx - 50, cy],
        [cx + 50, cy],
      ],
      'touchStart',
    );
    for (let i = 1; i <= 5; i++)
      await touches(
        page,
        [
          [cx - 50 - i * 20, cy],
          [cx + 50 + i * 20, cy],
        ],
        'touchMove',
      );
    await touches(page, [], 'touchEnd');
    await settle(page);
    const zoomed = await page.evaluate(() => window.xAxis.range.min);
    await touches(page, [[cx, cy]], 'touchStart');
    for (let i = 1; i <= 5; i++) await touches(page, [[cx + i * 20, cy]], 'touchMove');
    await touches(page, [], 'touchEnd');
    await settle(page);
    assert.ok((await page.evaluate(() => window.xAxis.range.min)) < zoomed, 'one finger pans the zoomed chart');
    await page.close();
  }

  await browser.close();
  assert.deepEqual(problems, [], 'no page errors');
});

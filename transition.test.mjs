// Transitions in headless Chromium: a data change eases the shapes of the chart, other changes do not, and reduced motion or no
// `transition` attribute means no easing at all.
//   node transition.test.mjs
import { bundle } from './tools/bundle.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from './tools/browser.mjs';
import { test } from 'vite-plus/test';

const APP = `
import { Axis, CartesianPlane, Chart, DOMPlatform, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, BarPath, Entrance, lightTheme, moveView } from 'inkplot';
const hash = location.hash.slice(1);
const data = new Float64Array([1, 3, 2, 5, 4]);
const source = new FlatDataSource({ data, regularDomain: { start: 0, step: 1 } });
const x = new Axis({ orientation: 'bottom', min: 0, max: 4 }, new LinearScale());
const y = new Axis({ orientation: 'left', min: 0, max: 12 }, new LinearScale());
const enter = hash.startsWith('enter');
const renderer = hash === 'enter-bars' ? new BarPath({}) : new LinePath(new LinearCurve());
const chart = new Chart(
  { theme: lightTheme, ...(hash === 'off' ? {} : { transition: { duration: 800, easing: 'linear' } }) },
  new CartesianPlane({}, x, y, new DomainSeries({}, source, renderer)),
  ...(enter ? [new Entrance({ duration: 800, easing: 'linear' })] : []),
);
chart.attach(new DOMPlatform(document.getElementById('host'), { size: { width: 400, height: 200 }, preciseText: false }));
Object.assign(window, { chart, source, data, x, y, moveView });
`;

test('transition', async () => {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  const bundled = await bundle({
    contents: APP,
    resolveDir: here('./'),
    format: 'iife',
    platform: 'browser',
    alias: { inkplot: here('./src/index.ts') },
  });
  const dir = mkdtempSync(tmpdir() + '/inkplot-transition-');
  writeFileSync(
    `${dir}/index.html`,
    `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="host" style="width:400px;height:200px"></div><script>${bundled.code.replace(/<\/script/gi, '<\\/script')}</script>`,
  );

  const browser = await chromium.launch();
  const problems = [];
  const open = async (hash, reducedMotion = 'no-preference') => {
    const context = await browser.newContext({ viewport: { width: 500, height: 300 }, reducedMotion });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    await page.goto(pathToFileURL(`${dir}/index.html`).href + '#' + hash);
    await page.waitForSelector('svg path');
    await frames(page);
    return page;
  };
  const frames = (page, n = 2) =>
    page.evaluate(
      (count) =>
        new Promise((resolve) => {
          const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
          step(count);
        }),
      n,
    );
  // The series' line is the path whose shape follows the data: the one that changes with it. `shown` is what is on screen this
  // instant (the computed `d`), `final` what was written (the attribute).
  const line = (page) =>
    page.evaluate(() => {
      const paths = [...document.querySelectorAll('svg path')].filter((p) => /^M[\d. -]+L[\d. -]+$/.test(p.getAttribute('d') ?? ''));
      const p = paths[paths.length - 1];
      return { shown: getComputedStyle(p).d, final: 'path("' + p.getAttribute('d') + '")', morph: p.getAttribute('d') };
    });
  // The numbers of a path, to compare shapes whatever the commands are spelled like.
  const norm = (d) => (d.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map((n) => Number(n).toFixed(1)).join(' ');
  const sameShape = (l) => norm(l.shown) === norm(l.final);

  try {
    // A data change eases: partway through, the shape on screen is not yet the one that was written; later it is.
    {
      const page = await open('on');
      assert.equal(
        await page.evaluate(() => document.querySelector('svg').hasAttribute('data-ink-t')),
        false,
        'the first draw does not ease',
      );
      await page.evaluate(() => {
        window.data[2] = 10;
        window.source.invalidate();
      });
      await frames(page, 3);
      await page.waitForTimeout(150);
      const mid = await line(page);
      assert.ok(!sameShape(mid), `partway through a data change the shape is between: ${mid.shown} vs ${mid.final}`);
      await page.waitForTimeout(900);
      assert.ok(sameShape(await line(page)), 'it arrives');
      assert.equal(await page.evaluate(() => document.querySelector('svg').hasAttribute('data-ink-t')), true);

      // Zooming is not a data change: immediate, and it ends the easing (the attribute is taken off).
      await page.evaluate(() => {
        window.x.setAttributes({ min: 1, max: 3 });
      });
      await frames(page, 3);
      assert.ok(sameShape(await line(page)), 'a view change is immediate');
      assert.equal(await page.evaluate(() => document.querySelector('svg').hasAttribute('data-ink-t')), false);
    }
    // A view that jumps on purpose eases too, and arrives exactly.
    {
      const page = await open('on');
      await page.evaluate(() => window.moveView(window.y, { min: 2, max: 4 }));
      await frames(page, 3);
      await page.waitForTimeout(250);
      const mid = await page.evaluate(() => window.y.range);
      assert.ok(mid.min > 0 && mid.min < 2 && mid.max < 12 && mid.max > 4, `partway the range is between: ${JSON.stringify(mid)}`);
      await page.waitForTimeout(1000);
      assert.deepEqual(await page.evaluate(() => window.y.range), { min: 2, max: 4 });
    }
    // An entrance: a line is drawn on from the left (a clip that opens), bars grow from their baseline (a scale from nothing); both end
    // on the drawing itself, and no `enter` means no entrance.
    {
      const group = (page) =>
        page.evaluate(() => {
          const g = document.querySelector('svg g[data-ink-enter]');
          if (!g) return null;
          const c = getComputedStyle(g);
          return { kind: g.getAttribute('data-ink-enter'), clip: c.clipPath, transform: c.transform, attr: g.getAttribute('clip-path') };
        });
      const line = await open('enter');
      const start = await group(line);
      assert.equal(start?.kind, 'sweep');
      assert.ok(start.clip.startsWith('inset('), `the clip is opening: ${start.clip}`);
      await line.waitForTimeout(1100);
      const after = await group(line);
      assert.ok(after.clip.startsWith('url('), `and has given way to the plot's own clip: ${after.clip}`);

      const bars = await open('enter-bars');
      const grow = await group(bars);
      assert.equal(grow?.kind, 'grow-y');
      assert.notEqual(grow.transform, 'none', `bars start scaled: ${grow.transform}`);
      await bars.waitForTimeout(1100);
      assert.equal((await group(bars)).transform, 'none', 'and end at full size');

      const plain = await open('on');
      assert.equal(await group(plain), null, 'without `enter` there is no entrance');
    }
    // No `transition`: nothing is written for it and nothing eases.
    {
      const page = await open('off');
      await page.evaluate(() => {
        window.data[2] = 10;
        window.source.invalidate();
      });
      await frames(page, 3);
      assert.ok(sameShape(await line(page)), 'without the attribute a data change is immediate');
      assert.equal(await page.evaluate(() => document.querySelector('svg style')), null, 'and no rule is added');
    }
    // Reduced motion switches it off with no script.
    {
      const page = await open('on', 'reduce');
      await page.evaluate(() => {
        window.data[2] = 10;
        window.source.invalidate();
      });
      await frames(page, 3);
      await page.waitForTimeout(100);
      assert.ok(sameShape(await line(page)), 'with reduced motion a data change is immediate');
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(problems, []);
});

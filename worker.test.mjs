// A WorkerBoundary on a real Web Worker, in headless Chromium: the page starts with empty axes and the points arrive, panning a
// 10 million point line does not block the main thread, and a worker that fails is an error. The worker is the library's own
// `serveWorker` bundled with the three classes it needs.
//   node worker.test.mjs
import { bundle } from './tools/bundle.ts';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from './tools/browser.mjs';
import { test } from 'vite-plus/test';

const WORKER = `
import { FlatDataSource, Decimator, MinMaxKernel } from 'inkplot';
import { serveWorker } from 'inkplot/worker';
serveWorker({ FlatDataSource, Decimator, MinMaxKernel });
`;
const APP = `
import { Axis, CartesianPlane, Chart, DOMPlatform, DomainSeries, FlatDataSource, Decimator, MinMaxKernel, LinePath, LinearCurve, LinearScale, WebWorker, WorkerBoundary, lightTheme } from 'inkplot';
const N = 10_000_000;
const registry = { FlatDataSource, Decimator, MinMaxKernel };
const ys = new Float64Array(N);
for (let i = 0; i < N; i++) ys[i] = Math.sin(i / 20000) * 10 + Math.sin(i / 37) * (i % 5000 === 0 ? 4 : 1);
const source = (data = ys) => new Decimator({}, new MinMaxKernel(), new FlatDataSource({ data, regularDomain: { start: 0, step: 1 } }));
const workerUrl = URL.createObjectURL(new Blob([window.WORKER_CODE], { type: 'text/javascript' }));
const worker = new WebWorker(workerUrl);
const boundary = new WorkerBoundary({ worker, registry, transfer: true }, source());
const x = new Axis({ orientation: 'bottom', min: 0, max: N }, new LinearScale());
const y = new Axis({ orientation: 'left', min: -15, max: 15 }, new LinearScale());
const chart = new Chart({ theme: lightTheme }, new CartesianPlane({}, x, y, new DomainSeries({}, boundary, new LinePath(new LinearCurve()))));
chart.attach(new DOMPlatform(document.getElementById('host'), { size: { width: 600, height: 300 }, preciseText: false }));
const atFirst = { arrived: boundary.arrived, points: boundary.pointCount, paths: document.querySelectorAll('svg path').length };
const bad = new WebWorker(URL.createObjectURL(new Blob(['throw new Error("boom")'], { type: 'text/javascript' })));
const lost = new WorkerBoundary({ worker: bad, registry }, source(new Float64Array(10)));
boundary.settledFor = 0;
Object.assign(window, { atFirst, chart, boundary, lost, x, N, ys });
`;

test('worker boundary on a real Web Worker', async () => {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  const alias = { inkplot: here('./src/index.ts'), 'inkplot/worker': here('./src/worker.ts') };
  const worker = await bundle({ contents: WORKER, resolveDir: here('./'), format: 'iife', platform: 'browser', alias, minify: true });
  const app = await bundle({ contents: APP, resolveDir: here('./'), format: 'iife', platform: 'browser', alias });
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="host" style="width:600px;height:300px"></div><script>window.WORKER_CODE=${safe(JSON.stringify(worker.code))}</script><script>${safe(app.code)}</script>`;
  // Served over http: a page from a file has an opaque origin, which a worker made from a blob cannot be started in.
  const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const browser = await chromium.launch();
  const problems = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 700, height: 400 } })).newPage();
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    // The page is up at once with no points; the line comes when the worker has answered.
    await page.waitForSelector('svg');
    const first = await page.evaluate(() => window.atFirst);
    assert.ok(!first.arrived && first.points === 0, 'the first paint has no points');
    await page
      .waitForFunction(() => window.boundary.arrived && !window.boundary.pending, null, { timeout: 15_000 })
      .catch(async (e) => {
        const state = await page.evaluate(() => ({
          arrived: window.boundary.arrived,
          pending: window.boundary.pending,
          n: window.boundary.pointCount,
          len: window.ys.length,
        }));
        throw new Error(e.message + ' ' + JSON.stringify(state) + ' ' + problems.join('; '));
      });
    // A flush after an answer may ask for more (the first ask was made before the axes knew the data): flush until it does not.
    await page.waitForFunction(() => (window.chart.flush(), window.boundary.pending === false && window.boundary.settledFor++ > 2), null, {
      timeout: 15_000,
    });
    const drawn = await page.evaluate(() => {
      const p =
        [...document.querySelectorAll('svg path')]
          .map((e) => e.getAttribute('d') ?? '')
          .filter((d) => /^M[\d. -]+L[\d. -]+$/.test(d))
          .pop() ?? '';
      return { points: (p.match(/-?[\d.]+/g) ?? []).length / 2, count: window.boundary.pointCount, detached: window.ys.length };
    });
    assert.equal(drawn.count, 10_000_000);
    assert.ok(drawn.points > 500 && drawn.points < 3000, `${drawn.points} points are drawn for 10 million`);
    assert.equal(drawn.detached, 0, 'the array moved to the worker');

    // Pan across the data for a few seconds, a view per frame, and look at what the main thread did meanwhile.
    const pan = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const long = [];
          new PerformanceObserver((l) => long.push(...l.getEntries().map((e) => e.duration))).observe({ entryTypes: ['longtask'] });
          const frames = [];
          let last = performance.now(),
            n = 0,
            answers = 0;
          const stop = window.chart.attrs.onFlush;
          const step = (now) => {
            frames.push(now - last);
            last = now;
            const lo = (n * 120_000) % 8_000_000;
            window.x.setAttributes({ min: lo, max: lo + 2_000_000 });
            const t0 = performance.now();
            window.chart.flush();
            frames.work = Math.max(frames.work ?? 0, performance.now() - t0);
            if (++n < 180) requestAnimationFrame(step);
            else setTimeout(() => resolve({ worst: Math.max(...frames.slice(1)), work: frames.work, long, answers }), 100);
          };
          requestAnimationFrame(step);
        }),
    );
    console.log(`pan: worst frame ${pan.worst.toFixed(1)} ms, worst flush ${pan.work.toFixed(1)} ms, long tasks ${pan.long.length}`);
    assert.equal(pan.long.length, 0, `the main thread never blocked for 50 ms: ${pan.long.join(', ')}`);
    assert.ok(pan.work < 20, `a flush takes ${pan.work} ms`);

    // A worker that cannot start is an error for the boundary that asked of it.
    const message = await page.evaluate(async () => {
      const ctx = { width: 600, height: 300, domainRange: { min: 0, max: 1 }, channels: [] };
      window.lost.plan(ctx);
      await new Promise((r) => setTimeout(r, 300));
      try {
        window.lost.plan(ctx);
        return 'no error';
      } catch (e) {
        return String(e.message);
      }
    });
    assert.ok(/the worker failed/.test(message), 'lost: ' + message);
  } finally {
    await browser.close();
    server.close();
  }
  // The worker's own script failing to load is logged by the browser as well: that is the one thing allowed to be reported.
  assert.deepEqual(
    problems.filter((p) => !/boom/.test(p)),
    [],
  );
}, 120_000);

// A WorkerBoundary on a real Web Worker, in headless Chromium: the page starts with empty axes and the points arrive, panning a
// 10 million point line does not block the main thread, and a worker that fails is an error. The worker is the library's own
// `serveWorker` bundled with the three classes it needs.
//   node worker.test.mjs
import { bundle } from './tools/bundle.ts';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from './tools/browser.mjs';
import { test } from 'vite-plus/test';
import {
  Axis,
  CartesianPlane,
  Chart,
  DomainSeries,
  FlatDataSource,
  Decimator,
  MinMaxKernel,
  LinePath,
  LinearCurve,
  LinearScale,
  StringPlatform,
  WorkerBoundary,
  lightTheme,
} from './src/index.ts';
import { NodeWorker } from './src/node-worker.ts';

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
const atFirst = { arrived: boundary.arrived, points: boundary.pointCount, paths: document.querySelectorAll('#host svg path').length };
const bad = new WebWorker(URL.createObjectURL(new Blob(['throw new Error("boom")'], { type: 'text/javascript' })));
const lost = new WorkerBoundary({ worker: bad, registry }, source(new Float64Array(10)));
// Arrays on a SharedArrayBuffer are not copied, and an edit in place reaches the worker on refresh() (this page is cross-origin isolated).
const sharedData = new Float64Array(new SharedArrayBuffer(8 * 200_000));
for (let i = 0; i < sharedData.length; i++) sharedData[i] = Math.sin(i / 300) * 5;
const sharedBoundary = new WorkerBoundary({ worker, registry, shared: true }, source(sharedData));
const sharedChart = new Chart({ theme: lightTheme }, new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()), new DomainSeries({}, sharedBoundary, new LinePath(new LinearCurve()))));
sharedChart.attach(new DOMPlatform(document.getElementById('shared'), { size: { width: 300, height: 150 }, preciseText: false }));
const again = () => new WorkerBoundary({ worker, registry }, source());
Object.assign(window, { sharedData, sharedBoundary, sharedChart, isolated: crossOriginIsolated, again, atFirst, chart, boundary, lost, x, N, ys });
`;

test('worker boundary on a real Web Worker', async () => {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  const alias = { inkplot: here('./src/index.ts'), 'inkplot/worker': here('./src/worker.ts') };
  const worker = await bundle({ contents: WORKER, resolveDir: here('./'), format: 'iife', platform: 'browser', alias, minify: true });
  const app = await bundle({ contents: APP, resolveDir: here('./'), format: 'iife', platform: 'browser', alias });
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="host" style="width:600px;height:300px"></div><div id="shared" style="width:300px;height:150px"></div><script>window.WORKER_CODE=${safe(JSON.stringify(worker.code))}</script><script>${safe(app.code)}</script>`;
  // Served over http: a page from a file has an opaque origin, which a worker made from a blob cannot be started in.
  const server = createServer((req, res) =>
    res
      .writeHead(200, {
        'content-type': 'text/html',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      })
      .end(html),
  );
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
    await page.evaluate(() => window.chart.idle());
    const drawn = await page.evaluate(() => {
      const p =
        [...document.querySelectorAll('#host svg path')]
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

    const edited = await page.evaluate(async () => {
      await window.sharedChart.idle();
      const before = window.sharedBoundary.valueExtent();
      for (let i = 0; i < window.sharedData.length; i++) window.sharedData[i] *= 3;
      window.sharedBoundary.refresh();
      await window.sharedChart.idle();
      return { isolated: window.isolated, before, after: window.sharedBoundary.valueExtent(), length: window.sharedData.length };
    });
    assert.ok(edited.isolated, 'the page is cross-origin isolated');
    assert.equal(edited.length, 200_000, 'a shared array stays with the page');
    assert.ok(Math.abs(edited.after.max - 3 * edited.before.max) < 1e-9, `${edited.before.max} then ${edited.after.max}`);

    // The array is in the worker now: using it in another boundary says why it fails.
    const reused = await page.evaluate(() => {
      try {
        return String(window.again().pointCount);
      } catch (e) {
        return e.message;
      }
    });
    assert.ok(/moved to another thread/.test(reused), 'reused: ' + reused);

    // A worker that cannot start is an error for the boundary that asked of it.
    const message = await page.evaluate(async () => {
      const ctx = { width: 600, height: 300, domainRange: { min: 0, max: 1 }, columns: ['domain', 'value'] };
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

test('worker boundary on a Node worker thread', async () => {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  const entry = `
import { parentPort } from 'node:worker_threads';
import { FlatDataSource, Decimator, MinMaxKernel } from 'inkplot';
import { serveWorker } from 'inkplot/worker';
serveWorker({ FlatDataSource, Decimator, MinMaxKernel }, { port: parentPort });
`;
  const built = await bundle({
    contents: entry,
    resolveDir: here('./'),
    format: 'esm',
    platform: 'node',
    alias: { inkplot: here('./src/index.ts'), 'inkplot/worker': here('./src/worker.ts') },
  });
  const file = join(mkdtempSync(tmpdir() + '/inkplot-node-worker-'), 'worker.mjs');
  writeFileSync(file, built.code);

  const N = 2_000_000;
  const ys = new Float64Array(N);
  for (let i = 0; i < N; i++) ys[i] = Math.sin(i / 5000) * 10;
  const registry = { FlatDataSource, Decimator, MinMaxKernel };
  const worker = new NodeWorker(file);
  const boundary = new WorkerBoundary(
    { worker, registry, transfer: true },
    new Decimator({}, new MinMaxKernel(), new FlatDataSource({ data: ys, regularDomain: { start: 0, step: 1 } })),
  );
  const series = new DomainSeries({}, boundary, new LinePath(new LinearCurve()));
  const chart = new Chart(
    { theme: lightTheme, width: 500, height: 200 },
    new CartesianPlane({}, new Axis({}, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()), series),
  );
  const platform = new StringPlatform({ width: 500, height: 200 });
  try {
    chart.attach(platform).flush();
    await chart.idle();
    assert.equal(ys.length, 0, 'the array moved to the worker thread');
    assert.equal(boundary.pointCount, N);
    const plane = chart.firstChild;
    assert.ok(plane.series[0].points.count > 100 && plane.series[0].points.count < 2000, `${plane.series[0].points.count} points`);
    // A worker that fails to start is an error for the boundary that asked of it.
    const bad = new WorkerBoundary(
      { worker: new NodeWorker(join(tmpdir(), 'inkplot-no-such-worker.mjs')), registry },
      new Decimator({}, new MinMaxKernel(), new FlatDataSource({ data: new Float64Array(10) })),
    );
    const other = new Chart(
      { theme: lightTheme, width: 100, height: 100 },
      new CartesianPlane(
        {},
        new Axis({}, new LinearScale()),
        new Axis({ orientation: 'left' }, new LinearScale()),
        new DomainSeries({}, bad, new LinePath(new LinearCurve())),
      ),
    );
    other.attach(new StringPlatform({ width: 100, height: 100 })).flush();
    await assert.rejects(other.idle(), /the worker (failed|exited)/);
  } finally {
    worker.terminate();
  }
}, 60_000);

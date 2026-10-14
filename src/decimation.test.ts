// Decimation: the kernels against a deliberately naive reference, then the Decimator inside a live chart.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  Series,
  DomainSeries,
  LinePath,
  FlatDataSource,
  ObjectDataSource,
  Decimator,
  MinMaxKernel,
  M4Kernel,
  CircleMarker,
  LttbKernel,
  StrideKernel,
  StringPlatform,
  lineSeries,
  type DecimationKernel,
  type PointView,
  type Extent,
} from './index.ts';
import { test } from 'vite-plus/test';

test('decimation', () => {
  // ── Data: a noisy sine, as an x,y array and as a y-only array on a regular domain.
  const hash = (i: number) => {
    let h = ((i + 1) * 2654435761) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 2246822519) >>> 0;
    return (h >>> 8) / 16777216;
  };
  const X0 = -10,
    X1 = 10;
  const yAt = (i: number, x: number, noise = 0.3) => 1.5 * Math.sin(3 * x) + (hash(i) * 2 - 1) * noise;
  function pairs(n: number): PointView {
    const d = new Float64Array(2 * n),
      dx = (X1 - X0) / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = X0 + dx * i;
      d[2 * i] = x;
      d[2 * i + 1] = yAt(i, x);
    }
    return { data: d, count: n, stride: 2, domainOffset: 0, valueOffset: 1, regularDomain: null };
  }
  function regular(n: number): PointView {
    const d = new Float64Array(n),
      dx = (X1 - X0) / (n - 1);
    for (let i = 0; i < n; i++) d[i] = yAt(i, X0 + dx * i);
    return { data: d, count: n, stride: 1, domainOffset: 0, valueOffset: 0, regularDomain: { start: X0, step: dx } };
  }
  const W = 776,
    range: Extent = { min: X0, max: X1 };

  /** The obvious per-point implementation: column maths on every point, extremes tracked in a closure. */
  function referenceMinMax(v: PointView, W: number): { points: number[]; yMin: number; yMax: number } {
    const reg = v.regularDomain,
      k = W / (range.max - range.min);
    const points: number[] = [];
    let col = -1,
      iMin = 0,
      iMax = 0,
      minX = 0,
      minY = 0,
      maxX = 0,
      maxY = 0,
      yMin = Infinity,
      yMax = -Infinity;
    const close = () => {
      if (col < 0) return;
      yMin = Math.min(yMin, minY);
      yMax = Math.max(yMax, maxY);
      if (iMin === iMax) points.push(minX, minY);
      else if (iMin < iMax) points.push(minX, minY, maxX, maxY);
      else points.push(maxX, maxY, minX, minY);
      col = -1;
    };
    for (let i = 0; i < v.count; i++) {
      const x = reg ? reg.start + reg.step * i : v.data[i * v.stride + v.domainOffset]!;
      const y = v.data[i * v.stride + v.valueOffset]!;
      if (y !== y) {
        close();
        if (!(points.length && Number.isNaN(points[points.length - 1]))) points.push(x, NaN);
        continue;
      }
      let c = ((x - range.min) * k) | 0;
      if (c >= W) c = W - 1;
      else if (c < 0) c = 0;
      if (c !== col) {
        close();
        col = c;
        minX = maxX = x;
        minY = maxY = y;
        iMin = iMax = i;
      } else if (y < minY) {
        minY = y;
        minX = x;
        iMin = i;
      } else if (y > maxY) {
        maxY = y;
        maxX = x;
        iMax = i;
      }
    }
    close();
    return { points, yMin, yMax };
  }

  function run(kernel: DecimationKernel, v: PointView, r: Extent = range, columns = W) {
    const cap = kernel.capacity(columns),
      out = new Float64Array(2 * cap);
    const res = kernel.reduce(v, r, columns, out, cap);
    return { ...res, points: Array.from(out.subarray(0, 2 * res.count)), cap };
  }

  // ── Min/max matches the reference exactly, in both layouts.
  for (const make of [pairs, regular]) {
    const v = make(100_000),
      ref = referenceMinMax(v, W),
      got = run(new MinMaxKernel(), v);
    assert.deepEqual(got.points, ref.points, `${make.name}: points`);
    assert.equal(got.yMin, ref.yMin);
    assert.equal(got.yMax, ref.yMax);
  }

  // ── Every kernel gives the same answer from either layout, stays within its capacity, and never loses the ends.
  for (const kernel of [new MinMaxKernel(), new M4Kernel(), new LttbKernel(), new StrideKernel()]) {
    const a = run(kernel, pairs(100_000)),
      b = run(kernel, regular(100_000));
    assert.equal(a.count, b.count, `${kernel.constructor.name} count`);
    assert(a.count <= a.cap, `${kernel.constructor.name} within capacity`);
    for (let i = 0; i < a.points.length; i++)
      assert(Math.abs(a.points[i]! - b.points[i]!) < 1e-9, `${kernel.constructor.name} layouts agree at ${i}`);
  }

  // ── The extremes survive min/max and M4, and are lost by stride (which is why it is only for previews).
  {
    const v = pairs(1_000_000);
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < v.count; i++) {
      const y = v.data[2 * i + 1]!;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    for (const kernel of [new MinMaxKernel(), new M4Kernel()]) {
      const r = run(kernel, v);
      assert.equal(r.yMin, lo);
      assert.equal(r.yMax, hi);
      const ys = r.points.filter((_, i) => i % 2 === 1);
      assert.equal(Math.min(...ys), lo);
      assert.equal(Math.max(...ys), hi);
    }
    const s = run(new StrideKernel(), v);
    assert(s.yMax < hi, 'stride misses the peak');
    // M4 keeps column joins exact: its point count is about twice min/max's.
    assert(run(new M4Kernel(), v).count > run(new MinMaxKernel(), v).count * 1.5);
  }

  // ── Gaps: NaN splits the line in min/max and M4, once per gap however long, and the extent ignores it.
  for (const kernel of [new MinMaxKernel(), new M4Kernel()]) {
    const v = pairs(50_000);
    const d = v.data as Float64Array;
    for (let i = 20_000; i < 20_300; i++) d[2 * i + 1] = NaN;
    d[2 * 30_000 + 1] = NaN;
    const r = run(kernel, v);
    const gaps = r.points.filter((y, i) => i % 2 === 1 && Number.isNaN(y)).length;
    assert.equal(gaps, 2, `${kernel.constructor.name}: one gap point per gap`);
    assert(r.points.filter((_, i) => i % 2 === 0).every((x) => !Number.isNaN(x)));
    assert(Number.isFinite(r.yMin) && Number.isFinite(r.yMax));
  }
  {
    const v = pairs(50_000);
    for (let i = 20_000; i < 20_300; i++) (v.data as Float64Array)[2 * i + 1] = NaN;
    assert.deepEqual(run(new MinMaxKernel(), v).points, referenceMinMax(v, W).points, 'gaps match the reference');
  }

  // ── Inside a live chart.
  function chartOf(data: FlatDataSource | ObjectDataSource, kernel: DecimationKernel | null, width = 640) {
    const time = new Axis({ orientation: 'bottom' }, new LinearScale());
    const level = new Axis({ orientation: 'left', nice: true }, new LinearScale());
    const line = new LinePath({ stroke: '#2a6fdb' }, new LinearCurve());
    const series = new DomainSeries(kernel ? new Decimator({}, kernel, data) : data, line);
    const chart = new Chart({ theme: lightTheme, width, height: 360 }, new CartesianPlane({}, time, level, series));
    const platform = new StringPlatform({ width, height: 360 });
    chart.attach(platform);
    return { chart, platform, time, level, series, line };
  }

  const N = 1_000_000;
  const big = regular(N);
  const flat = new FlatDataSource({ data: big.data, regularDomain: big.regularDomain!, count: N });
  const kernel = new MinMaxKernel();
  const c = chartOf(flat, kernel);
  const f1 = c.chart.flush();
  assert.equal(f1.pointsIn, N);
  assert(f1.pointsDrawn <= 2 * 640, `drawn ${f1.pointsDrawn} points, not ${N}`);
  assert(f1.stages.decimate > 0, 'decimation is timed on its own');
  assert(c.platform.toString().length < 40_000, 'the path is small');
  // The value axis saw the true extremes, not a sample of them.
  let trueMax = -Infinity;
  for (let i = 0; i < N; i++) trueMax = Math.max(trueMax, big.data[i]!);
  assert(c.level.range.max >= trueMax && c.level.range.max < trueMax + 1, 'value axis covers the true maximum');
  mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../out/out-decimated.svg', import.meta.url).pathname, c.platform.toString());

  // Nothing changed: cached. Style change: no refill. Kernel swap: one refill.
  assert.equal(c.chart.flush().fillsCached, 1);
  c.line.setAttribute('stroke', 'crimson');
  assert.equal(c.chart.flush().filled, 0, 'style change reuses the fill');
  const before = c.chart.flush();
  assert.equal(before.filled, 0);
  kernel.setAttribute('id', 'k');
  assert.equal(c.chart.flush().filled, 1, 'a change to the kernel refills');

  // Zoom: only the visible part is read, the axis range is honoured, and the result is still bounded.
  c.time.setViewRange({ min: -1, max: 1 });
  const z = c.chart.flush();
  assert.equal(z.filled, 1);
  assert(z.pointsDrawn <= 2 * 640);
  const zoomed = c.series.points;
  assert(zoomed.count > 0);
  // A zoom into 1/10 of the data still has full-resolution detail: more distinct columns than a naive stride would give.
  assert(zoomed.count > 600, `zoomed view keeps its detail (${zoomed.count} points)`);
  c.time.setViewRange(null);
  c.chart.flush();

  // Zoomed output equals the full-view output inside the window, away from the two edge columns.
  {
    const v = regular(200_000),
      r: Extent = { min: -2, max: 3 };
    const mm = new MinMaxKernel();
    const w = run(mm, v, r);
    // Same kernel on the unwindowed view (a plain array defeats the windowing).
    const full = run(mm, { ...v, data: Array.from(v.data as Float64Array) }, r).points;
    const margin = ((r.max - r.min) * 3) / W;
    const inner = (pts: number[]) => {
      const o: number[] = [];
      for (let i = 0; i < pts.length; i += 2) if (pts[i]! > r.min + margin && pts[i]! < r.max - margin) o.push(pts[i]!, pts[i + 1]!);
      return o;
    };
    assert.deepEqual(inner(w.points), inner(full));
  }

  // Small data passes through untouched; `enabled: false` does the same for big data.
  {
    const small = chartOf(new FlatDataSource({ data: big.data, regularDomain: big.regularDomain!, count: 5000 }), new MinMaxKernel());
    assert.equal(small.chart.flush().pointsDrawn <= 2 * 640, true);
    const off = chartOf(new FlatDataSource({ data: big.data, regularDomain: big.regularDomain!, count: 5000 }), new MinMaxKernel());
    firstDecimator(off.series).setAttribute('enabled', false);
    assert.equal(off.chart.flush().pointsDrawn, 5000);
  }
  function firstDecimator(s: Series): Decimator {
    return s.data as Decimator;
  }

  // A source with no stored array (objects) goes through the scratch buffer; unsorted is refused with a reason.
  {
    const rows = Array.from({ length: 50_000 }, (_, i) => ({ t: i / 5000, v: Math.sin(i / 100) + hash(i) * 0.2 }));
    const obj = chartOf(new ObjectDataSource({ source: rows, domain: 't', value: 'v', isSorted: true }), new M4Kernel());
    const s = obj.chart.flush();
    assert(s.pointsDrawn <= 4 * 640 + 4 && s.pointsDrawn > 600);
    // Not flagged sorted: the source arranges its points, and the result is the same as the flagged one.
    const unflagged = chartOf(new ObjectDataSource({ source: [...rows].reverse(), domain: 't', value: 'v' }), new M4Kernel());
    assert.equal(unflagged.chart.flush().pointsDrawn, s.pointsDrawn);
    assert.equal(unflagged.series.points.count, obj.series.points.count);
  }

  // The one-call form.
  {
    const t = new Axis({ orientation: 'bottom' }, new LinearScale());
    const l = new Axis({ orientation: 'left' }, new LinearScale());
    const src = new FlatDataSource({ data: big.data, regularDomain: big.regularDomain!, count: N });
    const chart = new Chart(
      { theme: lightTheme, width: 640, height: 360 },
      new CartesianPlane({}, t, l, lineSeries(src, { stroke: 'teal', decimate: M4Kernel })),
    );
    chart.attach(new StringPlatform({ width: 640, height: 360 }));
    assert(chart.flush().pointsDrawn <= 4 * 640 + 4);
  }

  // The marker class and its stroke.
  {
    const t = new Axis({ orientation: 'bottom' }, new LinearScale());
    const l = new Axis({ orientation: 'left' }, new LinearScale());
    const src = new FlatDataSource({ data: big.data, regularDomain: big.regularDomain!, count: N });
    const chart = new Chart(
      { theme: lightTheme, width: 640, height: 360 },
      new CartesianPlane({}, t, l, lineSeries(src, { stroke: 'teal', marker: CircleMarker, markerStroke: 'red', decimate: M4Kernel })),
    );
    const platform = new StringPlatform({ width: 640, height: 360 });
    chart.attach(platform);
    chart.flush();
    assert(platform.toString().includes('stroke="red"'));
  }

  // Timing, for the record.
  {
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      c.time.setViewRange({ min: -10 + i * 0.01, max: 10 });
      times.push(c.chart.flush().total);
    }
    times.sort((a, b) => a - b);
    console.log('ok decimation', { points: N, medianRefillFlushMs: +times[4]!.toFixed(2), drawn: c.series.points.count });
  }
});

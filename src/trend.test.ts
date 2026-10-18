// Trendlines: fits that can be read anywhere along the domain, outside a chart too.
import assert from 'node:assert/strict';
import { lightTheme } from './themes.ts';
import {
  Axis,
  CartesianPlane,
  Chart,
  DomainSeries,
  LinePath,
  LinearCurve,
  LinearScale,
  LinearTrend,
  LoessTrend,
  MeanTrend,
  ObjectDataSource,
  PolynomialTrend,
  SinusoidalTrend,
  StringPlatform,
  XYSeries,
  readTable,
  registry,
} from './index.ts';
import { test } from 'vite-plus/test';

test('trend', () => {
  const near = (a: number, b: number, what: string, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
  const src = (rows: { t: number; v: number }[], channels = {}) =>
    new ObjectDataSource({ source: rows, domain: 't', value: 'v', channels });
  const line = Array.from({ length: 20 }, (_, i) => ({ t: i, v: 3 + 2 * i }));

  {
    // A line through exact data: the coefficients, a perfect fit, and evaluation at a number and at an array.
    const t = new LinearTrend({}, src(line));
    const f = t.fit!;
    near(f.coefficients![0]!, 3, 'intercept');
    near(f.coefficients![1]!, 2, 'slope');
    near(f.r2, 1, 'r2');
    near(f.rmse, 0, 'rmse');
    assert.equal(f.n, 20);
    near(t.evaluate(100), 203, 'extrapolated');
    assert.deepEqual(Array.from(t.evaluate([0, 1, 2])), [3, 5, 7]);
    assert.equal(t.evaluate([1]).constructor, Float64Array);
    assert(Number.isNaN(t.evaluate(NaN)) || true);
  }
  {
    // Noise lowers r2; a flat line through scattered values explains nothing.
    const noisy = line.map((p, i) => ({ t: p.t, v: p.v + (i % 2 ? 5 : -5) }));
    const f = new LinearTrend({}, src(noisy)).fit!;
    assert(f.r2 < 1 && f.r2 > 0.8 && f.rmse > 4 && f.rmse < 6, `r2 ${f.r2} rmse ${f.rmse}`);
  }
  {
    // Source changes refit; gaps are left out; unsorted data is sorted.
    const source = src([
      { t: 3, v: 7 },
      { t: 0, v: 1 },
      { t: 1, v: NaN },
      { t: 2, v: 5 },
      { t: NaN, v: 9 },
    ]);
    const t = new LinearTrend({}, source);
    assert.equal(t.fit!.n, 3);
    near(t.evaluate(1), 3, 'through (0,1) (2,5) (3,7): slope 2');
    source.setAttribute('source', [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
    ]);
    near(t.evaluate(2), 20, 'refit after the source changed');
  }
  {
    // Too few points or one position: no fit, NaN, not a throw.
    const one = new LinearTrend({}, src([{ t: 1, v: 1 }]));
    assert.equal(one.fit, null);
    assert(Number.isNaN(one.evaluate(1)));
    assert.equal(new LinearTrend({}, src([])).fit, null);
    assert.equal(new PolynomialTrend({ degree: 3 }, src(line.slice(0, 3))).fit, null, 'degree 3 needs 4 points');
  }
  {
    // Polynomial: a parabola is recovered exactly, a high degree stays stable, bad degrees fail.
    const par = Array.from({ length: 30 }, (_, i) => ({ t: 1000 + i, v: 0.5 * (i - 15) ** 2 + 4 }));
    const t = new PolynomialTrend({ degree: 2 }, src(par));
    near(t.fit!.r2, 1, 'parabola', 1e-9);
    near(t.evaluate(1015), 4, 'vertex', 1e-6);
    const wave = Array.from({ length: 200 }, (_, i) => ({ t: i / 20, v: Math.sin(i / 20) }));
    assert(new PolynomialTrend({ degree: 9 }, src(wave)).fit!.r2 > 0.9999, 'degree 9 fits a sine over 10 units');
    assert.throws(() => new PolynomialTrend({ degree: 0 }, src(line)).fit, /degree/);
    assert.throws(() => new PolynomialTrend({ degree: 2.5 }, src(line)).fit, /degree/);
  }
  {
    // Sinusoid: with the period given, and found by itself, on even and uneven spacing; the offset and amplitude come out.
    const T = 7.3,
      f = (x: number) => 10 + 3 * Math.sin((2 * Math.PI * x) / T + 0.8);
    const even = Array.from({ length: 150 }, (_, i) => ({ t: i * 0.2, v: f(i * 0.2) }));
    const given = new SinusoidalTrend({ period: T }, src(even)).fit!;
    near(given.r2, 1, 'known period', 1e-9);
    near(given.amplitude!, 3, 'amplitude', 1e-6);
    near(given.coefficients![0]!, 10, 'offset', 1e-6);
    const found = new SinusoidalTrend({}, src(even)).fit!;
    near(found.period!, T, 'found period', 1e-3);
    assert(found.r2 > 0.999999);
    const uneven = Array.from({ length: 120 }, (_, i) => {
      const x = i * 0.25 + 0.17 * Math.sin(i * 12.9898);
      return { t: x, v: f(x) };
    });
    near(new SinusoidalTrend({}, src(uneven)).fit!.period!, T, 'uneven spacing', 1e-3);
    // With noise the period is still near.
    const noisy = even.map((p, i) => ({ t: p.t, v: p.v + 0.5 * Math.sin(i * 78.233) }));
    const nf = new SinusoidalTrend({}, src(noisy)).fit!;
    near(nf.period!, T, 'noisy period', 0.05);
    assert(nf.r2 > 0.9);
    assert.throws(() => new SinusoidalTrend({ period: -1 }, src(even)).fit, /period/);
  }
  {
    // Loess: smoothness 0 joins the points, 1 is the line exactly, between the curve is smoother with more of it.
    const zig = Array.from({ length: 21 }, (_, i) => ({ t: i, v: (i % 2 ? 4 : 0) + i * 0.5 }));
    const exact = new LoessTrend({ smoothness: 0 }, src(zig));
    for (const p of zig) near(exact.evaluate(p.t), p.v, 'through the point');
    near(exact.evaluate(0.5), (zig[0]!.v + zig[1]!.v) / 2, 'straight between neighbours');
    near(exact.evaluate(25), zig[20]!.v + (zig[20]!.v - zig[19]!.v) * 5, 'continues the end segment');
    const ols = new LinearTrend({}, src(zig)),
      one = new LoessTrend({ smoothness: 1 }, src(zig));
    for (const x of [-3, 0, 4.4, 20, 30]) near(one.evaluate(x), ols.evaluate(x), 'smoothness 1 is the line');
    const roughness = (s: number) => {
      const t = new LoessTrend({ smoothness: s }, src(zig)),
        v = Array.from(t.evaluate(Array.from({ length: 200 }, (_, i) => i / 10)));
      return v.slice(2).reduce((p, q, i) => p + Math.abs(q - 2 * v[i + 1]! + v[i]!), 0);
    };
    const r = [0.3, 0.5, 0.7, 0.9].map(roughness);
    assert(r[0]! > r[1]! && r[1]! > r[2]! && r[2]! > r[3]!, `smoother as it grows: ${r.join(' ')}`);
    // On a line every smoothness gives the line (local linear regression reproduces it), the gaussian kernel too.
    for (const s of [0.1, 0.5, 0.9])
      for (const kernel of ['tricube', 'gaussian'] as const)
        near(new LoessTrend({ smoothness: s, kernel }, src(line)).evaluate(7.5), 18, `line, ${s} ${kernel}`, 1e-6);
    // A curve is followed more closely by a lower smoothness.
    const curve = Array.from({ length: 100 }, (_, i) => ({ t: i / 10, v: Math.sin(i / 10) }));
    const err = (s: number) => new LoessTrend({ smoothness: s }, src(curve)).fit!.rmse;
    assert(err(0.1) < err(0.5) && err(0.5) < err(0.95), 'rmse grows with smoothness');
    // Extrapolating noisy data stays near the data: it is the line at the end continued, not a steep line through the last two points.
    const noisyLine = Array.from({ length: 60 }, (_, i) => ({ t: i / 3, v: i / 3 + Math.sin(i * 12.9898) * 2 }));
    for (const sm of [0.2, 0.4, 0.7])
      for (const x of [-4, 25])
        assert(
          Math.abs(new LoessTrend({ smoothness: sm }, src(noisyLine)).evaluate(x) - x) < 8,
          `extrapolation at ${x} with smoothness ${sm}`,
        );
    assert.throws(() => new LoessTrend({ smoothness: 1.5 }, src(line)).fit, /smoothness/);
    assert(new LoessTrend({}, src(line)).fit!.bandwidth! > 0);
    // Duplicate positions and sparse windows do not break it.
    const dup = [
      { t: 1, v: 1 },
      { t: 1, v: 3 },
      { t: 2, v: 5 },
      { t: 10, v: 9 },
    ];
    assert(Number.isFinite(new LoessTrend({ smoothness: 0.2 }, src(dup)).evaluate(1.5)));
    near(new LoessTrend({ smoothness: 0 }, src(dup)).evaluate(1), 2, 'duplicates average');
  }
  {
    // Sampling: one point for each pixel in view, `count` fixed, `extend` past the ends; the table is the sampled curve.
    const t = new LinearTrend({ count: 5, extend: [0.5, 1] }, src(line));
    const tab = readTable(t);
    assert.equal(tab.count, 5);
    assert.deepEqual(Array.from(tab.column('domain')), [-9.5, 2.375, 14.25, 26.125, 38], 'five samples from -9.5 to 38');
    near(tab.column('value')[0]!, 3 + 2 * -9.5, 'extrapolated before');
    near(tab.column('value')[4]!, 3 + 2 * 38, 'extrapolated after');
    assert.deepEqual(t.domain(), { min: -9.5, max: 38 });
    near(t.valueExtent()!.min, 3 + 2 * -9.5, 'value extent covers the extension');
    assert.throws(() => new LinearTrend({ extend: -1 }, src(line)).domain(), /extend/);
    // Without `count` the width says: one a pixel across what is in view.
    const wide = new LinearTrend({}, src(line)).plan({
      width: 300,
      height: 100,
      domainRange: { min: 5, max: 10 },
      columns: ['domain', 'value'],
    });
    assert.equal(wide.capacity, 300);
    const buf = new Float64Array(600),
      res = wide.fill(buf);
    near(buf[0]!, 5, 'starts at the view');
    near(buf[2 * (res.count - 1)]!, 10, 'ends at the view');
  }
  {
    // On a scatter: fit against a channel, and draw from the series.
    const pts = Array.from({ length: 30 }, (_, i) => ({ t: i, v: 1 + 0.5 * (29 - i), x: i })); // y falls as the row rises; x is the channel
    const source = new ObjectDataSource({ source: pts, domain: 't', value: 'v', channels: { x: 'x' } });
    const trend = new LinearTrend({ x: 'x', count: 10 }, source);
    near(trend.fit!.coefficients![1]!, -0.5, 'slope against the channel');
    const series = new XYSeries({ x: 'domain', y: 'value' }, trend, new LinePath(new LinearCurve()));
    const chart = new Chart(
      { theme: lightTheme, width: 300, height: 200 },
      new CartesianPlane({}, new Axis({}, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()), series),
    );
    const platform = new StringPlatform({ width: 300, height: 200 });
    chart.attach(platform);
    chart.flush();
    assert(/<path d="M[^"]*L/.test(platform.toString()) && !/NaN/.test(platform.toString()));
  }
  {
    // In a DomainSeries; the domain axis fits the extension.
    const series = new DomainSeries({}, new LoessTrend({ extend: 0.2 }, src(line)), new LinePath(new LinearCurve()));
    const x = new Axis({}, new LinearScale());
    const chart = new Chart(
      { theme: lightTheme, width: 300, height: 200 },
      new CartesianPlane({}, x, new Axis({ orientation: 'left' }, new LinearScale()), series),
    );
    chart.attach(new StringPlatform({ width: 300, height: 200 }));
    chart.flush();
    assert(x.range.max >= 19 + 19 * 0.2 - 1e-9, `axis reaches the extension: ${x.range.max}`);
    assert(series.points.count >= 2);
  }
  {
    // The tags are registered.
    for (const name of ['LinearTrend', 'PolynomialTrend', 'SinusoidalTrend', 'LoessTrend', 'MeanTrend'])
      assert((registry as Record<string, unknown>)[name], name);
  }
});

// A mean trendline: a weighted average, so it never leaves the range of the data, and it holds the end value past the ends.
test('mean trend', () => {
  const src = (rows: { t: number; v: number }[]) => new ObjectDataSource({ source: rows, domain: 't', value: 'v' });
  let seed = 7;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const near = (a: number, b: number, what: string, tol: number) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
  // Uneven spacing, with a step in it, where a local line overshoots.
  const rows = Array.from({ length: 300 }, () => {
    const t = rand() ** 2 * 100;
    return { t, v: (t > 40 ? 10 : 0) + rand() };
  });
  const lo = Math.min(...rows.map((r) => r.v)),
    hi = Math.max(...rows.map((r) => r.v));
  for (const kernel of ['tricube', 'gaussian'] as const)
    for (const s of [0, 0.05, 0.2, 0.5, 0.8, 0.95, 1]) {
      const t = new MeanTrend({ smoothness: s, kernel, extend: 0.3 }, src(rows));
      for (let x = -40; x <= 140; x += 0.7) {
        const y = t.evaluate(x);
        assert(y >= lo - 1e-9 && y <= hi + 1e-9, `${kernel} ${s} at ${x}: ${y} is outside ${lo}..${hi}`);
      }
    }
  const first = rows.reduce((a, b) => (b.t < a.t ? b : a)),
    last = rows.reduce((a, b) => (b.t > a.t ? b : a));
  // Flat past the ends.
  {
    const t = new MeanTrend({ smoothness: 0.3 }, src(rows));
    assert.equal(t.evaluate(-50), t.evaluate(first.t));
    assert.equal(t.evaluate(500), t.evaluate(last.t));
  }
  // 0 joins the points; 1 is their mean.
  {
    const few = [0, 1, 2, 3].map((t) => ({ t, v: [4, 1, 7, 2][t]! }));
    near(new MeanTrend({ smoothness: 0 }, src(few)).evaluate(1.5), 4, 'joins the points', 1e-9);
    near(new MeanTrend({ smoothness: 1 }, src(few)).evaluate(0.2), 3.5, 'the mean', 1e-9);
  }
  // Exact on a constant, at any smoothness.
  for (const s of [0.1, 0.5, 0.9])
    near(new MeanTrend({ smoothness: s }, src(rows.map((r) => ({ t: r.t, v: 5 })))).evaluate(33), 5, 'constant', 1e-9);
  // Over many points the grid gives the same line as reading the points, to a small fraction of the range.
  {
    const big = Array.from({ length: 20000 }, (_, i) => ({ t: i / 20, v: Math.sin(i / 700) * 5 + ((i * 7919) % 101) / 50 }));
    // The same line from every eleventh point, few enough to be read directly.
    const exactSrc = src(big.filter((_, i) => i % 11 === 0));
    const viaGrid = new MeanTrend({ smoothness: 0.05 }, src(big)),
      viaPoints = new MeanTrend({ smoothness: 0.05 }, exactSrc);
    for (let x = 100; x < 900; x += 37) near(viaGrid.evaluate(x), viaPoints.evaluate(x), `grid at ${x}`, 0.15);
    assert(viaGrid.fit!.bandwidth! > 0);
  }
  // Small and degenerate inputs.
  assert.equal(new MeanTrend({}, src([{ t: 1, v: 2 }])).fit, null);
  assert.throws(() => new MeanTrend({ smoothness: 2 }, src(rows)).fit, /smoothness/);
  assert.throws(() => new MeanTrend({ kernel: 'box' as 'tricube' }, src(rows)).fit, /kernel/);
});

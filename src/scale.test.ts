// Scales: value ↔ fraction, tidy ends and ticks. Log, sqrt and band are checked against hand-worked values.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Axis,
  BandScale,
  Chart,
  CartesianPlane,
  DomainSeries,
  FlatDataSource,
  LinePath,
  LinearScale,
  LogScale,
  SqrtScale,
  StringPlatform,
} from './index.ts';
import { test } from 'vite-plus/test';

test('scale', () => {
  const near = (a: number, b: number, tol = 1e-9) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
  const norm = (s: LinearScale | LogScale | SqrtScale | BandScale, v: number[], r: { min: number; max: number }) => {
    const b = new Float64Array(v);
    s.normalize(b, b.length, 1, 0, r);
    return [...b];
  };

  // ── Log: equal ratios, equal distances; non-positive is a gap; round trip.
  {
    const s = new LogScale();
    const [a, b, c, d] = norm(s, [1, 10, 100, 0], { min: 1, max: 100 });
    near(a!, 0);
    near(b!, 0.5);
    near(c!, 1);
    assert(Number.isNaN(d));
    near(s.denormalize(0.5, { min: 1, max: 100 }), 10);
    assert.deepEqual(s.nice({ min: 3, max: 640 }), { min: 1, max: 1000 });
    assert.deepEqual(s.nice({ min: 10, max: 1000 }), { min: 10, max: 1000 }, 'exact powers stay put');
    assert.deepEqual(s.constrain({ min: -5, max: 1000 }), { min: 1, max: 1000 }, 'reaching zero is pulled up three decades');
    assert.deepEqual(s.constrain({ min: -5, max: -1 }), { min: 1, max: 10 });
    assert.deepEqual(s.ticks({ min: 1, max: 1e6 }, 7), [1, 10, 100, 1000, 10000, 100000, 1e6], 'a decade each when they fit');
    assert.deepEqual(s.ticks({ min: 1, max: 1e6 }, 3), [1, 1000, 1e6], 'thinned to about the count');
    assert.deepEqual(s.ticks({ min: 1, max: 100 }, 8), [1, 2, 5, 10, 20, 50, 100], '2 and 5 fill in a short span');
    const two = new LogScale({ base: 2 });
    assert.deepEqual(two.ticks({ min: 1, max: 16 }, 8), [1, 2, 4, 8, 16]);
    near(norm(two, [4], { min: 1, max: 16 })[0]!, 0.5);
  }

  // ── Sqrt: zero has a place; negatives are gaps; low end held at zero.
  {
    const s = new SqrtScale();
    const [a, b, c, d] = norm(s, [0, 25, 100, -1], { min: 0, max: 100 });
    near(a!, 0);
    near(b!, 0.5);
    near(c!, 1);
    assert(Number.isNaN(d));
    near(s.denormalize(0.5, { min: 0, max: 100 }), 25);
    assert.deepEqual(s.constrain({ min: -3, max: 10 }), { min: 0, max: 10 });
    assert.deepEqual(s.ticks({ min: 0, max: 10 }, 5), [0, 2, 4, 6, 8, 10]);
  }

  // ── Band: categories fix the range; ticks are the categories; labels are their names.
  {
    const s = new BandScale({ categories: ['a', 'b', 'c', 'd'], bandGap: 0.5 });
    assert.deepEqual(s.constrain(), { min: -0.5, max: 3.5 });
    near(norm(s, [0], s.constrain())[0]!, 0.125);
    near(norm(s, [3], s.constrain())[0]!, 0.875);
    near(s.bandwidth, 0.125);
    assert.deepEqual(s.ticks({ min: -0.5, max: 3.5 }), [0, 1, 2, 3]);
    assert.deepEqual(s.ticks({ min: 0.6, max: 2.4 }), [1, 2], 'zoomed in: only the bands in view');
    assert.equal(s.label(2), 'c');
  }

  // ── In a chart: a log axis and a category axis draw their own ticks and labels.
  {
    const x = new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['Mon', 'Tue', 'Wed'] }));
    const y = new Axis({ orientation: 'left', nice: true }, new LogScale());
    const series = new DomainSeries(
      new FlatDataSource({ data: new Float64Array([3, 80, 5000]), regularDomain: { start: 0, step: 1 } }),
      new LinePath(new LinearCurve()),
    );
    const chart = new Chart({ theme: lightTheme, width: 400, height: 300 }, new CartesianPlane({}, x, y, series));
    const platform = new StringPlatform({ width: 400, height: 300 });
    chart.attach(platform).flush();
    const svg = platform.toString();
    for (const t of ['Mon', 'Tue', 'Wed']) assert(svg.includes(`>${t}</text>`), `${t} labelled`);
    assert.deepEqual([y.range.min, y.range.max], [1, 10000], 'the log axis rounds out to whole decades');
    assert(svg.includes('>1000</text>'), 'and labels its decades');
  }

  // A base of 1, or one not above zero, has no logarithm to count in.
  for (const base of [1, 0, -2]) {
    assert.throws(() => new LogScale({ base }).ticks({ min: 1, max: 100 }, 5), /LogScale: base is above 0 and not 1/);
  }
  assert.deepEqual([...new LogScale({ base: 2 }).ticks({ min: 1, max: 8 }, 5)].slice(0, 4), [1, 2, 4, 8].slice(0, 4));
});

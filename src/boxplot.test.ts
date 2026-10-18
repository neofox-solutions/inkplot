// Box and whisker: BoxPath from five channels, BoxStats from samples, and the two together.
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  PolarPlane,
  Axis,
  LinearScale,
  BandScale,
  DomainSeries,
  ObjectDataSource,
  BoxPath,
  BoxStats,
  ErrorBars,
  DotMarker,
  Stack,
  hitTest,
  quantile,
  registry,
  type AnyElement,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';
import { test } from 'vite-plus/test';

test('boxplot', () => {
  const near = (a: number, b: number, what: string, tol = 1e-9) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

  // ── Quantiles: the two rules, on a spread whose answers are known.
  {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    near(quantile(v, 0.25), 3, 'inclusive q1');
    near(quantile(v, 0.5), 5, 'median');
    near(quantile(v, 0.75), 7, 'inclusive q3');
    near(quantile(v, 0.25, 'exclusive'), 2.5, 'exclusive q1');
    near(quantile(v, 0.75, 'exclusive'), 7.5, 'exclusive q3');
    near(quantile([1, 2, 3, 4], 0.5), 2.5, 'even count median');
    assert(Number.isNaN(quantile([], 0.5)));
  }

  const samples = [
    ...[2, 4, 4, 5, 5, 6, 7, 30].map((x) => ({ g: 0, x })),
    ...[10, 11, 12, 13, 14].map((x) => ({ g: 1, x })),
    ...[1, 2, 3, 4, 100, -50].map((x) => ({ g: 2, x })),
  ];
  const source = () => new ObjectDataSource({ source: samples, domain: 'g', value: 'x' });
  function chartOf(children: AnyElement[], o: { plane?: 'cartesian' | 'polar'; flip?: boolean } = {}) {
    const cat = new Axis({ id: 'cat', orientation: o.flip ? 'left' : 'bottom' }, new BandScale({ categories: ['a', 'b', 'c'] }));
    const val = new Axis({ id: 'val', orientation: o.flip ? 'bottom' : 'left' }, new LinearScale());
    const series = new DomainSeries(
      o.flip ? { domainAxis: 'cat', valueAxis: 'val' } : {},
      children[0] as never,
      ...(children.slice(1) as never[]),
    );
    const plane =
      o.plane === 'polar'
        ? new PolarPlane(
            {},
            new Axis({ orientation: 'angle', min: -0.5, max: 2.5 }, new LinearScale()),
            new Axis({ orientation: 'radius' }, new LinearScale()),
            series,
          )
        : new CartesianPlane({}, o.flip ? val : cat, o.flip ? cat : val, series);
    const platform = new FakePlatform({ width: 500, height: 300 });
    const chart = new Chart({ theme: lightTheme }, plane);
    chart.attach(platform).flush();
    return { cat, val, series, plane, chart, svg: () => platform.toString() };
  }

  // ── BoxStats: a point for each group, the five numbers and the rest as channels.
  {
    const stats = new BoxStats({}, source());
    const t = chartOf([stats, new BoxPath({})]);
    assert.equal(stats.pointCount, 3, 'three groups');
    const plan = stats.plan({
      width: 0,
      height: 0,
      domainRange: { min: -Infinity, max: Infinity },
      sorted: true,
      columns: ['domain', 'value', 'min', 'q1', 'median', 'q3', 'max', 'mean', 'sd', 'n'],
    });
    const out = new Float64Array(3 * 10),
      r = plan.fill(out);
    assert.equal(r.count, 3);
    const g1 = Array.from(out.subarray(10, 20));
    assert.deepEqual(g1.slice(0, 2), [1, 12], 'group 1 at its domain, with the median as its value');
    assert.deepEqual(g1.slice(2, 7), [10, 11, 12, 13, 14], 'min q1 median q3 max');
    near(g1[7]!, 12, 'mean');
    near(g1[8]!, Math.sqrt(2.5), 'sd', 1e-12);
    assert.equal(g1[9], 5, 'n');
    // Group 0: q1 = 4, q3 = 6.25 (inclusive), fence 1.5 IQR = 3.375: 30 is an outlier, the whisker stops at 7.
    const g0 = Array.from(out.subarray(0, 10));
    assert.equal(g0[6], 7, 'upper whisker is the furthest sample inside the fence');
    assert.equal(g0[2], 2, 'lower whisker');
    // Group 2 has a pair of outliers, one each way.
    const outliers = new BoxStats({ output: 'outliers' }, source());
    chartOf([outliers, new DotMarker({})]);
    assert.deepEqual([outliers.pointCount, outliers.valueExtent()], [3, { min: -50, max: 100 }]);
    void t;
  }

  // ── fence 'minmax': whiskers to the extremes, no outliers. A different method gives different quartiles.
  {
    const mm = new BoxStats({ fence: 'minmax' }, source());
    chartOf([mm, new BoxPath({})]);
    assert.equal(mm.channelExtent('max')?.max, 100);
    const none = new BoxStats({ fence: 'minmax', output: 'outliers' }, source());
    chartOf([none, new DotMarker({})]);
    assert.equal(none.pointCount, 0, 'no outliers');
    const ex = new BoxStats({ method: 'exclusive' }, source());
    chartOf([ex, new BoxPath({})]);
    const inc = new BoxStats({}, source());
    chartOf([inc, new BoxPath({})]);
    assert.notEqual(ex.channelExtent('q1')?.min, inc.channelExtent('q1')?.min, 'the rules differ');
    assert.throws(
      () =>
        new BoxStats({}, source()).plan({
          width: 0,
          height: 0,
          domainRange: { min: 0, max: 1 },
          sorted: true,
          columns: ['domain', 'value', 'nope'],
        }),
      /no channel "nope"/,
    );
  }

  // ── The mean as the value, for error bars from sd.
  {
    const stats = new BoxStats({ value: 'mean' }, source());
    const t = chartOf([stats, new ErrorBars({ error: 'sd' })]);
    assert(t.val.range.max >= 60, 'the axis reaches mean + sd of the wide group');
    assert.equal(stats.valueExtent()?.min !== undefined, true);
  }

  // ── BoxPath from hand-made numbers, with its channels named.
  {
    const rows = [
      { g: 0, lo: 1, a: 3, m: 5, b: 7, hi: 20 },
      { g: 1, lo: 2, a: 4, m: 6, b: 8, hi: 9 },
      { g: 2, lo: 0, a: 1, m: 2, b: 3, hi: 4 },
    ];
    const src = new ObjectDataSource({
      source: rows,
      domain: 'g',
      value: 'm',
      isSorted: true,
      channels: { lo: 'lo', a: 'a', b: 'b', hi: 'hi' },
    });
    const t = chartOf([src, new BoxPath({ low: 'lo', q1: 'a', q3: 'b', high: 'hi' })]);
    assert(t.val.range.max >= 20 && t.val.range.min <= 0, `the value axis reaches the whiskers: ${JSON.stringify(t.val.range)}`);
    const svg = t.svg();
    assert(/<path d="(M[^"]*Z)"[^>]*fill-opacity="0.4"/.test(svg), 'boxes drawn at the box fill opacity');
    assert.equal(((/<path d="(M[^"]*Z)"[^>]*fill-opacity="0.4"/.exec(svg)?.[1] ?? '').match(/Z/g) ?? []).length, 3, 'one box each');
    assert(!/NaN/.test(svg));
    // Its shapes are what a hit is measured against: the middle of a box hits, outside does not.
    const shapes = t.series.shapes()!;
    assert.equal(shapes.count, 3);
    assert.equal(t.series.hitHint, 'shape');
    const r = t.plane.rect,
      st = t.series.points.stride,
      px = t.series.points.data[st]!,
      py = t.series.points.data[st + 1]!;
    assert(hitTest(t.series, px, py)?.index === 1, 'the box of the second group is hit at its median');
    assert.equal(hitTest(t.series, px, r.height + 40), null, 'and not beneath the plot');
    // capWidth 0: no caps; the whiskers are two lines each.
    const bare = chartOf([
      new ObjectDataSource({ source: rows, domain: 'g', value: 'm', isSorted: true, channels: { lo: 'lo', a: 'a', b: 'b', hi: 'hi' } }),
      new BoxPath({ low: 'lo', q1: 'a', q3: 'b', high: 'hi', capWidth: 0 }),
    ]);
    const lines = (s: string) => (/<path d="(M[^"]*)"[^>]*fill="none"[^>]*stroke-width="1.5"/.exec(s)?.[1]?.match(/M/g) ?? []).length;
    assert.equal(lines(bare.svg()), 3 * 2, 'two whiskers each');
    assert.equal(lines(t.svg()), 3 * 4, 'and four caps with capWidth');
  }

  // ── Horizontal boxes (the groups on the vertical axis), a polar wedge, and boxes in a group.
  {
    const rows = [
      { g: 0, lo: 1, a: 3, m: 5, b: 7, hi: 9 },
      { g: 1, lo: 2, a: 4, m: 6, b: 8, hi: 10 },
    ];
    const make = () =>
      new ObjectDataSource({ source: rows, domain: 'g', value: 'm', isSorted: true, channels: { min: 'lo', q1: 'a', q3: 'b', max: 'hi' } });
    const flip = chartOf([make(), new BoxPath({})], { flip: true });
    const first = /<path d="(M[^Z"]*Z)/.exec(flip.svg())?.[1] ?? '';
    const nums = [...first.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const xs = nums.map((p) => p[0]!),
      ys = nums.map((p) => p[1]!);
    assert(
      Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys),
      'with the groups on the vertical axis a box is wider than it is tall',
    );
    assert(!/NaN/.test(flip.svg()));
    const polar = chartOf([make(), new BoxPath({})], { plane: 'polar' });
    assert(!/NaN/.test(polar.svg()), 'wedges on a polar plane');
    const x = new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['a', 'b'] })),
      y = new Axis({ orientation: 'left' }, new LinearScale());
    const one = new DomainSeries({}, make(), new BoxPath({})),
      two = new DomainSeries({}, make(), new BoxPath({}));
    const platform = new FakePlatform({ width: 400, height: 300 });
    new Chart({ theme: lightTheme }, new CartesianPlane({}, x, y, new Stack({ mode: 'group' }, one, two))).attach(platform).flush();
    const a = one.shapes()!,
      b = two.shapes()!;
    assert(a.data[0]! < b.data[0]!, 'the first series is left of the second');
  }

  // ── A row with any of the five missing has no box and does not break the others.
  {
    const rows = [
      { g: 0, lo: 1, a: 3, m: 5, b: 7, hi: 9 },
      { g: 1, lo: 2, a: NaN, m: 6, b: 8, hi: 10 },
      { g: 2, lo: 0, a: 1, m: 2, b: 3, hi: 4 },
    ];
    const t = chartOf([
      new ObjectDataSource({ source: rows, domain: 'g', value: 'm', isSorted: true, channels: { min: 'lo', q1: 'a', q3: 'b', max: 'hi' } }),
      new BoxPath({}),
    ]);
    assert.equal(((/<path d="(M[^"]*Z)"[^>]*fill-opacity="0.4"/.exec(t.svg())?.[1] ?? '').match(/Z/g) ?? []).length, 2, 'two boxes');
  }
  assert(registry.BoxPath && registry.BoxStats);
});

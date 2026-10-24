// Error bars and bands: channels beside the points, asymmetric and relative errors, axes that make room, stacks, bars in a group, log axes.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  LogScale,
  BandScale,
  DomainSeries,
  XYSeries,
  ObjectDataSource,
  LinePath,
  BarPath,
  Stack,
  ErrorBars,
  ErrorBand,
  PanZoom,
  type AnyElement,
  type Series,
  barShapes,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';
import { shapeCorners } from './fake-platform.ts';
import { test } from 'vite-plus/test';

test('errors', async () => {
  const rows = [
    { t: 0, v: 10, up: 2, down: 1, rel: 0.1 },
    { t: 1, v: 20, up: 3, down: 3, rel: 0.2 },
    { t: 2, v: 15, up: 1, down: 4, rel: 0.1 },
    { t: 3, v: 30, up: 5, down: 2, rel: 0.05 },
  ];
  const source = (extra: Record<string, string> = {}) =>
    new ObjectDataSource({
      source: rows,
      domain: 't',
      value: 'v',
      isSorted: true,
      channels: { up: 'up', down: 'down', rel: 'rel', ...extra },
    });
  function build(
    renderers: AnyElement[],
    o: { xScale?: () => LinearScale | LogScale; yScale?: () => LinearScale | LogScale; pz?: boolean } = {},
  ) {
    const x = new Axis({ orientation: 'bottom' }, new LinearScale()),
      y = new Axis({ orientation: 'left' }, o.yScale?.() ?? new LinearScale());
    const series = new DomainSeries({}, source(), ...(renderers as never[]));
    const plane = new CartesianPlane({}, x, y, series, ...(o.pz ? [new PanZoom({})] : []));
    const chart = new Chart({ theme: lightTheme, width: 400, height: 300 }, plane);
    const platform = new FakePlatform({ width: 400, height: 300 });
    chart.attach(platform).flush();
    return { x, y, series, plane, chart, svg: () => platform.toString() };
  }
  const near = (a: number, b: number, what: string, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

  // ── A symmetric error from one channel: a whisker and two caps for each of the four points; the axis reaches value ± error.
  {
    const t = build([new LinePath({}, new LinearCurve()), new ErrorBars({ error: 'up' })]);
    const svg = t.svg();
    const d = /<path d="(M[^"]*)"[^>]*stroke-linecap="butt"/.exec(svg)?.[1] ?? '';
    assert.equal((d.match(/M/g) ?? []).length, 4 * 3, 'a whisker and two caps each');
    assert(t.y.range.min <= 10 - 2 && t.y.range.max >= 30 + 5, `the value axis reaches the bars: ${JSON.stringify(t.y.range)}`);
    assert(t.series.channels.includes('up'), 'the channel is requested');
  }

  // ── negativeError makes it asymmetric: the lower end is where the other channel says.
  {
    const t = build([new ErrorBars({ error: 'up', negativeError: 'down', capWidth: 0 })]);
    assert(t.y.range.min <= 15 - 4 && t.y.range.min > 15 - 4 - 6, 'the lowest end is 15 - 4');
    assert(t.y.range.max >= 30 + 5);
    const d = /<path d="(M[^"]*)"[^>]*stroke-linecap="butt"/.exec(t.svg())?.[1] ?? '';
    assert.equal((d.match(/M/g) ?? []).length, 4, 'no caps with capWidth 0');
    // The first point's whisker runs from 10 - 1 to 10 + 2: the same distances in pixels as in the data.
    const nums = [...d.matchAll(/M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)/g)][0]!.slice(1).map(Number);
    const perUnit = t.plane.rect.height / (t.y.range.max - t.y.range.min);
    near(nums[1]! - nums[3]!, 3 * perUnit, 'whisker length for 1 + 2 units', 0.05);
  }

  // ── mode 'relative': the number is a fraction of the value.
  {
    const t = build([new ErrorBars({ error: 'rel', mode: 'relative' })]);
    assert(t.y.range.max >= 30 * 1.05 && t.y.range.max < 30 * 1.05 + 4, `relative: 30 + 5% reaches ${t.y.range.max}`);
    assert(t.y.range.min <= 10 * 0.9 && t.y.range.min > 8 - 3, `and 10 - 10%: ${t.y.range.min}`);
  }

  // ── A band is one closed shape between the ends; a gap in the error splits it.
  {
    const t = build([new ErrorBand({ error: 'up', negativeError: 'down' })]);
    const d = /<path d="(M[^"]*Z)"[^>]*fill-opacity="0.2"/.exec(t.svg())?.[1] ?? '';
    assert.equal((d.match(/Z/g) ?? []).length, 1, 'one shape');
    assert.equal((d.match(/[ML]/g) ?? []).length, 8, 'four points forward, four back');
    const gappy = rows.slice(0, 4).map((r, i) => (i === 2 ? { ...r, up: NaN } : r));
    const g = new DomainSeries(
      {},
      new ObjectDataSource({ source: gappy, domain: 't', value: 'v', isSorted: true, channels: { up: 'up', down: 'down' } }),
      new ErrorBand({ error: 'up', negativeError: 'down' }),
    );
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      g,
    );
    const platform = new FakePlatform({ width: 400, height: 300 });
    new Chart({ theme: lightTheme }, plane).attach(platform).flush();
    const parts = /<path d="(M[^"]*Z)"[^>]*fill-opacity/.exec(platform.toString())?.[1] ?? '';
    assert.equal((parts.match(/Z/g) ?? []).length, 2, 'a gap splits the band');
  }

  // ── Zooming is held to the range with the errors in it: zoom right out and the whole of every bar is in view.
  {
    const t = build([new ErrorBars({ error: 'up' })], { pz: true });
    const pz = [...t.plane].find((c) => c instanceof PanZoom) as PanZoom;
    assert(pz);
    const natural = { ...t.y.range };
    assert(natural.max >= 35, 'at rest the bars are all in view');
    const ext = t.series.extentFor(t.y)!;
    assert(ext.max >= 35 && ext.min <= 8, `the zoom limit covers the bars: ${JSON.stringify(ext)}`);
  }

  // ── On bars: the whisker sits on top of the bar. In a stack it sits on the layer's top.
  {
    const bars = (extra: string) => new DomainSeries({}, source(), new BarPath({}), new ErrorBars({ error: extra }));
    const x = new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['a', 'b', 'c', 'd'] })),
      y = new Axis({ orientation: 'left' }, new LinearScale());
    const a = bars('up'),
      b = new DomainSeries({}, source(), new BarPath({}), new ErrorBars({ error: 'down' }));
    const plane = new CartesianPlane({}, x, y, new Stack({}, a, b));
    const platform = new FakePlatform({ width: 400, height: 300 });
    new Chart({ theme: lightTheme }, plane).attach(platform).flush();
    assert(y.range.max >= 30 + 30 + 2, `a stacked bar's whisker is from the top of the stack: ${y.range.max}`);
    assert(((a as Series).drawn!.top?.length ?? 0) > 0, 'it is in a stack');
  }

  // ── Grouped bars: each whisker is on its own bar, not on the middle of the band.
  {
    const x = new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['a', 'b', 'c', 'd'] })),
      y = new Axis({ orientation: 'left' }, new LinearScale());
    const one = new DomainSeries({}, source(), new BarPath({}), new ErrorBars({ error: 'up', capWidth: 0 }));
    const two = new DomainSeries({}, source(), new BarPath({}), new ErrorBars({ error: 'down', capWidth: 0 }));
    const plane = new CartesianPlane({}, x, y, new Stack({ mode: 'group' }, one, two));
    const platform = new FakePlatform({ width: 400, height: 300 });
    new Chart({ theme: lightTheme }, plane).attach(platform).flush();
    const all = [...platform.toString().matchAll(/<path d="(M[^"]*)"[^>]*stroke-linecap="butt"/g)].map((m) =>
      [...m[1]!.matchAll(/M([\d.-]+) /g)].map((n) => Number(n[1])),
    );
    assert.equal(all.length, 2);
    assert(all[0]![0]! < all[1]![0]!, 'the first series is left of the second in its band');
  }

  // ── Grouped bars with a width of their own: the whiskers move with the bars (the gap between the two is the bars' gap).
  {
    const x = new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['a', 'b', 'c', 'd'] })),
      y = new Axis({ orientation: 'left' }, new LinearScale());
    const mk = (error: string) => new DomainSeries({}, source(), new BarPath({ width: 0.5 }), new ErrorBars({ error, capWidth: 0 }));
    const one = mk('up'),
      two = mk('down');
    const platform = new FakePlatform({ width: 400, height: 300 });
    new Chart({ theme: lightTheme }, new CartesianPlane({}, x, y, new Stack({ mode: 'group' }, one, two))).attach(platform).flush();
    const whisker = [...platform.toString().matchAll(/<path d="(M[^"]*)"[^>]*stroke-linecap="butt"/g)].map((m) =>
      Number(/M([\d.-]+) /.exec(m[1]!)![1]),
    );
    const centre = (s: DomainSeries) => {
      const { x } = shapeCorners(s, barShapes(s, { width: 0.5 })!, 0);
      return (Math.min(...x) + Math.max(...x)) / 2;
    };
    assert.equal(whisker.length, 2);
    assert(Math.abs(whisker[1]! - whisker[0]! - (centre(two) - centre(one))) < 0.02, 'each whisker is at the middle of its own bar');
  }

  // ── An XYSeries with an error along x: the x axis is fitted to it.
  {
    const pts = [
      { x: 1, y: 1, ex: 0.5 },
      { x: 5, y: 3, ex: 2 },
    ];
    const x = new Axis({ orientation: 'bottom' }, new LinearScale()),
      y = new Axis({ orientation: 'left' }, new LinearScale());
    const s = new XYSeries(
      { x: 'x' },
      new ObjectDataSource({ source: pts, domain: 'x', channels: { x: 'x', y: 'y', ex: 'ex' } }),
      new ErrorBars({ error: 'ex', along: 'domain' }),
    );
    const platform = new FakePlatform({ width: 400, height: 300 });
    new Chart({ theme: lightTheme }, new CartesianPlane({}, x, y, s)).attach(platform).flush();
    assert(x.range.min <= 0.5 && x.range.max >= 7, `x covers 1 - 0.5 and 5 + 2: ${JSON.stringify(x.range)}`);
    assert(!y.isZoomed);
  }

  // ── A log axis holds a lower end that would be at or below zero at the edge instead of dropping the bar.
  {
    const data = [
      { t: 0, v: 10, up: 5, down: 20 },
      { t: 1, v: 100, up: 50, down: 10 },
    ];
    const x = new Axis({ orientation: 'bottom' }, new LinearScale()),
      y = new Axis({ orientation: 'left' }, new LogScale());
    const s = new DomainSeries(
      {},
      new ObjectDataSource({ source: data, domain: 't', value: 'v', isSorted: true, channels: { up: 'up', down: 'down' } }),
      new ErrorBars({ error: 'up', negativeError: 'down' }),
    );
    const platform = new FakePlatform({ width: 400, height: 300 });
    new Chart({ theme: lightTheme }, new CartesianPlane({}, x, y, s)).attach(platform).flush();
    const svg = platform.toString();
    assert(!/NaN/.test(svg), 'no NaN in the drawing');
    const d = /<path d="(M[^"]*)"[^>]*stroke-linecap="butt"/.exec(svg)?.[1] ?? '';
    assert((d.match(/M/g) ?? []).length >= 6, 'both bars are drawn');
  }

  // ── A serialisable chart: the renderers are registered.
  {
    const { registry } = await import('./registry.ts');
    assert(registry.ErrorBars && registry.ErrorBand);
  }
});

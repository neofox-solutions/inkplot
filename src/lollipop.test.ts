import assert from 'node:assert/strict';
import {
  Axis,
  BandScale,
  BarLinePath,
  CartesianPlane,
  Chart,
  CircleMarker,
  DomainSeries,
  FlatDataSource,
  LinearScale,
  StringPlatform,
  Stack,
  lightTheme,
} from './index.ts';
import { test } from 'vite-plus/test';

// A lollipop is a stem and a marker in one series: the marker stands on the end of its stem, also when stems share a band, and the value
// axis does not open up below the baseline for it.
test('lollipop', () => {
  const rows = (data: number[]) => new FlatDataSource({ data, regularDomain: { start: 0, step: 1 } });
  const make = (mode: 'stack' | 'group') => {
    const value = new Axis({ orientation: 'left', nice: false }, new LinearScale());
    const chart = new Chart(
      { theme: lightTheme, width: 400, height: 300 },
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['a', 'b', 'c'] })),
        value,
        new Stack(
          { mode },
          new DomainSeries({}, rows([3, 5, 4]), new BarLinePath({}), new CircleMarker({ size: 5 })),
          new DomainSeries({}, rows([2, 4, 3]), new BarLinePath({}), new CircleMarker({ size: 5 })),
        ),
      ),
    );
    const platform = new StringPlatform({ width: 400, height: 300 });
    chart.attach(platform).flush();
    return { value, svg: platform.toString() };
  };
  // A marker is drawn from its left edge (a circle of radius 5): its centre is 5 to the right of where its path starts.
  const centres = (svg: string) => [...svg.matchAll(/M([\d.-]+) [\d.-]+a5 5 /g)].map((m) => Number(m[1]) + 5);
  const { value, svg } = make('group');
  assert.equal(value.range.min, 0, 'the value axis starts at the baseline');
  assert(value.range.max > 5, 'and leaves room above the highest marker');
  // Each marker's x is where its stem is: every stem x appears as a marker x.
  const stems = [...svg.matchAll(/M([\d.-]+) [\d.-]+L([\d.-]+) /g)].map((m) => Number(m[1]));
  assert(stems.length >= 6, `stems found: ${stems.length}`);
  const dots = centres(svg);
  assert(dots.length >= 6, `markers found: ${dots.length}`);
  for (const x of dots)
    assert(
      stems.some((s) => Math.abs(s - x) < 1.1),
      `a marker at ${x} is on a stem`,
    );
});

// Swapping a series' data for another node refills it, also when both nodes are at the same version.
test('swapped data', () => {
  const one = new FlatDataSource({ data: [1, 2, 3], regularDomain: { start: 0, step: 1 } });
  const series = new DomainSeries({}, one, new BarLinePath({}));
  const chart = new Chart(
    { theme: lightTheme, width: 400, height: 300 },
    new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      series,
    ),
  );
  const platform = new StringPlatform({ width: 400, height: 300 });
  chart.attach(platform).flush();
  const before = platform.toString();
  series.setChild(0, new FlatDataSource({ data: [9, 1, 7], regularDomain: { start: 0, step: 1 } }));
  chart.flush();
  assert.notEqual(platform.toString(), before);
});

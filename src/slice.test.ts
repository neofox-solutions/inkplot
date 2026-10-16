// Slice: a window of rows, its extents, composing with a Decimator, and moving it.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  DomainSeries,
  LinePath,
  LinearCurve,
  FlatDataSource,
  Slice,
  Decimator,
  MinMaxKernel,
  StringPlatform,
} from './index.ts';
import { lightTheme } from './themes.ts';

test('slice', () => {
  const N = 1000;
  const ys = Float64Array.from({ length: N }, (_, i) => (i % 100 === 0 ? 50 : Math.sin(i / 10)));
  const flat = () => new FlatDataSource({ data: ys, regularDomain: { start: 0, step: 1 }, count: N });
  const read = (s: Slice) => {
    const plan = s.plan({ width: 100, height: 50, domainRange: { min: 0, max: N }, channels: [] });
    const out = new Float64Array(plan.capacity * 2);
    const r = plan.fill(out);
    return { out, r };
  };

  // Array.prototype.slice rules, and `last`.
  {
    const a = new Slice({ start: 10, end: 20 }, flat());
    const { out, r } = read(a);
    assert.equal(r.count, 10);
    assert.deepEqual([out[0], out[1], out[18]], [10, ys[10], 19]);
    assert.equal(a.pointCount, 10);
    assert.deepEqual(a.domain(), { min: 10, max: 19 });
    assert.equal(read(new Slice({ start: -5 }, flat())).r.count, 5);
    assert.equal(read(new Slice({ last: 30, end: 500 }, flat())).out[0], 470);
    assert.equal(read(new Slice({ last: 5000 }, flat())).r.count, N);
    assert.equal(read(new Slice({ start: 20, end: 10 }, flat())).r.count, 0);
  }

  // Extents are those of the kept rows only: the spike at row 0 and 100 is outside the window.
  {
    const s = new Slice({ start: 1, end: 99 }, flat());
    assert.equal(s.valueExtent()!.max <= 1, true);
    assert.equal(new Slice({ start: 0, end: 101 }, flat()).valueExtent()!.max, 50);
  }

  // In a chart: moving the window changes what is drawn, and the value axis follows it.
  {
    const slice = new Slice({ last: 200, end: 300 }, flat());
    const level = new Axis({ orientation: 'left' }, new LinearScale());
    const time = new Axis({ orientation: 'bottom' }, new LinearScale());
    const series = new DomainSeries(new Decimator({}, new MinMaxKernel(), slice), new LinePath({}, new LinearCurve()));
    const chart = new Chart({ theme: lightTheme, width: 400, height: 200 }, new CartesianPlane({}, time, level, series));
    chart.attach(new StringPlatform({ width: 400, height: 200 }));
    const f1 = chart.flush();
    assert.equal(f1.pointsIn, 200);
    assert.equal(level.range.max >= 50, true, 'row 100 is in the window');
    assert.deepEqual([time.range.min, time.range.max], [100, 299]);
    const v0 = slice.version;
    slice.setAttribute('end', 700);
    assert.equal(slice.version > v0, true);
    const f2 = chart.flush();
    assert.equal(f2.filled > 0, true, 'moving the window refills');
    assert.deepEqual([time.range.min, time.range.max], [500, 699]);
    assert.equal(chart.flush().filled, 0, 'and then it is cached');
  }
});

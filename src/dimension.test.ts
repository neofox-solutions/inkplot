// Dimensions: explicit ticks (a list, a function, a step), room for what reaches past the data (markers, bars), and `inverted`.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart, CartesianPlane, Axis, LinearScale, LogScale, DomainSeries, XYSeries, DotMarker, CircleMarker, BarPath, LinePath, FlatDataSource,
  StringPlatform, type Plane,
} from './index.ts';

const near = (a: number, b: number, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
function mount(plane: Plane, w = 400, h = 300) {
  const chart = new Chart({ theme: lightTheme, width: w, height: h }, plane);
  chart.attach(new StringPlatform({ width: w, height: h }));
  chart.flush();
  return chart;
}
const flat = (ys: number[], start = 0, step = 1) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start, step } });
const axis = (attrs: object = {}) => new Axis({ orientation: 'left', min: 0, max: 100, ...attrs }, new LinearScale());
const values = (a: Axis) => a.getTicks(300).map((t) => t.value);

// ── Ticks: a list is used as given (those inside the range), a function is asked for them, a step makes multiples.
{
  const a = axis({ ticks: [0, 10, 25, 99, 150, -5] });
  mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), a, new DomainSeries({}, flat([1, 2]), new LinePath(new LinearCurve()))));
  assert.deepEqual(values(a), [0, 10, 25, 99], 'the ones outside the range are left out, the order is kept');
  assert.deepEqual(a.getTicks(300).map((t) => t.label), ['0', '10', '25', '99'], 'labels are as wide as the closest ticks need');

  const f = axis({ ticks: (r: { min: number; max: number }) => [r.min, (r.min + r.max) / 2, r.max] });
  mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), f, new DomainSeries({}, flat([1, 2]), new LinePath(new LinearCurve()))));
  assert.deepEqual(values(f), [0, 50, 100], 'a function is given the range');

  const s = axis({ tickStep: 15 });
  mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), s, new DomainSeries({}, flat([1, 2]), new LinePath(new LinearCurve()))));
  assert.deepEqual(values(s), [0, 15, 30, 45, 60, 75, 90], 'multiples of the step, none outside');

  const c = axis({ tickCount: 3, ticks: [] });
  mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), c, new DomainSeries({}, flat([1, 2]), new LinePath(new LinearCurve()))));
  assert.deepEqual(values(c), [], 'an empty list is a request for no ticks');

  const fmt = axis({ ticks: [0.1, 0.2], min: 0, max: 1 });
  mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), fmt, new DomainSeries({}, flat([1, 2]), new LinePath(new LinearCurve()))));
  assert.deepEqual(fmt.getTicks(300).map((t) => t.label), ['0.1', '0.2'], 'decimals follow the spacing of the ticks given');

  const log = new Axis({ orientation: 'left', min: 1, max: 1000, ticks: [1, 30, 1000] }, new LogScale());
  mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), log, new DomainSeries({}, flat([1, 2]), new LinePath(new LinearCurve()))));
  assert.deepEqual(values(log), [1, 30, 1000], 'on any scale');
}

// ── Markers on the ends of the data are not cut: the axes leave their radius, in pixels, past each end.
{
  const x = new Axis({ orientation: 'bottom' }, new LinearScale()), y = new Axis({ orientation: 'left', min: 0, max: 10 }, new LinearScale());
  const series = new DomainSeries({}, flat([2, 5, 3, 8]), new CircleMarker({ size: 6 }));
  const plane = new CartesianPlane({}, x, y, series);
  mount(plane);
  const p = series.points, w = plane.rect.width;
  assert(p.data[0]! > 6 && p.data[0]! < 8.5, `first marker clear of the edge: ${p.data[0]}`);
  assert(w - p.data[6]! > 6 && w - p.data[6]! < 8.5, `last marker clear of the edge: ${w - p.data[6]!}`);
  assert(x.range.min < 0 && x.range.max > 3, 'the range grew past the data');
  // An end the attributes fixed is where it was put, and so is a whole axis that is fixed.
  const fixed = new Axis({ orientation: 'bottom', min: 0, max: 3 }, new LinearScale());
  const s2 = new DomainSeries({}, flat([2, 5, 3, 8]), new CircleMarker({ size: 6 }));
  mount(new CartesianPlane({}, fixed, new Axis({ orientation: 'left', min: 0, max: 10 }, new LinearScale()), s2));
  near(s2.points.data[0]!, 0);
  // The value axis too, and the radius of a size bound to data is the largest it can be.
  assert(y.range.min === 0, 'a fixed value axis does not move');
  const free = new Axis({ orientation: 'left' }, new LinearScale());
  const s3 = new DomainSeries({}, flat([2, 8]), new CircleMarker({ size: 10 }));
  const plane3 = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), free, s3);
  mount(plane3);
  const top = s3.points.data[3]!;
  assert(top > 10 && top < 14, `the highest marker's top edge is inside the plot: ${top}`);
  // No markers, no room: a line reaches no further than its points.
  const lx = new Axis({ orientation: 'bottom' }, new LinearScale());
  const line = new DomainSeries({}, flat([2, 5]), new LinePath(new LinearCurve()));
  mount(new CartesianPlane({}, lx, axis(), line));
  near(lx.range.min, 0);
  near(lx.range.max, 1);
}

// ── Padding in pixels follows the scale: on a log axis it is a ratio.
{
  const y = new Axis({ orientation: 'left' }, new LogScale());
  const series = new DomainSeries({}, flat([1, 10, 100, 1000]), new DotMarker({ size: 6 }));
  mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), y, series));
  assert(y.range.min > 0 && y.range.min < 1 && y.range.max > 1000, `grew by ratio, stayed positive: ${JSON.stringify(y.range)}`);
}

// ── Bars centred on the ends of a numeric domain keep their halves on the plot.
{
  const x = new Axis({ orientation: 'bottom' }, new LinearScale());
  const bars = new DomainSeries({}, flat([3, 7, 5, 9]), new BarPath({}));
  const plane = new CartesianPlane({}, x, new Axis({ orientation: 'left' }, new LinearScale()), bars);
  mount(plane);
  near(x.range.min, -0.4);
  near(x.range.max, 3.4);
  const pitch = bars.points.data[2]! - bars.points.data[0]!;
  near(bars.points.data[0]!, 0.4 * pitch, 1e-6);
  // A series that is not bars adds nothing, and a width asked for is the half-width asked for.
  const x2 = new Axis({ orientation: 'bottom' }, new LinearScale());
  mount(new CartesianPlane({}, x2, new Axis({ orientation: 'left' }, new LinearScale()), new DomainSeries({}, flat([3, 7, 5, 9]), new BarPath({ width: 1 }))));
  near(x2.range.min, -0.5);
}

// ── An XY series reaches on both axes.
{
  const x = new Axis({ orientation: 'bottom' }, new LinearScale()), y = new Axis({ orientation: 'left' }, new LinearScale());
  const data = new FlatDataSource({ data: Float64Array.from([1, 2, 3, 4]), stride: 2, regularDomain: { start: 0, step: 1 }, channels: { x: 1 } });
  const series = new XYSeries({ x: 'x' }, data, new DotMarker({ size: 5 }));
  mount(new CartesianPlane({}, x, y, series));
  assert(x.range.min < 2 && y.range.min < 1, 'both axes grew past the data');
}

// ── Inverted runs from max at the bottom.
{
  const y = axis({ inverted: true });
  const series = new DomainSeries({}, flat([100, 0]), new LinePath(new LinearCurve()));
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), y, series);
  mount(plane);
  near(series.points.data[1]!, plane.rect.height, 1e-6);
  near(series.points.data[3]!, 0, 1e-6);
  near(y.denormalize(0), 100);
}
console.log('ok dimension');

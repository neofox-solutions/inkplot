// Hit geometry, and what a series, a source and a plane make of it: distance modes, NaN sentinels, row identity, unplace.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  PolarPlane,
  RadarPlane,
  Axis,
  LinearScale,
  DomainSeries,
  XYSeries,
  LinePath,
  AreaPath,
  ObjectDataSource,
  FlatDataSource,
  Decimator,
  MinMaxKernel,
  StringPlatform,
  hitTest,
  hitPlane,
  hitAll,
  interpolate,
  interpolateAll,
  nearestPoint,
  nearestSegment,
  insideArea,
  type Plane,
  type PointBuffer,
} from './index.ts';
import { test } from 'vite-plus/test';

test('hit', () => {
  const near = (a: number, b: number, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
  const buf = (...xy: number[]): PointBuffer => ({ data: new Float64Array(xy), stride: 2, count: xy.length / 2 });

  // ── Geometry: point, segment, area; NaN gaps and NaN pointer coordinates.
  {
    const p = buf(0, 0, 10, 0, 20, 10);
    assert.deepEqual(nearestPoint(p, 9, 3), { index: 1, distance: Math.hypot(1, 3) });
    const seg = nearestSegment(p, 4, 4)!;
    near(seg.distance, 4);
    assert.equal(seg.index, 0, 'the hit is the nearer end of the segment');
    assert.equal(nearestSegment(p, 7, 4)!.index, 1);
    near(nearestSegment(p, -5, 0)!.distance, 5, 1e-9);

    const gap = buf(0, 0, NaN, NaN, 20, 0);
    near(nearestSegment(gap, 10, 0)!.distance, 10, 1e-9); // nothing joins across a gap
    assert.equal(nearestPoint(buf(NaN, NaN), 0, 0), null);

    assert.deepEqual(nearestPoint(p, 9, NaN), { index: 1, distance: 1 }, 'NaN y: along x alone');
    assert.deepEqual(nearestPoint(p, NaN, 9), { index: 2, distance: 1 }, 'NaN x: along y alone');
    assert.equal(nearestPoint(p, NaN, NaN), null);
    assert.deepEqual(nearestSegment(p, 9, NaN), { index: 1, distance: 1 }, 'a line with one coordinate missing is just its points');

    // An area: the triangle 0,0 → 20,0 → 20,10 over a baseline at y = 20 (below, in pixels).
    const base = buf(0, 20, 10, 20, 20, 20);
    const line = buf(0, 5, 10, 5, 20, 5);
    assert.equal(insideArea(line, base, 10, 12), 1);
    assert.equal(insideArea(line, base, 10, 2), null, 'above the line is outside');
  }

  // ── A series: modes, radius, opting out, NaN sentinel through the plane.
  const yAxis = () => new Axis({ orientation: 'left', min: 0, max: 10 }, new LinearScale());
  const xAxis = () => new Axis({ orientation: 'bottom', min: 0, max: 10 }, new LinearScale());
  function mount(plane: Plane, w = 400, h = 300) {
    const chart = new Chart({ theme: lightTheme, width: w, height: h }, plane);
    chart.attach(new StringPlatform({ width: w, height: h }));
    chart.flush();
    return chart;
  }
  const flat = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start: 0, step: 1 } });
  {
    const line = new DomainSeries({ hit: 'line', name: 'line' }, flat([2, 8, 2, 8]), new LinePath(new LinearCurve()));
    const dots = new DomainSeries({ hit: { radius: 4 }, name: 'dots' }, flat([5, 5, 5, 5]), new LinePath(new LinearCurve()));
    const off = new DomainSeries({ hit: false }, flat([0, 0, 0, 0]), new LinePath(new LinearCurve()));
    const plane = new CartesianPlane({}, xAxis(), yAxis(), line, dots, off);
    mount(plane);
    const w = plane.rect.width,
      h = plane.rect.height,
      px = (x: number) => (x / 10) * w,
      py = (y: number) => (1 - y / 10) * h;

    const mid = hitTest(line, px(0.5), py(5)); // halfway along the first segment of the line
    assert(mid && mid.distance < 1, 'on the line between points');
    assert.equal(mid.series, line);
    assert.equal(hitTest(dots, px(0.5), py(5)), null, 'a point series is not hit between its points');
    assert.equal(hitTest(dots, px(1) + 3, py(5))!.index, 1, 'within the radius of a point');
    assert.equal(hitTest(dots, px(1) + 6, py(5)), null, 'beyond it');
    assert.equal(hitTest(off, px(1), py(0)), null, 'hit: false takes none');

    const hit = hitTest(line, px(1), py(8))!;
    assert.equal(hit.first, 1);
    assert.equal(hit.second, 8);
    assert.equal(hit.row, 1);
    near(hit.px, px(1), 1e-6);
    assert.equal(hit.plane, plane);

    // The plane: nearest across series, ties to the one on top; the sentinel finds each series at the pointer's x.
    const both = hitPlane(plane, px(1), py(5));
    assert.equal(both?.series, dots, 'a crossing: the line is 3 units away at x=1.0, the dot is on it');
    const all = hitAll(plane, px(2), NaN);
    assert.deepEqual(
      all.map((h) => h.series.attrs.name),
      ['dots', 'line'],
      'topmost first, one per series (the opted-out one is silent)',
    );
  }
  {
    // An area is hit anywhere inside the shape.
    const area = new DomainSeries({ hit: 'area' }, flat([8, 8, 8, 8]), new AreaPath({ baseline: 0 }, new LinearCurve()));
    const plane = new CartesianPlane({}, xAxis(), yAxis(), area);
    mount(plane);
    const w = plane.rect.width,
      h = plane.rect.height;
    const inside = hitTest(area, w * 0.15, h * 0.7)!;
    assert.equal(inside.distance, 0);
    assert.equal(inside.index, 1, 'the point nearest where it is');
    assert.equal(hitTest(area, w * 0.15, h * 0.05, 3), null, 'above the shape is outside');
  }

  // ── Row identity: sorted order is not storage order, gaps shift it, and decimation takes it away.
  {
    const rows = [
      { k: 3, v: 30 },
      { k: NaN, v: 0 },
      { k: 1, v: 10 },
      { k: 2, v: 20 },
    ];
    const src = new ObjectDataSource({ source: rows, domain: 'k', value: 'v' });
    const series = new DomainSeries({}, src, new LinePath(new LinearCurve()));
    const plane = new CartesianPlane({}, xAxis(), new Axis({ orientation: 'left', min: 0, max: 40 }, new LinearScale()), series);
    mount(plane);
    const w = plane.rect.width,
      h = plane.rect.height;
    // Domain 1..3 on 0..10 axis: find each by its own place.
    const rowAt = (k: number, v: number) => hitTest(series, (k / 10) * w, (1 - v / 40) * h)!.row;
    assert.equal(rowAt(1, 10), 2);
    assert.equal(rowAt(2, 20), 3);
    assert.equal(rowAt(3, 30), 0);

    // Editing storage and invalidating re-sorts; the same row is found at its new place.
    rows[0]!.k = 0.5;
    src.invalidate();
    plane.chart!.flush();
    assert.equal(hitTest(series, (0.5 / 10) * w, (1 - 30 / 40) * h)!.row, 0, 'the row follows its edit');

    const wrapped = new ObjectDataSource({
      source: [
        { k: 2, v: 5 },
        { k: 0, v: 1 },
        { k: 1, v: 3 },
      ],
      domain: 'k',
      value: 'v',
      wrap: 3,
    });
    const a = new DomainSeries({}, wrapped, new LinePath(new LinearCurve()));
    mount(new CartesianPlane({}, xAxis(), yAxis(), a));
    const ws = a.points;
    assert.equal(ws.count, 4);
    assert.equal(hitTest(a, ws.data[6]!, ws.data[7]!)!.row, 1, 'the closing copy is the first point again');
  }
  {
    const big = new FlatDataSource({
      data: Float64Array.from({ length: 5000 }, (_, i) => Math.sin(i / 50) * 4 + 5),
      regularDomain: { start: 0, step: 1 },
    });
    const series = new DomainSeries({}, new Decimator({}, new MinMaxKernel(), big), new LinePath(new LinearCurve()));
    const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), yAxis(), series);
    mount(plane, 200, 200);
    const p = series.points;
    const hit = hitTest(series, p.data[2 * 10]!, p.data[2 * 10 + 1]!)!;
    assert(hit, 'a decimated series can still be hovered');
    // The points kept are rows of the source, and say which: that row holds the value the hit reports.
    assert.ok(hit.row !== undefined, 'its points are source rows');
    assert.equal(big.view()!.data[hit.row], hit.second);
  }

  // ── XY series report x and y as first and second, with channels by name.
  {
    const rows = [
      { x: 1, y: 2, w: 7 },
      { x: 4, y: 6, w: 9 },
    ];
    const series = new XYSeries(
      { x: 'x', hit: 'point' },
      new ObjectDataSource({ source: rows, channels: { x: 'x', y: 'y', w: 'w' } }),
      new LinePath(new LinearCurve()),
    );
    const plane = new CartesianPlane({}, xAxis(), yAxis(), series);
    mount(plane);
    const w = plane.rect.width,
      h = plane.rect.height;
    const hit = hitTest(series, (4 / 10) * w, (1 - 6 / 10) * h)!;
    assert.equal(hit.first, 4);
    assert.equal(hit.second, 6);
    assert.equal(hit.row, 1);
  }

  // ── unplace inverts place, on every plane, and on inverted and flipped axes.
  {
    const cases: Plane[] = [
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom', min: 0, max: 10 }, new LinearScale()),
        new Axis({ orientation: 'left', min: 0, max: 10, inverted: true }, new LinearScale()),
        new DomainSeries({}, flat([1, 2, 3]), new LinePath(new LinearCurve())),
      ),
    ];
    const polar = new PolarPlane(
      {},
      new Axis({ orientation: 'angle', min: 0, max: 10 }, new LinearScale()),
      new Axis({ orientation: 'radius', min: 0, max: 10 }, new LinearScale()),
      new DomainSeries({}, flat([1, 4, 9]), new LinePath(new LinearCurve())),
    );
    const radar = new RadarPlane(
      {},
      new Axis({ orientation: 'angle', min: 0, max: 5, tickCount: 6, nice: false }, new LinearScale()),
      new Axis({ orientation: 'radius', min: 0, max: 10 }, new LinearScale()),
      new DomainSeries({}, flat([1, 4, 9, 3, 6]), new LinePath(new LinearCurve())),
    );
    const values = new Map<Plane, number[]>([
      [cases[0]!, [1, 2, 3]],
      [polar, [1, 4, 9]],
      [radar, [1, 4, 9, 3, 6]],
    ]);
    for (const plane of [cases[0]!, polar, radar]) {
      const series = plane.series[0]!;
      mount(plane);
      const p = series.points;
      for (let i = 0; i < p.count; i++) {
        const [f, s] = plane.unplace(p.data[2 * i]!, p.data[2 * i + 1]!, series.firstAxis, series.secondAxis);
        near(f, i, 1e-6);
        near(s, values.get(plane)![i]!, 1e-6);
      }
    }
  }

  // ── interpolate: a straight line between the two points either side, in data terms, placed like any point.
  {
    const line = new DomainSeries({ name: 'l' }, flat([2, 8, 2, NaN, 4]), new LinePath(new LinearCurve()));
    const off = new DomainSeries({ hit: false }, flat([2, 8]), new LinePath(new LinearCurve()));
    const xy = new XYSeries(
      { x: 'x' },
      new ObjectDataSource({
        source: [
          { x: 1, y: 1 },
          { x: 4, y: 4 },
        ],
        channels: { x: 'x', y: 'y' },
      }),
      new LinePath(new LinearCurve()),
    );
    const plane = new CartesianPlane({}, xAxis(), yAxis(), line, off, xy);
    mount(plane);
    const w = plane.rect.width,
      h = plane.rect.height;
    const mid = interpolate(line, 0.5)!;
    assert.equal(mid.interpolated, true);
    near(mid.first, 0.5);
    near(mid.second, 5);
    near(mid.px, w * 0.05, 1e-6);
    near(mid.py, h * 0.5, 1e-6);
    assert.equal(mid.index, 1, 'halfway: the later point is the nearer');
    assert.equal(interpolate(line, 0.25)!.index, 0);
    near(interpolate(line, 1.5)!.second, 5);
    near(interpolate(line, 2)!.second, 2, 1e-9); // exactly on a point
    assert.equal(interpolate(line, 2.5), null, 'nothing across a gap');
    assert.equal(interpolate(line, -0.1), null, 'nor before the data');
    assert.equal(interpolate(line, 4.1), null, 'nor after it');
    assert.equal(interpolate(off, 0.5), null, 'a series that takes no hits');
    assert.equal(interpolate(xy, 2), null, 'an XY series has no domain to read along');
    // The plane reads every series at the pointer's own position, topmost first.
    const all = interpolateAll(plane, w * 0.05, h * 0.9);
    assert.deepEqual(
      all.map((x) => x.series),
      [line],
    );
    near(all[0]!.second, 5);
  }
  // ── ... and on a polar plane the domain is the angle.
  {
    const line = new DomainSeries({}, flat([2, 8]), new LinePath(new LinearCurve()));
    const plane = new PolarPlane(
      {},
      new Axis({ orientation: 'angle', min: 0, max: 4 }, new LinearScale()),
      new Axis({ orientation: 'radius', min: 0, max: 10 }, new LinearScale()),
      line,
    );
    mount(plane);
    const h = interpolate(line, 0.5)!;
    near(h.second, 5);
    const [f, s] = plane.unplace(h.px, h.py, line.firstAxis, line.secondAxis);
    near(f, 0.5, 1e-6);
    near(s, 5, 1e-6);
  }
});

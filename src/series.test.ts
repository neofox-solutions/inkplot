// Series: a DomainSeries windows a domain and an XYSeries follows an order; either gives renderers [first, second, ...channels].
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  PolarPlane,
  Axis,
  LinearScale,
  XYSeries,
  DomainSeries,
  LinePath,
  AreaPath,
  CircleMarker,
  ScalarAxis,
  ObjectDataSource,
  FlatDataSource,
  Decimator,
  MinMaxKernel,
  StringPlatform,
  type Plane,
} from './index.ts';
import { test } from 'vite-plus/test';

test('series', () => {
  const lin = () => new LinearScale();
  const near = (a: number, b: number, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
  function render(plane: Plane, size = 400) {
    const chart = new Chart({ theme: lightTheme, width: size, height: size }, plane);
    chart.attach(new StringPlatform({ width: size, height: size }));
    chart.flush();
    return chart;
  }

  // Not ascending in x, and x is not the order: the points keep the order of the rows.
  const rows = [
    { x: 1, y: 2, w: 20 },
    { x: 9, y: 4, w: 40 },
    { x: 5, y: 8, w: 80 },
    { x: 3, y: 6, w: 60 },
  ];
  const source = () => new ObjectDataSource({ source: rows, value: 'y', channels: { x: 'x', w: 'w' } });

  // ── An XY series puts x on the first axis and y on the second, in the order given, with the domain as the index.
  {
    const x = new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin()),
      y = new Axis({ orientation: 'left', min: 0, max: 10 }, lin());
    const series = new XYSeries({ x: 'x' }, source(), new LinePath(new LinearCurve()));
    const plane = new CartesianPlane({}, x, y, series);
    render(plane);
    const p = series.points,
      w = plane.rect.width,
      h = plane.rect.height;
    assert.equal(p.count, 4);
    assert.equal(p.stride, 2, 'no bound channels: just the two coordinates');
    rows.forEach((r, i) => {
      near(p.data[2 * i]!, (r.x / 10) * w);
      near(p.data[2 * i + 1]!, (1 - r.y / 10) * h);
    });
    assert.deepEqual(source().domain(), { min: 0, max: 3 }, 'without a domain it is the row index');
    assert.equal(series.extentFor(x)?.min, 1);
    assert.equal(series.extentFor(x)?.max, 9);
    assert.deepEqual(series.extentFor(y), { min: 2, max: 8 });
    assert.equal(series.extentFor(new Axis({}, lin())), null, 'nothing for an axis it does not use');
  }

  // ── Axes that are not fixed fit all the data, with no window.
  {
    const x = new Axis({ orientation: 'bottom' }, lin()),
      y = new Axis({ orientation: 'left' }, lin());
    render(new CartesianPlane({}, x, y, new XYSeries({ x: 'x' }, source(), new LinePath(new LinearCurve()))));
    assert(x.range.min <= 1 && x.range.max >= 9, `x covers its data: ${JSON.stringify(x.range)}`);
    assert(y.range.min <= 2 && y.range.max >= 8, `y covers its data: ${JSON.stringify(y.range)}`);
  }

  // ── Bound channels follow the two coordinates, however the data was laid out.
  {
    const size = new ScalarAxis({ id: 'w', output: [2, 10] }, lin());
    const x = new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin()),
      y = new Axis({ orientation: 'left', min: 0, max: 10 }, lin());
    const series = new XYSeries({ x: 'x' }, source(), new CircleMarker({ bind: { size: { axis: size, channel: 'w' } } }));
    const plane = new CartesianPlane({}, x, y, series);
    const chart = new Chart({ theme: lightTheme, width: 400, height: 400 }, plane, size);
    chart.attach(new StringPlatform({ width: 400, height: 400 }));
    chart.flush();
    const p = series.points;
    assert.equal(p.stride, 3);
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => p.data[3 * i + 2]),
      [20, 40, 80, 60],
      'the channel column holds the data, in the row order',
    );
    near(p.data[3]!, 0.9 * plane.rect.width); // x of row 1 was placed, ahead of the channel
    assert.deepEqual(size.range, { min: 20, max: 80 }, 'the mapped axis covers all of the channel');
  }

  // ── Interleaved x,y pairs in a typed array: the same series, no copy of the source.
  {
    const flat = new FlatDataSource({
      data: new Float64Array([1, 2, 9, 4, 5, 8]),
      stride: 2,
      regularDomain: { start: 0, step: 1 },
      valueOffset: 1,
      channels: { x: 0 },
    });
    const x = new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin()),
      y = new Axis({ orientation: 'left', min: 0, max: 10 }, lin());
    const series = new XYSeries({ x: 'x' }, flat, new LinePath(new LinearCurve()));
    const plane = new CartesianPlane({}, x, y, series);
    render(plane);
    near(series.points.data[2]!, 0.9 * plane.rect.width);
    near(series.points.data[3]!, 0.6 * plane.rect.height);
  }

  // ── Wrap closes a loop: the first point once more, one period on.
  {
    const x = new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin()),
      y = new Axis({ orientation: 'left', min: 0, max: 10 }, lin());
    const loop = new ObjectDataSource({ source: rows, value: 'y', channels: { x: 'x' }, wrap: 4 });
    const series = new XYSeries({ x: 'x' }, loop, new LinePath(new LinearCurve()));
    render(new CartesianPlane({}, x, y, series));
    const p = series.points;
    assert.equal(p.count, 5);
    assert.deepEqual([p.data[8], p.data[9]], [p.data[0], p.data[1]], 'the loop meets itself');
  }

  // ── The same series on a polar plane: first coordinate round, second out.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 360 }, lin()),
      radius = new Axis({ orientation: 'radius', min: 0, max: 10 }, lin());
    const spots = new ObjectDataSource({
      source: [
        { a: 90, r: 10 },
        { a: 0, r: 5 },
      ],
      value: 'r',
      channels: { a: 'a' },
    });
    const series = new XYSeries({ x: 'a' }, spots, new LinePath(new LinearCurve()));
    const plane = new PolarPlane({}, angle, radius, series);
    render(plane);
    const p = series.points,
      R = plane.radius,
      cx = plane.rect.width / 2,
      cy = plane.rect.height / 2;
    near(p.data[0]!, cx + R, 0.01);
    near(p.data[1]!, cy, 0.01); // 90°, full radius: three o'clock
    near(p.data[2]!, cx, 0.01);
    near(p.data[3]!, cy - R / 2, 0.01); // 0°, half radius: above the middle
  }

  // ── An area on an XY series is held to its baseline: the same x, y at the baseline.
  {
    const x = new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin()),
      y = new Axis({ orientation: 'left', min: 0, max: 10 }, lin());
    const series = new XYSeries({ x: 'x' }, source(), new AreaPath(new LinearCurve()));
    const plane = new CartesianPlane({}, x, y, series);
    render(plane);
    const b = series.baseline(0);
    rows.forEach((_, i) => {
      near(b.data[2 * i]!, series.points.data[2 * i]!);
      near(b.data[2 * i + 1]!, plane.rect.height);
    });
  }

  // ── What an XY series cannot take: thinning by domain, which here is only an order.
  {
    const x = new Axis({ orientation: 'bottom' }, lin()),
      y = new Axis({ orientation: 'left' }, lin());
    const series = new XYSeries({ x: 'x' }, new Decimator({}, new MinMaxKernel(), source()), new LinePath(new LinearCurve()));
    assert.throws(() => render(new CartesianPlane({}, x, y, series)), /position on an axis/);
    // The same decimator is fine on a domain series.
    const ok = new DomainSeries(
      new Decimator({}, new MinMaxKernel(), new ObjectDataSource({ source: rows, domain: 'x', value: 'y' })),
      new LinePath(new LinearCurve()),
    );
    render(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, lin()), new Axis({ orientation: 'left' }, lin()), ok));
  }

  // ── The compiler checks the x channel against the source's channels.
  {
    new XYSeries({ x: 'x' }, source(), new LinePath(new LinearCurve()));
    // @ts-expect-error the source has channels x and w, not z
    new XYSeries({ x: 'z' }, source(), new LinePath(new LinearCurve()));
    // @ts-expect-error a source with only w has no x
    new XYSeries({ x: 'x' }, new ObjectDataSource({ source: rows, value: 'y', channels: { w: 'w' } }), new LinePath(new LinearCurve()));
    // @ts-expect-error a source with no channels at all has none to be x
    new XYSeries({ x: 'x' }, new ObjectDataSource({ source: rows, value: 'y', channels: {} }), new LinePath(new LinearCurve()));
    new XYSeries(
      { x: 'x' },
      new FlatDataSource({ data: new Float64Array(4), stride: 2, regularDomain: { start: 0, step: 1 }, channels: { x: 0 } }),
      new LinePath(new LinearCurve()),
    );
    new XYSeries(
      { x: 'q' },
      // @ts-expect-error a typed-array source's channels are checked the same way
      new FlatDataSource({ data: new Float64Array(4), stride: 2, regularDomain: { start: 0, step: 1 }, channels: { x: 0 } }),
      new LinePath(new LinearCurve()),
    );
    // A transform does not say what it offers, so it is not checked: its source's channels are checked when it fills.
    new XYSeries({ x: 'anything' }, new Decimator({}, new MinMaxKernel(), source()), new LinePath(new LinearCurve()));
    new XYSeries({ x: 'x' }, source()); // renderers are optional
  }
  // ── Missing values: a line breaks at them by default, can go across them, or take them as zero.
  {
    const data = () =>
      new FlatDataSource({ data: Float64Array.from([4, 6, NaN, 8, 5, Infinity, 7]), regularDomain: { start: 0, step: 1 } });
    const draw = (gaps: 'break' | 'connect' | 'zero' | undefined, renderer: () => LinePath | AreaPath) => {
      const series = new DomainSeries({ gaps }, data(), renderer());
      const x = new Axis({ orientation: 'bottom', min: 0, max: 6 }, lin()),
        y = new Axis({ orientation: 'left' }, lin());
      const plane = new CartesianPlane({}, x, y, series);
      const platform = new StringPlatform({ width: 400, height: 300 });
      const chart = new Chart({ theme: lightTheme, width: 400, height: 300 }, plane);
      chart.attach(platform);
      chart.flush();
      return { series, y, svg: platform.toString(), plane };
    };
    const paths = (svg: string, re: RegExp) => [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]!).filter((d) => re.test(d));
    const count = (d: string, ch: string) => d.split(ch).length - 1;

    const broken = draw(undefined, () => new LinePath(new LinearCurve())),
      connected = draw('connect', () => new LinePath(new LinearCurve()));
    const pen = (svg: string) => paths(svg, /^M[\d.-]+ [\d.-]+L/)[0]!;
    assert.equal(count(pen(broken.svg), 'M'), 3, 'three runs: 4 6, 8 5, 7');
    assert.equal(count(pen(connected.svg), 'M'), 1, 'one run when connected');
    assert.equal(pen(connected.svg).split(/[ML ]/).filter(Boolean).length / 2, 5, 'five points, the gaps left out');

    const zero = draw('zero', () => new LinePath(new LinearCurve()));
    assert.equal(count(pen(zero.svg), 'M'), 1, 'a gap is a point, so one run');
    assert(zero.y.range.min <= 0, `the axis reaches zero: ${JSON.stringify(zero.y.range)}`);
    const p = zero.series.points,
      h = zero.plane.rect.height;
    near(p.data[2 * 2 + 1]!, (1 - (0 - zero.y.range.min) / (zero.y.range.max - zero.y.range.min)) * h);
    assert.equal(zero.series.extentFor(zero.y)?.min, 4, 'what a reading or a zoom limit sees is the data');
    const noGap = new DomainSeries(
      { gaps: 'zero' },
      new FlatDataSource({ data: Float64Array.from([4, 6]), regularDomain: { start: 0, step: 1 } }),
      new LinePath(new LinearCurve()),
    );
    const ny = new Axis({ orientation: 'left' }, lin());
    render(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, lin()), ny, noGap));
    assert(ny.range.min > 0, 'with no gap the axis is not asked for zero');

    // An area breaks into shapes, joins into one, or sits on the baseline.
    const areaPath = (g: 'break' | 'connect' | 'zero' | undefined) => paths(draw(g, () => new AreaPath(new LinearCurve())).svg, /Z$/)[0]!;
    assert.equal(count(areaPath(undefined), 'Z'), 3);
    assert.equal(count(areaPath('connect'), 'Z'), 1);
    assert.equal(count(areaPath('connect'), 'M'), 1);
    assert.equal(count(areaPath('zero'), 'Z'), 1);
    assert.equal(
      areaPath('connect')
        .split(/[MLZ ]/)
        .filter(Boolean).length,
      20,
      'five points forward and five back, each two numbers',
    );

    // Markers draw nothing at a gap whatever the policy.
    const dots = draw('connect', () => new LinePath(new LinearCurve()));
    assert.equal(Number.isNaN(dots.series.points.data[2 * 2 + 1]), true, 'the point is still a gap for what reads it');
  }
});

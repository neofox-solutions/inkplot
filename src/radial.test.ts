// Radial planes: polar and radar place the same normalized points, so lines and areas need no special cases.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Plane,
  Chart,
  CartesianPlane,
  PolarPlane,
  RadarPlane,
  Axis,
  LinearScale,
  DomainSeries,
  LinePath,
  AreaPath,
  ObjectDataSource,
  StringPlatform,
} from './index.ts';
import { test } from 'vite-plus/test';

test('radial', () => {
  const near = (a: number, b: number, tol = 0.02) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
  type Row = { a: number; r: number };
  const data = (rows: Row[]) => new ObjectDataSource({ source: rows, domain: 'a', value: 'r', isSorted: true });
  const lin = () => new LinearScale();

  function render(plane: Plane, size = 400) {
    const chart = new Chart({ theme: lightTheme, width: size, height: size }, plane);
    const platform = new StringPlatform({ width: size, height: size });
    chart.attach(platform);
    chart.flush();
    return { chart, svg: platform.toString() };
  }
  const pathD = (svg: string, _key: string) =>
    [...svg.matchAll(/<path[^>]*? d="([^"]*)"/g)]
      .map((m) => m[1]!)
      .filter((d) => d.includes('L') && d.endsWith('Z'))
      .pop();

  // ── Where the polar plane puts things: angle clockwise from the top, radius from the middle.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 360 }, lin());
    const radius = new Axis({ orientation: 'radius', min: 0, max: 10 }, lin());
    const series = new DomainSeries(
      data([
        { a: 0, r: 10 },
        { a: 90, r: 10 },
        { a: 180, r: 5 },
        { a: 270, r: 0 },
        { a: 360, r: 10 },
      ]),
      new LinePath(new LinearCurve()),
    );
    const plane = new PolarPlane({}, angle, radius, series);
    render(plane);
    const p = series.points,
      R = plane.radius,
      cx = plane.rect.width / 2,
      cy = plane.rect.height / 2;
    assert(R > 100, 'the circle fills the plot');
    const at = (i: number) => [p.data[i * p.stride]!, p.data[i * p.stride + 1]!];
    near(at(0)[0]!, cx);
    near(at(0)[1]!, cy - R); // zero is twelve o'clock, full radius
    near(at(1)[0]!, cx + R);
    near(at(1)[1]!, cy); // a quarter turn is three o'clock
    near(at(2)[0]!, cx);
    near(at(2)[1]!, cy + R / 2); // half a turn, half the radius: below the middle
    near(at(3)[0]!, cx);
    near(at(3)[1]!, cy); // radius zero is the centre, whatever the angle
    near(at(4)[0]!, at(0)[0]!);
    near(at(4)[1]!, at(0)[1]!); // 360 is back at the start
  }

  // ── Start angle, sweep and a hole in the middle.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 1 }, lin());
    const radius = new Axis({ orientation: 'radius', min: 0, max: 1 }, lin());
    const series = new DomainSeries(
      data([
        { a: 0, r: 0 },
        { a: 1, r: 1 },
      ]),
      new LinePath(new LinearCurve()),
    );
    const plane = new PolarPlane({ startAngle: Math.PI / 2, sweep: -Math.PI / 2, innerRadius: 0.5 }, angle, radius, series);
    render(plane);
    const p = series.points,
      R = plane.radius,
      cx = plane.rect.width / 2,
      cy = plane.rect.height / 2;
    near(p.data[0]!, cx + R / 2);
    near(p.data[1]!, cy); // starts at three o'clock, on the inner ring
    near(p.data[2]!, cx);
    near(p.data[3]!, cy - R); // a negative sweep runs anticlockwise: a quarter turn to twelve, at the rim
  }

  // ── An area is the data forward and the baseline back, on a rectangle and on a circle alike.
  {
    const rows = [
      { a: 0, r: 2 },
      { a: 5, r: 4 },
      { a: 10, r: 2 },
    ];
    const flat = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin()),
      new Axis({ orientation: 'left', min: 0, max: 4 }, lin()),
      new DomainSeries(data(rows), new AreaPath(new LinearCurve())),
    );
    const d = pathD(render(flat).svg, 'Z')!;
    assert.match(d, /^M[\d. ]+L[\d. ]+Z$/, 'one closed shape');
    const w = flat.rect.width,
      h = flat.rect.height;
    assert.equal(d.split(/[ML]/).filter(Boolean).join(' ').split(' ').length, 12, 'three points out, three back');
    assert(d.endsWith(`${(0).toString()} ${h}Z`) || d.includes(`${h} 0 ${h} Z`) || d.includes(` ${h} `), 'the baseline is the bottom edge');
    assert(d.includes(`${w} ${h}`), 'the far end drops to the baseline');

    const ring = new PolarPlane(
      {},
      new Axis({ orientation: 'angle', min: 0, max: 10 }, lin()),
      new Axis({ orientation: 'radius', min: 0, max: 4 }, lin()),
      new DomainSeries(data(rows), new AreaPath({ baseline: 1 }, new LinearCurve())),
    );
    const svg = render(ring).svg;
    const dp = pathD(svg, 'Z')!;
    assert.match(dp, /^M[\d. ]+L[\d. ]+Z$/, 'also closed, by the same code');
    // The baseline half is the three points again at a quarter of the radius, in reverse.
    const nums = dp.slice(1, -1).replace('L', ' ').split(' ').map(Number);
    assert.equal(nums.length, 12);
    const cx = ring.rect.width / 2,
      cy = ring.rect.height / 2;
    for (const k of [3, 4, 5]) {
      const x = nums[2 * k]! - cx,
        y = nums[2 * k + 1]! - cy;
      near(Math.hypot(x, y), ring.radius / 4, 0.1);
    }
    near(nums[6]!, nums[10]!, 0.1); // 0 and 10 are the same angle: the baseline comes back to where it began
  }

  // ── Axes are drawn along the rim and a spoke, with gridlines to match; the wrong axes are refused.
  {
    const plane = new PolarPlane(
      {},
      new Axis({}, lin()),
      new Axis({}, lin()),
      new DomainSeries(
        data([
          { a: 0, r: 1 },
          { a: 360, r: 9 },
        ]),
        new LinePath(new LinearCurve()),
      ),
    );
    const { svg } = render(plane);
    assert.match(svg, /<path[^>]* d="M[^"]*A[^"]*"/, 'the rim is an arc');
    assert.match(svg, /clipPath/);
    const labels = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    assert((labels.includes('0') && labels.includes('90')) || labels.includes('100'), `tick labels around the rim: ${labels.join()}`);
    assert.throws(() => render(new PolarPlane({}, new Axis({ orientation: 'bottom' }, lin()))), /CartesianPlane/);
    assert.throws(() => render(new CartesianPlane({}, new Axis({ orientation: 'angle' }, lin()))), /PolarPlane/);
  }

  // ── Radar: spokes at the ticks, chords between them, for rings and data alike.
  {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    const angle = new Axis({ orientation: 'angle', min: 0, max: 6, tickCount: 7, format: (v) => names[v] ?? '' }, lin());
    const radius = new Axis({ orientation: 'radius', min: 0, max: 10, tickCount: 3 }, lin());
    const rows = [3, 8, 5, 10, 2, 6].map((r, a) => ({ a, r }));
    const series = new DomainSeries(
      new ObjectDataSource({ source: rows, domain: 'a', value: 'r', isSorted: true, wrap: 6 }),
      new AreaPath(new LinearCurve()),
      new LinePath(new LinearCurve()),
    ); // wrap closes the turn
    const plane = new RadarPlane({}, angle, radius, series);
    const { svg } = render(plane);
    const R = plane.radius,
      cx = plane.rect.width / 2,
      cy = plane.rect.height / 2,
      p = series.points;
    // Category 1 is a sixth of the way round, at 8/10 of the radius.
    const a1 = Math.PI / 3;
    near(p.data[2]!, cx + 0.8 * R * Math.sin(a1));
    near(p.data[3]!, cy - 0.8 * R * Math.cos(a1));
    near(p.data[12]!, p.data[0]!);
    near(p.data[13]!, p.data[1]!);

    // A point halfway between spokes is halfway along the chord, not on the arc: nearer the middle than the radius says.
    const mid = new DomainSeries(
      data([
        { a: 0.5, r: 10 },
        { a: 5.5, r: 10 },
      ]),
      new LinePath(new LinearCurve()),
    );
    const plane2 = new RadarPlane(
      {},
      new Axis({ orientation: 'angle', min: 0, max: 6, tickCount: 7 }, lin()),
      new Axis({ orientation: 'radius', min: 0, max: 10 }, lin()),
      mid,
    );
    render(plane2);
    const m = mid.points,
      R2 = plane2.radius,
      c2 = [plane2.rect.width / 2, plane2.rect.height / 2];
    near(Math.hypot(m.data[0]! - c2[0]!, m.data[1]! - c2[1]!), R2 * Math.cos(Math.PI / 6), 0.5); // apothem of a hexagon

    // Rings are hexagons: six straight edges and no arcs; the polar plane has none of those.
    const grid = [...svg.matchAll(/<path[^>]* d="(M[^"]*)"[^>]* stroke="#e6e6e6"/g)].map((x) => x[1]!).join('');
    assert(grid.includes('L') && !grid.includes('A'), 'chords, not arcs');
    assert.match(svg, /clipPath/);
    const labels = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((x) => x[1]);
    for (const n of names) assert(labels.includes(n), `spoke label ${n}`);
    // The area is a closed polygon whose baseline half is the centre.
    const d = pathD(svg, 'Z')!;
    const nums = d.slice(1, -1).replace('L', ' ').split(' ').map(Number);
    assert.equal(nums.length, 28);
    for (let k = 7; k < 14; k++) {
      near(nums[2 * k]!, cx, 0.2);
      near(nums[2 * k + 1]!, cy, 0.2);
    }
  }
  console.log('ok radial');

  // ── A ring at an infinite radius draws nothing.
  {
    const series = new DomainSeries(
      data([
        { a: 0, r: 10 },
        { a: 180, r: 5 },
      ]),
      new LinePath(new LinearCurve()),
    );
    const plane = new PolarPlane(
      {},
      new Axis({ orientation: 'angle', min: 0, max: 360 }, lin()),
      new Axis({ orientation: 'radius', min: 0, max: 10 }, lin()),
      series,
    );
    render(plane);
    assert.match(plane.guide('second', 5), /^M/, 'a finite value gets a ring');
    for (const v of [NaN, Infinity, -Infinity]) assert.equal(plane.guide('second', v), '', `no ring at ${v}`);
  }
});

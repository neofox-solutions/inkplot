// Exact paths: every plane draws straight lines in its own terms, and `PlaneCurve` is a curve that asks the plane to.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  AreaPath,
  Axis,
  CartesianPlane,
  Chart,
  DomainSeries,
  FlatDataSource,
  LinePath,
  LinearCurve,
  LinearScale,
  PlaneCurve,
  PolarPlane,
  RadarPlane,
  StringPlatform,
  type Plane,
} from './index.ts';
import { lightTheme } from './themes.ts';

test('exact paths', () => {
  const near = (a: number, b: number, tol = 0.02, what = '') => assert(Math.abs(a - b) <= tol, `${what} ${a} is not ${b}`);
  const lin = () => new LinearScale();
  function show(plane: Plane, size = 400) {
    const platform = new StringPlatform({ width: size, height: size });
    const chart = new Chart({ theme: lightTheme, width: size, height: size }, plane);
    chart.attach(platform);
    chart.flush();
    return platform.toString();
  }
  const parse = (d: string) =>
    [...d.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)].map((m) => [m[1]!, (m[2]!.match(/-?[\d.]+/g) ?? []).map(Number)] as const);
  const placed = (plane: Plane, first: Axis, second: Axis, a: number, b: number): [number, number] => {
    const p = { data: new Float64Array([a, b]), stride: 2, count: 1 };
    plane.place(p, first, second);
    return [p.data[0]!, p.data[1]!];
  };
  const flat = (...v: number[][]) => Float64Array.from(v.flat());

  // ── A rectangle: straight lines from vertex to vertex, a gap lifts the pen, closed runs end in Z.
  {
    const first = new Axis({ orientation: 'bottom', min: 0, max: 1 }, lin()),
      second = new Axis({ orientation: 'left', min: 0, max: 1 }, lin());
    const plane = new CartesianPlane({}, first, second);
    show(plane);
    const d = plane.exactPath(flat([0, 0], [0.5, 0.8], [1, 0.2], [NaN, NaN], [0.1, 0.1], [0.3, 0.3]), 6, first, second);
    const cmds = parse(d);
    assert.deepEqual(
      cmds.map((c) => c[0]),
      ['M', 'L', 'L', 'M', 'L'],
    );
    const [x, y] = placed(plane, first, second, 0.5, 0.8);
    near(cmds[1]![1][0]!, x);
    near(cmds[1]![1][1]!, y);
    assert.match(plane.exactPath(flat([0, 0], [1, 0], [1, 1]), 3, first, second, true), /Z$/);
    assert.equal(plane.exactPath(flat([NaN, 0]), 1, first, second), '');
  }

  // ── A polar plane: a move along one axis is the arc or spoke the plane draws; a diagonal is a spiral of short chords, each vertex where `place` puts it.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 1 }, lin()),
      radius = new Axis({ orientation: 'radius', min: 0, max: 1 }, lin());
    const plane = new PolarPlane({}, angle, radius);
    show(plane);
    const R = plane.radius,
      cx = plane.rect.width / 2,
      cy = plane.rect.height / 2;
    const arcs = parse(plane.exactPath(flat([0, 0.5], [0.5, 0.5]), 2, angle, radius));
    assert(
      arcs.some((c) => c[0] === 'A'),
      'a move round at one radius is an arc',
    );
    for (const c of arcs.filter((q) => q[0] === 'A')) near(c[1][0]!, R * 0.5, 0.05, 'arc radius');
    assert.equal(parse(plane.exactPath(flat([0.25, 0.2], [0.25, 0.9]), 2, angle, radius)).length, 2, 'a move along the radius is a spoke');
    // The spiral: from (angle 0, radius 0.2) to (angle 0.5, radius 0.8).
    const spiral = parse(plane.exactPath(flat([0, 0.2], [0.5, 0.8]), 2, angle, radius));
    assert(spiral.length > 10, 'cut into pieces');
    let last = -1;
    for (const [cmd, nums] of spiral) {
      assert(cmd === 'M' || cmd === 'L');
      const r = Math.hypot(nums[0]! - cx, nums[1]! - cy) / R,
        th = Math.atan2(nums[0]! - cx, -(nums[1]! - cy)) / (2 * Math.PI);
      // On the line from (0, 0.2) to (0.5, 0.8): the radius is 0.2 + 1.2 * angle fraction.
      near(r, 0.2 + 1.2 * (th < -1e-9 ? th + 1 : th), 0.005, 'on the spiral');
      assert(r >= last - 1e-6, 'outwards');
      last = r;
    }
    // A full turn at one radius is more than one arc, and a closed shape comes back.
    assert(/Z$/.test(plane.exactPath(flat([0, 0.2], [0.5, 0.8], [0.5, 0.2]), 3, angle, radius, true)));
    // Swapped axes (the value is the angle) work too.
    assert(parse(plane.exactPath(flat([0.5, 0], [0.5, 0.5]), 2, radius, angle)).some((c) => c[0] === 'A'));
  }

  // ── A radar: a vertex at each spoke the move crosses, none beyond.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 6, tickCount: 6, nice: false }, lin()),
      radius = new Axis({ orientation: 'radius', min: 0, max: 1 }, lin());
    const plane = new RadarPlane({}, angle, radius);
    show(plane);
    const d = parse(plane.exactPath(flat([0.1, 0.2], [0.9, 0.8]), 2, angle, radius));
    assert.equal(d.length, 1 + 5 + 1 - 0, 'start, the five spokes between, and the end (spokes at 0, 1/6 .. 1)');
    // Each vertex is where `place` puts the point at that angle on the line.
    for (const [i, [, nums]] of d.entries()) {
      const spokes = [0.1, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 0.9];
      const a = spokes[i]!,
        r = 0.2 + ((a - 0.1) / 0.8) * 0.6;
      const [x, y] = placed(plane, angle, radius, a, r);
      near(nums[0]!, x, 0.02, `vertex ${i} x`);
      near(nums[1]!, y, 0.02, `vertex ${i} y`);
    }
  }

  // ── PlaneCurve: the same line as LinearCurve on a rectangle; on a polar plane a smooth spiral where LinearCurve is a chord.
  {
    const build = (curve: PlaneCurve | LinearCurve, polar: boolean) => {
      const series = new DomainSeries(
        new FlatDataSource({ data: Float64Array.from([1, 3, 2, NaN, 5, 4]), regularDomain: { start: 0, step: 1 } }),
        new LinePath(curve),
      );
      const plane = polar
        ? new PolarPlane(
            {},
            new Axis({ orientation: 'angle', min: 0, max: 5 }, lin()),
            new Axis({ orientation: 'radius', min: 0, max: 6 }, lin()),
            series,
          )
        : new CartesianPlane(
            {},
            new Axis({ orientation: 'bottom', min: 0, max: 5 }, lin()),
            new Axis({ orientation: 'left', min: 0, max: 6 }, lin()),
            series,
          );
      show(plane);
      return curve.line(series);
    };
    // The same vertices and gaps; LinearCurve only leaves out the repeated `L`.
    const norm = (d: string) => ({ moves: parse(d).filter((c) => c[0] === 'M').length, nums: d.match(/-?[\d.]+/g) });
    assert.deepEqual(norm(build(new PlaneCurve(), false)), norm(build(new LinearCurve(), false)));
    const exact = build(new PlaneCurve(), true),
      plain = build(new LinearCurve(), true);
    assert(parse(exact).length > 3 * parse(plain).length, 'a spiral is more pieces than chords');
    assert.equal(parse(exact).filter((c) => c[0] === 'M').length, 2, 'the gap lifts the pen');
  }
  // ── An area between PlaneCurve's line and the baseline is closed shapes, one for each run.
  {
    const series = new DomainSeries(
      new FlatDataSource({ data: Float64Array.from([1, 3, NaN, 4, 2]), regularDomain: { start: 0, step: 1 } }),
      new AreaPath(new PlaneCurve()),
    );
    const plane = new PolarPlane(
      {},
      new Axis({ orientation: 'angle', min: 0, max: 4 }, lin()),
      new Axis({ orientation: 'radius', min: 0, max: 5 }, lin()),
      series,
    );
    const svg = show(plane);
    const d = [...svg.matchAll(/ d="(M[^"]*Z)"/g)].map((m) => m[1]!).find((p) => p.includes('A') && p.includes('L'));
    assert(d, 'the area is drawn');
    assert.equal(d.split('Z').filter(Boolean).length, 2, 'two shapes');
  }
});

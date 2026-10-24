import type { AnySeriesRenderer } from './renderer.ts';
// Steps: before, after and centre on a rectangle, a horizontal one, a circle and a radar; gaps; areas; stacks.
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
  Stack,
  StepCurve,
  LinearCurve,
  AreaPath,
  FlatDataSource,
  StringPlatform,
  stepLines,
  hitTest,
  interpolate,
  LinePath,
  type Plane,
  type StepMode,
} from './index.ts';
import { test } from 'vite-plus/test';

test('steps', () => {
  const near = (a: number, b: number, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
  function mount(plane: Plane, size = 400) {
    const chart = new Chart({ theme: lightTheme, width: size, height: size }, plane);
    const platform = new StringPlatform({ width: size, height: size });
    chart.attach(platform);
    chart.flush();
    return platform.toString();
  }
  const flat = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start: 0, step: 1 } });
  const lin = () => new LinearScale();
  const pairs = (b: { data: Float64Array; count: number }) =>
    Array.from({ length: b.count }, (_, i) => [b.data[2 * i]!, b.data[2 * i + 1]!] as const);
  const real = (p: readonly [number, number]) => Number.isFinite(p[0]);

  /** A rectangular plane with fixed axes (so no room is added) 0..3 by 0..5, and the values in pixels of a data position. */
  function rect(ys: number[], renderer: AnySeriesRenderer, attrs: object = {}) {
    const series = new DomainSeries(attrs, flat(ys), renderer);
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom', min: 0, max: ys.length - 1 }, lin()),
      new Axis({ orientation: 'left', min: 0, max: 5 }, lin()),
      series,
    );
    const svg = mount(plane);
    const w = plane.rect.width,
      h = plane.rect.height,
      last = ys.length - 1;
    return { series, plane, svg, at: (x: number, y: number) => [(x / last) * w, (1 - y / 5) * h] as const };
  }

  // ── The three modes give exactly these corners.
  {
    const ys = [1, 3, 2, 5];
    const expected: Record<StepMode, [number, number][]> = {
      after: [
        [0, 1],
        [1, 1],
        [1, 3],
        [2, 3],
        [2, 2],
        [3, 2],
        [3, 5],
      ],
      before: [
        [0, 1],
        [0, 3],
        [1, 3],
        [1, 2],
        [2, 2],
        [2, 5],
        [3, 5],
      ],
      center: [
        [0, 1],
        [0.5, 1],
        [0.5, 3],
        [1, 3],
        [1.5, 3],
        [1.5, 2],
        [2, 2],
        [2.5, 2],
        [2.5, 5],
        [3, 5],
      ],
    };
    for (const mode of ['after', 'before', 'center'] as const) {
      const { series, at, svg } = rect(ys, new LinePath(new StepCurve({ mode })));
      const s = stepLines(series, mode, null)!;
      const got = pairs(s.top),
        want = expected[mode].map(([x, y]) => at(x, y));
      assert.equal(got.length, want.length + 1, `${mode}: the corners and the end of the run`);
      want.forEach(([x, y], i) => {
        near(got[i]![0], x);
        near(got[i]![1], y);
      });
      assert(!real(got[got.length - 1]!), 'a run ends with a gap point');
      assert.equal(s.base, null, 'a line needs no foot');
      assert.match(svg, /<path[^>]*d="M[\d. -]+[HVL][\d. HVL-]+"[^>]*stroke-linejoin/, `${mode}: drawn as a path`);
    }
    // The default is `after`.
    const drawn = (m: StepMode | undefined) => rect(ys, new LinePath(new StepCurve(m ? { mode: m } : {}))).svg.replace(/clip\d+/g, 'clip');
    assert.equal(drawn(undefined), drawn('after'));
    assert.notEqual(drawn('before'), drawn('after'));
  }

  // ── A gap breaks the steps in two, can be connected across, or counts as zero.
  {
    const ys = [1, 3, NaN, 2, 4];
    const runs = (gaps: 'break' | 'connect' | 'zero') => {
      const { series } = rect(ys, new LinePath(new StepCurve({})), { missing: gaps });
      const p = pairs(stepLines(series, 'after', null)!.top);
      return { p, ends: p.filter((q) => !real(q)).length };
    };
    assert.equal(runs('break').ends, 2, 'two runs');
    assert.equal(runs('connect').ends, 1, 'one run across the gap');
    assert.equal(runs('zero').ends, 1, 'a zero is a point, so one run');
    // Connected, the 3 holds across to where the next real value is (x = 3).
    const c = runs('connect').p,
      { at } = rect(ys, new LinePath(new StepCurve({})), { missing: 'connect' });
    near(c[3]![0], at(3, 3)[0]);
    near(c[3]![1], at(3, 3)[1]);
    const z = runs('zero').p;
    assert(
      z.some((q) => Math.abs(q[1] - rect(ys, new LinePath(new StepCurve({})), { missing: 'zero' }).at(2, 0)[1]) < 1e-6),
      'the zero is a level of its own',
    );
  }

  // ── An area fills between the steps and a baseline that steps with them.
  {
    const { series, at, svg } = rect([1, 3, 2, 5], new AreaPath(new StepCurve({ mode: 'after' })));
    const s = stepLines(series, 'after', 0)!;
    assert.equal(s.top.count, s.base!.count, 'the two have one shape');
    pairs(s.top).forEach((p, i) => {
      if (real(p)) {
        near(s.base!.data[2 * i]!, p[0]);
        near(s.base!.data[2 * i + 1]!, at(0, 0)[1]);
      }
    });
    const d = [...svg.matchAll(/<path[^>]*? d="([^"]*Z)"/g)].map((m) => m[1]!)[0]!;
    assert.equal(d.split('M').length - 1, 1, 'one closed shape');
    assert.match(d, /^M[\d. -]+(?:[HV][\d. -]+){6}V[\d. -]+H[\d. -]+Z$/, 'the steps forward, then straight back along the baseline');
    // A baseline value shifts the foot.
    const high = stepLines(rect([1, 3], new AreaPath({ baseline: 2 }, new StepCurve())).series, 'after', 2)!;
    near(high.base!.data[1]!, rect([1, 3], new AreaPath(new StepCurve({}))).at(0, 2)[1]);
    // A gap splits it, as it splits the line.
    const gappy = rect([1, NaN, 2, 3], new AreaPath(new StepCurve({}))).svg.match(/ d="([^"]*Z)"/)![1]!;
    assert.equal(gappy.split('M').length - 1, 2, 'two shapes');
  }

  // ── In a stack the foot of a step area is the step of the layer below.
  {
    const a = new DomainSeries({ name: 'a' }, flat([1, 3, 2]), new AreaPath(new StepCurve({}))),
      b = new DomainSeries({ name: 'b' }, flat([2, 1, 4]), new AreaPath(new StepCurve({})));
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom', min: 0, max: 2 }, lin()),
      new Axis({ orientation: 'left', min: 0, max: 8 }, lin()),
      new Stack({}, a, b),
    );
    mount(plane);
    const lower = stepLines(a, 'after', 0)!,
      upper = stepLines(b, 'after', 0)!;
    assert.deepEqual(Array.from(upper.base!.data), Array.from(lower.top.data), 'the upper one sits exactly on the lower one');
  }

  // ── The domain on the vertical axis: levels run up the plot and jumps across it.
  {
    const series = new DomainSeries({ domainAxis: 'd', valueAxis: 'v' }, flat([1, 3, 2]), new LinePath(new StepCurve({})));
    const plane = new CartesianPlane(
      {},
      new Axis({ id: 'd', orientation: 'left', min: 0, max: 2 }, lin()),
      new Axis({ id: 'v', orientation: 'bottom', min: 0, max: 5 }, lin()),
      series,
    );
    mount(plane);
    const p = pairs(stepLines(series, 'after', null)!.top);
    near(p[1]![0], p[0]![0]);
    assert(p[1]![1] !== p[0]![1], 'a level is vertical here: same x, new y');
    near(p[2]![1], p[1]![1]);
    assert(p[2]![0] !== p[1]![0], 'and the jump is across');
  }

  // ── On a circle a level is an arc and a jump a spoke: along each piece one of angle and radius stays put.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 8 }, lin()),
      radius = new Axis({ orientation: 'radius', min: 0, max: 5 }, lin());
    const series = new DomainSeries({}, flat([1, 4, 2, 5, 3, 4, 1, 3, 2]), new LinePath(new StepCurve({ mode: 'center' })));
    const plane = new PolarPlane({}, angle, radius, series);
    mount(plane);
    const p = pairs(stepLines(series, 'center', null)!.top).filter(real);
    assert(p.length > 3 * 9, `levels are cut into pieces to follow the circle: ${p.length} points for 9`);
    let levels = 0,
      jumps = 0;
    for (let i = 1; i < p.length; i++) {
      const [a0, r0] = plane.unplace(p[i - 1]![0], p[i - 1]![1], angle, radius),
        [a1, r1] = plane.unplace(p[i]![0], p[i]![1], angle, radius);
      const sameRadius = Math.abs(r1 - r0) < 1e-6,
        sameAngle = Math.abs(a1 - a0) < 1e-6 || Math.abs(Math.abs(a1 - a0) - 8) < 1e-6;
      assert(sameRadius || sameAngle, `piece ${i} moves along one only: angle ${a0}→${a1}, radius ${r0}→${r1}`);
      if (sameRadius && !sameAngle) levels++;
      else if (sameAngle && !sameRadius) jumps++;
    }
    assert(levels >= 9 && jumps >= 8, `${levels} level pieces and ${jumps} jumps`);
  }

  // ── On a radar a level follows the polygon exactly, with a point at each spoke it crosses.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 6, tickCount: 7 }, lin()),
      radius = new Axis({ orientation: 'radius', min: 0, max: 5 }, lin());
    const series = new DomainSeries({}, flat([2, 4, 3, 5, 2, 4, 1]), new LinePath(new StepCurve({ mode: 'after' })));
    const plane = new RadarPlane({}, angle, radius, series);
    mount(plane);
    const corners = plane.breaks(angle);
    assert(corners.length >= 6, 'the radar knows its spokes');
    const p = pairs(stepLines(series, 'after', null)!.top).filter(real);
    // Each step between consecutive points spans one spoke interval: a level has no corner strictly inside it, so it is one piece.
    assert.equal(p.length, 1 + 2 * 6, 'a point at each corner and none between: the chords are the polygon');
  }

  // ── Before the first projection there is nothing to draw.
  {
    const series = new DomainSeries({}, flat([1, 2]), new LinePath(new StepCurve({})));
    assert.equal(stepLines(series, 'after', null), null);
  }
  // ── Hits follow the steps drawn, not the chords between the points, and report the point whose level they are on.
  {
    const ys = [1, 5, 2];
    const hit = (mode: StepMode, x: number, y: number, how: 'line' | 'area' = 'line', radius = 3) => {
      const r = rect(ys, new LinePath(new StepCurve({ mode })), { hit: { mode: how, radius } });
      const [px, py] = r.at(x, y);
      return hitTest(r.series, px, py);
    };
    assert.equal(hit('after', 0.5, 1)?.index, 0, 'on the first level: the first point');
    assert.equal(hit('after', 0.5, 1)?.distance, 0);
    assert.equal(hit('after', 1.5, 5)?.index, 1, 'the level of the second');
    assert.equal(hit('after', 1, 4.7)?.index, 1, 'the top of a jump is the point it jumps to');
    assert.equal(hit('after', 1, 1.3)?.index, 0, 'the foot of it the point it leaves');
    assert.equal(hit('before', 0.5, 5)?.index, 1, "before: the level is the later point's");
    assert.equal(hit('center', 0.25, 1)?.index, 0);
    assert.equal(hit('center', 0.75, 5)?.index, 1);
    // The straight chord from (0,1) to (1,5) passes through the middle of the first step's air; a pointer there hits nothing now.
    assert.equal(hit('after', 0.5, 3), null, 'not on the line that is drawn');
    const chord = rect(ys, new LinePath(new LinearCurve()), { hit: { mode: 'line', radius: 3 } });
    assert(hitTest(chord.series, ...chord.at(0.5, 3)) !== null, 'but it is on the straight line a LinePath draws');
    // A pointer with one coordinate left out is still measured to the points, as documented.
    const r = rect(ys, new LinePath(new StepCurve({})), { hit: 'line' });
    assert.equal(hitTest(r.series, r.at(0.4, 0)[0], NaN, Infinity)?.index, 0);
    assert.equal(hitTest(r.series, r.at(0.6, 0)[0], NaN, Infinity)?.index, 1);
  }

  // ── An area is hit inside the steps, not inside the chords.
  {
    const r = rect([1, 5], new AreaPath(new StepCurve({})), { hit: { mode: 'area', radius: 8 } });
    const inside = hitTest(r.series, ...r.at(0.5, 0.5));
    assert.equal(inside?.index, 0);
    assert.equal(inside?.distance, 0);
    assert.equal(hitTest(r.series, ...r.at(0.5, 2.9)), null, 'under the chord but above the step: outside');
    assert.equal(hitTest(r.series, ...r.at(1.5 / 2 + 0.5, 3))?.distance ?? 99, 99, 'and past the last point there is nothing');
  }

  // ── A reading between points is the level there, on the line drawn, for each mode.
  {
    const ys = [1, 5, 2];
    const read = (mode: StepMode, first: number) => {
      const r = rect(ys, new LinePath(new StepCurve({ mode })), { hit: 'line' });
      return { h: interpolate(r.series, first), r };
    };
    for (const [mode, first, level, index] of [
      ['after', 0.5, 1, 0],
      ['after', 1.5, 5, 1],
      ['before', 0.5, 5, 1],
      ['before', 1.5, 2, 2],
      ['center', 0.25, 1, 0],
      ['center', 0.75, 5, 1],
    ] as const) {
      const { h, r } = read(mode, first);
      near(h!.second, level);
      assert.equal(h!.interpolated, true);
      assert.equal(h!.index, index, `${mode} at ${first}`);
      const [px, py] = r.at(first, level);
      near(h!.px, px, 1e-6);
      near(h!.py, py, 1e-6);
    }
    // On a point exactly it is the point; past the ends and across a gap it is nothing, as for a line.
    near(read('after', 1).h!.second, 5);
    assert.equal(read('after', 2.5).h, null);
    const gappy = rect([1, 2, NaN, 3, 4], new LinePath(new StepCurve({})), { hit: 'line' });
    near(interpolate(gappy.series, 0.5)!.second, 1);
    assert(interpolate(gappy.series, 0.5), 'a level is a reading while its run goes on...');
    assert.equal(interpolate(gappy.series, 1.5), null, '...but not beside a gap');
  }

  // ── In a stack a reading is the series' own level, drawn at the stacked height.
  {
    const a = new DomainSeries({ hit: 'line' }, flat([1, 3, 2]), new LinePath(new StepCurve({}))),
      b = new DomainSeries({ hit: 'line' }, flat([2, 1, 4]), new LinePath(new StepCurve({})));
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom', min: 0, max: 2 }, lin()),
      new Axis({ orientation: 'left', min: 0, max: 8 }, lin()),
      new Stack({}, a, b),
    );
    mount(plane);
    const h = interpolate(b, 0.5)!,
      h0 = interpolate(a, 0.5)!;
    near(h.second, 2);
    near(h0.second, 1);
    const w = plane.rect.height;
    near(h.py, (1 - 3 / 8) * w, 1e-6); // drawn at 1 + 2
    const sharp = hitTest(b, plane.rect.width * 0.25, (1 - 3 / 8) * w, 3);
    assert.equal(sharp?.index, 0);
    near(sharp.lift!, 1);
  }

  // ── On a polar plane the reading follows the arc, and a hit is inside the wedge.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 6 }, lin()),
      radius = new Axis({ orientation: 'radius', min: 0, max: 6 }, lin());
    const series = new DomainSeries({ hit: 'line' }, flat([2, 5, 3, 6, 1, 4, 2]), new LinePath(new StepCurve({ mode: 'after' })));
    mount(new PolarPlane({}, angle, radius, series));
    for (const [first, level] of [
      [0.5, 2],
      [1.3, 5],
      [2.9, 3],
      [4.6, 1],
      [5.5, 4],
    ] as const) {
      const h = interpolate(series, first)!;
      assert(Math.abs(h.second - level) < 0.02, `at ${first} it reads ${h.second}, not ${level}`);
    }
    const h = interpolate(series, 1.5)!;
    assert.equal(hitTest(series, h.px, h.py, 1)?.index, 1, "a pointer on the arc hits the level's point");
  }
});

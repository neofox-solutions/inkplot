import type { AnySeriesRenderer } from './renderer.ts';
// Curves: each is the SVG command it says, passes (or does not) through the points as it should, and areas close round them.
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import { f2 } from './geometry.ts';
import {
  Chart, CartesianPlane, PolarPlane, Axis, LinearScale, DomainSeries, Stack, LinePath, AreaPath, FlatDataSource, StringPlatform,
  LinearCurve, MonotoneCurve, NaturalCurve, CardinalCurve, CatmullRomCurve, BasisCurve, BumpCurve, QuadraticCurve, ArcCurve, StrokeCurve,
  hitTest, interpolate, nearestSegment, lineTo, type Piece, type Plane, 
} from './index.ts';

type CurveName = 'linear' | 'monotone' | 'natural' | 'cardinal' | 'catmull-rom' | 'basis' | 'bump' | 'quadratic' | 'arc';
const CLASSES = { monotone: MonotoneCurve, natural: NaturalCurve, cardinal: CardinalCurve, 'catmull-rom': CatmullRomCurve, basis: BasisCurve, bump: BumpCurve, quadratic: QuadraticCurve, arc: ArcCurve } as const;
/** A curve by name, with the attributes that go with it. */
const curveOf = (o: { curve?: CurveName; [k: string]: unknown }): StrokeCurve => {
  const { curve = 'monotone', ...attrs } = o;
  return curve === 'linear' ? (new LinearCurve() as unknown as StrokeCurve) : new (CLASSES[curve] as new (attrs: object) => StrokeCurve)(attrs);
};
const near = (a: number, b: number, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
function mount(plane: Plane, size = 500) {
  const chart = new Chart({ theme: lightTheme, width: size, height: size }, plane);
  const platform = new StringPlatform({ width: size, height: size });
  chart.attach(platform);
  chart.flush();
  return platform.toString();
}
const flat = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start: 0, step: 1 } });
const lin = () => new LinearScale();
const count = (d: string, ch: string) => d.split(ch).length - 1;
const pt = (x: number, y: number) => `${f2(x)} ${f2(y)}`;

/** A path as commands with their numbers, in the few forms the curves use. */
function parse(d: string): { cmd: string; n: number[] }[] {
  return [...d.matchAll(/([MLCQTAZ])([^MLCQTAZ]*)/g)].map((m) => ({ cmd: m[1]!, n: (m[2]!.match(/-?\d+(\.\d+)?/g) ?? []).map(Number) }));
}
/** The cubic pieces as [P0, C1, C2, P3] in order, from a path of M and C (and L) only. */
function cubics(d: string) {
  const out: number[][] = [];
  let x = 0, y = 0;
  for (const { cmd, n } of parse(d)) {
    if (cmd === 'M' || cmd === 'L') { x = n[n.length - 2]!; y = n[n.length - 1]!; }
    else if (cmd === 'C') { out.push([x, y, ...n]); x = n[4]!; y = n[5]!; }
  }
  return out;
}
const bez = (c: number[], t: number, k: 0 | 1) => {
  const p0 = c[k]!, p1 = c[2 + k]!, p2 = c[4 + k]!, p3 = c[6 + k]!, u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

// Points in pixels, not a function of x: a loop, so that every curve has something to do. 
const P = [0, 0, 60, 40, 120, 10, 180, 80, 240, 70, 300, 120];
const through = new Set<CurveName>(['monotone', 'natural', 'cardinal', 'catmull-rom', 'bump', 'arc', 'linear']);

// ── Each curve is the command it should be, through the points where it should be.
for (const curve of ['monotone', 'natural', 'cardinal', 'catmull-rom', 'basis', 'bump', 'quadratic', 'arc'] as const) {
  const d = curveOf({ curve }).path(P, 'M');
  assert(d.startsWith('M0 0'), `${curve} starts at the first point`);
  assert(d.endsWith(pt(300, 120)), `${curve} ends at the last point`);
  assert(!/NaN|undefined|Infinity/.test(d), `${curve}: ${d}`);
  if (through.has(curve)) for (let i = 0; i < P.length; i += 2) assert(d.includes(pt(P[i]!, P[i + 1]!)), `${curve} passes through point ${i / 2}`);
  const n = P.length / 2;
  switch (curve) {
    case 'monotone': case 'natural': case 'cardinal': case 'catmull-rom': case 'bump': assert.equal(count(d, 'C'), n - 1, `${curve}: a cubic for each segment`); break;
    case 'basis': assert.equal(count(d, 'C'), n - 1); assert.equal(count(d, 'L'), 2, 'a line in from the first point and out to the last'); break;
    case 'quadratic': assert.equal(count(d, 'Q'), 1); assert.equal(count(d, 'T'), n - 3, 'smooth quadratics after the first'); break;
    case 'arc': assert.equal(count(d, 'A'), n - 1); break;
  }
}

// ── 'L' as the lead carries on from the pen instead of starting a path.
assert(curveOf({ curve: 'monotone' }).path(P, 'L').startsWith('L0 0C'));
assert.equal(curveOf({}).path([], 'M'), '');
assert.equal(curveOf({}).path([5, 6], 'M'), 'M5 6');
assert.equal(curveOf({ curve: 'natural' }).path([0, 0, 10, 10], 'M'), 'M0 0L10 10', 'two points are a straight line, for curves that need three');

// ── Monotone never leaves the range of the two data values on either side of a segment; natural may.
{
  const flatTop = [0, 0, 40, 100, 80, 100, 120, 100, 160, 0, 200, 0, 240, 60, 280, 60];   // plateaus and a rise: where a spline overshoots
  const worst = (curve: CurveName) => {
    let over = 0;
    const d = curveOf({ curve }).path(flatTop, 'M');
    cubics(d).forEach((c, k) => {
      const lo = Math.min(flatTop[2 * k + 1]!, flatTop[2 * k + 3]!), hi = Math.max(flatTop[2 * k + 1]!, flatTop[2 * k + 3]!);
      for (let t = 0; t <= 1; t += 0.02) { const y = bez(c, t, 1); over = Math.max(over, lo - y, y - hi); }
    });
    return over;
  };
  assert(worst('monotone') < 0.05, `monotone overshoots by ${worst('monotone')}`);
  assert(worst('natural') > 5, 'a natural spline swings past plateaus');
}

// ── Natural has continuous curvature where the pieces meet; cardinal and catmull-rom only continuous direction.
{
  const d = curveOf({ curve: 'natural' }).path(P, 'M'), c = cubics(d);
  const hs = c.map((s) => Math.hypot(s[6]! - s[0]!, s[7]! - s[1]!));
  for (let k = 0; k < c.length - 1; k++) {
    for (const axis of [0, 1] as const) {
      // Second derivative with respect to the length parameter: at the end of a piece, and the start of the next.
      const end = (c[k]![axis + 2]! - 2 * c[k]![axis + 4]! + c[k]![axis + 6]!) / hs[k]! ** 2;
      const start = (c[k + 1]![axis]! - 2 * c[k + 1]![axis + 2]! + c[k + 1]![axis + 4]!) / hs[k + 1]! ** 2;
      near(end, start, 2e-3);
    }
  }
  const r = cubics(curveOf({ curve: 'catmull-rom' }).path(P, 'M'));
  for (let k = 0; k < r.length - 1; k++) {   // the control points either side of a joint are in line with it
    const a = [r[k]![6]! - r[k]![4]!, r[k]![7]! - r[k]![5]!], b = [r[k + 1]![2]! - r[k + 1]![0]!, r[k + 1]![3]! - r[k + 1]![1]!];
    near((a[0]! * b[1]! - a[1]! * b[0]!) / (Math.hypot(...(a as [number, number])) * Math.hypot(...(b as [number, number]))), 0, 5e-3);
  }
}

// ── Tension pulls cardinal towards straight lines; alpha changes Catmull-Rom on uneven spacing.
{
  const c0 = cubics(curveOf({ curve: 'cardinal', tension: 0 }).path(P, 'M'))[1]!, c1 = cubics(curveOf({ curve: 'cardinal', tension: 1 }).path(P, 'M'))[1]!;
  near(c1[2]!, c1[0]!); near(c1[3]!, c1[1]!);   // tension 1: the first control point is the start itself
  assert(Math.hypot(c0[2]! - c0[0]!, c0[3]! - c0[1]!) > 5, 'tension 0 leaves it free');
  const uneven = [0, 0, 10, 30, 200, 40, 210, 0];
  assert.notEqual(curveOf({ curve: 'catmull-rom', alpha: 0 }).path(uneven, 'M'), curveOf({ curve: 'catmull-rom', alpha: 1 }).path(uneven, 'M'));
}

// ── A bump leaves each point level, along x or along y; an arc has the radius its rise says, and bends the way its sign says.
{
  const [c] = cubics(curveOf({ curve: 'bump' }).path([0, 0, 100, 60], 'M'));
  assert.deepEqual([c![3], c![5]], [0, 60], 'level at both ends along x: the controls keep the end values');
  const [cy] = cubics(curveOf({ curve: 'bump', along: 'y' }).path([0, 0, 100, 60], 'M'));
  assert.deepEqual([cy![2], cy![4]], [0, 100]);
  const [a] = parse(curveOf({ curve: 'arc', bend: 0.3 }).path([0, 0, 100, 0], 'M')).slice(1);
  near(a!.n[0]!, (100 * (0.25 + 0.09)) / 0.6, 0.01);
  assert.equal(a!.n[3], 0, 'a small arc'); assert.equal(a!.n[4], 0, 'positive bends left of the way along (anticlockwise on screen)');
  const [b] = parse(curveOf({ curve: 'arc', bend: -0.8 }).path([0, 0, 100, 0], 'M')).slice(1);
  assert.equal(b!.n[3], 1, 'more than a semicircle is a large arc'); assert.equal(b!.n[4], 1);
  assert.equal(curveOf({ curve: 'arc', bend: 0 }).path([0, 0, 100, 0], 'M'), 'M0 0L100 0', 'no bend is a line');
  assert.equal(curveOf({ curve: 'arc' }).path([0, 0, 0, 0], 'M'), 'M0 0L0 0', 'coincident points are not a division by zero');
}

// ── The renderers: a line, broken or connected at gaps, and an area closed round the curve and the baseline's.
{
  const draw = (renderer: AnySeriesRenderer, ys: number[], gaps?: 'connect') => {
    const series = new DomainSeries({ gaps }, flat(ys), renderer);
    const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom', min: 0, max: ys.length - 1 }, lin()), new Axis({ orientation: 'left', min: 0, max: 6 }, lin()), series);
    const svg = mount(plane);
    return { svg, series, plane, paths: [...svg.matchAll(/<path[^>]*? d="([^"]*)"/g)].map((m) => m[1]!) };
  };
  const ys = [1, 4, 2, 5, 3];
  const line = draw(new LinePath(curveOf({})), ys), curved = line.paths.find((d) => d.includes('C'))!;
  assert.equal(count(curved, 'M'), 1);
  assert.equal(count(curved, 'C'), 4, 'the default is monotone: a cubic for each segment');
  const p = line.series.points;
  for (let i = 0; i < 5; i++) assert(curved.includes(pt(p.data[2 * i]!, p.data[2 * i + 1]!)), 'through the series points');
  assert.equal(draw(new LinePath(curveOf({ curve: 'linear' })), ys).paths.filter((d) => /^M[\d. ]+L/.test(d) && !/V|H/.test(d)).length, 1);

  const gappy = [1, 4, NaN, 5, 3, 2];
  assert.equal(count(draw(new LinePath(curveOf({})), gappy).paths.find((d) => d.includes('C'))!, 'M'), 2, 'a gap starts a new curve');
  assert.equal(count(draw(new LinePath(curveOf({})), gappy, 'connect').paths.find((d) => d.includes('C'))!, 'M'), 1, 'connected, one');

  const area = draw(new AreaPath(curveOf({})), ys), a = area.paths.find((d) => d.endsWith('Z'))!;
  assert.equal(count(a, 'Z'), 1);
  assert.equal(count(a, 'C'), 8, 'forward along the curve and back along the baseline');
  assert(a.includes(pt(0, area.plane.rect.height)) && a.includes(pt(area.plane.rect.width, area.plane.rect.height)), 'down to the baseline at each end');
  assert.equal(count(draw(new AreaPath(curveOf({})), gappy).paths.find((d) => d.endsWith('Z'))!, 'Z'), 2, 'a gap splits the area');
  assert.equal(count(draw(new AreaPath(curveOf({})), gappy, 'connect').paths.find((d) => d.endsWith('Z'))!, 'Z'), 1);
}

// ── In a stack a curved area sits on the curve of the layer below it (the same points, so the same curve).
{
  const a = new DomainSeries({}, flat([1, 3, 2, 4]), new AreaPath(curveOf({ curve: 'cardinal' }))), b = new DomainSeries({}, flat([2, 1, 3, 1]), new AreaPath(curveOf({ curve: 'cardinal' })));
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom', min: 0, max: 3 }, lin()), new Axis({ orientation: 'left', min: 0, max: 8 }, lin()), new Stack({}, a, b));
  const svg = mount(plane);
  const shapes = [...svg.matchAll(/<path[^>]*? d="([^"]*Z)"/g)].map((m) => m[1]!);
  assert.equal(shapes.length, 2);
  const forward = cubics(shapes[0]!.split('L')[0]!).map((c) => c.join(' ')), back = cubics('M' + shapes[1]!.split('L').slice(1).join('L'));
  assert(back.length > 0 && forward.length > 0, 'both drawn');
}

// ── On a polar plane it is a smooth line through the placed points.
{
  const angle = new Axis({ orientation: 'angle', min: 0, max: 8 }, lin()), radius = new Axis({ orientation: 'radius', min: 0, max: 6 }, lin());
  const series = new DomainSeries({}, flat([2, 5, 3, 6, 2, 4, 3, 5]), new LinePath(curveOf({ curve: 'catmull-rom' })));
  const svg = mount(new PolarPlane({}, angle, radius, series));
  const d = [...svg.matchAll(/<path[^>]*? d="([^"]*C[^"]*)"/g)].map((m) => m[1]!)[0]!;
  assert.equal(count(d, 'C'), 7);
  assert(!/NaN/.test(d));
}
// ── The polyline of a curve is the curve: an arc's vertices are on its circle, and every one belongs to a point.
{
  const { pts, owner } = curveOf({ curve: 'arc', bend: 0.3 }).polyline([0, 0, 100, 0]);
  const r = (100 * (0.25 + 0.09)) / 0.6, mid = (pts.length / 2 - 1) / 2;
  const cy = pts[2 * mid + 1]! > 0 ? 30 - r : r - 30;   // the circle's middle, on the side the arc bulges away from
  for (let i = 0; i < pts.length; i += 2) near(Math.hypot(pts[i]! - 50, pts[i + 1]! - cy), r, 1e-6);
  near(Math.abs(pts[2 * mid + 1]!), 30, 1e-6);
  assert.deepEqual([owner[0], owner[owner.length - 1]], [0, 1], 'the ends are the points');
  const q = curveOf({ curve: 'monotone' }).polyline(P);
  assert.equal(q.owner.length, 1 + 16 * 5);
  assert(q.owner.every((i) => i >= 0 && i < 6));
  for (let i = 0; i < P.length; i += 2) assert(q.pts.some((v, j) => j % 2 === 0 && Math.abs(v - P[i]!) < 1e-9 && Math.abs(q.pts[j + 1]! - P[i + 1]!) < 1e-9), 'every point of the data is a vertex');
}

// ── A hit is on the curve drawn, not on the chords, and a reading between points is a height on the curve.
{
  const mk = (renderer: AnySeriesRenderer, ys: number[], hit: object = { mode: 'line', radius: 2 }) => {
    const series = new DomainSeries({ hit }, flat(ys), renderer);
    const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom', min: 0, max: ys.length - 1 }, lin()), new Axis({ orientation: 'left', min: -3, max: 9 }, lin()), series);
    mount(plane);
    return { series, plane };
  };
  // A natural spline swings past a plateau's corner: there the curve is far from the chord.
  const ys = [0, 0, 6, 6, 0, 0], { series } = mk(new LinePath(curveOf({ curve: 'natural' })), ys);
  const trace = series.trace()!;
  assert(trace && trace.base === null);
  assert.equal(Array.from(trace.owner).filter((o) => o < 0).length, 1, 'one run, ended by a gap point');
  // The vertex farthest from the chords.
  let far = 0, farAt = 0;
  for (let k = 0; k < trace.line.count; k++) {
    const x = trace.line.data[2 * k]!, y = trace.line.data[2 * k + 1]!;
    if (x !== x) continue;
    const d = nearestSegment(series.points, x, y)!.distance;
    if (d > far) { far = d; farAt = k; }
  }
  assert(far > 2.5, `the curve strays ${far.toFixed(1)}px from its chords`);
  const vx = trace.line.data[2 * farAt]!, vy = trace.line.data[2 * farAt + 1]!;
  const h = hitTest(series, vx, vy);
  assert(h && h.distance < 1e-6 && h.index === trace.owner[farAt], 'a pointer on the curve hits');
  const chordOnly = mk(new LinePath(new LinearCurve()), ys);
  assert.equal(hitTest(chordOnly.series, vx, vy), null, 'where a straight line is not');

  // Readings: on a straight (two point) curve it is the straight reading; on a monotone curve it stays between its points; the point is on the path.
  const two = mk(new LinePath(curveOf({ curve: 'monotone' })), [2, 8]), mid = interpolate(two.series, 0.5)!;
  near(mid.second, 5, 0.05);
  const mono = mk(new LinePath(curveOf({ curve: 'monotone' })), [0, 0, 6, 6, 0]);
  for (const first of [0.3, 1.5, 2.2, 3.5]) {
    const r = interpolate(mono.series, first)!, lo = Math.floor(first);
    const a = [0, 0, 6, 6, 0][lo]!, b = [0, 0, 6, 6, 0][lo + 1]!;
    assert(r.second >= Math.min(a, b) - 0.01 && r.second <= Math.max(a, b) + 0.01, `${first}: ${r.second} between ${a} and ${b}`);
    assert(nearestSegment(mono.series.trace()!.line, r.px, r.py)!.distance < 1e-6, 'on the drawn curve');
  }
  const swing = interpolate(series, 1.5)!;
  assert(Math.abs(swing.second - 3) > 0.05, `the natural curve is not the chord's ${3}: ${swing.second}`);
  assert(interpolate(series, 2.5)!.second > 3, 'it reads the height of the curve');

  // The area: inside is under the curve, not under the chords.
  const area = mk(new AreaPath(curveOf({ curve: 'natural' })), ys, { mode: 'area', radius: 4 });
  const on = interpolate(area.series, 1.5)!;
  const below = hitTest(area.series, on.px, on.py + 20), above = hitTest(area.series, on.px, on.py - 40);
  assert(below && below.distance === 0, 'inside the shape under the curve'); assert.equal(above, null, 'and not above it');
  assert(area.series.trace()!.base, 'an area traces its way back too');
  // Gaps give a run each.
  const gaps = mk(new LinePath(curveOf({})), [1, 4, NaN, 5, 3, 2]);
  assert.equal(Array.from(gaps.series.trace()!.owner).filter((o) => o < 0).length, 2);
}
// ── A curve is a child that can be swapped live, and one of your own is a few lines.
{
  /** Straight lines that stop at the same height as the last point first: an L-shaped route, as a custom curve. */
  class ElbowCurve extends StrokeCurve {
    protected pieces(p: ArrayLike<number>): Piece[] {
      const out: Piece[] = [];
      for (let k = 0; k < (p.length >> 1) - 1; k++) out.push(lineTo(p[2 * k + 2]!, p[2 * k + 1]!, k, k), lineTo(p[2 * k + 2]!, p[2 * k + 3]!, k, k + 1));
      return out;
    }
  }
  const line = new LinePath(new LinearCurve());
  const series = new DomainSeries({}, flat([1, 4, 2]), line);
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom', min: 0, max: 2 }, lin()), new Axis({ orientation: 'left', min: 0, max: 5 }, lin()), series);
  const chart = new Chart({ theme: lightTheme, width: 400, height: 300 }, plane);
  const platform = new StringPlatform({ width: 400, height: 300 });
  chart.attach(platform);
  chart.flush();
  const pathOf = () => [...platform.toString().matchAll(/<path[^>]*? d="(M[^"]*)"/g)].map((m) => m[1]!).find((d) => !d.includes('V') && !d.includes('H'))!;
  const before = pathOf();
  assert.equal(count(before, 'M'), 1);
  line.setChild(0, new ElbowCurve());
  chart.flush();
  const after = pathOf();
  assert.notEqual(after, before, 'the new curve draws');
  assert.equal(count(after, 'L'), 1, 'implicit linetos after the first');
  assert.equal(after.match(/-?\d+(\.\d+)?/g)!.length, 2 * (1 + 2 * 2), 'two pieces for each of the two segments');
  assert(line.curve instanceof ElbowCurve);
  line.setChild(0, new MonotoneCurve());
  chart.flush();
  assert(count(pathOf(), 'C') === 2, 'and swapped again');
  assert.equal(new LinearCurve().parent, null, 'a curve belongs to the renderer that has it');
}
console.log('ok curves');

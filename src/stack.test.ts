// Stack: the layout maths, lining up unequal domains, and what the stack does to a series' points, baseline, bars,
// hits and edits. Members are ordinary series, so most of this checks that nothing downstream needs to know.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart, CartesianPlane, PolarPlane, Axis, LinearScale, BandScale, DomainSeries, LinePath, AreaPath, BarPath, FlatDataSource, ObjectDataSource,
  PointerListener, Stack, StringPlatform, alignRows, layOut, barShapes, hitTest, hitAll, interpolate, type Plane, type Rows, type RawPointer,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';

const near = (a: number, b: number, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const table = (domain: number[], values: number[], rowOf: ((i: number) => number) | null = (i) => i): Rows => {
  const raw = new Float64Array(domain.length * 2);
  domain.forEach((x, i) => { raw[2 * i] = x; raw[2 * i + 1] = values[i]!; });
  return { raw, count: domain.length, stride: 2, rowOf };
};
const flat = (ys: number[], start = 0) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start, step: 1 } });
function mount(plane: Plane, w = 400, h = 300) {
  const chart = new Chart({ theme: lightTheme, width: w, height: h }, plane);
  chart.attach(new StringPlatform({ width: w, height: h }));
  chart.flush();
  return chart;
}
const bottom = (o = {}) => new Axis({ orientation: 'bottom', ...o }, new LinearScale());
const left = (o = {}) => new Axis({ orientation: 'left', ...o }, new LinearScale());
const col = (a: Float64Array) => Array.from(a);

// ── The maths of each mode, on three layers over three rows.
{
  const t = [table([0, 1, 2], [1, 2, 3]), table([0, 1, 2], [2, NaN, -1]), table([0, 1, 2], [3, 1, -2])];
  const s = layOut(t, 'stack');
  assert.deepEqual(col(s.base[0]!), [0, 0, 0]);
  assert.deepEqual(col(s.top[0]!), [1, 2, 3]);
  assert.deepEqual(col(s.base[1]!), [1, NaN, 0], 'on top of the first; a gap has no layer');
  assert.deepEqual(col(s.top[1]!), [3, NaN, -1], 'a negative hangs below zero');
  assert.deepEqual(col(s.base[2]!), [3, 2, -1], 'a gap adds nothing to the layers above; negatives stack down from one another');
  assert.deepEqual(col(s.top[2]!), [6, 3, -3]);
  assert.deepEqual(s.extent, { min: -3, max: 6 });

  const n = layOut(t, 'normalize');
  near(n.top[2]![0]!, 1); near(n.top[0]![0]!, 1 / 6); near(n.base[2]![0]!, 0.5);
  near(n.top[2]![1]!, 1, 1e-9);                // 2 and 1 of a total of 3 (the gap is no part of it)
  near(n.base[1]![2]!, 0, 1e-9); near(n.top[1]![2]!, -1 / 6, 1e-9);
  const zero = layOut([table([0], [0]), table([0], [0])], 'normalize');
  assert.deepEqual([col(zero.top[0]!), col(zero.top[1]!)], [[0], [0]], 'a row of nothing stays nothing');

  const c = layOut(t, 'center');
  near(c.base[0]![0]!, -3); near(c.top[2]![0]!, 3);               // 1+2+3 = 6, centred on zero
  near(c.base[0]![2]!, 0); near(c.top[0]![2]!, 3);               // sum is 0: nothing to shift by
  const g = layOut(t, 'group');
  assert.deepEqual([col(g.base[1]!), col(g.top[1]!)], [[0, NaN, 0], [2, NaN, -1]], 'every layer from zero');
  assert.deepEqual(layOut([], 'stack').extent, null);
}

// ── Lining rows up: union of the domains; gaps or a straight line; made-up rows are not rows.
{
  const a = table([0, 2, 4], [10, 20, 40]), b = table([1, 2, 3], [5, 6, 7], (i) => 100 + i);
  const g = alignRows([a, b], 'gaps');
  assert.deepEqual([g[0]!.count, g[1]!.count], [5, 5]);
  assert.deepEqual(Array.from(g[0]!.raw).filter((_, i) => i % 2 === 0), [0, 1, 2, 3, 4], 'the union, ascending');
  assert.deepEqual(Array.from(g[0]!.raw).filter((_, i) => i % 2 === 1), [10, NaN, 20, NaN, 40]);
  assert.deepEqual(Array.from(g[1]!.raw).filter((_, i) => i % 2 === 1), [NaN, 5, 6, 7, NaN]);
  assert.deepEqual([0, 1, 2, 3, 4].map(g[1]!.rowOf!), [-1, 100, 101, 102, -1], 'own rows keep their identity, made-up ones have none');
  const l = alignRows([a, b], 'interpolate');
  assert.deepEqual(Array.from(l[0]!.raw).filter((_, i) => i % 2 === 1), [10, 15, 20, 30, 40], 'straight lines between its points');
  assert.deepEqual(Array.from(l[1]!.raw).filter((_, i) => i % 2 === 1), [NaN, 5, 6, 7, NaN], 'and nothing beyond its ends');
  // A value that is a gap blocks the line across it; a table with no source rows says so.
  const holey = alignRows([table([0, 2], [1, NaN]), table([1], [1], null)], 'interpolate');
  assert(Number.isNaN(holey[0]!.raw[3]!));
  assert.equal(holey[1]!.rowOf!(1), -1);
  // Duplicates of a position keep the first.
  assert.equal(alignRows([table([0, 1, 1], [1, 2, 3]), table([1], [9])], 'gaps')[0]!.count, 2);
}

// ── In a plane: lines are drawn at the tops, areas fill from the layer below, the axis reaches the total.
{
  const a = new DomainSeries({ name: 'A' }, flat([1, 2, 3]), new LinePath(new LinearCurve())), b = new DomainSeries({ name: 'B' }, flat([2, 1, 4]), new AreaPath(new LinearCurve()));
  const y = left();
  const plane = new CartesianPlane({}, bottom(), y, new Stack({}, a, b));
  const chart = mount(plane);
  assert.deepEqual(plane.series, [a, b], 'the plane sees through the stack');
  assert(y.range.max >= 7 && y.range.min <= 0, `axis ${y.range.min}..${y.range.max}`);
  const toTop = (s: DomainSeries, i: number) => s.points.data[2 * i + 1]!;
  const baseB = b.baseline(0).data;
  for (let i = 0; i < 3; i++) near(baseB[2 * i + 1]!, toTop(a, i), 1e-9);     // B's foot is A's line
  assert(toTop(b, 2) < toTop(a, 2), 'B is above A (smaller y is higher on the page)');
  near(a.baseline(0).data[1]!, plane.rect.height - (0 - y.range.min) / (y.range.max - y.range.min) * plane.rect.height, 1e-6);
  // The raw rows are the series' own: what a hit reports.
  const h = hitTest(b, b.points.data[2]!, b.points.data[3]!)!;
  assert.deepEqual([h.second, h.lift, h.row], [1, 2, 1], 'its own value, and how far it is lifted');
  assert.equal(hitTest(a, a.points.data[2]!, a.points.data[3]!)!.lift, 0);
  // Reading the line between points follows the stacked line, and still reports the own value.
  const mid = interpolate(b, 0.5)!;
  near(mid.second, 1.5, 1e-9);
  near(mid.py, (toTop(b, 0) + toTop(b, 1)) / 2, 1e-6);
  // Colours: palette slots run across the whole plane, through the stack.
  const c = new DomainSeries({}, flat([1, 1, 1]), new LinePath(new LinearCurve()));
  plane.append(c);
  chart.flush();
  assert.deepEqual([a.accentColor, b.accentColor, c.accentColor], lightTheme.palette.slice(0, 3));
}

// ── Strict by default: unequal domains say what to do. Merging: bars on gaps, lines on a line.
{
  const a = new DomainSeries({}, flat([1, 2, 3]), new BarPath({})), b = new DomainSeries({}, flat([4, 5], 1), new BarPath({}));
  assert.throws(() => mount(new CartesianPlane({}, bottom(), left(), new Stack({}, a, b))), /share their domain values.*align/);
  assert.throws(() => mount(new CartesianPlane({}, bottom(), left(), new Stack({}, new DomainSeries({}, flat([1]), new LinePath(new LinearCurve())), new DomainSeries({ valueAxis: 'v2' }, flat([1]), new LinePath(new LinearCurve()))), left({ id: 'v2' }))), /share their domain axis and their value axis/);

  const lines = [new DomainSeries({}, flat([2, 4, 6]), new LinePath(new LinearCurve())), new DomainSeries({}, flat([1, 1], 0.5), new LinePath(new LinearCurve()))];   // second sits at 0.5 and 1.5
  const plane = new CartesianPlane({}, bottom(), left(), new Stack({ align: 'interpolate' }, ...lines));
  mount(plane);
  assert.equal(lines[0]!.points.count, 5, 'the union of 0, 0.5, 1, 1.5, 2');
  const tops0 = Array.from({ length: 5 }, (_, i) => lines[0]!.drawn!.top![i]!);
  assert.deepEqual(tops0, [2, 3, 4, 5, 6], 'the first, interpolated');
  const tops1 = Array.from({ length: 5 }, (_, i) => lines[1]!.drawn!.top![i]!);
  assert.deepEqual(tops1, [NaN, 4, 5, 6, NaN], 'the second on top of it, and a gap outside its own span');
  assert.deepEqual([0, 1, 2, 3, 4].map(lines[0]!.drawn!.rowOf!), [0, -1, 1, -1, 2], 'made-up rows are not source rows');
  assert.equal(hitTest(lines[0]!, lines[0]!.points.data[2]!, lines[0]!.points.data[3]!, 5)?.row, undefined, 'so a hit on one cannot be edited');

  const bars = [new DomainSeries({}, flat([1, 2, 3]), new BarPath({})), new DomainSeries({}, flat([4, 5], 1), new BarPath({}))];
  mount(new CartesianPlane({}, bottom(), left(), new Stack({ align: 'gaps' }, ...bars)));
  assert.equal(bars[1]!.points.count, 3);
  assert(Number.isNaN(barShapes(bars[1]!)!.data[1]!), 'no bar where the member has no value');
}

// ── Stacked bars: each starts where the one below ends, and the shapes are what is hit. Band axis, mixed signs.
{
  const cats = ['x', 'y', 'z'];
  const a = new DomainSeries({ name: 'a' }, flat([3, 5, 2]), new BarPath({})), b = new DomainSeries({ name: 'b' }, flat([4, -2, 6]), new BarPath({}));
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new BandScale({ categories: cats })), left(), new Stack({}, a, b));
  mount(plane);
  const sa = barShapes(a)!, sb = barShapes(b)!, per = sa.perShape * 2;
  const ysOf = (s: typeof sa, i: number) => Array.from({ length: sa.perShape }, (_, j) => s.data[i * per + 2 * j + 1]!);
  near(Math.max(...ysOf(sb, 0)), Math.min(...ysOf(sa, 0)), 1e-6);          // b's foot is a's top (row 0)
  near(Math.max(...ysOf(sb, 2)), Math.min(...ysOf(sa, 2)), 1e-6);          // row 2
  const zero = a.baseline(0).data[3]!;
  near(Math.min(...ysOf(sb, 1)), zero, 1e-6);                              // a negative b hangs from zero, not from a
  assert(Math.max(...ysOf(sb, 1)) > zero);
  // Hits: inside the upper bar is b's, inside the lower is a's.
  const px = a.points.data[0]!, atA = (zero + a.points.data[1]!) / 2, atB = (a.points.data[1]! + b.points.data[1]!) / 2;
  assert.equal(hitTest(a, px, atA)!.distance, 0);
  assert.equal(hitTest(b, px, atB)!.distance, 0);
  assert.equal(hitAll(plane, px, atB)[0]!.series, b, 'topmost first');
  assert.equal(hitTest(b, px, atA, 2), null, 'b is not at a`s height');
}

// ── Side by side: each series takes its share of the band, in order, touching.
{
  const mk = (ys: number[]) => new DomainSeries({}, flat(ys), new BarPath({}));
  const [a, b, c] = [mk([3, 5]), mk([4, 2]), mk([6, 1])] as [DomainSeries, DomainSeries, DomainSeries];
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['p', 'q'], gap: 0.4 })), left(), new Stack({ mode: 'group' }, a, b, c));
  mount(plane);
  const xs = (s: DomainSeries, i: number) => { const d = barShapes(s)!; return [d.data[i * d.perShape * 2]!, d.data[i * d.perShape * 2 + 2]!].sort((u, v) => u - v); };
  const band = (a.points.data[2]! - a.points.data[0]!);                        // one category, in pixels
  const [a0, b0, c0] = [xs(a, 0), xs(b, 0), xs(c, 0)];
  near(a0[1]! - a0[0]!, (0.6 * band) / 3, 1e-6);
  near(a0[1]!, b0[0]!, 1e-6); near(b0[1]!, c0[0]!, 1e-6);
  near((a0[0]! + c0[1]!) / 2, a.points.data[0]!, 1e-6);                        // the group is centred on its category
  // From zero, not stacked: heights are the own values.
  assert.equal(a.drawn!.top![0], 3); assert.equal(c.drawn!.base![0], 0);
  assert.deepEqual([a, b, c].map((s) => s.drawn!.slot.index), [0, 1, 2]);
}

// ── Normalized to a whole, and centred.
{
  const mk = (ys: number[]) => new DomainSeries({}, flat(ys), new AreaPath(new LinearCurve()));
  const [a, b] = [mk([1, 3]), mk([3, 1])] as [DomainSeries, DomainSeries];
  const y = left();
  mount(new CartesianPlane({}, bottom(), y, new Stack({ mode: 'normalize' }, a, b)));
  assert(y.range.max >= 1 && y.range.max < 1.5 && y.range.min <= 0, `0..1 axis: ${y.range.min}..${y.range.max}`);
  near(b.drawn!.top![0]!, 1); near(a.drawn!.top![1]!, 0.75);
  assert.equal(hitTest(a, a.points.data[0]!, a.points.data[1]!)!.lift, undefined, 'a scaled layer cannot be edited back to its own value');
  const [c, d] = [mk([2, 4]), mk([2, 0])] as [DomainSeries, DomainSeries];
  const y2 = left();
  mount(new CartesianPlane({}, bottom(), y2, new Stack({ mode: 'center' }, c, d)));
  assert(y2.range.min <= -2 && y2.range.max >= 2, 'symmetric about zero');
  near(c.drawn!.base![0]!, -2); near(d.drawn!.top![0]!, 2);
}

// ── Polar: a stacked bar starts at the radius where the one under it stops.
{
  const a = new DomainSeries({}, flat([3, 4, 2]), new BarPath({})), b = new DomainSeries({}, flat([2, 3, 5]), new BarPath({}));
  const plane = new PolarPlane({}, new Axis({ orientation: 'angle', min: -0.5, max: 2.5 }, new LinearScale()), new Axis({ orientation: 'radius' }, new LinearScale()), new Stack({}, a, b));
  mount(plane);
  const c = { x: plane.rect.width / 2, y: plane.rect.height / 2 };
  const [sa, sb] = [barShapes(a)!, barShapes(b)!], radius = (s: typeof sa, k: number) => Math.hypot(s.data[k]! - c.x, s.data[k + 1]! - c.y);
  const half = sa.perShape / 2;
  near(radius(sb, 0), radius(sa, 2 * half), 1e-6);        // b's foot (first point) is a's top edge (a's point `half`)
}

// ── Changing a member's data or the mode re-lays the stack out, and a drag edits the layer's own value.
{
  const rows = [{ x: 0, y: 2 }, { x: 1, y: 3 }], rows2 = [{ x: 0, y: 4 }, { x: 1, y: 1 }];
  const sa = new ObjectDataSource({ source: rows, domain: 'x', value: 'y' }), sb = new ObjectDataSource({ source: rows2, domain: 'x', value: 'y' });
  const a = new DomainSeries({ name: 'a' }, sa, new LinePath(new LinearCurve())), b = new DomainSeries({ name: 'b', hit: { radius: 8 } }, sb, new LinePath(new LinearCurve()));
  const stack = new Stack({}, a, b);
  const edits: { row: number; value: number }[] = [];
  const plane = new CartesianPlane({}, bottom({ min: 0, max: 1 }), left({ min: 0, max: 10 }), stack, new PointerListener({ onDrag: ({ hit, second, phase }) => { if (phase === 'end') edits.push({ row: hit.row!, value: second }); } }));
  const chart = new Chart({ theme: lightTheme }, plane);
  const platform = new FakePlatform({ width: 400, height: 300 });
  chart.attach(platform).flush();
  assert.deepEqual(col(b.drawn!.top!), [6, 4]);
  rows[0]!.y = 5; sa.invalidate(); chart.flush();
  assert.deepEqual(col(b.drawn!.top!), [9, 4], 'an edit below moves what is stacked on it');
  stack.setAttribute('mode', 'group'); chart.flush();
  assert.deepEqual(col(b.drawn!.top!), [4, 1], 'and so does the mode');
  stack.setAttribute('mode', 'stack'); chart.flush();
  // Drag b's first point (stacked at 9) up by one unit of the axis: its own value becomes 5.
  const r = plane.rect, at = (v: number) => [r.x, r.y + (1 - v / 10) * r.height] as const;
  const send = (kind: RawPointer['kind'], v: number, buttons = 1) => platform.pointer!({ kind, x: at(v)[0], y: at(v)[1], buttons, deltaY: 0, shift: false, ctrl: false });
  send('down', 9); send('move', 10); send('up', 10, 0);
  assert.equal(edits.length, 1);
  assert.equal(edits[0]!.row, 0);
  near(edits[0]!.value, 5, 1e-6);
}
console.log('ok stack');

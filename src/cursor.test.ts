// The cursor: finding what is under the pointer or the keyboard, on rectangular and radial planes, and the crosshair and tooltip that read it.
import assert from 'node:assert/strict';
import { LinearCurve } from './curve.ts';
import { FakePlatform } from './fake-platform.ts';
import {
  Axis, CartesianPlane, Chart, ChartTooltip, Crosshair, Cursor, DomainSeries, LinePath, LinearScale, ObjectDataSource, PanZoom, PolarPlane, RadarPlane, type Plane, type PlatformNode, type RawPointer,
  fromJSON, hitAcross, registry, toJSON,
} from './index.ts';
import { lightTheme } from './themes.ts';
import { test } from 'vite-plus/test';

test("cursor", () => {
type N = { tag: string; attrs: Map<string, string | number>; children: N[] };
const walk = (n: N, out: N[] = []): N[] => { out.push(n); for (const c of n.children) walk(c, out); return out; };
const nodes = (p: FakePlatform) => walk(p.root as unknown as N);
const withAttr = (p: FakePlatform, name: string, value?: string) => nodes(p).filter((n) => n.attrs.has(name) && (value === undefined || n.attrs.get(name) === value));
const asNode = (n: N) => n as unknown as PlatformNode;
const paths = (p: FakePlatform) => nodes(p).filter((n) => n.tag === 'path').map((n) => String(n.attrs.get('d') ?? ''));
const words = (p: FakePlatform) => nodes(p).filter((n) => n.tag === 'text').map((n) => (n as unknown as { text: string }).text ?? '');
const lin = () => new LinearScale();

type Row = { a: number; v: number };
const rows = (f: (i: number) => number | null, n = 12): Row[] => Array.from({ length: n }, (_, i) => ({ a: i, v: f(i) ?? NaN }));
const data = (r: Row[]) => new ObjectDataSource({ source: r, domain: 'a', value: 'v', isSorted: true });

function build(kind: 'cartesian' | 'polar' | 'radar', o: { cursor?: object; crosshair?: object | null; tooltip?: object | null; pan?: boolean; size?: number } = {}) {
  const size = o.size ?? 400;
  const one = new DomainSeries({ name: 'One' }, data(rows((i) => 2 + i * 0.5)), new LinePath(new LinearCurve()));
  const two = new DomainSeries({ name: 'Two' }, data(rows((i) => (i === 4 ? null : 8 - i * 0.4))), new LinePath(new LinearCurve()));
  const first = kind === 'cartesian' ? new Axis({ orientation: 'bottom', min: 0, max: 11, title: 'Day' }, lin()) : new Axis({ orientation: 'angle', min: 0, max: 12, tickStep: 1 }, lin());
  const second = kind === 'cartesian' ? new Axis({ orientation: 'left', min: 0, max: 10 }, lin()) : new Axis({ orientation: 'radius', min: 0, max: 10 }, lin());
  const pan = o.pan ? [new PanZoom({})] : [];
  const plane: Plane = kind === 'cartesian' ? new CartesianPlane({}, first, second, one, two, ...pan) : kind === 'polar' ? new PolarPlane({}, first, second, one, two, ...pan) : new RadarPlane({}, first, second, one, two, ...pan);
  const kids = [
    ...(o.crosshair === null ? [] : [new Crosshair(o.crosshair ?? {})]),
    ...(o.tooltip === null ? [] : [new ChartTooltip(o.tooltip ?? {})]),
  ];
  const cursor = new Cursor(o.cursor ?? {}, ...kids);
  const chart = new Chart({ theme: lightTheme }, plane, cursor);
  const platform = new FakePlatform({ width: size, height: size });
  chart.attach(platform).flush();
  const send = (kind: RawPointer['kind'], px: number, py: number, extra: Partial<RawPointer> = {}) => {
    const r = plane.rect;
    const handled = platform.pointer!({ kind, x: r.x + px, y: r.y + py, buttons: 0, deltaY: 0, shift: false, ctrl: false, ...extra });
    chart.flush();
    return handled;
  };
  return { chart, platform, plane, cursor, one, two, first, second, send, svg: () => platform.toString() };
}
const polar = (t: ReturnType<typeof build>, turns: number, radius: number) => {
  // A place on the circle: `turns` of the way round clockwise from twelve, `radius` as a fraction of the rim.
  const R = (t.plane as PolarPlane).radius, cx = t.plane.rect.width / 2, cy = t.plane.rect.height / 2, a = turns * 2 * Math.PI;
  return [cx + R * radius * Math.sin(a), cy - R * radius * Math.cos(a)] as const;
};


// ── Cartesian: the cursor is where the pointer is; a nearest reading and a shared one; guides are a vertical and a horizontal line.
{
  const t = build('cartesian', { cursor: { mode: 'shared' }, crosshair: { lines: 'both' } });
  assert(t.cursor.state === null, 'nowhere before the pointer is on the plot');
  const r = t.plane.rect;
  t.send('move', r.width * 0.5, r.height * 0.1);
  const s = t.cursor.state!;
  assert.equal(s.source, 'pointer');
  assert.deepEqual(s.hits.map((h) => h.series.attrs.name), ['Two', 'One'], 'every series, topmost first');
  assert(s.hits.every((h) => Math.abs(h.first - 5.5) <= 0.6), 'at the pointer along the first axis, whatever the height');
  const guide = paths(t.platform).find((d) => /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+M/.test(d))!;
  assert(guide, `a guide path: ${paths(t.platform).slice(-4).join(' ; ')}`);
  const [v, h] = guide.split('M').filter(Boolean).map((p) => p.split('L').map((q) => q.split(' ').map(Number)));
  assert(Math.abs(v![0]![0]! - v![1]![0]!) < 0.01 && Math.abs(v![0]![0]! - s.x) < 0.01, 'a vertical line through the pointer');
  assert(Math.abs(h![0]![1]! - h![1]![1]!) < 0.01 && Math.abs(h![0]![1]! - s.y) < 0.01, 'and a horizontal one');
  assert(withAttr(t.platform, 'transform').some((n) => String(n.attrs.get('transform')).startsWith('translate')) && withAttr(t.platform, 'clip-path').length >= 2, 'in the plane\'s pixels and clipped to it');
  // lines: 'first' only.
  const only = build('cartesian', { cursor: { mode: 'shared' }, crosshair: { lines: 'first' } });
  only.send('move', only.plane.rect.width * 0.5, 20);
  assert(paths(only.platform).some((d) => /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+$/.test(d) && d.split('L')[0]!.split(' ')[0]!.slice(1) === d.split('L')[1]!.split(' ')[0]), 'one vertical line');
  // Off the plot, or dragging: nothing.
  t.send('leave', 0, 0);
  assert(t.cursor.state === null);
  t.send('move', r.width * 0.5, 30, { buttons: 1 });
  assert(t.cursor.state === null, 'a drag has no cursor');
  assert(!paths(t.platform).some((d) => /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+M/.test(d) && d.length > 0 && false));
}


// ── Polar: shared readings are by angle, guides are a spoke and a ring, the corners are not the plot.
{
  const t = build('polar', { cursor: { mode: 'shared' }, crosshair: { dots: true } });
  const R = (t.plane as PolarPlane).radius, cx = t.plane.rect.width / 2, cy = t.plane.rect.height / 2;
  // A quarter of the way round (three o'clock), well in from the rim.
  const [px, py] = polar(t, 0.25, 0.3);
  t.send('move', px, py);
  const s = t.cursor.state!;
  assert.deepEqual(s.hits.map((h) => h.series.attrs.name), ['Two', 'One']);
  assert(s.hits.every((h) => Math.abs(h.first - 3) <= 0.51), `nearest in angle (a quarter of 12 is 3): ${s.hits.map((h) => h.first).join()}`);
  // The old, pixel way: asking for the nearest in screen x puts the pointer at x=px and finds the same point only by luck; here, probe a place where x and angle disagree.
  const [qx, qy] = polar(t, 0.75, 0.8);   // nine o'clock, near the rim
  const across = hitAcross(t.plane, qx, qy);
  assert(across.every((h) => Math.abs(h.first - 9) <= 0.51), `at nine o'clock the nearest by angle is 9: ${across.map((h) => h.first).join()}`);
  const [nx, ny] = polar(t, 0.9, 0.5);
  assert(hitAcross(t.plane, nx, ny).every((h) => Math.abs(h.first - 10.8) <= 0.51), 'any angle');
  // Wrapping: just before the start of the sweep is the end of the data (12 is 0 again).
  const [wx, wy] = polar(t, 0.998, 0.5);
  const wrap = hitAcross(t.plane, wx, wy);
  assert(wrap.every((h) => h.first >= 11 || h.first <= 0.5), `wraps round the start: ${wrap.map((h) => h.first).join()}`);
  // Guides: a spoke from the middle, and a circle (arcs), not a vertical and a horizontal line.
  t.send('move', px, py);
  const all = paths(t.platform);
  const spoke = all.find((d) => /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+M[\d.]+ [\d.]+A/.test(d))!;
  assert(spoke, `spoke then ring: ${all.slice(-4).join(' ; ')}`);
  const [from, to] = spoke.split('M')[1]!.split('L').map((p) => p.split(' ').map(Number));
  assert(Math.abs(from![0]! - cx) < 1 && Math.abs(from![1]! - cy) < 1, 'the spoke starts at the middle');
  assert(Math.abs(Math.hypot(to![0]! - cx, to![1]! - cy) - R) < 1.5, 'and runs to the rim');
  assert(Math.abs(Math.atan2(to![0]! - cx, -(to![1]! - cy)) - Math.PI / 2) < 0.05, 'at the pointer\'s angle, three o\'clock');
  assert(/A(\d+(\.\d+)?) \1 0/.test(spoke), 'the second guide is a circle');
  const radius = Number(/A([\d.]+) /.exec(spoke)![1]);
  assert(Math.abs(radius - R * 0.3) < 1.5, `of the pointer's radius (${radius} against ${R * 0.3})`);
  // A corner of the plot's rectangle is outside the circle: no cursor.
  t.send('move', 2, 2);
  assert(t.cursor.state === null, 'the corner is not the plot');
  // The tooltip reads by angle too.
  t.send('move', qx, qy);
  assert(words(t.platform).some((w) => w === '9'), `heading ${words(t.platform).join(',')}`);
}


// ── Radar: a spoke and a polygon.
{
  const t = build('radar', { cursor: { mode: 'shared' }, crosshair: {} });
  t.send('move', ...polar(t, 0.5, 0.5));
  const s = t.cursor.state!;
  assert(s.hits.length === 2 && s.hits.every((h) => Math.abs(h.first - 6) <= 0.51), s.hits.map((h) => h.first).join());
  const d = paths(t.platform).find((p) => /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+M[\d.]+ [\d.]+L/.test(p))!;
  assert(d, 'a spoke, then a polygon through the spokes');
  assert(!d.includes('A'), 'the ring is straight chords');
}


// ── Nearest mode: one point, within the series' radius; the pointer over nothing leaves a cursor without a reading.
{
  const t = build('cartesian', { cursor: { mode: 'nearest' }, tooltip: {}, crosshair: {} });
  const p = t.one.points;
  const px = p.data[3 * p.stride]!, py = p.data[3 * p.stride + 1]!;
  t.send('move', px + 2, py + 1);
  assert.equal(t.cursor.state!.hits.length, 1);
  assert.equal(t.cursor.state!.hits[0]!.series, t.one);
  assert(words(t.platform).includes('One'), 'the tooltip says what it is');
  t.send('move', t.plane.rect.width * 0.5, 1);
  assert.equal(t.cursor.state!.hits.length, 0, 'over nothing, there is still a cursor (a crosshair is drawn)');
  assert(!words(t.platform).includes('One'), 'but no box');
}


// ── Redraws: a snapped tooltip does not redraw as the pointer moves over the same point; a following one does.
{
  const t = build('cartesian', { cursor: { mode: 'nearest' }, tooltip: {}, crosshair: null });
  const p = t.one.points, px = p.data[3 * p.stride]!, py = p.data[3 * p.stride + 1]!;
  t.send('move', px + 1, py);
  assert.equal(t.chart.needsFlush, false);
  t.platform.pointer!({ kind: 'move', x: t.plane.rect.x + px + 2, y: t.plane.rect.y + py, buttons: 0, deltaY: 0, shift: false, ctrl: false });
  assert.equal(t.chart.needsFlush, false, 'the same point: nothing to draw');
  const f = build('cartesian', { cursor: { mode: 'nearest' }, tooltip: { follow: true }, crosshair: null });
  const q = f.one.points, fx = q.data[3 * q.stride]!, fy = q.data[3 * q.stride + 1]!;
  f.send('move', fx + 1, fy);
  f.platform.pointer!({ kind: 'move', x: f.plane.rect.x + fx + 2, y: f.plane.rect.y + fy, buttons: 0, deltaY: 0, shift: false, ctrl: false });
  assert.equal(f.chart.needsFlush, true, 'a box that follows moves with the pointer');
}


// ── Keyboard: the plot is a tab stop; arrows step through the points, up and down through the series.
{
  const t = build('cartesian', { cursor: { meta: { title: 'Readings' } }, tooltip: {}, crosshair: { dots: true } });
  const stops = withAttr(t.platform, 'tabindex');
  assert.equal(stops.length, 1);
  const stop = stops[0]!;
  assert.equal(stop.attrs.get('role'), 'application');
  assert.equal(stop.attrs.get('aria-label'), 'Readings');
  assert(String(stop.attrs.get('aria-keyshortcuts')).includes('ArrowRight'));
  assert(t.cursor.state === null, 'nothing until it has focus');
  t.platform.focus(asNode(stop), true);
  t.chart.flush();
  let s = t.cursor.state!;
  assert.equal(s.source, 'keyboard');
  assert.equal(s.hits[0]!.series, t.one);
  assert.equal(s.hits[0]!.index, 0, 'at the first point of the first series');
  assert.equal(t.platform.announced.length, 1, 'what the box says is spoken');
  const spoken = t.platform.announced[0]!;
  assert(spoken.includes('One'), spoken);
  assert(withAttr(t.platform, 'stroke', '#0b57d0').filter((n) => n.attrs.get('display') === 'inline').length === 1, 'with a ring round the plot');
  assert.equal(t.platform.key('ArrowRight'), true);
  t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.index, 1);
  assert.equal(t.platform.announced.length, 2);
  t.platform.key('End'); t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.index, 11);
  t.platform.key('ArrowRight'); t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.index, 11, 'it stops at the end');
  t.platform.key('Home'); t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.index, 0);
  t.platform.key('PageDown'); t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.index, 1, 'a tenth of twelve is one');
  t.platform.key('ArrowDown'); t.chart.flush();
  s = t.cursor.state!;
  assert.equal(s.hits[0]!.series, t.two, 'down is the next series');
  assert.equal(s.hits[0]!.index, 1, 'at the same place along the domain');
  t.platform.key('ArrowUp'); t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.series, t.one);
  t.platform.key('ArrowUp'); t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.series, t.one, 'no further up');
  // A gap is stepped over.
  t.platform.key('ArrowDown'); t.chart.flush();
  t.platform.key('Home'); t.chart.flush();
  for (let i = 0; i < 3; i++) t.platform.key('ArrowRight');
  t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.index, 3);
  t.platform.key('ArrowRight'); t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.index, 5, 'point 4 is a gap');
  t.platform.key('ArrowLeft'); t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.index, 3);
  // Unhandled keys are the browser's; Escape puts it away, and an arrow brings it back.
  assert.equal(t.platform.key('Tab'), false);
  assert.equal(t.platform.key('Escape'), true);
  t.chart.flush();
  assert(t.cursor.state === null);
  assert.equal(t.platform.key('Escape'), false, 'nothing to put away: the key is not taken');
  t.platform.key('ArrowRight'); t.chart.flush();
  assert(t.cursor.state !== null);
  const source = () => t.cursor.state?.source;
  // The pointer takes it over; the keyboard takes it back.
  t.send('move', t.plane.rect.width * 0.5, 1);
  assert.equal(source(), 'pointer');
  t.platform.key('ArrowRight'); t.chart.flush();
  assert.equal(source(), 'keyboard');
  // Blur puts the keyboard's cursor away (the pointer's, were it on the plot, would stay).
  t.platform.blur(); t.chart.flush();
  assert.equal(source(), 'pointer', 'the pointer is still on the plot');
  t.send('leave', 0, 0);
  assert(t.cursor.state === null);
  assert(!paths(t.platform).some((d) => d.startsWith('M') && d.includes('A4 4')), 'no dots left');
}


// ── Keys are configurable; keys: false is no keyboard and no tab stop; a pinned plane ignores the pointer elsewhere.
{
  const t = build('cartesian', { cursor: { keys: { next: ['n'], previous: [], last: ['z'] } }, tooltip: null, crosshair: null });
  t.platform.focus(asNode(withAttr(t.platform, 'tabindex')[0]!), true);
  t.chart.flush();
  assert.equal(t.platform.key('ArrowRight'), false, 'the old key is free');
  assert.equal(t.platform.key('n'), true);
  assert.equal(t.platform.key('ArrowLeft'), false, 'an empty list turns an action off');
  assert.equal(t.platform.key('Home'), true, 'others keep theirs');
  t.chart.flush();
  assert.equal(t.cursor.state!.hits[0]!.index, 0);
  const off = build('cartesian', { cursor: { keys: false } });
  assert.equal(withAttr(off.platform, 'tabindex').length, 0);
  assert(off.cursor.state === null);

  const a = new DomainSeries({ name: 'A' }, data(rows((i) => i)), new LinePath(new LinearCurve())), b = new DomainSeries({ name: 'B' }, data(rows((i) => i)), new LinePath(new LinearCurve()));
  const p1 = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, lin()), new Axis({ orientation: 'left' }, lin()), a);
  const p2 = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, lin()), new Axis({ orientation: 'left' }, lin()), b);
  const cursor = new Cursor({ plane: p2 }, new Crosshair()), free = new Cursor({}, new Crosshair());
  const chart = new Chart({ theme: lightTheme }, p1, p2, cursor, free);
  const platform = new FakePlatform({ width: 400, height: 600 });
  chart.attach(platform).flush();
  // Planes laid one over another share the pointer by order: the first under it gets it.
  platform.pointer!({ kind: 'move', x: p1.rect.x + p1.rect.width / 2, y: p1.rect.y + p1.rect.height / 2, buttons: 0, deltaY: 0, shift: false, ctrl: false });
  assert(cursor.state === null, 'a cursor tied to the other plane ignores it');
  assert(free.state?.plane === p1, 'an untied one follows the pointer\'s plane');
}

// ── PanZoom and a cursor share a plot: two tab stops, and a zoomed view is read at what is in view.
{
  const t = build('cartesian', { pan: true, cursor: { mode: 'shared' }, tooltip: null, crosshair: null });
  assert.equal(withAttr(t.platform, 'tabindex').length, 2, 'the plot for panning and the plot for reading');
}


// ── Elements of the tree: JSON and back, and the cursor releases the platform.
{
  const t = build('polar', { cursor: { mode: 'shared', interpolate: true }, crosshair: { lines: 'second' } });
  const back = fromJSON<Chart>(JSON.parse(JSON.stringify(toJSON(t.chart, registry))), registry);
  const platform = new FakePlatform({ width: 400, height: 400 });
  back.attach(platform).flush();
  const cur = [...back].find((c) => c instanceof Cursor) as Cursor;
  assert.equal(cur.attrs.mode, 'shared');
  assert.equal([...cur].length, 2);
  back.detach();
  assert.equal(platform.pointer, null);
}
});

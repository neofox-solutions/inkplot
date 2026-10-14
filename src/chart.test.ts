// Chart: flushing, caching, live tree edits, export, scheduling, resize and pointer routing, and what the compiler rejects.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  Chart, CartesianPlane, Axis, LinearScale, Series, DomainSeries, LinePath, ObjectDataSource, FlatDataSource, ChartElement, Scale, DataSource, DataTransform,
  StringPlatform, toSvgString, resolveRef, firstDescendantOfType, EVENT_POINTER, inputOf,
  type RawPointer, type ChartEvent, type BaseAttributes, type SvgOptions,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';

// ── Build a chart the way the API sketch does: plain variables for references.
type Row = { t: number; v: number };
const rows = (n: number, amp: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ t: (i / (n - 1)) * 10, v: amp * Math.sin((i / (n - 1)) * Math.PI * 2 * 1.5) }));

const time = new Axis({ id: 'time', orientation: 'bottom', title: 'Time (s)' }, new LinearScale());
const level = new Axis({ id: 'level', orientation: 'left', title: 'Level', nice: true }, new LinearScale());
const source = new ObjectDataSource({ source: rows(200, 1.2), domain: 't', value: 'v', isSorted: true });
const line = new LinePath({ stroke: '#2a6fdb', strokeWidth: 1.5 }, new LinearCurve());

const chart = new Chart(
  { theme: lightTheme, width: 640, height: 360 },
  new CartesianPlane({ frame: true }, time, level, new DomainSeries(source, line)),
);

const platform = new StringPlatform({ width: 640, height: 360 });
chart.attach(platform);
const first = chart.flush();
mkdirSync(new URL('../out/', import.meta.url), { recursive: true }); // `out/` is not in a fresh checkout
writeFileSync(new URL('../out/out.svg', import.meta.url).pathname, platform.toString());

assert(first.filled === 1 && first.projected === 1, 'first flush fills and projects once');
assert(first.pointsDrawn === 200);

// ── Nothing changed: nothing is written.
const idle = chart.flush();
assert.equal(idle.attributeWrites, 0, 'an idle flush writes no attributes');
assert.equal(idle.fillsCached, 1);

// ── A data update is one attribute write: the path's `d`.
source.setAttribute('source', rows(200, 1.1));
const updated = chart.flush();
assert.deepEqual(updated.attributesWritten, ['d'], 'data update writes only d');
assert.equal(updated.attributeWrites, 1);
assert.equal(updated.filled, 1);

// ── A style change writes only that attribute and reuses the fill.
line.setAttribute('stroke', 'crimson');
const styled = chart.flush();
assert.deepEqual(styled.attributesWritten, ['stroke']);
assert.equal(styled.filled, 0);

// ── References by id resolve to the same element.
assert.equal(resolveRef('level', chart, Axis), level);
assert.throws(() => resolveRef('nope', chart));
assert.equal(firstDescendantOfType(chart, Series)?.data, source);

// ── Elements can join and leave a live chart; lazily created nodes still land in order.
const plane = firstDescendantOfType(chart, CartesianPlane)!;
const second = new DomainSeries(new ObjectDataSource({ source: rows(200, 0.6), domain: 't', value: 'v' }), new LinePath({ stroke: 'seagreen' }, new LinearCurve()));
plane.append(second);
chart.flush();
const lines = (svg: string) => [...svg.matchAll(/stroke="(#2a6fdb|crimson|seagreen)"/g)].map((m) => m[1]);
assert.deepEqual(lines(platform.toString()), ['crimson', 'seagreen'], 'appended series draws after the first');
plane.remove(second);
chart.flush();
assert.deepEqual(lines(platform.toString()), ['crimson'], 'removed series leaves no nodes');

// ── Placement follows the tree: DOM order matches child order, own content sits under children,
//    and the frame (an `above` node) sits on top, however the tree is edited.
const order = (svg: string) => ['<defs>', 'text-anchor="middle"', 'text-anchor="end"', 'clip-path=', 'fill="none" stroke="#bbb"']
  .map((token) => svg.indexOf(token));
const inOrder = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]!));
assert(inOrder(order(platform.toString())), 'defs, axes, series, frame, in that order');
const front = new DomainSeries(new ObjectDataSource({ source: rows(50, 0.3), domain: 't', value: 'v' }), new LinePath({ stroke: 'seagreen' }, new LinearCurve()));
plane.insertBefore(front, [...plane][0]!);   // before the axes in the tree
chart.flush();
const svgFront = platform.toString();
assert(svgFront.indexOf('seagreen') < svgFront.indexOf('text-anchor="middle"'), 'inserted first, drawn first');
assert(svgFront.lastIndexOf('stroke="#bbb"') > svgFront.lastIndexOf('crimson'), 'frame still above every series');
plane.remove(front);                         // and out again, from the front
source.setAttribute('source', rows(200, 5));  // the value range changes, so axis labels come and go
chart.flush();
assert(inOrder(order(platform.toString())), 'order survives a removal at the front and relabelling');
assert(!/seagreen/.test(platform.toString()));

// ── Visibility is handled once, by the base class.
line.setAttribute('visible', false);
chart.flush();
assert(/display="none"/.test(platform.toString()));
line.setAttribute('visible', true);
chart.flush();
assert(!/display="none"/.test(platform.toString()) || /display="inline"/.test(platform.toString()));
line.setAttribute('stroke', '#2a6fdb');
chart.flush();

// ── Typed-array source, a different axis layout (two stacked left axes), and one-shot export.
const ys = new Float64Array(1000).map((_, i) => Math.cos(i / 40) * 50 + i / 10);
const flat = new Chart(
  { theme: lightTheme, width: 640, height: 360 },
  new CartesianPlane(
    {},
    new Axis({ title: 'Sample' }, new LinearScale()),
    new Axis({ title: 'Amplitude' }, new LinearScale()),
    new DomainSeries(new FlatDataSource({ data: ys, regularDomain: { start: 0, step: 1 } }), new LinePath({ stroke: '#d9480f' }, new LinearCurve())),
  ),
);
const flatSvg = toSvgString(flat);
writeFileSync(new URL('../out/out-flat.svg', import.meta.url).pathname, flatSvg);

// ── Gaps: NaN breaks the line.
const gappy = new Float64Array([1, 3, 2, NaN, 5, 4, 3]);
const gapSvg = toSvgString(new Chart({ theme: lightTheme, width: 300, height: 200 }, new CartesianPlane({},
  new Axis({}, new LinearScale()), new Axis({}, new LinearScale()),
  new DomainSeries(new FlatDataSource({ data: gappy, regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve())))));
const d = /<path d="(M[^"]*)"[^>]*stroke="#2a6fdb"/.exec(gapSvg)?.[1] ?? '';
assert((d.match(/M/g) ?? []).length === 2, 'a NaN produces a second subpath');
assert(!/NaN|undefined|Infinity/.test(flatSvg + gapSvg + platform.toString()), 'no junk values in the output');

// ── Detach and reattach on another platform.
const svgBeforeDetach = platform.toString();
chart.detach();
const again = new StringPlatform({ width: 640, height: 360 });
chart.attach(again).flush();
assert.equal(again.toString().length > 1000, true);

// ── The compiler checks structure: a scale per axis, a source per series, nothing in the wrong place.
// Never called: these lines only have to fail to compile.
function compileTimeChecks() {
  const series0 = firstDescendantOfType(chart, Series)!;
  // @ts-expect-error an axis needs its scale
  new Axis({ title: 'no scale' });
  // @ts-expect-error a series starts with its data source, not a renderer
  new DomainSeries(new LinePath(new LinearCurve()), source);
  // @ts-expect-error a plane takes axes and series, not renderers
  new CartesianPlane({}, new LinePath(new LinearCurve()));
  // @ts-expect-error a renderer has no children
  new LinePath({}, new LinearScale(), new LinearCurve());
  // @ts-expect-error unknown attribute
  new Axis({ tickLenght: 3 }, new LinearScale());
  // @ts-expect-error internals are private
  void (level as Axis)._first;
  // @ts-expect-error an axis' scale is fixed: it can be replaced but not removed
  level.remove(level.scale);
  // @ts-expect-error a series' data source is fixed too
  series0.remove(series0.data);
  // @ts-expect-error renderers come and go, but not axes
  series0.append(level);
  // @ts-expect-error an axis has one child, so there is no second
  level.child(1, Scale);
  // @ts-expect-error a plane's children are all optional, so none is at a fixed position
  plane.child(0, Axis);
  // @ts-expect-error a fixed child is replaced by one of its own kind
  series0.setChild(0, new LinePath(new LinearCurve()));
  // Only the types are under test: the values are checked by the compiler, not read.
  const scaleOfAxis: LinearScale | Scale = level.child(0, Scale);
  const dataOfSeries: import('./index.ts').DataNode = series0.child(0, DataSource, DataTransform);
  // @ts-expect-error a class that cannot be the fixed child at that place is refused at compile time
  level.child(0, LinePath);
  void [scaleOfAxis, dataOfSeries];
  // @ts-expect-error protected: only an element's own code draws through its surface
  void line.surface;
}
void compileTimeChecks;


// ═══ Scheduling, resize and pointer routing (no browser needed) ═══
{
  /** Records what the plane's children see. */
  class Probe extends ChartElement<CartesianPlane, [], BaseAttributes & { claim?: boolean }> {
    seen: { kind: string; x: number; y: number }[] = [];
    static override takesInput = inputOf;   // an element that takes input declares it
    override onEvent(ev: ChartEvent): void {
      if (ev.type === EVENT_POINTER) {
        this.seen.push({ kind: ev.kind, x: ev.x, y: ev.y });
        if (this.attrs.claim) ev.handled = true;
      }
    }
  }

  const axes = () => [new Axis({ orientation: 'bottom' }, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale())] as const;
  const [bottom, left] = axes();
  const probe = new Probe({ claim: true });
  const plane = new CartesianPlane({}, bottom, left, new DomainSeries(new FlatDataSource({ data: new Float64Array([1, 3, 2]), regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve())), probe as never);
  const chart = new Chart({ theme: lightTheme }, plane);   // no explicit size: follows the platform
  const platform = new FakePlatform({ width: 400, height: 300 });
  chart.attach(platform);

  // ── Scheduling and resize: the chart flushes itself, follows the platform's size, and flushes again when it changes.
  assert(platform.pending, 'attaching asks for a flush');
  platform.runScheduled();
  assert.match(platform.toString(), /width="400"/);
  assert.equal(chart.needsFlush, false);
  platform.current = { width: 520, height: 260 };
  platform.resize!(platform.current);
  assert(platform.pending, 'a resize asks for a flush');
  platform.runScheduled();
  assert.match(platform.toString(), /width="520"/);
  assert.match(platform.toString(), /viewBox="0 0 520 260"/);

  // ── Pointer routing: plane-local coordinates, and the handled flag comes back.
  const r = plane.rect;
  const at = (kind: RawPointer['kind'], x: number, y: number, extra: Partial<RawPointer> = {}): RawPointer =>
    ({ kind, x, y, buttons: 0, deltaY: 0, shift: false, ctrl: false, ...extra });
  const inside = { x: r.x + 10, y: r.y + 20 };
  assert.equal(platform.pointer!(at('move', inside.x, inside.y)), true, 'a claimed event is reported as handled');
  assert.deepEqual(probe.seen.at(-1), { kind: 'move', x: 10, y: 20 });
  probe.seen.length = 0;
  assert.equal(platform.pointer!(at('move', 1, 1)), false, 'outside every plane: ignored');
  assert.deepEqual(probe.seen, [{ kind: 'leave', x: 1 - r.x, y: 1 - r.y }], 'the plane the pointer left is told');

  // A drag keeps going to the plane it started on, even outside it, until the button is up.
  probe.seen.length = 0;
  platform.pointer!(at('down', inside.x, inside.y, { buttons: 1 }));
  platform.pointer!(at('move', 2, 2, { buttons: 1 }));
  platform.pointer!(at('up', 2, 2));
  assert.deepEqual(probe.seen.map((e) => e.kind), ['down', 'move', 'up']);
  assert.equal(probe.seen[1]!.x, 2 - r.x, 'moves outside the plane still arrive, in its coordinates');
  probe.seen.length = 0;
  platform.pointer!(at('move', 2, 2));
  assert.deepEqual(probe.seen.map((e) => e.kind), ['leave'], 'after the button is up the pointer is simply outside, and the plane is told');

  // Unclaimed events are not handled: the browser keeps the wheel.
  probe.setAttribute('claim', false);
  assert.equal(platform.pointer!(at('wheel', inside.x, inside.y, { deltaY: 100 })), false);

  // ── Detaching lets go of the platform.
  chart.detach();
  assert.equal(platform.pointer, null);
  assert.equal(platform.resize, null);
  assert.equal(platform.unsubscribed, 4, 'resize, pointer, key and focus');
  assert.equal(platform.pending, null);
  assert.equal(chart.input, null, 'detaching drops the host');
  // Re-attached, the element asks again and input flows as before.
  chart.attach(platform).flush();
  assert(platform.pointer, 'input is listened to again');
  chart.detach();

  // ── A chart nothing in it listens to never subscribes to input, so a browser leaves the page its touches.
  const still = new Chart({ theme: lightTheme }, new CartesianPlane({}, ...axes(), new DomainSeries(new FlatDataSource({ data: new Float64Array([1, 3, 2]), regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve()))));
  const quiet = new FakePlatform({ width: 400, height: 300 });
  still.attach(quiet).flush();
  assert.equal(quiet.pointer, null); assert.equal(quiet.keyHandler, null); assert.equal(quiet.focusHandler, null);
  assert.equal(still.input, null);
  still.detach();
  assert.equal(quiet.unsubscribed, 1, 'only the resize');

}

console.log('ok chart', {
  firstFlushMs: +first.total.toFixed(2),
  bytes: svgBeforeDetach.length,
  attributesFirstFlush: first.attributeWrites,
});

// ── Background: none by default; `style.chart.background` or the theme's fills the drawing, beneath everything.
{
  const make = (a: Partial<ConstructorParameters<typeof Chart>[0]>) => toSvgString(new Chart({ theme: lightTheme, width: 200, height: 100, ...a } as ConstructorParameters<typeof Chart>[0], new CartesianPlane({})));
  assert.ok(!/<rect[^>]*width="200"[^>]*height="100"/.test(make({})), 'no background by default');
  const svg = make({ style: { chart: { background: '#fffbe6' } } });
  assert.match(svg, /<rect[^>]*width="200"[^>]*height="100"[^>]*fill="#fffbe6"|<rect[^>]*fill="#fffbe6"[^>]*width="200"/);
  assert.ok(svg.indexOf('#fffbe6') < svg.indexOf('<g'), 'drawn first');
  assert.match(make({ theme: { ...lightTheme, chart: { background: '#111' } } }), /fill="#111"/);
  assert.match(make({ theme: { ...lightTheme, chart: { background: '#111' } }, style: { chart: { background: '#222' } } }), /fill="#222"/);
}

// ── Ids in an SVG are the same on every draw, differ between charts, and can be named.
{
  const line = (data: number[]) => new Chart({ theme: lightTheme, width: 200, height: 120 }, new CartesianPlane({},
    new Axis({}, new LinearScale()), new Axis({}, new LinearScale()),
    new DomainSeries(new FlatDataSource({ data: new Float64Array(data), regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve()))));
  const idsOf = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
  const one = toSvgString(line([1, 3, 2])), same = toSvgString(line([1, 3, 2])), other = toSvgString(line([2, 1, 4]));
  assert.equal(one, same, 'the same chart drawn twice gives the same text, however many charts were made before');
  const ids = idsOf(one);
  assert.ok(ids.length > 0 && ids.every((id) => /^ink[0-9a-f]{8}-\d+$/.test(id)), `ids are ink<hash>-<n>: ${ids.join()}`);
  assert.ok(ids.every((id) => one.includes(`url(#${id})`)), 'every id is pointed at');
  assert.ok([...one.matchAll(/url\(#([^)]+)\)/g)].every((m) => ids.includes(m[1]!)), 'every pointer finds its id');
  assert.equal(idsOf(other).filter((id) => ids.includes(id)).length, 0, 'two different charts share no id, so they can sit in one page');
  const named = toSvgString(line([1, 3, 2]), { idPrefix: 'sales' });
  assert.deepEqual(idsOf(named), ids.map((_, i) => `sales-${i + 1}`));
  const bare = (o: SvgOptions) => toSvgString(new Chart({ theme: lightTheme }, new CartesianPlane({}, new Axis({}, new LinearScale()), new Axis({}, new LinearScale()))), o);
  assert.match(bare({ width: 300, height: 90 }), /width="300" height="90"/);
  assert.match(bare({}), /width="640" height="400"/);
  assert.match(toSvgString(line([1, 3, 2]), { width: 999 }), /width="200" height="120"/, 'the chart\'s own size wins');
}

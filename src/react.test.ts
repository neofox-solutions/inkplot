// React adapter, in jsdom: the tree React renders is the tree `new` builds, attributes are written only when they differ,
// reorders move instances, and the chart is attached while mounted.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as L from './index.ts';
import { ChartView, reactWrapper } from './react.ts';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act, createElement: h, StrictMode, memo, useState } = React;

const Chart = reactWrapper(L.Chart), Plane = reactWrapper(L.CartesianPlane), Axis = reactWrapper(L.Axis), Linear = reactWrapper(L.LinearScale), Log = reactWrapper(L.LogScale);
const Series = reactWrapper(L.DomainSeries), Flat = reactWrapper(L.FlatDataSource), Line = reactWrapper(L.LinePath), Curve = reactWrapper(L.LinearCurve), Title = reactWrapper(L.ChartTitle);
const platformOptions = { size: { width: 400, height: 200 }, preciseText: false, schedule: 'manual' as const };

const mount = () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  return { container, root, render: (node: React.ReactNode) => act(async () => { root.render(node); }), unmount: () => act(async () => { root.unmount(); }) };
};
const ids = (e: L.AnyElement) => [...e].map((c) => (c.attrs as { id?: string }).id ?? c.constructor.name);
const data = [1, 3, 2, 5];

const series = (id: string, color = '#36c') => h(Series, { key: id, id }, h(Flat, { data, regularDomain: { start: 0, step: 1 } }), h(Line, { stroke: color }, h(Curve)));
const page = (props: { min?: number; title?: string; ids?: string[]; log?: boolean; chart?: React.Ref<L.Chart>; plane?: React.Ref<L.CartesianPlane>; axis?: React.Ref<L.Axis> } = {}) =>
  h(Chart, { theme: L.lightTheme, ref: props.chart, hostProps: { id: 'host' }, platformOptions },
    h(Title, { text: 'T', 'meta-description': 'd' }),
    h(Plane, { ref: props.plane },
      h(Axis, { id: 'x', ref: props.axis, ...(props.min === undefined ? {} : { min: props.min }), 'meta-title': props.title ?? 'time' }, props.log ? h(Log) : h(Linear)),
      h(Axis, { id: 'y', orientation: 'left' }, h(Linear)),
      ...(props.ids ?? ['a', 'b']).map((id) => series(id))));

// The tree is the one `new` builds.
{
  const m = mount();
  let chart: L.Chart | null = null, plane: L.CartesianPlane | null = null;
  await m.render(page({ chart: (c) => { if (c) chart = c; }, plane: (p) => { if (p) plane = p; } }));
  assert.ok(chart && plane);
  const reference = new L.Chart({ theme: L.lightTheme },
    new L.ChartTitle({ text: 'T', meta: { description: 'd' } }),
    new L.CartesianPlane({},
      new L.Axis({ id: 'x', meta: { title: 'time' } }, new L.LinearScale()),
      new L.Axis({ id: 'y', orientation: 'left' }, new L.LinearScale()),
      ...['a', 'b'].map((id) => new L.DomainSeries({ id }, new L.FlatDataSource({ data, regularDomain: { start: 0, step: 1 } }), new L.LinePath({ stroke: '#36c' }, new L.LinearCurve())))));
  assert.ok(JSON.stringify(L.toJSON(chart, L.registry)) === JSON.stringify(L.toJSON(reference, L.registry)), 'the same tree');
  // Attached to the host div, and drawn once flushed.
  assert.ok((chart as L.Chart).isAttached);
  (chart as L.Chart).flush();
  const svg = m.container.querySelector('#host svg');
  assert.ok(svg && svg.querySelectorAll('path').length >= 3, 'the chart is drawn in the host');
  assert.equal(svg!.getAttribute('width'), '400');
  // Gone with the component.
  await m.unmount();
  assert.ok(!(chart as L.Chart).isAttached, 'detached on unmount');
  assert.equal(m.container.querySelector('svg'), null, 'and its svg removed');
}

// Attributes: written when they differ, removed when they go, and not touched by equal objects.
{
  const m = mount();
  let axis: L.Axis | null = null;
  const writes: string[] = [];
  const original = L.Axis.prototype.setAttributes;
  L.Axis.prototype.setAttributes = function (this: L.Axis, patch: Record<string, unknown>) { writes.push(Object.keys(patch).sort().join()); return original.call(this, patch as never); };
  try {
    await m.render(page({ axis: (a) => { if (a) axis = a; }, min: 0 }));
    assert.equal(axis!.attrs.min, 0);
    assert.deepEqual(axis!.attrs.meta, { title: 'time' });
    writes.length = 0;
    await m.render(page({ axis: (a) => { if (a) axis = a; }, min: 0 }));
    assert.deepEqual(writes, [], 'equal props, and a new `meta` object by content, write nothing');
    await m.render(page({ axis: (a) => { if (a) axis = a; }, min: 5, title: 'other' }));
    assert.deepEqual(writes, ['meta,min'], 'only what changed');
    assert.equal(axis!.attrs.min, 5);
    assert.deepEqual(axis!.attrs.meta, { title: 'other' });
    writes.length = 0;
    await m.render(page({ axis: (a) => { if (a) axis = a; } }));
    assert.deepEqual(writes, ['min,meta'].map((s) => s.split(',').sort().join()), 'a prop that is gone is removed');
    assert.ok(!('min' in axis!.attrs));
  } finally { L.Axis.prototype.setAttributes = original; }
  await m.unmount();
}

// Order: reorders move the same instances, insertions go in place, removals leave the rest.
{
  const m = mount();
  let plane: L.CartesianPlane | null = null;
  const ref = (p: L.CartesianPlane | null) => { if (p) plane = p; };
  const seriesIds = () => ids(plane!).filter((i) => i.length === 1 && i !== 'x' && i !== 'y');
  await m.render(page({ plane: ref, ids: ['a', 'b', 'c'] }));
  assert.deepEqual(ids(plane!), ['x', 'y', 'a', 'b', 'c']);
  const before = new Map([...plane!].map((e) => [(e.attrs as { id: string }).id, e]));
  await m.render(page({ plane: ref, ids: ['c', 'a', 'b'] }));
  assert.deepEqual(ids(plane!), ['x', 'y', 'c', 'a', 'b'], 'moved');
  for (const e of plane!) assert.equal(before.get((e.attrs as { id: string }).id), e, 'the same elements, moved');
  await m.render(page({ plane: ref, ids: ['c', 'b'] }));
  assert.deepEqual(seriesIds(), ['c', 'b'], 'one removed');
  await m.render(page({ plane: ref, ids: ['c', 'n', 'b', 'm'] }));
  assert.deepEqual(seriesIds(), ['c', 'n', 'b', 'm'], 'two inserted, one in the middle');
  await m.render(page({ plane: ref, ids: [] }));
  assert.deepEqual(ids(plane!), ['x', 'y']);
  await m.unmount();
}

// A fixed child swapped for another kind: one scale, the new kind.
{
  const m = mount();
  let axis: L.Axis | null = null;
  await m.render(page({ axis: (a) => { if (a) axis = a; } }));
  assert.ok(axis!.child(0, L.Scale) instanceof L.LinearScale);
  await m.render(page({ axis: (a) => { if (a) axis = a; }, log: true }));
  assert.deepEqual([...axis!].map((c) => c.constructor.name), ['LogScale']);
  await m.render(page({ axis: (a) => { if (a) axis = a; } }));
  assert.deepEqual([...axis!].map((c) => c.constructor.name), ['LinearScale']);
  await m.unmount();
}

// Strict Mode renders twice and runs effects twice: still one of everything, in order.
{
  const m = mount();
  let chart: L.Chart | null = null, plane: L.CartesianPlane | null = null;
  await m.render(h(StrictMode, null, page({ chart: (c) => { if (c) chart = c; }, plane: (p) => { if (p) plane = p; }, ids: ['a', 'b', 'c'] })));
  assert.deepEqual(ids(plane!), ['x', 'y', 'a', 'b', 'c']);
  assert.equal([...chart!].length, 2);
  assert.ok(chart!.isAttached);
  await m.render(h(StrictMode, null, page({ chart: (c) => { if (c) chart = c; }, plane: (p) => { if (p) plane = p; }, ids: ['c', 'b', 'a'] })));
  assert.deepEqual(ids(plane!), ['x', 'y', 'c', 'b', 'a']);
  await m.unmount();
}

// A child that does not render with its parent stays where it is, and the others still change around it.
{
  const m = mount();
  let plane: L.CartesianPlane | null = null;
  const Stable = memo(() => series('s'));
  const view = (extra: string[]) => h(Chart, { theme: L.lightTheme, platformOptions }, h(Plane, { ref: (p: L.CartesianPlane | null) => { if (p) plane = p; } }, h(Axis, { id: 'x' }, h(Linear)), h(Axis, { id: 'y' }, h(Linear)), h(Stable), ...extra.map((id) => series(id))));
  await m.render(view(['a']));
  assert.deepEqual(ids(plane!), ['x', 'y', 's', 'a']);
  await m.render(view(['a', 'b']));
  assert.deepEqual(ids(plane!), ['x', 'y', 's', 'a', 'b'], 'the memoized child is kept, new ones join');
  await m.render(view([]));
  assert.deepEqual(ids(plane!), ['x', 'y', 's'], 'and the others can go');
  await m.unmount();
}

// A component with state between chart elements: the chart follows its state.
{
  const m = mount();
  let flip: (() => void) | null = null, plane: L.CartesianPlane | null = null;
  const Toggle = () => { const [on, set] = useState(false); flip = () => set(!on); return on ? series('t') : null; };
  await m.render(h(Chart, { theme: L.lightTheme, platformOptions }, h(Plane, { ref: (p: L.CartesianPlane | null) => { if (p) plane = p; } }, h(Axis, { id: 'x' }, h(Linear)), h(Axis, { id: 'y' }, h(Linear)), h(Toggle))));
  assert.deepEqual(ids(plane!), ['x', 'y']);
  await act(async () => { flip!(); });
  assert.deepEqual(ids(plane!), ['x', 'y', 't'], 'appears (last: its parent did not render)');
  await act(async () => { flip!(); });
  assert.deepEqual(ids(plane!), ['x', 'y']);
  await m.unmount();
}

// A chart made another way, shown with ChartView; detached when it goes.
{
  const m = mount();
  const chart = new L.Chart({ theme: L.lightTheme }, new L.CartesianPlane({}, new L.Axis({}, new L.LinearScale()), new L.Axis({ orientation: 'left' }, new L.LinearScale()),
    new L.DomainSeries(new L.FlatDataSource({ data, regularDomain: { start: 0, step: 1 } }), new L.LinePath({}, new L.LinearCurve()))));
  await m.render(h(ChartView, { chart, hostProps: { id: 'view' }, platformOptions }));
  assert.ok(chart.isAttached);
  chart.flush();
  assert.ok(m.container.querySelectorAll('#view svg path').length >= 2);
  await m.unmount();
  assert.ok(!chart.isAttached);
}

// Mistakes are errors in the render, naming the attribute.
{
  const m = mount();
  const quiet = console.error;
  console.error = () => {};
  try {
    await assert.rejects(async () => { await m.render(h(Chart, { theme: L.lightTheme, platformOptions }, h(Plane, null, h(Axis, { meta: { title: 'a' }, 'meta-description': 'b' }, h(Linear))))); }, /conflicts with 'meta'/);
  } finally { console.error = quiet; }
}
console.log('react ok');

// ── Tree-shaking: a page that uses two built-ins gets those and what they need, not the other 54 and their classes.
{
  const { build } = await import('esbuild');
  const src = (f: string) => new URL(f, import.meta.url).pathname;
  const out = await build({
    stdin: { contents: `import { Axis, LinearScale } from 'inkplot/react'; export default [Axis, LinearScale];`, resolveDir: src('.'), loader: 'ts' },
    bundle: true, write: false, minify: false, format: 'esm', external: ['react'], treeShaking: true, logLevel: 'error',
    alias: { 'inkplot/react': src('react.ts'), inkplot: src('index.ts') },
  });
  const text = out.outputFiles[0]!.text;
  assert.ok(/(var|class) Axis\b/.test(text) && /(var|class) LinearScale\b/.test(text));
  for (const gone of ['RadarPlane', 'BarPath', 'TemporalTimeScale', 'CalloutAnnotation', 'Legend']) assert.ok(!new RegExp(`(var|class) ${gone}\\b`).test(text), `${gone} should be shaken out`);
  console.log('react tree-shaking ok', text.length);
}

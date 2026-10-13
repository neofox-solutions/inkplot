// JSX runtime: tags build elements directly, hyphenated attributes nest, children flatten, and real JSX compiled by esbuild gives the same chart as `new`.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Axis, CartesianPlane, Chart, ChartTitle, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, StringPlatform, lightTheme, registry, toJSON, toSvgString } from './index.ts';
import { Fragment, jsx, jsxs } from './jsx-runtime.ts';
import { jsxDEV } from './jsx-dev-runtime.ts';

// A tag is the element, built at once.
const scale = jsx(LinearScale, {});
const axis = jsx(Axis, { min: 0, 'meta-title': 'Time', 'meta-aria-roledescription': 'x axis', children: scale }) as Axis;
assert.ok(axis instanceof Axis);
assert.equal(axis.attrs.min, 0);
assert.deepEqual(axis.attrs.meta, { title: 'Time', aria: { roledescription: 'x axis' } });
assert.equal(axis.child(0, LinearScale), scale);

// Children: lists and fragments are flattened, holes are dropped, order is kept.
const a = jsx(Axis, { id: 'a', children: jsx(LinearScale, {}) }), b = jsx(Axis, { id: 'b', children: jsx(LinearScale, {}) }), c = jsx(Axis, { id: 'c', children: jsx(LinearScale, {}) });
const plane = jsxs(CartesianPlane, { children: [a, [null, b], false, jsx(Fragment, { children: [c, undefined] })] }) as CartesianPlane;
assert.deepEqual([...plane].map((e) => e.attrs.id), ['a', 'b', 'c']);
assert.equal(jsx(CartesianPlane, {}).firstChild, null, 'no children at all');

// Undefined attributes are not set; `key` is ignored; objects and functions arrive as they are.
const fmt = (v: number) => `${v}!`, include = [0];
const ax = jsx(Axis, { format: fmt, include, title: undefined, children: jsx(LinearScale, {}) }, 'k') as Axis;
assert.equal(ax.attrs.format, fmt);
assert.equal(ax.attrs.include, include);
assert.ok(!('title' in ax.attrs));

// `ref` gets the element, as a function or an object.
let got: unknown;
const box: { current: unknown } = { current: null };
const withRefs = jsx(Axis, { ref: (e: unknown) => { got = e; }, children: jsx(LinearScale, { ref: box }) });
assert.equal(got, withRefs);
assert.equal(box.current, withRefs.firstChild);
assert.ok(!('ref' in withRefs.attrs), 'ref is not an attribute');

// A function tag makes a reusable piece; it gets its children.
const Panel = (props: { name: string; children?: unknown }) => jsx(Axis, { id: props.name, children: props.children ?? jsx(LinearScale, {}) });
const piece = jsx(Panel, { name: 'p' });
assert.equal(piece.attrs.id, 'p');
assert.ok(piece.firstChild instanceof LinearScale);
const own = jsx(LinearScale, {});
assert.equal(jsx(Panel, { name: 'q', children: own }).firstChild, own);
assert.throws(() => jsx((() => 'nope') as never, {}), /<.*>: a function used as a tag must return a chart element/);

// Mistakes say which tag and what was wrong.
assert.throws(() => jsx(Axis, { children: 'text' }), /<Axis>: a child must be a chart element, not string "text"/);
assert.throws(() => jsx(Axis, { children: [jsx(LinearScale, {}), 5] }), /not number 5/);
assert.throws(() => jsx(Axis, { children: {} }), /not an object/);
assert.throws(() => jsx(Axis, { meta: { title: 'a' }, 'meta-description': 'b' }), /conflicts/);
assert.throws(() => jsx(Axis, { 'a--b': 1 }), /empty name part/);

// The development runtime says where.
assert.throws(() => jsxDEV(Axis, { children: 'x' }, undefined, false, { fileName: 'chart.tsx', lineNumber: 7, columnNumber: 3 }), /not string "x" \(chart\.tsx:7:3\)/);
assert.doesNotThrow(() => jsxDEV(Axis, { children: jsx(LinearScale, {}) }, undefined, true, { fileName: 'chart.tsx' }));
const nested = (() => { try { jsxDEV(Axis, { children: jsxDEV(Axis, { children: 'x' }, undefined, false, { fileName: 'f.tsx', lineNumber: 2 }) }, undefined, false, { fileName: 'f.tsx', lineNumber: 1 }); } catch (e) { return (e as Error).message; } })();
assert.equal((nested!.match(/f\.tsx/g) ?? []).length, 1, 'the innermost position only');

// The same chart three ways: with `new`, with direct calls, and with JSX that esbuild compiled against this runtime.
const rows = Array.from({ length: 30 }, (_, i) => ({ t: i, v: Math.sin(i / 4) }));
const withNew = () => new Chart({ theme: lightTheme, width: 400, height: 240 },
  new ChartTitle({ text: 'Sine' }),
  new CartesianPlane({},
    new Axis({ orientation: 'bottom', meta: { title: 'time' } }, new LinearScale()),
    new Axis({ orientation: 'left', nice: true }, new LinearScale()),
    new DomainSeries({ name: 'sin' }, new FlatDataSource({ data: rows.map((r) => r.v), regularDomain: { start: 0, step: 1 } }), new LinePath({ stroke: '#36c' }, new LinearCurve()))));
const reference = withNew();
const expectedSvg = toSvgString(reference), expectedJson = JSON.stringify(toJSON(reference, registry));

const bundled = await build({
  stdin: {
    loader: 'tsx', resolveDir: import.meta.dirname, contents: `
      import { Axis, CartesianPlane, Chart, ChartTitle, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme, registry, toJSON, toSvgString } from './index.ts';
      const rows = ${JSON.stringify(rows)};
      const stroke = '#36c';
      export const chart = (
        <Chart theme={lightTheme} width={400} height={240}>
          <ChartTitle text="Sine" />
          <CartesianPlane>
            <Axis orientation="bottom" meta-title="time"><LinearScale /></Axis>
            <Axis orientation="left" nice><LinearScale /></Axis>
            <DomainSeries name="sin">
              <FlatDataSource data={rows.map((r) => r.v)} regularDomain-start={0} regularDomain-step={1} />
              <LinePath stroke={stroke}><LinearCurve /></LinePath>
            </DomainSeries>
          </CartesianPlane>
        </Chart>
      );
      export const svg = toSvgString(chart);
      export const json = JSON.stringify(toJSON(chart, registry));
    `,
  },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', jsxImportSource: import.meta.dirname, logLevel: 'silent',
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0]!.text).toString('base64'));
// (Clip ids come from a counter each copy of the library has for itself.)
const sameIds = (svg: string) => svg.replace(/clip\d+/g, 'clip');
assert.ok(sameIds(mod.svg) === sameIds(expectedSvg), 'JSX gives the chart `new` gives');
assert.ok(mod.json === expectedJson, 'and the same tree');
// Elements made by another copy of the library are still chart elements to this one only through the JSON, as expected of separate bundles.
assert.ok(new StringPlatform({ width: 1, height: 1 }));
console.log('jsx ok');

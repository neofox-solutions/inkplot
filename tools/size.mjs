// Bundle size per scenario: each is a small program that uses the library the way a page would, bundled through the barrel
// with esbuild (minified, ESM, tree-shaken), then measured raw, gzip and brotli. Deltas are against the minimal chart, so
// a row says what its feature costs on top of a chart that already draws a line.
//   node tools/size.mjs            the table
//   node tools/size.mjs --modules  also the cost of each source module in the kitchen-sink bundle
import { build } from 'esbuild';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = (p) => root + 'src/' + p;

const BASE = ['Chart', 'CartesianPlane', 'Axis', 'LinearScale', 'DomainSeries', 'LinePath', 'LinearCurve', 'FlatDataSource', 'lightTheme', 'toSvgString'];
const FLAT = `new FlatDataSource({ data: ys, regularDomain: { start: 0, step: 1 } })`;
const ROWS = `new ObjectDataSource({ source: rows, domain: 'x', value: 'y', channels: { v: 'v' } })`;

/** The program for a scenario; each field replaces one default piece of the minimal chart. */
function program(s) {
  const imports = new Set([...BASE, ...(s.imports ?? [])]);
  const [o1, o2] = s.axes ?? ['bottom', 'left'];
  return `import { ${[...imports].join(', ')} } from 'inkplot';
const ys = new Float64Array(100), rows = [{ x: 0, y: 0, v: 0 }];
export function make(el) {
  const x = new Axis({ orientation: '${o1}' }, ${s.xScale ?? 'new LinearScale()'});
  const y = new Axis({ orientation: '${o2}' }, new LinearScale());
  ${s.setup ?? ''}
  const series = ${s.series ?? `new DomainSeries(${s.data ?? FLAT}, new LinePath(new LinearCurve())${(s.renderers ?? []).map((r) => ', ' + r).join('')})`};
  const plane = new ${s.plane ?? 'CartesianPlane'}({}, x, y, series${(s.planeKids ?? []).map((k) => ', ' + k).join('')});
  const chart = new Chart({ theme: ${s.theme ?? 'lightTheme'} }, plane${(s.chartKids ?? []).map((k) => ', ' + k).join('')});
  ${s.out ?? 'return toSvgString(chart);'}
}
`;
}

const SCENARIOS = [
  { name: 'Minimal line chart to an SVG string' },
  { name: 'dark theme as well', imports: ['darkTheme'], theme: `(el ? darkTheme : lightTheme)` },
  { name: 'DOM platform (instead of an SVG string)', imports: ['DOMPlatform'], out: 'return chart.attach(new DOMPlatform(el));' },
  { name: 'Pan and zoom', imports: ['PanZoom'], planeKids: ['new PanZoom({})'] },
  { name: 'Pointer listener', imports: ['PointerListener'], planeKids: ['new PointerListener({ onClick() {} })'] },
  { name: 'Chart title', imports: ['ChartTitle'], chartKids: [`new ChartTitle({ text: 't' })`] },
  { name: 'Cursor + tooltip', imports: ['Cursor', 'ChartTooltip'], chartKids: ['new Cursor({}, new ChartTooltip({}))'] },
  { name: 'Cursor + crosshair', imports: ['Cursor', 'Crosshair'], chartKids: ['new Cursor({}, new Crosshair({}))'] },
  { name: 'Legend', imports: ['Legend'], chartKids: ['new Legend({})'] },
  { name: 'Screen-reader summary', imports: ['ChartSummary'], chartKids: ['new ChartSummary({})'] },
  { name: 'Line annotation', imports: ['LineAnnotation'], planeKids: ['new LineAnnotation({ value: 1 })'] },
  { name: 'Callout annotation', imports: ['CalloutAnnotation'], planeKids: [`new CalloutAnnotation({ domain: 1, value: 1, text: 't' })`] },
  { name: 'Circle markers', imports: ['CircleMarker'], renderers: ['new CircleMarker({})'] },
  { name: 'Area path', imports: ['AreaPath'], renderers: ['new AreaPath({}, new LinearCurve())'] },
  { name: 'Stepped line (StepCurve)', imports: ['StepCurve'], series: `new DomainSeries(${FLAT}, new LinePath({}, new StepCurve({})))` },
  { name: 'Stepped area (StepCurve)', imports: ['StepCurve', 'AreaPath'], series: `new DomainSeries(${FLAT}, new AreaPath({}, new StepCurve({})))` },
  { name: 'Monotone curve', imports: ['MonotoneCurve'], series: `new DomainSeries(${FLAT}, new LinePath({}, new MonotoneCurve()))` },
  { name: 'Arc curve', imports: ['ArcCurve'], series: `new DomainSeries(${FLAT}, new LinePath({}, new ArcCurve({})))` },
  { name: 'Every curve', imports: ['MonotoneCurve', 'NaturalCurve', 'CardinalCurve', 'CatmullRomCurve', 'BasisCurve', 'BumpCurve', 'QuadraticCurve', 'ArcCurve', 'StepCurve'], series: `new DomainSeries(${FLAT}, new LinePath({}, new MonotoneCurve()), ...[new NaturalCurve(), new CardinalCurve(), new CatmullRomCurve(), new BasisCurve(), new BumpCurve(), new QuadraticCurve(), new ArcCurve(), new StepCurve()].map((c) => new LinePath({}, c)))` },
  { name: 'Bars (replaces LinePath)', imports: ['BarPath'], series: `new DomainSeries(${FLAT}, new BarPath({}))` },
  { name: 'Bars as lines (BarLinePath)', imports: ['BarLinePath'], series: `new DomainSeries(${FLAT}, new BarLinePath({}))` },
  {
    name: 'toJSON + fromJSON, registry of only the classes used', imports: ['toJSON', 'fromJSON'],
    setup: 'const reg = { Chart, CartesianPlane, Axis, LinearScale, DomainSeries, LinePath, LinearCurve, FlatDataSource };',
    out: 'return toSvgString(fromJSON(JSON.parse(JSON.stringify(toJSON(chart, reg))), reg));',
  },
  {
    name: 'toJSON + fromJSON + applyJSON with the full registry', imports: ['toJSON', 'fromJSON', 'applyJSON', 'registry', 'Refs'],
    out: 'const refs = new Refs({}, { auto: true }); applyJSON(chart, toJSON(chart, registry, { refs }), registry, { refs }); return toSvgString(fromJSON(toJSON(chart, registry, { refs }), registry, { refs }));',
  },
  { name: 'Stack of two area series', imports: ['Stack', 'AreaPath'], series: `new Stack({}, new DomainSeries(${FLAT}, new AreaPath({}, new LinearCurve())), new DomainSeries(${FLAT}, new AreaPath({}, new LinearCurve())))` },
  { name: 'Stack of two bar series', imports: ['Stack', 'BarPath'], series: `new Stack({}, new DomainSeries(${FLAT}, new BarPath({})), new DomainSeries(${FLAT}, new BarPath({})))` },
  { name: 'Decimator (min/max kernel)', imports: ['Decimator', 'MinMaxKernel'], data: `new Decimator({}, new MinMaxKernel(), ${FLAT})` },
  { name: 'Objects as data', imports: ['ObjectDataSource'], data: ROWS },
  { name: 'Log scale on x', imports: ['LogScale'], xScale: 'new LogScale()' },
  { name: 'Time axis, Date + Intl (replaces linear x)', imports: ['IntlTimeScale'], xScale: `new IntlTimeScale({ timeZone: 'UTC' })` },
  { name: 'Time axis, Temporal (replaces linear x)', imports: ['TemporalTimeScale'], xScale: `new TemporalTimeScale({ timeZone: 'UTC' })` },
  { name: 'Band scale on x', imports: ['BandScale'], xScale: `new BandScale({ categories: ['a'] })` },
  { name: 'Polar plane (instead of Cartesian)', imports: ['PolarPlane'], plane: 'PolarPlane', axes: ['angle', 'radius'] },
  { name: 'Radar plane (instead of Cartesian)', imports: ['RadarPlane'], plane: 'RadarPlane', axes: ['angle', 'radius'] },
  {
    name: 'Colour axis, colour key, circle markers', imports: ['ObjectDataSource', 'ColorAxis', 'ColorKey', 'CircleMarker'], data: ROWS,
    setup: 'const c = new ColorAxis({}, new LinearScale());', renderers: [`new CircleMarker({ bind: { fill: { axis: c, channel: 'v' } } })`],
    chartKids: ['c', 'new ColorKey({ dimension: c })'],
  },
  { name: 'The `lineSeries` shortcut (replaces DomainSeries + LinePath)', imports: ['lineSeries'], series: `lineSeries(${FLAT})` },
  {
    name: 'Kitchen sink: every feature above in one chart', imports: [
      'DOMPlatform', 'PanZoom', 'PointerListener', 'ChartTitle', 'Cursor', 'ChartTooltip', 'Crosshair', 'LineAnnotation', 'CalloutAnnotation', 'CircleMarker', 'Decimator',
      'MinMaxKernel', 'ObjectDataSource', 'ColorAxis', 'ColorKey', 'darkTheme', 'LogScale', 'BandScale', 'Stack', 'BarPath',
    ],
    data: `new Decimator({}, new MinMaxKernel(), ${ROWS})`, setup: 'const c = new ColorAxis({}, new LinearScale()); const l = new LogScale(), b = new BandScale({ categories: [] }); globalThis.s = [l, b, darkTheme, Stack, BarPath];',
    renderers: [`new CircleMarker({ bind: { fill: { axis: c, channel: 'v' } } })`],
    planeKids: ['new PanZoom({})', 'new PointerListener({ onClick() {} })', 'new LineAnnotation({ value: 1 })', `new CalloutAnnotation({ domain: 1, value: 1, text: 't' })`],
    chartKids: [`new ChartTitle({ text: 't' })`, 'new Cursor({ mode: "shared" }, new Crosshair({}), new ChartTooltip({}))', 'c', 'new ColorKey({ dimension: c })'],
    out: 'return chart.attach(new DOMPlatform(el));',
  },
  {
    name: 'The minimal chart written as JSX (runtime + attribute expansion)', jsx: true,
    source: `import { Chart, CartesianPlane, Axis, LinearScale, DomainSeries, LinePath, LinearCurve, FlatDataSource, lightTheme, toSvgString } from 'inkplot';
const ys = new Float64Array(100);
export function make() {
  return toSvgString(<Chart theme={lightTheme}><CartesianPlane>
    <Axis orientation="bottom"><LinearScale /></Axis><Axis orientation="left"><LinearScale /></Axis>
    <DomainSeries><FlatDataSource data={ys} regularDomain-start={0} regularDomain-step={1} /><LinePath><LinearCurve /></LinePath></DomainSeries>
  </CartesianPlane></Chart>);
}`,
  },
  {
    name: 'The minimal chart as React components, built-ins (react itself not counted)', jsx: true, external: ['react', 'react-dom/client', 'react/jsx-runtime'], reactJsx: true,
    source: `import { createRoot } from 'react-dom/client';
import { lightTheme } from 'inkplot';
import { Chart, CartesianPlane as Plane, Axis, LinearScale as Linear, DomainSeries as Series, FlatDataSource as Flat, LinePath as Line, LinearCurve as Curve } from 'inkplot/react';
const ys = new Float64Array(100);
export function make(el) {
  createRoot(el).render(<Chart theme={lightTheme}><Plane>
    <Axis orientation="bottom"><Linear /></Axis><Axis orientation="left"><Linear /></Axis>
    <Series><Flat data={ys} regularDomain-start={0} regularDomain-step={1} /><Line><Curve /></Line></Series>
  </Plane></Chart>);
}`,
  },
  {
    name: 'The minimal chart as custom elements (the tags defined; markup not counted)',
    source: `import * as L from 'inkplot';
import { defineElements } from 'inkplot/web-components';
export function make() {
  defineElements({ Chart: L.Chart, CartesianPlane: L.CartesianPlane, Axis: L.Axis, LinearScale: L.LinearScale, DomainSeries: L.DomainSeries, FlatDataSource: L.FlatDataSource, LinePath: L.LinePath, LinearCurve: L.LinearCurve }, { prefix: 'ch' });
}`,
  },
  { name: 'Everything the barrel exports (`import * as L`)', whole: true },
];

async function bundle(s, wantMeta = false) {
  const contents = s.whole ? `import * as L from 'inkplot'; globalThis.L = L;` : s.source ?? program(s);
  const r = await build({
    stdin: { contents, resolveDir: root, loader: s.jsx ? 'jsx' : 'js' }, bundle: true, minify: true, format: 'esm', target: 'es2022', write: false,
    ...(s.jsx ? { jsx: 'automatic', jsxImportSource: s.reactJsx ? 'react' : 'inkplot' } : {}),
    ...(s.external ? { external: s.external } : {}),
    alias: { inkplot: src('index.ts'), 'inkplot/jsx-runtime': src('jsx-runtime.ts'), 'inkplot/react': src('react.ts'), 'inkplot/web-components': src('web-components.ts') }, metafile: wantMeta, legalComments: 'none', logLevel: 'error', treeShaking: true,
  });
  const code = r.outputFiles[0].contents;
  return { raw: code.length, gzip: gzipSync(code, { level: 9 }).length, brotli: brotliCompressSync(code).length, meta: r.metafile };
}

const kb = (n) => (n / 1024).toFixed(1);
const sign = (n) => (n >= 0 ? '+' : '') + kb(n);
const rows = [];
let base;
for (const s of SCENARIOS) {
  const m = await bundle(s);
  base ??= m;
  rows.push({ s, m });
}
const head = '| Scenario | min KB | gzip KB | brotli KB | gzip vs minimal |\n|---|---:|---:|---:|---:|\n';
const table = head + rows.map(({ s, m }, i) => `| ${s.name} | ${kb(m.raw)} | ${kb(m.gzip)} | ${kb(m.brotli)} | ${i === 0 ? '' : s.whole ? '' : sign(m.gzip - base.gzip)} |`).join('\n');
console.log(table);

let modules = '';
if (process.argv.includes('--modules')) {
  for (const prefix of ['Minimal', 'Kitchen']) {
    const sc = SCENARIOS.find((s) => s.name.startsWith(prefix));
    const m = await bundle(sc, true);
    const inputs = Object.entries(m.meta.outputs).flatMap(([, o]) => Object.entries(o.inputs)).map(([f, v]) => [f.replace(/^.*src\//, ''), v.bytesInOutput]).filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]);
    const total = inputs.reduce((a, [, b]) => a + b, 0);
    modules += `\n\n| ${sc.name.split(':')[0]}: module (minified, before gzip) | KB | share |\n|---|---:|---:|\n` + inputs.map(([f, b]) => `| ${f} | ${kb(b)} | ${((100 * b) / total).toFixed(0)}% |`).join('\n');
  }
  console.log(modules);
}
mkdirSync(root + 'out', { recursive: true });
writeFileSync(root + 'out/size.md', table + modules + '\n');

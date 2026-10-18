// Bundle size per scenario: each is a small program that uses the library the way a page would, bundled through the barrel
// with Rolldown (minified, ESM, tree-shaken), then measured raw, gzip and brotli. Deltas are against the minimal chart, so
// a row says what its feature costs on top of a chart that already draws a line.
//   node tools/size.mjs            the table
//   node tools/size.mjs --modules  also the cost of each source module in the kitchen-sink bundle
//   node tools/size.mjs --check    fails if a scenario's gzip size is more than the tolerance over tools/size-baseline.json
//   node tools/size.mjs --update   writes the baseline from the current sizes (a reviewable diff: do it on purpose, say why in the commit)
import { bundle as build } from './bundle.ts';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = (p) => root + 'src/' + p;

const BASE = [
  'Chart',
  'CartesianPlane',
  'Axis',
  'LinearScale',
  'DomainSeries',
  'LinePath',
  'LinearCurve',
  'FlatDataSource',
  'lightTheme',
  'toSvgString',
];
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
  {
    name: 'Entrance animation (with the DOM platform)',
    imports: ['Entrance', 'DOMPlatform'],
    chartKids: ['new Entrance({})'],
    out: 'return chart.attach(new DOMPlatform(el));',
  },
  { name: 'Line annotation', imports: ['LineAnnotation'], planeKids: ['new LineAnnotation({ value: 1 })'] },
  { name: 'Callout annotation', imports: ['CalloutAnnotation'], planeKids: [`new CalloutAnnotation({ domain: 1, value: 1, text: 't' })`] },
  {
    name: 'Point annotations',
    imports: ['PointAnnotations'],
    planeKids: [`new PointAnnotations({ text: (hit) => String(hit.second) })`],
  },
  { name: 'Circle markers', imports: ['CircleMarker'], renderers: ['new CircleMarker({})'] },
  { name: 'Area path', imports: ['AreaPath'], renderers: ['new AreaPath({}, new LinearCurve())'] },
  { name: 'Stepped line (StepCurve)', imports: ['StepCurve'], series: `new DomainSeries(${FLAT}, new LinePath({}, new StepCurve({})))` },
  {
    name: 'Stepped area (StepCurve)',
    imports: ['StepCurve', 'AreaPath'],
    series: `new DomainSeries(${FLAT}, new AreaPath({}, new StepCurve({})))`,
  },
  { name: 'Monotone curve', imports: ['MonotoneCurve'], series: `new DomainSeries(${FLAT}, new LinePath({}, new MonotoneCurve()))` },
  { name: 'Arc curve', imports: ['ArcCurve'], series: `new DomainSeries(${FLAT}, new LinePath({}, new ArcCurve({})))` },
  {
    name: 'Every curve',
    imports: [
      'MonotoneCurve',
      'NaturalCurve',
      'CardinalCurve',
      'CatmullRomCurve',
      'BasisCurve',
      'BumpCurve',
      'QuadraticCurve',
      'ArcCurve',
      'StepCurve',
    ],
    series: `new DomainSeries(${FLAT}, new LinePath({}, new MonotoneCurve()), ...[new NaturalCurve(), new CardinalCurve(), new CatmullRomCurve(), new BasisCurve(), new BumpCurve(), new QuadraticCurve(), new ArcCurve(), new StepCurve()].map((c) => new LinePath({}, c)))`,
  },
  { name: 'Bars (replaces LinePath)', imports: ['BarPath'], series: `new DomainSeries(${FLAT}, new BarPath({}))` },
  { name: 'Bars as lines (StemPath)', imports: ['StemPath'], series: `new DomainSeries(${FLAT}, new StemPath({}))` },
  {
    name: 'toJSON + fromJSON, registry of only the classes used',
    imports: ['toJSON', 'fromJSON'],
    setup: 'const reg = { Chart, CartesianPlane, Axis, LinearScale, DomainSeries, LinePath, LinearCurve, FlatDataSource };',
    out: 'return toSvgString(fromJSON(JSON.parse(JSON.stringify(toJSON(chart, reg))), reg));',
  },
  {
    name: 'toJSON + fromJSON + applyJSON with the full registry',
    imports: ['toJSON', 'fromJSON', 'applyJSON', 'registry', 'Refs'],
    out: 'const refs = new Refs({}, { auto: true }); applyJSON(chart, toJSON(chart, registry, { refs }), registry, { refs }); return toSvgString(fromJSON(toJSON(chart, registry, { refs }), registry, { refs }));',
  },
  {
    name: 'Stack of two area series',
    imports: ['Stack', 'AreaPath'],
    series: `new Stack({}, new DomainSeries(${FLAT}, new AreaPath({}, new LinearCurve())), new DomainSeries(${FLAT}, new AreaPath({}, new LinearCurve())))`,
  },
  {
    name: 'Stack of two bar series',
    imports: ['Stack', 'BarPath'],
    series: `new Stack({}, new DomainSeries(${FLAT}, new BarPath({})), new DomainSeries(${FLAT}, new BarPath({})))`,
  },
  { name: 'Decimator (min/max kernel)', imports: ['Decimator', 'MinMaxKernel'], data: `new Decimator({}, new MinMaxKernel(), ${FLAT})` },
  { name: 'Objects as data', imports: ['ObjectDataSource'], data: ROWS },
  { name: 'Log scale on x', imports: ['LogScale'], xScale: 'new LogScale()' },
  { name: 'Time axis, Date + Intl (replaces linear x)', imports: ['IntlTimeScale'], xScale: `new IntlTimeScale({ timeZone: 'UTC' })` },
  { name: 'Time axis, Temporal (replaces linear x)', imports: ['TemporalTimeScale'], xScale: `new TemporalTimeScale({ timeZone: 'UTC' })` },
  { name: 'Band scale on x', imports: ['BandScale'], xScale: `new BandScale({ categories: ['a'] })` },
  { name: 'Polar plane (instead of Cartesian)', imports: ['PolarPlane'], plane: 'PolarPlane', axes: ['angle', 'radius'] },
  { name: 'Radar plane (instead of Cartesian)', imports: ['RadarPlane'], plane: 'RadarPlane', axes: ['angle', 'radius'] },
  {
    name: 'Colour axis, colour key, circle markers',
    imports: ['ObjectDataSource', 'ColorAxis', 'ColorKey', 'CircleMarker'],
    data: ROWS,
    setup: 'const c = new ColorAxis({}, new LinearScale());',
    renderers: [`new CircleMarker({ bind: { fill: { axis: c, channel: 'v' } } })`],
    chartKids: ['c', 'new ColorKey({ dimension: c })'],
  },
  {
    name: 'The `pieChart` shortcut (a doughnut with labels; replaces the whole chart)',
    imports: ['pieChart'],
    out: `return toSvgString(pieChart([{ name: 'a', value: 1 }, { name: 'b', value: 2 }], { theme: lightTheme, label: (s) => s.name }));`,
  },
  {
    name: 'The `lineChart` shortcut (replaces the whole chart)',
    imports: ['lineChart'],
    out: `return toSvgString(lineChart(${FLAT}, { theme: lightTheme }));`,
  },
  {
    name: 'The `barChart` shortcut (replaces the whole chart)',
    imports: ['barChart'],
    out: `return toSvgString(barChart(${FLAT}, { theme: lightTheme, categories: ['a'] }));`,
  },
  {
    name: 'Kitchen sink: every feature above in one chart',
    imports: [
      'DOMPlatform',
      'PanZoom',
      'PointerListener',
      'ChartTitle',
      'Cursor',
      'ChartTooltip',
      'Crosshair',
      'LineAnnotation',
      'CalloutAnnotation',
      'CircleMarker',
      'Decimator',
      'MinMaxKernel',
      'ObjectDataSource',
      'ColorAxis',
      'ColorKey',
      'darkTheme',
      'LogScale',
      'BandScale',
      'Stack',
      'BarPath',
    ],
    data: `new Decimator({}, new MinMaxKernel(), ${ROWS})`,
    setup:
      'const c = new ColorAxis({}, new LinearScale()); const l = new LogScale(), b = new BandScale({ categories: [] }); globalThis.s = [l, b, darkTheme, Stack, BarPath];',
    renderers: [`new CircleMarker({ bind: { fill: { axis: c, channel: 'v' } } })`],
    planeKids: [
      'new PanZoom({})',
      'new PointerListener({ onClick() {} })',
      'new LineAnnotation({ value: 1 })',
      `new CalloutAnnotation({ domain: 1, value: 1, text: 't' })`,
    ],
    chartKids: [
      `new ChartTitle({ text: 't' })`,
      'new Cursor({ mode: "shared" }, new Crosshair({}), new ChartTooltip({}))',
      'c',
      'new ColorKey({ dimension: c })',
    ],
    out: 'return chart.attach(new DOMPlatform(el));',
  },
  {
    name: 'The minimal chart written as JSX (runtime + attribute expansion)',
    jsx: true,
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
    name: 'The minimal chart as React components, built-ins (react itself not counted)',
    jsx: true,
    external: ['react', 'react-dom/client', 'react/jsx-runtime'],
    reactJsx: true,
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
  {
    name: 'A worker bundle: serveWorker with FlatDataSource, Decimator, MinMaxKernel (no chart)',
    source: `import { FlatDataSource, Decimator, MinMaxKernel } from 'inkplot';
import { serveWorker } from 'inkplot/worker';
serveWorker({ FlatDataSource, Decimator, MinMaxKernel });`,
  },
  {
    name: 'WorkerBoundary and WebWorker on top of the minimal chart',
    imports: ['WorkerBoundary', 'WebWorker', 'Decimator', 'MinMaxKernel'],
    data: `new WorkerBoundary({ worker: new WebWorker('w.js'), registry: { FlatDataSource, Decimator, MinMaxKernel } }, new Decimator({}, new MinMaxKernel(), ${FLAT}))`,
  },
  { name: 'Everything the barrel exports (`import * as L`)', whole: true },
];

async function bundle(s) {
  const contents = s.whole ? `import * as L from 'inkplot'; globalThis.L = L;` : (s.source ?? program(s));
  const r = await build({
    contents,
    resolveDir: root,
    type: s.jsx ? 'jsx' : 'js',
    minify: true,
    format: 'esm',
    // As an app ships: the error messages are left out (src/fail.ts).
    define: { 'process.env.NODE_ENV': '"production"' },
    ...(s.jsx ? { jsx: s.reactJsx ? 'react' : 'inkplot' } : {}),
    ...(s.external ? { external: s.external } : {}),
    alias: {
      inkplot: src('index.ts'),
      'inkplot/jsx-runtime': src('jsx-runtime.ts'),
      'inkplot/react': src('react.ts'),
      'inkplot/web-components': src('web-components.ts'),
      'inkplot/worker': src('worker.ts'),
    },
  });
  const code = Buffer.from(r.code);
  return { raw: code.length, gzip: gzipSync(code, { level: 9 }).length, brotli: brotliCompressSync(code).length, meta: r.modules };
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
const table =
  head +
  rows
    .map(
      ({ s, m }, i) =>
        `| ${s.name} | ${kb(m.raw)} | ${kb(m.gzip)} | ${kb(m.brotli)} | ${i === 0 ? '' : s.whole ? '' : sign(m.gzip - base.gzip)} |`,
    )
    .join('\n');
console.log(table);

let modules = '';
if (process.argv.includes('--modules')) {
  for (const prefix of ['Minimal', 'Kitchen']) {
    const sc = SCENARIOS.find((s) => s.name.startsWith(prefix));
    const m = await bundle(sc);
    const inputs = Object.entries(m.meta)
      .filter(([f]) => f.includes('/src/'))
      .map(([f, bytes]) => [f.replace(/^.*src\//, ''), bytes])
      .filter(([, b]) => b > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = inputs.reduce((a, [, b]) => a + b, 0);
    modules +=
      `\n\n| ${sc.name.split(':')[0]}: module (minified, before gzip) | KB | share |\n|---|---:|---:|\n` +
      inputs.map(([f, b]) => `| ${f} | ${kb(b)} | ${((100 * b) / total).toFixed(0)}% |`).join('\n');
  }
  console.log(modules);
}
mkdirSync(root + 'out', { recursive: true });
writeFileSync(root + 'out/size.md', table + modules + '\n');

// The gate. The baseline holds each scenario's gzip size; growth past the tolerance (a share, plus a few bytes for the compressor
// differing between versions) fails, so a feature that makes every chart bigger shows up as a failing check and a diff to the baseline.
const baselineFile = root + 'tools/size-baseline.json';
const TOLERANCE = 0.02,
  SLACK = 100;
if (process.argv.includes('--update')) {
  const sizes = Object.fromEntries(rows.map(({ s, m }) => [s.name, m.gzip]));
  writeFileSync(baselineFile, JSON.stringify({ tolerance: TOLERANCE, slackBytes: SLACK, gzip: sizes }, null, 2) + '\n');
  console.log(`wrote ${baselineFile}`);
}
if (process.argv.includes('--check')) {
  if (!existsSync(baselineFile)) {
    console.error('no tools/size-baseline.json: run `node tools/size.mjs --update`');
    process.exit(1);
  }
  const { tolerance, slackBytes, gzip } = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const failures = [];
  for (const { s, m } of rows) {
    const was = gzip[s.name];
    if (was === undefined) failures.push(`"${s.name}" is not in the baseline: run \`node tools/size.mjs --update\``);
    else if (m.gzip > was * (1 + tolerance) + slackBytes)
      failures.push(
        `"${s.name}" grew from ${kb(was)} to ${kb(m.gzip)} KB gzip (${sign(m.gzip - was)}): if that is meant, \`node tools/size.mjs --update\` and say why in the commit`,
      );
  }
  for (const name of Object.keys(gzip))
    if (!rows.some(({ s }) => s.name === name)) failures.push(`"${name}" is in the baseline but is no longer a scenario: --update`);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(`sizes are within ${tolerance * 100}% (+${slackBytes} B) of tools/size-baseline.json`);
}

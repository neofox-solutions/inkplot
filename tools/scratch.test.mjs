// inkplot-scratch, run as a person's agent would: packed, installed beside inkplot in a fresh workspace, and pointed at source files.
//   node tools/scratch.test.mjs
// Checks the loop (type errors print as tsc prints them, runtime and shape errors name the problem), the outputs (SVG, PNG when
// @resvg/resvg-wasm is installed, JSON, HTML) and that the HTML page runs and holds every figure.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { convertCode } from './jsx-to-new.mjs';
import { test } from 'vite-plus/test';

test("scratch", async () => {
const root = fileURLToPath(new URL('../', import.meta.url));
const tgz = execFileSync(process.execPath, [join(root, 'tools/pack-scratch.mjs'), join(tmpdir(), `inkplot-scratch-pack-${process.pid}`)], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const inkplotTgz = readdirSync(join(tgz, '../../inkplot-lib/inkplot')).filter((f) => f.endsWith('.tgz')).map((f) => join(tgz, '../../inkplot-lib/inkplot', f))[0];

const ws = mkdtempSync(join(tmpdir(), 'inkplot-scratch-ws-'));
const nm = join(ws, 'node_modules');
mkdirSync(join(nm, '.bin'), { recursive: true });
for (const [name, file] of [['inkplot', inkplotTgz], ['inkplot-scratch', tgz]]) {
  mkdirSync(join(nm, name));
  execFileSync('tar', ['-xzf', file, '-C', join(nm, name), '--strip-components=1']);
}
// What npm would fetch beside them: linked from this repository's own install.
const png = existsSync(join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm'));
for (const dep of ['typescript', 'esbuild', '@esbuild', ...(png ? ['@resvg'] : [])]) symlinkSync(join(root, 'node_modules', dep), join(nm, dep));

const run = (args) => spawnSync(process.execPath, [join(nm, 'inkplot-scratch/bin.mjs'), ...args], { cwd: ws, encoding: 'utf8' });
const write = (name, text) => writeFileSync(join(ws, name), text);

write('data.json', JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ v: 50 + 12 * Math.sin(i * 12.9898), g: i % 3, t: i / 10 }))));
const good = `
import { Axis, BandScale, BarPath, BoxPath, BoxStats, CartesianPlane, Chart, Density, DomainSeries, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';
import rows from './data.json';

const histogram = () => (
  <Chart theme={lightTheme} meta={{ title: 'Magnitude histogram' }}>
    <CartesianPlane>
      <Axis orientation="bottom" title="Magnitude" min={0}><LinearScale /></Axis>
      <Axis orientation="left" title="Count" include={[0]}><LinearScale /></Axis>
      <DomainSeries name="Count">
        <Density width={0.5}><ObjectDataSource source={rows} domain="v" value="v" /></Density>
        <BarPath width={0.95} />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
const box = () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['A', 'B', 'C']} /></Axis>
      <Axis orientation="left" title="Magnitude"><LinearScale /></Axis>
      <DomainSeries name="Spread">
        <BoxStats><ObjectDataSource source={rows} domain="g" value="v" /></BoxStats>
        <BoxPath />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
export default [histogram(), { name: 'Box by group', caption: 'Quartiles per group', chart: box() }];
`;
write('good.tsx', good);

// 1. The checks a run prints: figures, series, real axis ranges.
let r = run(['good.tsx', '--check']);
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /01-magnitude-histogram {2}"Magnitude histogram" {2}640x400/);
assert.match(r.stdout, /02-box-by-group/);
assert.match(r.stdout, /bottom axis "Magnitude": range 0 to /, 'the fixed minimum shows as the range start');
assert.match(r.stdout, /left axis "Count": range 0 to /);
assert.equal(r.stderr, '', 'no warnings for a good chart');

// 2. Outputs.
r = run(['good.tsx', '--svg', 'out', '--json', 'out/facts.json', '--html', 'out/app.html', ...(png ? ['--png', 'out'] : []), '--width', '800', '--height', '500']);
assert.equal(r.status, 0, r.stderr);
const files = readdirSync(join(ws, 'out')).sort();
assert.deepEqual(files.filter((f) => f.endsWith('.svg')), ['01-magnitude-histogram.svg', '02-box-by-group.svg']);
const svg = readFileSync(join(ws, 'out/01-magnitude-histogram.svg'), 'utf8');
assert(svg.startsWith('<svg') && svg.includes('width="800"') && !/NaN/.test(svg), 'an SVG at the size asked');
const facts = JSON.parse(readFileSync(join(ws, 'out/facts.json'), 'utf8'));
assert.equal(facts.length, 2);
assert.equal(facts[1].caption, 'Quartiles per group');
assert(facts[0].series[0].points > 5 && facts[0].axes[0].min === 0 && facts[0].axes[0].orientation === 'bottom', JSON.stringify(facts[0]));
if (png) {
  const bytes = readFileSync(join(ws, 'out/01-magnitude-histogram.png'));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1600, 'a PNG at 2x the width');
  assert(bytes.length > 5000, 'ink on it');
}
const html = readFileSync(join(ws, 'out/app.html'), 'utf8');
assert(html.length < 400_000, `a self-contained page stays small (${html.length} bytes)`);
assert.equal((html.match(/<\/script>/g) ?? []).length, 1, 'the data and code cannot close the script tag early');
assert(!/<script[^>]+src=|<link[^>]+href=/i.test(html), 'nothing is fetched');

// 3. The page runs and holds both figures, with their controls.
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'file:///app.html', beforeParse(window) { window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; } });
const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.message));
await new Promise((resolve) => setTimeout(resolve, 100));
const doc = dom.window.document;
assert.deepEqual(errors, []);
assert.deepEqual([...doc.querySelectorAll('section.figure h2')].map((h) => h.textContent), ['Magnitude histogram', 'Box by group']);
assert.equal(doc.querySelectorAll('section.figure svg').length >= 2, true, 'each chart is drawn on the page');
assert.deepEqual([...doc.querySelectorAll('section.figure:first-of-type button')].map((b) => b.textContent), ['Copy SVG', 'Copy PNG', 'SVG ↓', 'PNG ↓', 'Reset view', 'Stats']);
assert.equal(doc.title, 'good');
assert.deepEqual([...doc.querySelectorAll('section.figure')].map((e) => e.dataset.interactive), ['boxzoom panzoom cursor', 'boxzoom panzoom cursor'], 'the standard interactions are added');
assert(/Shift-drag/.test(doc.querySelector('.hint')?.textContent ?? ''), 'a hint says how');
dom.window.close();

// 3b. Interactions: only what is missing is added, a figure can opt out, a polar plane gets no zoom box, and --static adds nothing.
write('inter.tsx', good.replace("import { Axis,", "import { PanZoom, PolarPlane, XYSeries, CircleMarker, Axis,").replace(/export default .*/, `
const own = histogram();
[...own][0].append(new PanZoom());
const ring = () => (<Chart theme={lightTheme} width={420} height={420}><PolarPlane><Axis orientation="angle" min={0} max={360}><LinearScale /></Axis><Axis orientation="radius" min={0}><LinearScale /></Axis><XYSeries name="p" x="angle"><ObjectDataSource source={rows} value="v" channels={{ angle: 't' }} /><CircleMarker size={3} /></XYSeries></PolarPlane></Chart>);
export default [own, { name: 'Plain', interactive: false, chart: box() }, { name: 'Ring', chart: ring() }];`));
r = run(['inter.tsx', '--html', 'out/inter.html']);
assert.equal(r.status, 0, r.stderr);
let sizes = [];
const page = (file) => {
  const d = new JSDOM(readFileSync(join(ws, file), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'file:///x.html', beforeParse(w) { w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; } });
  const got = [...d.window.document.querySelectorAll('section.figure')].map((e) => e.dataset.interactive);
  sizes = [...d.window.document.querySelectorAll('.plot')].map((e) => e.style.width || '');
  d.window.close();
  return got;
};
await new Promise((resolve) => setTimeout(resolve, 50));
const got = page('out/inter.html');
assert.deepEqual(sizes, ['', '', '420px'], 'a chart with its own size gets a box of exactly that size');
assert.deepEqual(got, ['boxzoom cursor', '', 'panzoom cursor'], 'own PanZoom kept, opt-out honoured, a polar plane gets pan/zoom and a cursor but no zoom box');
r = run(['good.tsx', '--html', 'out/static.html', '--static']);
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(page('out/static.html'), ['', ''], '--static adds nothing');

// 4. Type errors come out as tsc prints them, one fix per line.
write('typo.tsx', good.replace('include={[0]}', 'include={[0]} titel="x"').replace("orientation=\"left\" title=\"Count\"", "orientation=\"left\" title={3}"));
r = run(['typo.tsx', '--svg', 'out2']);
assert.equal(r.status, 1);
assert.match(r.stderr, /^typo\.tsx\(\d+,\d+\): error TS\d+: /m, r.stderr);
assert(!existsSync(join(ws, 'out2')), 'nothing is written when the source does not type-check');

// 5. A runtime error names the line in the person's file; a wrong default export says what it should be.
write('boom.ts', `import data from './data.json';\nconst first = (data as any)[999].v;\nexport default [first];\n`);
r = run(['boom.ts']);
assert.equal(r.status, 1);
assert.match(r.stderr, /error: Cannot read properties of undefined/);
assert.match(r.stderr, /boom\.ts:2/, 'the frame is the .ts line, not the bundle');
write('nodefault.ts', `export const chart = 1;\n`);
r = run(['nodefault.ts']);
assert.equal(r.status, 1);
assert.match(r.stderr, /no default export.*export default \[chart1, chart2\]/);
write('notchart.ts', `export default ['a title'];\n`);
r = run(['notchart.ts']);
assert.equal(r.status, 1);
assert.match(r.stderr, /item 1 is string a title, not a Chart/);
write('twice.tsx', good.replace(/export default .*/, `const c = histogram();\nexport default [c, c];`));
r = run(['twice.tsx']);
assert.equal(r.status, 1);
assert.match(r.stderr, /item 2 is the same chart object as item 1/);

// 6. A problem in the picture is a warning, not a crash.
write('empty.tsx', `import { Axis, BarPath, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinearScale, lightTheme } from 'inkplot';\n` +
  `export default [<Chart theme={lightTheme}><CartesianPlane><Axis orientation="bottom"><LinearScale /></Axis><Axis orientation="left"><LinearScale /></Axis><DomainSeries name="Nothing"><FlatDataSource data={[]} /><BarPath /></DomainSeries></CartesianPlane></Chart>];\n`);
r = run(['empty.tsx', '--check']);
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout + r.stderr, /WARNING Nothing has no points|warning: 01-figure: Nothing has no points/);

// 6b. A series with data and no renderer draws nothing, and says so; the wrong order of children names the classes (the library is not minified).
write('bare.tsx', `import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinearScale, lightTheme } from 'inkplot';\n` +
  `export default [<Chart theme={lightTheme}><CartesianPlane><Axis orientation="bottom"><LinearScale /></Axis><Axis orientation="left"><LinearScale /></Axis><DomainSeries name="Bare"><FlatDataSource data={[1, 2, 3]} /></DomainSeries></CartesianPlane></Chart>];\n`);
r = run(['bare.tsx', '--check']);
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /WARNING Bare has no renderer/);
write('order.tsx', good.replace('<Density width={0.5}><ObjectDataSource source={rows} domain="v" value="v" /></Density>\n        <BarPath width={0.95} />', '<BarPath width={0.95} />\n        <Density width={0.5}><ObjectDataSource source={rows} domain="v" value="v" /></Density>'));
r = run(['order.tsx', '--html', 'out/order.html', '--check']);
assert.equal(r.status, 1);
assert.match(r.stderr, /child 0 should be .*, but is BarPath/, r.stderr);

// 6c. The same charts in plain TypeScript (what the skill teaches): same figures, and the wrong child order is a type error, not a runtime one.
write('good.ts', await convertCode(good));
r = run(['good.ts', '--check']);
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /02-box-by-group/);
write('order.ts', await convertCode(good.replace('<Density width={0.5}><ObjectDataSource source={rows} domain="v" value="v" /></Density>\n        <BarPath width={0.95} />', '<BarPath width={0.95} />\n        <Density width={0.5}><ObjectDataSource source={rows} domain="v" value="v" /></Density>')));
r = run(['order.ts', '--svg', 'out3']);
assert.equal(r.status, 1);
assert.match(r.stderr, /^order\.ts\(\d+,\d+\): error TS\d+: /m, r.stderr);
assert(!existsSync(join(ws, 'out3')), 'nothing is written');

// 7. What the skill tells an agent is true of what shipped: every flag it names exists, and the files it points to are in the package.
const skill = readFileSync(join(nm, 'inkplot-scratch/skill/SKILL.md'), 'utf8'), help = run(['--help']).stdout;
for (const flag of new Set(skill.match(/--[a-z][a-z-]+/g))) assert(help.includes(flag), `SKILL.md mentions ${flag}, which --help does not list`);
for (const f of ['skill/inkplot/SKILL.md', 'skill/inkplot/topics/statistics.md', 'skill/inkplot/reference/exports.md', 'fonts/Inter-Regular.otf', 'fonts/LICENSE.txt']) assert(existsSync(join(nm, 'inkplot-scratch', f)), `the package holds ${f}`);

// 8. Usage mistakes exit 2.
assert.equal(run([]).status, 2);
assert.equal(run(['good.tsx', '--nope']).status, 2);
assert.equal(run(['missing.ts']).status, 2);
});

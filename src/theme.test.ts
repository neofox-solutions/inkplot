// Themes: the order in which a look is decided, the palette, and that new selectors can be added.
import { LinearCurve } from './curve.ts';
import assert from 'node:assert/strict';
import { Axis, CartesianPlane, Chart, ChartElement, CircleMarker, DomainSeries, FlatDataSource, LinePath, LinearScale, StringPlatform, darkTheme, extendTheme, lightTheme, resolveStyle } from './index.ts';
import type { BaseAttributes } from './index.ts';

// ── resolveStyle on its own, with no chart: a property comes from the first place that names it.
{
  const chain = ['tickLabel', 'axis', 'text'] as const;
  const base = lightTheme;
  const plain = resolveStyle(chain, [], base);
  assert.equal(plain.size, 11, 'root');
  assert.equal(plain.color, '#444');
  assert.equal(resolveStyle(['axisTitle', 'axis', 'text'], [], base).size, 12, 'a specific selector in the base theme beats the root');

  // Within one block, the more specific selector wins.
  assert.equal(resolveStyle(chain, [{ text: { color: 'red' }, tickLabel: { color: 'blue' } }], base).color, 'blue');
  // Between blocks, the nearer wins, even over a more specific selector farther out.
  assert.equal(resolveStyle(chain, [{ text: { color: 'red' } }], extendTheme(base, { tickLabel: { color: 'blue' } })).color, 'red', 'nearer beats the base theme');
  assert.equal(resolveStyle(chain, [{ text: { color: 'red' } }, { tickLabel: { color: 'blue' } }], base).color, 'red', 'nearer block beats a farther, more specific one');
  // Properties are decided one at a time.
  const mixed = resolveStyle(chain, [{ axis: { color: 'green' } }, { tickLabel: { size: 20 } }], base);
  assert.deepEqual([mixed.color, mixed.size], ['green', 20]);
  // Local values beat every block; undefined local values are ignored.
  assert.equal(resolveStyle(chain, [{ tickLabel: { color: 'blue' } }], base, { color: 'pink', size: undefined }).color, 'pink');
  assert.equal(resolveStyle(chain, [], base, { size: undefined }).size, 11);
  // The accent is a default that anything named beats, and that the root does not.
  assert.equal(resolveStyle(['seriesLine', 'line'], [], base, undefined, { color: 'teal' }).color, 'teal');
  assert.equal(resolveStyle(['seriesLine', 'line'], [{ line: { color: 'red' } }], base, undefined, { color: 'teal' }).color, 'red');
  assert.equal(resolveStyle(['seriesLine', 'line'], [], extendTheme(base, { seriesLine: { color: 'navy' } }), undefined, { color: 'teal' }).color, 'navy');
  // The base theme is not modified by extending it.
  extendTheme(base, { text: { size: 99 } });
  assert.equal(base.text.size, 11);
  assert.equal(extendTheme(base, { text: { size: 99 } }).text.color, '#444', 'a patch keeps the other properties of its selector');
}

// ── In a chart.
const data = (o = 0) => new FlatDataSource({ data: new Float64Array([1 + o, 3 + o, 2 + o]), regularDomain: { start: 0, step: 1 } });
function render(chartAttrs: object, planeAttrs: object, ...series: DomainSeries[]) {
  const plane = new CartesianPlane(planeAttrs, new Axis({ orientation: 'bottom' }, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()), ...series);
  const chart = new Chart({ theme: lightTheme, width: 300, height: 200, ...chartAttrs }, plane);
  const platform = new StringPlatform({ width: 300, height: 200 });
  chart.attach(platform).flush();
  return { svg: platform.toString(), chart, plane };
}

// The palette: a colour per series in turn, round again, and an explicit colour beats it.
{
  const { svg } = render({}, {}, new DomainSeries(data(), new LinePath(new LinearCurve())), new DomainSeries(data(1), new LinePath(new LinearCurve())), new DomainSeries(data(2), new LinePath({ stroke: '#123456' }, new LinearCurve())));
  const strokes = [...svg.matchAll(/stroke="(#[0-9a-f]{6})" stroke-width="1.5"/g)].map((m) => m[1]);
  assert.deepEqual(strokes, [lightTheme.palette[0], lightTheme.palette[1], '#123456']);
  const small = render({ theme: extendTheme(lightTheme, { palette: ['#aaaaaa'] }) }, {}, new DomainSeries(data(), new LinePath(new LinearCurve())), new DomainSeries(data(1), new LinePath(new LinearCurve())));
  assert.equal([...small.svg.matchAll(/stroke="#aaaaaa" stroke-width="1.5"/g)].length, 2, 'wraps round');
  const dots = render({}, {}, new DomainSeries(data(), new LinePath(new LinearCurve())), new DomainSeries(data(), new CircleMarker()));
  assert(dots.svg.includes(`fill="${lightTheme.palette[1]}"`), 'a marker takes its series colour');
}

// A block on the plane restyles everything in it; one on the chart restyles the lot; a series' colour is still just a default.
{
  const gridColor = (svg: string) => /<path d="[^"]*" fill="none" stroke="([^"]+)" stroke-width="1" stroke-dasharray="none" opacity="1"\/>/.exec(svg)![1];
  assert.equal(gridColor(render({}, {}).svg), '#e6e6e6');
  assert.equal(gridColor(render({}, { style: { gridline: { color: 'orange' } } }).svg), 'orange', 'plane block');
  assert.equal(gridColor(render({ style: { line: { color: 'purple' } } }, {}).svg), 'purple', 'a general block on the chart beats the base theme\'s more specific gridline');
  assert.equal(gridColor(render({ style: { line: { color: 'purple' } } }, { style: { gridline: { color: 'pink' } } }).svg), 'pink', 'unless a nearer block names it');
  assert(render({}, { style: { gridline: { dash: '2 2' } } }).svg.includes('stroke-dasharray="2 2"'));
  assert(render({ style: { seriesLine: { dash: '4 2' } } }, {}, new DomainSeries(data(), new LinePath(new LinearCurve()))).svg.includes('stroke-dasharray="4 2"'));
}

// A dark theme changes the defaults and leaves layout alone; swapping it at run time repaints.
{
  const light = render({}, {}, new DomainSeries(data(), new LinePath(new LinearCurve())));
  const dark = render({ theme: darkTheme }, {}, new DomainSeries(data(), new LinePath(new LinearCurve())));
  assert(light.svg.includes('fill="#444"') && !light.svg.includes('#d4d4d4'));
  assert(dark.svg.includes('fill="#d4d4d4"') && dark.svg.includes(`stroke="${darkTheme.palette[0]}"`));
  light.chart.setAttribute('theme', darkTheme);
  light.chart.flush();
  const platform = light.chart.platform as StringPlatform;
  assert(platform.toString().includes('fill="#d4d4d4"'), 'setAttribute("theme") restyles a live chart');
}

// A new kind of element joins the system with its own selector (declared once, by augmentation).
class Box extends ChartElement<Chart, [], BaseAttributes> {
  look() { return this.styleFor(['boxLabel', 'text']); }
}
declare module './theme.ts' { interface Selectors { boxLabel: TextProps } }
declare module './chart.ts' { interface ChartChildMap { box: Box } }
{
  const box = new Box();
  const { chart } = render({ theme: extendTheme(lightTheme, { boxLabel: { size: 30 } }) }, {});
  chart.append(box);
  assert.equal(box.look().size, 30, 'its selector comes from the theme');
  assert.equal(box.look().color, '#444', 'and the rest from the root');
  chart.setAttribute('style', { text: { color: 'red' } });
  assert.equal(box.look().color, 'red', 'and a block above it applies as to anything else');
  assert.throws(() => new Box().look(), /not in a chart/);
}
console.log('ok theme');

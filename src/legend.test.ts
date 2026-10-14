import type { AnySeriesRenderer } from './renderer.ts';
// The legend and series samples: each renderer's own graphic, in its own look, overlaid; layout; toggling a series away.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart, CartesianPlane, Axis, LinearScale, DomainSeries, Stack, LinePath, AreaPath, BarPath, BarLinePath, CircleMarker, DotMarker, CrossMarker, FlatDataSource,
  Legend, ChartTooltip, Cursor, fromJSON, toJSON, registry, type Series,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';

const flat = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start: 0, step: 1 } });
const lin = () => new LinearScale();

function setup(legend: object | null = {}, size = { width: 600, height: 300 }) {
  const rate = new DomainSeries({ name: 'Rate' }, flat([1, 3, 2, 4]), new LinePath({ style: { seriesLine: { dash: '6 4' } } }, new LinearCurve()));
  const volume = new DomainSeries({ name: 'Volume' }, flat([5, 6, 4, 7]), new BarPath({ fill: '#cc3333', stroke: '#222', strokeWidth: 2 }));
  const band = new DomainSeries({ name: 'Band' }, flat([2, 2, 3, 3]), new AreaPath(new LinearCurve()), new LinePath(new LinearCurve()));
  const points = new DomainSeries({ name: 'Points' }, flat([3, 1, 4, 2]), new LinePath(new LinearCurve()), new CircleMarker({ size: 3 }));
  const unnamed = new DomainSeries({}, flat([1, 1, 1, 1]), new LinePath(new LinearCurve()));
  const x = new Axis({ orientation: 'bottom' }, lin()), y = new Axis({ orientation: 'left', min: 0 }, lin());
  const plane = new CartesianPlane({}, x, y, rate, volume, band, points, unnamed);
  const leg = legend ? new Legend(legend) : null;
  const chart = new Chart({ theme: lightTheme }, plane, ...(leg ? [leg] : []));
  const platform = new FakePlatform(size);
  chart.attach(platform).flush();
  const click = (px: number, py: number) => {
    const handled = platform.pointer!({ kind: 'down', x: px, y: py, buttons: 1, deltaY: 0, shift: false, ctrl: false });
    platform.pointer!({ kind: 'up', x: px, y: py, buttons: 0, deltaY: 0, shift: false, ctrl: false });
    chart.flush();
    return handled;
  };
  return { chart, platform, plane, leg: leg!, rate, volume, band, points, unnamed, x, y, click, svg: () => platform.toString() };
}
const words = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);

// ── The entries: every named series, in drawing order, each with its own sample.
{
  const t = setup();
  const svg = t.svg();
  assert.deepEqual(words(svg).filter((w) => ['Rate', 'Volume', 'Band', 'Points'].includes(w)), ['Rate', 'Volume', 'Band', 'Points'], 'names in drawing order, the unnamed one left out');
  assert.equal(t.leg.entries.length, 4);
  const legendPart = svg.slice(svg.lastIndexOf('<text', svg.indexOf('>Rate<')) - 1500);
  assert(svg.includes('stroke-dasharray="6 4"'), 'the dash of the line is in its sample');
  assert(/M0 \d+(\.\d+)?H24/.test(svg), 'a line sample is a short line across the box');
  assert(legendPart.includes('fill="#cc3333"') && legendPart.includes('stroke="#222"'), 'a bar is a box with its fill and its outline');
  assert(/M0 0H24V\d+(\.\d+)?H0Z/.test(svg), 'boxes fill the sample');
  // A series with a marker over a line: the marker is drawn after the line, in the same group.
  const pts = svg.slice(svg.lastIndexOf('<g', svg.indexOf('>Points<')), svg.indexOf('>Points<'));
  assert(pts.indexOf('H24') >= 0 && pts.indexOf('H24') < pts.lastIndexOf('<path'), 'the line, then the marker over it');
}

// ── Samples drawn for each kind of renderer, through Series.sample into a legend of one series.
{
  const only = (...renderers: AnySeriesRenderer[]) => {
    const s = new DomainSeries({ name: 'S' }, flat([1, 2, 3]), ...renderers);
    const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, lin()), new Axis({ orientation: 'left' }, lin()), s);
    const chart = new Chart({ theme: lightTheme }, plane, new Legend({}));
    const platform = new FakePlatform({ width: 400, height: 200 });
    chart.attach(platform).flush();
    const svg = platform.toString();
    return svg.slice(svg.indexOf('translate', svg.lastIndexOf('<g')) );
  };
  assert(only(new BarLinePath({ stroke: '#123456' })).includes('stroke="#123456"'), 'stems in the line look');
  assert((only(new DotMarker({ stroke: '#654321', size: 4 })).match(/stroke-width="8"/g) ?? []).length >= 1, 'a dot is as wide as it is on the plot');
  assert(only(new CrossMarker({ size: 3 })).includes('l6 6'), 'a cross');
  assert(only(new LinePath({ stroke: '#abcdef', strokeWidth: 3, opacity: 0.5 }, new LinearCurve())).includes('stroke-width="3"'));
}

// ── Layout: a strip beside the plot, or along the top; rows wrap when they must.
{
  const without = setup(null), right = setup({ side: 'right' }), top = setup({ side: 'top' }), narrow = setup({ side: 'bottom' }, { width: 160, height: 300 });
  const w = (t: { plane: CartesianPlane }) => t.plane.rect.width, h = (t: { plane: CartesianPlane }) => t.plane.rect.height;
  assert(w(right) < w(without) - 60, 'a legend on the right takes width');
  assert(h(top) < h(without) - 10 && Math.abs(w(top) - w(without)) < 1, 'one on the top takes height only');
  const wide = setup({ side: 'bottom' }, { width: 700, height: 300 });
  assert(narrow.plane.rect.height < wide.plane.rect.height - 10, 'a narrow chart wraps the legend onto more rows');
  const titled = setup({ title: 'Series' });
  assert(words(titled.svg()).includes('Series'));
  assert(w(titled) <= w(right), 'a title is room too');
  assert.equal(setup({ side: 'left' }).plane.rect.x > setup({ side: 'right' }).plane.rect.x, true, 'on the left, the plot is pushed right');
}

// ── Clicking an entry hides its series and dims the entry; clicking again brings it back.
{
  const t = setup();
  // The Volume bars are what sets the top of the value axis, 7.
  const top = () => t.y.range.max;
  assert(top() >= 7);
  const index = t.leg.entries.indexOf(t.volume);
  assert.equal(index, 1);
  const rect = t.plane.rect, centre = (s: Series) => { const e = t.leg.entryRect(s)!; return [e.x + e.width / 2, e.y + e.height / 2] as const; };
  assert.equal(t.click(...centre(t.volume)), true, 'the click is the legend\'s');
  assert.equal(t.volume.attrs.visible, false);
  assert(top() < 7, `the axis no longer reaches the bars: ${top()}`);
  const svg = t.svg();
  assert(svg.includes('>Volume<'), 'still listed');
  assert(svg.includes('opacity="0.4"'), 'dimmed');
  assert(svg.includes('aria-pressed="false"'));
  t.click(...centre(t.volume));
  assert.equal(t.volume.attrs.visible, true);
  assert(top() >= 7, 'and back');
  assert.equal(t.click(rect.x + 20, rect.y + 20), false, 'a click on the plot is not the legend\'s');
  const off = setup({ toggle: false });
  const e0 = off.leg.entryRect(off.rate)!;
  assert.equal(off.click(e0.x + 3, e0.y + 3), false);
  assert.equal(off.rate.attrs.visible, undefined);
  assert(!off.svg().includes('aria-pressed'));
}

// ── A hidden series takes no part: not drawn, not hit, not in a stack, and its colour stays its own.
{
  const a = new DomainSeries({ name: 'a' }, flat([1, 2, 3]), new AreaPath(new LinearCurve())), b = new DomainSeries({ name: 'b' }, flat([2, 2, 2]), new AreaPath(new LinearCurve())), c = new DomainSeries({ name: 'c', hit: { radius: 30 } }, flat([1, 1, 1]), new AreaPath(new LinearCurve()));
  const y = new Axis({ orientation: 'left' }, lin());
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, lin()), y, new Stack({}, a, b, c));
  const chart = new Chart({ theme: lightTheme, width: 400, height: 300 }, plane);
  const platform = new FakePlatform({ width: 400, height: 300 });
  chart.attach(platform).flush();
  const total = y.range.max, colourC = c.accentColor, before = c.points.data.slice(0, 4);
  b.setAttribute('visible', false);
  chart.flush();
  assert(y.range.max < total, `the stack closes up: ${y.range.max} against ${total}`);
  assert.equal(c.accentColor, colourC, 'the palette colour is by position among all, shown or not');
  assert(c.points.data[1] !== before[1], 'c now sits on a');
  assert.deepEqual(plane.series.map((s: Series) => s.attrs.name), ['a', 'c']);
  assert.deepEqual(plane.allSeries.map((s: Series) => s.attrs.name), ['a', 'b', 'c']);
  b.setAttribute('visible', true);
  chart.flush();
  assert.equal(y.range.max, total);
}

// ── The tooltip's sample is the series', and a line that moves to another series leaves nothing of the first.
{
  const t = setup({ side: 'right' });
  const tip = new Cursor({ mode: 'shared' }, new ChartTooltip({ swatch: true }));
  t.chart.append(tip);
  t.chart.flush();
  const r = t.plane.rect;
  platformMove(t, r.x + r.width * 0.5, r.y + r.height * 0.5);
  const svg = t.svg();
  assert(svg.includes('Rate'), 'the tooltip names the series');
  const dashes = svg.split('stroke-dasharray="6 4"').length - 1;
  assert(dashes >= 3, `the dashed line's look reaches the plot, the legend and the tooltip (${dashes})`);
}
function platformMove(t: { platform: FakePlatform; chart: Chart }, x: number, y: number) {
  t.platform.pointer!({ kind: 'move', x, y, buttons: 0, deltaY: 0, shift: false, ctrl: false });
  t.chart.flush();
}

// ── A renderer added or removed leaves the sample as the series is.
{
  const t = setup();
  const count = () => (t.svg().match(/<path/g) ?? []).length;
  const before = count();
  const extra = new CircleMarker({ size: 3 });
  t.rate.append(extra);
  t.chart.flush();
  assert(count() >= before + 2, 'a marker on the plot and one in the legend');
  t.rate.remove(extra);
  t.chart.flush();
  assert.equal(count(), before, 'and both gone');
}

// ── It goes through JSON like anything else, and an empty legend takes no room.
{
  const t = setup();
  const json = JSON.parse(JSON.stringify(toJSON(t.chart, registry)));
  assert(JSON.stringify(json).includes('"Legend"'));
  const back = fromJSON<Chart>(json, registry);
  const platform = new FakePlatform({ width: 600, height: 300 });
  back.attach(platform).flush();
  const same = (svg: string) => svg.replace(/clip\d+/g, 'clip');
  assert.equal(same(platform.toString()), same(t.svg()), 'the same picture');
  const bare = new Chart({ theme: lightTheme }, new CartesianPlane({}, new Axis({ orientation: 'bottom' }, lin()), new Axis({ orientation: 'left' }, lin()), new DomainSeries({}, flat([1, 2]), new LinePath(new LinearCurve()))), new Legend({}));
  const p2 = new FakePlatform({ width: 300, height: 200 });
  bare.attach(p2).flush();
  assert(!p2.toString().includes('role='), 'nothing named, nothing listed');
}
console.log('ok legend');

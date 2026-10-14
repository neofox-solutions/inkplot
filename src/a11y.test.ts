// Accessibility: ARIA from meta, the opt-in summary, buttons and focus in the legend, and keyboard control of pan and zoom.
import assert from 'node:assert/strict';
import { LinearCurve } from './curve.ts';
import { FakePlatform } from './fake-platform.ts';
import {
  Axis, CartesianPlane, Chart, type ChartFacts, ChartSummary, DomainSeries, FlatDataSource, LinePath, LinearScale, Legend, PanZoom, type PlatformNode, englishSummary, fromJSON, registry, toJSON,
} from './index.ts';
import { lightTheme } from './themes.ts';
import { test } from 'vite-plus/test';

test("a11y", () => {
const flat = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start: 0, step: 1 } });
type N = { tag: string; attrs: Map<string, string | number>; children: N[] };
const walk = (n: N, out: N[] = []): N[] => { out.push(n); for (const c of n.children) walk(c, out); return out; };
const nodes = (p: FakePlatform) => walk(p.root as unknown as N);
const withAttr = (p: FakePlatform, name: string, value?: string) => nodes(p).filter((n) => n.attrs.has(name) && (value === undefined || n.attrs.get(name) === value));
const asNode = (n: N) => n as unknown as PlatformNode;

function build(options: { bare?: boolean; chart?: object; plane?: object; pan?: object | null; legend?: object | null; summary?: boolean | object; names?: boolean } = {}) {
  const rate = new DomainSeries({ name: 'Rate', ...(options.names === false && { name: undefined }), ...(!options.bare && { meta: { title: 'Rate series' } }) }, flat([1, 3, 2, 4, 8, 5]), new LinePath(new LinearCurve()));
  const cost = new DomainSeries({ name: 'Cost' }, flat([2, 2, 3, 3, 1, 1]), new LinePath(new LinearCurve()));
  const x = new Axis({ orientation: 'bottom', title: 'Day' }, new LinearScale()), y = new Axis({ orientation: 'left', title: 'Value' }, new LinearScale());
  const pan = options.pan === null ? [] : [new PanZoom(options.pan ?? {})];
  const plane = new CartesianPlane(options.plane ?? {}, x, y, rate, cost, ...pan);
  const legend = options.legend === null || options.legend === undefined ? [] : [new Legend(options.legend)];
  const summary = options.summary ? [new ChartSummary(options.summary === true ? {} : options.summary)] : [];
  const chart = new Chart({ theme: lightTheme, ...options.chart }, plane, ...legend, ...summary);
  const platform = new FakePlatform({ width: 500, height: 300 });
  chart.attach(platform).flush();
  return { chart, platform, plane, rate, cost, x, y, pan: pan[0], legend: legend[0], svg: () => platform.toString() };
}

// ── Nothing said, nothing announced; the core has no words of its own.
{
  const t = build({ bare: true, pan: null });
  const svg = t.svg();
  assert(!svg.includes('aria-label') && !svg.includes('aria-description') && !svg.includes('roledescription'), 'a chart without meta says nothing');
  assert(!svg.includes('role='), 'and has no role to name');
  assert.equal(withAttr(t.platform, 'aria-hidden', 'true').length >= 2, true, 'the axes are out of the accessibility tree');
}

// ── meta becomes the name, the description and the role, on the chart, a plane and a series; `aria` sets the rest.
{
  const t = build({
    chart: { meta: { title: 'Rates', description: 'Rates over six days', aria: { roledescription: 'sparkline', 'aria-busy': false } } },
    plane: { meta: { title: 'Main plot' } },
  });
  const root = t.platform.root as unknown as N;
  assert.equal(root.attrs.get('role'), 'group');
  assert.equal(root.attrs.get('aria-label'), 'Rates');
  assert.equal(root.attrs.get('aria-description'), 'Rates over six days');
  assert.equal(root.attrs.get('aria-roledescription'), 'sparkline', 'the prefix is optional');
  assert.equal(root.attrs.get('aria-busy'), 'false');
  assert.equal(withAttr(t.platform, 'aria-label', 'Main plot').length, 2, 'a plane is named, and so is its pan-and-zoom target');
  assert(withAttr(t.platform, 'aria-label', 'Rate series').length === 1, 'and a series');
  t.chart.setAttribute('meta', { title: 'Renamed', role: 'img' });
  t.chart.flush();
  assert.equal(root.attrs.get('aria-label'), 'Renamed');
  assert.equal(root.attrs.get('role'), 'img', 'meta.role overrides');
}

// ── The summary is opt-in, English, replaced by meta.description, and can be worded in another language.
{
  const t = build({ summary: true, chart: { meta: { title: 'Rates' } } });
  const root = t.platform.root as unknown as N;
  assert.equal(root.attrs.get('aria-roledescription'), 'chart');
  const text = String(root.attrs.get('aria-description'));
  assert(text.startsWith('2 series: Rate, 6 points; Cost, 6 points.'), text);
  assert(text.includes('Horizontal axis Day, from 0 to 5.') && text.includes('Vertical axis Value, from 1 to 8.'), text);
  t.rate.setAttribute('visible', false);
  t.chart.flush();
  assert(String(root.attrs.get('aria-description')).includes('Rate, 6 points, hidden'), 'a hidden series is said to be');
  const own = build({ summary: true, chart: { meta: { description: 'Mine' } } });
  assert.equal((own.platform.root as unknown as N).attrs.get('aria-description'), 'Mine', 'meta.description wins');
  const french = build({ summary: { roleDescription: 'graphique', text: (f: ChartFacts) => `${f.series.length} séries` } });
  const r = french.platform.root as unknown as N;
  assert.equal(r.attrs.get('aria-description'), '2 séries');
  assert.equal(r.attrs.get('aria-roledescription'), 'graphique');
  assert.equal(englishSummary({ series: [{ name: 'a', points: 1, shown: true }], axes: [] }), '1 series: a, 1 point.');
  // It is an element like the others: JSON and back.
  const back = fromJSON<Chart>(JSON.parse(JSON.stringify(toJSON(t.chart, registry))), registry);
  const p2 = new FakePlatform({ width: 500, height: 300 });
  back.attach(p2).flush();
  assert.equal((p2.root as unknown as N).attrs.get('aria-description') !== undefined, true);
}

// ── Legend entries are buttons in the tab order.
{
  const t = build({ legend: { side: 'right' }, plane: {}, pan: null });
  const buttons = withAttr(t.platform, 'role', 'button');
  assert.equal(buttons.length, 2);
  assert(buttons.every((b) => b.attrs.get('tabindex') === 0), 'tab stops');
  assert(buttons.every((b) => b.attrs.get('aria-pressed') === 'true'));
  const [first, second] = buttons.map(asNode) as [PlatformNode, PlatformNode];
  const ring = () => withAttr(t.platform, 'stroke', '#0b57d0').filter((n) => n.attrs.get('fill') === 'none' && n.attrs.get('display') === 'inline');

  // Focus by keyboard shows the ring; by mouse it does not (as with the browser's own buttons).
  assert.equal(ring().length, 0);
  t.platform.focus(first, true);
  t.chart.flush();
  assert.equal(ring().length, 1, 'ring on keyboard focus');
  t.platform.focus(second, false);
  t.chart.flush();
  assert.equal(ring().length, 0, 'no ring after a click');
  t.platform.focus(first, true);
  t.chart.flush();

  // Enter acts on the way down, once; a held key does not flip it back and forth.
  assert.equal(t.platform.key('Enter', {}, false), true, 'the key is the legend\'s');
  assert.equal(t.rate.attrs.visible, false);
  t.platform.key('Enter', { repeat: true }, false);
  assert.equal(t.rate.attrs.visible, false, 'repeats are ignored');
  t.platform.keyHandler!({ kind: 'up', key: 'Enter', shift: false, ctrl: false, alt: false, repeat: false }, first);
  t.chart.flush();
  assert.equal(withAttr(t.platform, 'aria-pressed', 'false').length, 1);

  // Space acts on the way up and holds the page still on the way down.
  assert.equal(t.platform.key(' ', {}, false), true, 'Space down is taken (the page must not scroll)');
  assert.equal(t.rate.attrs.visible, false, 'but nothing happens yet');
  t.platform.keyHandler!({ kind: 'up', key: ' ', shift: false, ctrl: false, alt: false, repeat: false }, first);
  assert.equal(t.rate.attrs.visible, true);

  // Tab and the like are the browser's.
  assert.equal(t.platform.key('Tab'), false);
  assert.equal(t.platform.key('Enter', { ctrl: true }), false);

  // The pointer acts on release over the same entry: it can be abandoned by moving away.
  const e = t.legend!.entryRect(t.cost)!;
  const send = (kind: 'down' | 'up', x: number, y: number) => t.platform.pointer!({ kind, x, y, buttons: kind === 'down' ? 1 : 0, deltaY: 0, shift: false, ctrl: false });
  send('down', e.x + 3, e.y + 3);
  assert.equal(t.cost.attrs.visible, undefined, 'not yet');
  send('up', e.x + 3, e.y + 3);
  assert.equal(t.cost.attrs.visible, false);
  send('down', e.x + 3, e.y + 3);
  send('up', 5, 5);
  assert.equal(t.cost.attrs.visible, false, 'released elsewhere: abandoned');

  // A legend that does not toggle is not a button and not a tab stop.
  const plain = build({ legend: { toggle: false }, pan: null });
  assert.equal(withAttr(plain.platform, 'tabindex').length, 0);
}

// ── PanZoom: a tab stop with the application role, and keys that move the view.
{
  const t = build({ pan: {}, plane: { meta: { title: 'Plot of rates' } } });
  const stops = withAttr(t.platform, 'tabindex');
  assert.equal(stops.length, 1);
  const target = stops[0]!;
  assert.equal(target.attrs.get('role'), 'application');
  assert.equal(target.attrs.get('aria-label'), 'Plot of rates', 'named from the plane when it has no name of its own');
  assert(String(target.attrs.get('aria-keyshortcuts')).includes('ArrowLeft') && String(target.attrs.get('aria-keyshortcuts')).includes('Plus'));
  t.platform.focus(asNode(target), true);
  t.chart.flush();
  const span = (a: Axis) => a.range.max - a.range.min;

  // Nothing to move until zoomed.
  assert.equal(t.platform.key('ArrowRight'), true, 'handled, so the page does not scroll');
  assert(!t.x.isZoomed);
  t.platform.key('+');
  t.chart.flush();
  const full = 5;
  assert(Math.abs(span(t.x) - full / 1.25) < 1e-6, `one zoom step: ${span(t.x)}`);
  assert(Math.abs(t.x.range.min + span(t.x) / 2 - 2.5) < 1e-6, 'about the middle');
  const before = t.x.range.min;
  t.platform.key('ArrowRight');
  t.chart.flush();
  assert(Math.abs(t.x.range.min - (before + span(t.x) * 0.1)) < 1e-6, 'an arrow moves a tenth of the view');
  const at = t.x.range.min;
  t.platform.key('ArrowRight', { shift: true });
  t.chart.flush();
  assert(t.x.range.min > at + span(t.x) * 0.2 - 1e-6 || Math.abs(t.x.range.max - 5) < 1e-6, 'with Shift, a page (or the end of the data)');
  t.platform.key('ArrowLeft');
  t.platform.key('ArrowLeft');
  t.platform.key('ArrowLeft');
  t.platform.key('ArrowLeft');
  t.platform.key('ArrowLeft');
  t.platform.key('ArrowLeft');
  t.platform.key('ArrowLeft');
  t.platform.key('ArrowLeft');
  t.chart.flush();
  assert(Math.abs(t.x.range.min) < 1e-6, 'it stops at the start of the data');

  // Up goes towards higher values.
  t.platform.key('+'); t.platform.key('+');
  t.chart.flush();
  const yBefore = t.y.range.min;
  t.platform.key('ArrowUp');
  t.chart.flush();
  assert(t.y.range.min > yBefore, `up moves the view up: ${yBefore} → ${t.y.range.min}`);
  t.platform.key('-'); t.platform.key('-'); t.platform.key('-');
  t.chart.flush();
  t.platform.key('0');
  t.chart.flush();
  assert.equal(t.x.range.min, 0);
  assert(Math.abs(t.x.range.max - 5) < 1e-6, 'zoom out and reset return to the data');

  // Keys are changeable, one action at a time; others keep theirs.
  const own = build({ pan: { keys: { zoomIn: ['i'], zoomOut: [], reset: ['r'] }, keyZoom: 2 } });
  own.platform.focus(asNode(withAttr(own.platform, 'tabindex')[0]!), true);
  assert.equal(own.platform.key('+'), false, 'the old key is free');
  assert.equal(own.platform.key('i'), true);
  own.chart.flush();
  assert(Math.abs(own.x.range.max - own.x.range.min - 2.5) < 1e-6, 'keyZoom');
  assert.equal(own.platform.key('-'), false, 'an empty list turns an action off');
  assert.equal(own.platform.key('ArrowLeft'), true, 'untouched actions keep their keys');
  own.platform.key('r');
  own.chart.flush();
  assert(Math.abs(own.x.range.max - 5) < 1e-6);

  // Direction restricts which axes the arrows move.
  const horizontal = build({ pan: { direction: 'horizontal' } });
  horizontal.platform.focus(asNode(withAttr(horizontal.platform, 'tabindex')[0]!), true);
  horizontal.platform.key('+');
  horizontal.chart.flush();
  assert(horizontal.x.isZoomed && !horizontal.y.isZoomed, 'only the horizontal axis is moved');

  // keys: false is no keyboard control and no tab stop.
  const off = build({ pan: { keys: false } });
  assert.equal(withAttr(off.platform, 'tabindex').length, 0);
  assert.equal(off.platform.key('+'), false);

  // The ring: on keyboard focus only, and gone on blur.
  const ringed = build({ pan: {} });
  const node = asNode(withAttr(ringed.platform, 'tabindex')[0]!);
  const rings = () => withAttr(ringed.platform, 'stroke', '#0b57d0').filter((n) => n.attrs.get('display') === 'inline');
  ringed.platform.focus(node, false); ringed.chart.flush();
  assert.equal(rings().length, 0);
  ringed.platform.blur();
  ringed.platform.focus(node, true); ringed.chart.flush();
  assert.equal(rings().length, 1);
  ringed.platform.blur(); ringed.chart.flush();
  assert.equal(rings().length, 0);
}

// ── Detaching releases the key and focus subscriptions.
{
  const t = build();
  assert(t.platform.keyHandler && t.platform.focusHandler);
  t.chart.detach();
  assert.equal(t.platform.keyHandler, null);
  assert.equal(t.platform.focusHandler, null);
}
});

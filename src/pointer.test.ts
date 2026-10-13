// PointerListener (hover, click, drag, and sharing a plane with PanZoom), the chart's lazy hit service, and the tooltip.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart, CartesianPlane, ChartElement, EVENT_HOVER, hitTest, type BaseAttributes, Axis, LinearScale, DomainSeries, LinePath, ObjectDataSource, PanZoom, PointerListener, ChartTooltip, Cursor, Crosshair,
  type DragInfo, type PointerInfo, type RawPointer, type PointerListenerAttributes, type ChartTooltipAttributes, type Hit,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';
import { inputOf } from './input.ts';

/** The cursor with a tooltip (and, shared, a crosshair) that the older single-element options meant. */
type TipOptions = ChartTooltipAttributes & { mode?: 'snap' | 'follow' | 'shared'; interpolate?: boolean };
function cursorFor(o: TipOptions) {
  const { mode = 'snap', interpolate, ...tip } = o;
  return new Cursor(
    { mode: mode === 'shared' ? 'shared' : 'nearest', ...(interpolate && { interpolate }) },
    ...(mode === 'shared' ? [new Crosshair({ lines: 'first', dots: true })] : []),
    new ChartTooltip({ ...(mode === 'follow' && { follow: true }), ...tip }),
  );
}

function setup(listener: PointerListenerAttributes = {}, o: { pan?: boolean; tooltip?: TipOptions } = {}) {
  const rows = [{ x: 0, y: 2 }, { x: 5, y: 8 }, { x: 10, y: 4 }];
  const source = new ObjectDataSource({ source: rows, domain: 'x', value: 'y' });
  const series = new DomainSeries({ name: 'Rate', hit: { radius: 8 } }, source, new LinePath(new LinearCurve()));
  const x = new Axis({ orientation: 'bottom', min: 0, max: 10, title: 'Week' }, new LinearScale());
  const y = new Axis({ orientation: 'left', min: 0, max: 10 }, new LinearScale());
  const pl = new PointerListener(listener);
  const plane = new CartesianPlane({}, x, y, series, pl, ...(o.pan ? [new PanZoom({})] : []));
  const chart = o.tooltip ? new Chart({ theme: lightTheme }, plane, cursorFor(o.tooltip)) : new Chart({ theme: lightTheme }, plane);
  const platform = new FakePlatform({ width: 400, height: 300 });
  chart.attach(platform).flush();
  const send = (kind: RawPointer['kind'], px: number, py: number, extra: Partial<RawPointer> = {}) => {
    const r = plane.rect;
    const handled = platform.pointer!({ kind, x: r.x + px, y: r.y + py, buttons: 0, deltaY: 0, shift: false, ctrl: false, ...extra });
    chart.flush();
    return handled;
  };
  const at = (px: number, py: number) => [(px / 10) * plane.rect.width, (1 - py / 10) * plane.rect.height] as const;
  return { rows, source, series, plane, chart, platform, send, at, x, y };
}

// ── Hover reports changes of the hit, including leaving; the cursor says there is something there.
{
  const seen: (Hit | null)[] = [];
  const t = setup({ onHover: (i) => seen.push(i.hit) });
  t.send('move', ...t.at(5, 8));
  t.send('move', ...t.at(5, 8));
  assert.equal(seen.length, 1, 'a second move over the same point says nothing');
  assert.equal(seen[0]!.row, 1);
  assert.equal(t.platform.cursor, 'pointer');
  t.send('move', ...t.at(2, 1));
  assert.equal(seen.length, 2);
  assert.equal(seen[1], null);
  t.send('move', ...t.at(0, 2));
  t.send('leave', 0, 0);
  assert.equal(seen.length, 4, 'leaving the plane ends a hover');
  assert.equal(seen[3], null);
}

// ── Click: on a point, on empty plot, and not after a drag-sized movement. Data position is reported.
{
  const clicks: PointerInfo[] = [];
  const t = setup({ onClick: (i) => clicks.push(i) });
  t.send('down', ...t.at(5, 8), { buttons: 1 });
  t.send('up', ...t.at(5, 8));
  assert.equal(clicks[0]!.hit?.row, 1);
  t.send('down', ...t.at(2.5, 6), { buttons: 1 });
  t.send('up', ...t.at(2.5, 6));
  assert.equal(clicks[1]!.hit, null);
  near(clicks[1]!.first, 2.5);
  near(clicks[1]!.second, 6);
  t.send('down', ...t.at(2.5, 6), { buttons: 1 });
  t.send('move', ...t.at(4, 6), { buttons: 1 });
  t.send('up', ...t.at(4, 6));
  assert.equal(clicks.length, 2, 'a press that travelled is not a click');
}
function near(a: number, b: number, tol = 0.05) { assert(Math.abs(a - b) <= tol, `${a} is not ${b}`); }

// ── Drag: phases, grab offset (no jump), editing through the row, and the claim over PanZoom.
{
  const phases: string[] = [];
  let last: DragInfo | null = null;
  const t = setup({ onDrag: (i) => { phases.push(i.phase); last = i; } }, { pan: true });
  const [gx, gy] = t.at(5, 8);
  t.send('down', gx + 3, gy + 2, { buttons: 1 });   // a little off the point, within its radius
  assert.equal(t.send('move', gx + 3, gy + 2, { buttons: 1 }), false, 'under the threshold: nothing yet');
  const handled = t.send('move', ...t.at(6, 5), { buttons: 1 });
  assert.equal(handled, true);
  t.send('move', ...t.at(7, 5), { buttons: 1 });
  t.send('up', ...t.at(7, 5));
  assert.deepEqual(phases, ['start', 'move', 'end']);
  assert.equal(last!.hit.row, 1);
  // The pointer started 3px right and 2px low of the point, so the point lands that far from the pointer's own place.
  const r = t.plane.rect, dx = (3 / r.width) * 10, dy = (2 / r.height) * 10;
  near(last!.first, 7 - dx, 0.01);
  near(last!.second, 5 + dy, 0.01);
  // PanZoom did not pan while the point was being dragged.
  assert.equal(t.x.range.min, 0);
  assert.equal(t.x.range.max, 10);
  // A press on empty plot goes through to PanZoom.
  // (A pan is only possible once zoomed in: the view cannot leave the data.)
  const w = t.plane.rect.width, h = t.plane.rect.height;
  t.send('wheel', w / 2, h / 2, { deltaY: -600 });
  const before = t.x.range.min;
  t.send('down', w * 0.5, h * 0.97, { buttons: 1 });
  t.send('move', w * 0.4, h * 0.97, { buttons: 1 });
  t.send('up', w * 0.4, h * 0.97);
  assert(t.x.range.min > before + 0.1, 'dragging the background still pans');
}

// ── Editing is the user's storage plus invalidate, and the row survives the re-sort.
{
  const t = setup({
    onDrag: ({ hit, first, second }) => { const row = t.rows[hit.row!]!; row.x = first; row.y = second; t.source.invalidate(); },
  });
  t.send('down', ...t.at(0, 2), { buttons: 1 });
  t.send('move', ...t.at(7.5, 6), { buttons: 1 });   // past the other points: the rows re-sort
  t.send('move', ...t.at(8, 6), { buttons: 1 });
  t.send('up', ...t.at(8, 6));
  near(t.rows[0]!.x, 8, 0.1);
  near(t.rows[0]!.y, 6, 0.1);
  assert.equal(hitTest(t.series, ...t.at(8, 6))!.row, 0);
}

// ── A listener after PanZoom cannot claim anything, so it is refused.
{
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()),
    new DomainSeries(new ObjectDataSource({ source: [{ y: 1 }], value: 'y' }), new LinePath(new LinearCurve())), new PanZoom({}), new PointerListener({}));
  assert.throws(() => new Chart({ theme: lightTheme }, plane).attach(new FakePlatform({ width: 100, height: 100 })), /before PanZoom/);
}

// ── The chart only tells elements about the pointer when they asked, and does no hit testing of its own.
{
  class Probe extends ChartElement<Chart, [], BaseAttributes> {
    seen = 0;
    override onEvent(ev: { type: number }): void { if (ev.type === EVENT_HOVER) this.seen++; }
  }
  const t = setup({});
  const probe = new Probe();
  t.chart.append(probe as never);
  t.send('move', ...t.at(5, 8));
  assert.equal(probe.seen, 0, 'not told until it asks');
  inputOf(t.chart).watchPointer(probe);
  t.send('move', ...t.at(5, 8));
  assert.equal(probe.seen, 1);
  t.send('leave', 0, 0);
  assert.equal(probe.seen, 2, 'and told when the pointer goes');
}

// ── The tooltip: snaps to a hit with the default words, hides when away or dragging, follows and shares on request.
{
  const t = setup({}, { tooltip: {} });
  const text = () => [...t.platform.toString().matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
  t.send('move', ...t.at(5, 8));
  const shown = text();
  assert(shown.includes('Rate') && shown.includes('Week: 5') && shown.includes('8'), `default words: ${shown.join(' | ')}`);
  t.send('move', ...t.at(2.5, 1));
  assert(!text().includes('Rate'), 'nothing near: nothing shown');
  t.send('move', ...t.at(5, 8));
  t.send('move', ...t.at(5, 8), { buttons: 1 });
  assert(!text().includes('Rate'), 'hidden while a button is held');
  t.send('move', ...t.at(5, 8));
  t.send('leave', 0, 0);
  assert(!text().includes('Rate'), 'hidden once the pointer leaves');
}
{
  const t = setup({}, { tooltip: { format: (h) => `row ${h.row}` } });
  const [ex, ey] = t.at(10, 4);
  t.send('move', ex - 2, ey);   // the far edge itself is outside the plane
  assert([...t.platform.toString().matchAll(/<text[^>]*>([^<]*)<\/text>/g)].some((m) => m[1] === 'row 2'), 'format overrides the words');
}
{
  const t = setup({}, { tooltip: { mode: 'shared' } });
  t.send('move', ...t.at(4.6, 1));   // far below the line: the nearest point in x is still found
  const svg = t.platform.toString();
  assert([...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].some((m) => /Rate: 8/.test(m[1]!)), 'each series at the pointer x');
  assert.match(svg, /M[\d.]+ [\d.]+V[\d.]+/, 'with a crosshair');
}
{
  // follow: the box moves with the pointer while the hit stays the same.
  const t = setup({}, { tooltip: { mode: 'follow' } });
  t.send('move', ...t.at(5, 8));
  const box = () => /<path d="(M[\d.]+ [\d.]+h[^"]*)"/.exec(t.platform.toString())?.[1];
  const a = box();
  t.send('move', ...t.at(5.1, 8));
  assert.notEqual(box(), a);
}
// ── A tooltip follows the data under a pointer that has not moved, and a shared one reads at the pointer's x.
{
  const t = setup({}, { tooltip: {} });
  const text = () => [...t.platform.toString().matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
  t.send('move', ...t.at(5, 8));
  assert(text().includes('Rate'));
  t.rows[1]!.y = 1;
  t.source.invalidate();
  t.chart.flush();
  assert(!text().includes('Rate'), 'the point moved away from the pointer: nothing is shown');
  t.rows[1]!.y = 8.2;
  t.source.invalidate();
  t.chart.flush();
  assert(text().includes('Rate'), 'and it is back when the point is');
}
{
  const t = setup({}, { tooltip: { mode: 'shared' } });
  t.send('move', ...t.at(4.6, 1));
  assert([...t.platform.toString().matchAll(/<text[^>]*>([^<]*)<\/text>/g)].some((m) => m[1] === '5'), 'the heading is the x the points are read at');
}

// ── Tooltip options: a colour dot, reading the line, and the dots and crosshair under the box.
{
  const words = (t: ReturnType<typeof setup>) => [...t.platform.toString().matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
  const plain = setup({}, { tooltip: {} });
  plain.send('move', ...plain.at(5, 8));
  const colour = plain.series.color;
  const strokes = (t: ReturnType<typeof setup>) => t.platform.toString().split(`stroke="${colour}"`).length - 1;
  assert(strokes(plain) >= 1, 'the plot draws its line');
  const dotted = setup({}, { tooltip: { swatch: true } });
  dotted.send('move', ...dotted.at(5, 8));
  assert.equal(strokes(dotted), strokes(plain) + 1, 'a sample of the line, in its own colour, beside the words');
  const xs = (t: ReturnType<typeof setup>) => Number(/<text[^>]* x="([\d.]+)"[^>]*>Rate/.exec(t.platform.toString())?.[1]);
  assert(xs(dotted) > xs(plain) - 100 && /<text[^>]* x="[\d.]+"[^>]*>Rate/.test(dotted.platform.toString()), 'the words are there with room left for it');

  // Shared: the crosshair and dots are drawn before the box, so they cannot cover it.
  const shared = setup({}, { tooltip: { mode: 'shared', swatch: true } });
  shared.send('move', ...shared.at(4.6, 1));
  const svg = shared.platform.toString();
  assert(svg.indexOf('V') > 0);
  const cross = svg.search(/<path[^>]* d="M[\d.]+ [\d.]+V/), box = svg.search(/<path[^>]* d="M[\d.]+ [\d.]+h[\d.]+v/);
  assert(cross > 0 && box > cross, 'the crosshair comes before the box');

  // Interpolated: the value on the line at the pointer, with the dot there; a plain shared tooltip reports a point.
  const line = setup({}, { tooltip: { mode: 'shared', interpolate: true } });
  line.send('move', ...line.at(2.5, 1));
  assert(words(line).includes('2.5') && words(line).includes('Rate: 5'), words(line).join(' | '));
  const follow = setup({}, { tooltip: { mode: 'follow', interpolate: true } });
  const [fx, fy] = follow.at(5.2, 8);
  follow.send('move', fx, fy);
  assert(words(follow).includes('Week: 5.2') && words(follow).includes('7.84'), words(follow).join(' | '));
  const snap = setup({}, { tooltip: { mode: 'snap', interpolate: true } });
  snap.send('move', ...snap.at(5.2, 8));
  assert(words(snap).includes('Week: 5.2') && words(snap).includes('7.84'), 'interpolation belongs to the cursor, so a box beside the point reads the line too');
}

console.log('ok pointer');

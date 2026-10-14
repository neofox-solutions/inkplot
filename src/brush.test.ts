// Brush: a dragged range is reported in data terms, stays drawn, follows the axes, and a click clears it.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  DomainSeries,
  LinePath,
  FlatDataSource,
  PanZoom,
  Brush,
  type BrushAttributes,
  type BrushSelection,
  type RawPointer,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';
import { test } from 'vite-plus/test';

test('brush', () => {
  function setup(attrs: BrushAttributes = {}) {
    const heard: (BrushSelection | null)[] = [];
    const x = new Axis({ orientation: 'bottom' }, new LinearScale()),
      y = new Axis({ orientation: 'left' }, new LinearScale());
    const series = new DomainSeries(
      new FlatDataSource({ data: Array.from({ length: 11 }, (_, i) => i), regularDomain: { start: 0, step: 1 } }),
      new LinePath(new LinearCurve()),
    );
    const brush = new Brush({ onBrush: (s) => heard.push(s), ...attrs });
    const plane = new CartesianPlane({}, x, y, series, brush, new PanZoom({}));
    const chart = new Chart({ theme: lightTheme }, plane);
    const platform = new FakePlatform({ width: 400, height: 300 });
    chart.attach(platform).flush();
    const send = (kind: RawPointer['kind'], fx: number, fy: number, extra: Partial<RawPointer> = {}) => {
      const r = plane.rect;
      const handled = platform.pointer!({
        kind,
        x: r.x + fx * r.width,
        y: r.y + fy * r.height,
        buttons: 0,
        deltaY: 0,
        shift: false,
        ctrl: false,
        ...extra,
      });
      chart.flush();
      return handled;
    };
    const drag = (a: [number, number], b: [number, number], shift = false) => {
      send('down', ...a, { buttons: 1, shift });
      send('move', ...b, { buttons: 1, shift });
      send('up', ...b, { shift });
    };
    const rects = () => [...platform.toString().matchAll(/<rect [^>]*opacity="0.2"[^>]*>/g)].map((m) => m[0]);
    return { x, y, brush, plane, chart, platform, send, drag, heard, rects };
  }
  const near = (a: number, b: number, what: string) => assert(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a)), `${what}: ${a} vs ${b}`);

  // ── A drag reports the ranges at its corners, leaves the box drawn, and zooms nothing.
  {
    const { x, y, drag, heard, rects, brush } = setup();
    const [x0, x1] = [x.denormalize(0.25), x.denormalize(0.5)];
    drag([0.25, 0.25], [0.5, 0.75]);
    assert.equal(heard.length, 1);
    near(heard[0]!.x!.min, x0, 'x min');
    near(heard[0]!.x!.max, x1, 'x max');
    assert.equal(heard[0]!.ranges.length, 2);
    assert.equal(x.isZoomed, false, 'no zoom');
    assert.equal(y.isZoomed, false);
    assert.equal(rects().length, 1, 'the box stays');
    assert.equal(brush.selecting, false);
    assert.deepEqual(brush.selection?.y, heard[0]!.y);
  }

  // ── mode 'x' is a band over the full height; a click clears and says so.
  {
    const { drag, heard, rects, send, brush, plane } = setup({ mode: 'x' });
    drag([0.2, 0.4], [0.6, 0.5]);
    assert.equal(heard[0]!.ranges.length, 1);
    assert.equal(heard[0]!.y, undefined);
    assert(new RegExp(`height="${plane.rect.height.toFixed(2).replace(/\.?0+$/, '')}"`).test(rects()[0]!), `full height: ${rects()[0]}`);
    send('down', 0.8, 0.5, { buttons: 1 });
    send('up', 0.8, 0.5);
    assert.equal(heard.at(-1), null);
    assert.equal(rects().length, 0);
    assert.equal(brush.selection, null);
  }

  // ── The box follows the axes when they zoom, and `select`/`clear` work from code.
  {
    const { x, drag, rects, brush, heard, chart } = setup({ mode: 'x' });
    drag([0.25, 0.5], [0.5, 0.5]);
    const before = rects()[0]!;
    x.setViewRange({ min: 0, max: 5 });
    chart.flush(); // the view was 0..10, so 2.5..5 now spans the right half
    assert.notEqual(rects()[0], before, 'it moved with the axis');
    brush.select([{ axis: x, min: 1, max: 2 }]);
    chart.flush();
    assert.equal(heard.at(-1)!.x!.min, 1);
    brush.clear();
    chart.flush();
    assert.equal(heard.at(-1), null);
    assert.equal(rects().length, 0);
  }

  // ── With Shift required, a plain drag pans; `live` reports while dragging; a touch only brushes when always.
  {
    const { drag, heard, send } = setup({ activate: 'shift', live: true, mode: 'x' });
    drag([0.2, 0.5], [0.4, 0.5]);
    assert.equal(heard.length, 0, 'a plain drag was left to pan');
    send('down', 0.2, 0.5, { buttons: 1, shift: true });
    send('move', 0.5, 0.5, { buttons: 1, shift: true });
    assert.equal(heard.length, 1, 'live while dragging');
    send('up', 0.5, 0.5, { shift: true });
    assert.equal(heard.length, 2);
  }
  {
    const { send, heard } = setup({ activate: 'shift' });
    send('down', 0.2, 0.5, { buttons: 1, shift: true, pointerType: 'touch' });
    send('move', 0.5, 0.5, { buttons: 1, shift: true, pointerType: 'touch' });
    send('up', 0.5, 0.5, { pointerType: 'touch' });
    assert.equal(heard.length, 0, 'a touch makes no brush unless always');
  }
});

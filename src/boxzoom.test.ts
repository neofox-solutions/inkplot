// BoxZoom: a dragged rectangle becomes the view of the axes it zooms, and resetViews takes it back.
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
  BoxZoom,
  type BoxZoomAttributes,
  type RawPointer,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';
import { test } from 'vite-plus/test';

test('boxzoom', () => {
  function setup(box: BoxZoomAttributes = {}, withPan = true) {
    const x = new Axis({ orientation: 'bottom' }, new LinearScale()),
      y = new Axis({ orientation: 'left' }, new LinearScale());
    const series = new DomainSeries(
      new FlatDataSource({ data: Array.from({ length: 11 }, (_, i) => i), regularDomain: { start: 0, step: 1 } }),
      new LinePath(new LinearCurve()),
    );
    const plane = new CartesianPlane({}, x, y, series, new BoxZoom(box), ...(withPan ? [new PanZoom({})] : []));
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
    const drag = (a: [number, number], b: [number, number], shift = true) => {
      send('down', ...a, { buttons: 1, shift });
      send('move', ...b, { buttons: 1, shift });
      send('up', ...b, { shift });
    };
    return { x, y, plane, chart, platform, send, drag };
  }
  const near = (a: number, b: number, what: string) => assert(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a)), `${what}: ${a} vs ${b}`);

  // ── Shift-drag zooms to the box; the value at the box corners becomes the new ends.
  {
    const { x, y, drag, plane } = setup();
    const [x0, x1, y0, y1] = [x.denormalize(0.25), x.denormalize(0.5), y.denormalize(1 - 0.75), y.denormalize(1 - 0.25)];
    drag([0.25, 0.25], [0.5, 0.75]);
    near(x.range.min, x0, 'x min');
    near(x.range.max, x1, 'x max');
    near(y.range.min, y0, 'y min');
    near(y.range.max, y1, 'y max');
    assert.ok(plane.chart);
  }

  // ── A plain drag is left to pan; with `activate: 'always'` it is a box.
  {
    const a = setup();
    a.drag([0.2, 0.2], [0.4, 0.4], false);
    assert(!a.x.isZoomed, 'no box without Shift');
    const b = setup({ activate: 'always' });
    b.drag([0.2, 0.2], [0.4, 0.4], false);
    assert(b.x.isZoomed && b.y.isZoomed, 'a box without Shift when always');
  }

  // ── mode: one direction, or 'auto' from the shape of the box. A box too small does nothing.
  {
    const x = setup({ along: 'x' });
    x.drag([0.2, 0.2], [0.6, 0.8]);
    assert(x.x.isZoomed && !x.y.isZoomed, "mode 'x' zooms the horizontal axis only");
    const y = setup({ along: 'y' });
    y.drag([0.2, 0.2], [0.6, 0.8]);
    assert(!y.x.isZoomed && y.y.isZoomed, "mode 'y'");
    const wide = setup({ along: 'auto' });
    wide.drag([0.1, 0.5], [0.9, 0.55]);
    assert(wide.x.isZoomed && !wide.y.isZoomed, "'auto': a wide flat box zooms x");
    const square = setup({ along: 'auto' });
    square.drag([0.2, 0.2], [0.5, 0.5]);
    assert(square.x.isZoomed && square.y.isZoomed, "'auto': a square box zooms both");
    const tiny = setup();
    tiny.drag([0.5, 0.5], [0.502, 0.502]);
    assert(!tiny.x.isZoomed, 'a box under minSize does nothing');
  }

  // ── The box is drawn while dragging, and gone when it ends; it looks as `selection` says.
  {
    const { send, platform } = setup();
    send('down', 0.2, 0.2, { buttons: 1, shift: true });
    send('move', 0.6, 0.6, { buttons: 1, shift: true });
    assert(/<rect[^>]*opacity="0.2"/.test(platform.toString()) && platform.toString().includes('fill="#2a6fdb"'), 'drawn while dragging');
    send('up', 0.6, 0.6, { shift: true });
    assert(!/<rect[^>]*opacity="0.2"/.test(platform.toString()), 'gone afterwards');
  }

  // ── Zoom, then reset: `resetViews` on the plane and on the chart.
  {
    const { x, y, drag, plane, chart } = setup();
    drag([0.2, 0.2], [0.5, 0.5]);
    assert(x.isZoomed);
    plane.resetViews();
    assert(!x.isZoomed && !y.isZoomed, 'plane.resetViews');
    drag([0.2, 0.2], [0.5, 0.5]);
    chart.resetViews();
    assert(!x.isZoomed && !y.isZoomed, 'chart.resetViews');
  }

  // ── Dragging past the plot is held at its edge; the order with PanZoom is checked.
  {
    const { x, drag } = setup();
    drag([0.5, 0.5], [3, 3]);
    near(x.range.max, x.denormalize(1), 'held at the edge');
    const build = () =>
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom' }, new LinearScale()),
        new Axis({ orientation: 'left' }, new LinearScale()),
        new PanZoom({}),
        new BoxZoom(),
      );
    assert.throws(() => new Chart({ theme: lightTheme }, build()).attach(new FakePlatform({ width: 100, height: 100 })), /before PanZoom/);
  }
});

// PanZoom, driven through the same pointer path a browser uses, on every side and scale an axis can have.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  PolarPlane,
  RadarPlane,
  XYSeries,
  ObjectDataSource,
  Axis,
  LinearScale,
  Scale,
  DomainSeries,
  LinePath,
  FlatDataSource,
  PanZoom,
  Decimator,
  MinMaxKernel,
  type Extent,
  type PanZoomAttributes,
  type RawPointer,
  type CartesianOrientation,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';
import { test } from 'vite-plus/test';

test('panzoom', async () => {
  /** A scale that is not linear, defined here: sign(v) * sqrt(|v|). */
  class RootScale extends Scale {
    private f = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
    private g = (u: number) => Math.sign(u) * u * u;
    normalize(b: Float64Array, n: number, stride: number, offset: number, r: Extent): void {
      const lo = this.f(r.min),
        inv = 1 / (this.f(r.max) - lo);
      for (let k = 0, i = offset; k < n; k++, i += stride) b[i] = (this.f(b[i]!) - lo) * inv;
    }
    denormalize(fraction: number, r: Extent): number {
      const lo = this.f(r.min);
      return this.g(lo + fraction * (this.f(r.max) - lo));
    }
    constrain(r: Extent): Extent {
      return r;
    }
    nice(r: Extent): Extent {
      return r;
    }
    ticks(r: Extent, count: number): readonly number[] {
      return new LinearScale().ticks(r, count);
    }
  }

  interface Options {
    pz?: PanZoomAttributes;
    xSide?: CartesianOrientation;
    ySide?: CartesianOrientation;
    xInverted?: boolean;
    yInverted?: boolean;
    yScale?: () => Scale;
  }
  function setup(o: Options = {}) {
    const x = new Axis({ id: 'x', orientation: o.xSide ?? 'bottom', inverted: o.xInverted }, new LinearScale());
    const y = new Axis({ id: 'y', orientation: o.ySide ?? 'left', inverted: o.yInverted }, o.yScale?.() ?? new LinearScale());
    const ys = new Float64Array(11).map((_, i) => i * 0.5);
    const series = new DomainSeries(
      new FlatDataSource({ data: ys, regularDomain: { start: 0, step: 1 } }),
      new LinePath(new LinearCurve()),
    );
    const pz = new PanZoom(o.pz ?? {});
    const plane = new CartesianPlane({}, x, y, series, pz);
    const chart = new Chart({ theme: lightTheme }, plane);
    const platform = new FakePlatform({ width: 400, height: 300 });
    chart.attach(platform).flush();
    // The plot area can change size as tick labels change width, so always read it live.
    const send = (kind: RawPointer['kind'], px: number, py: number, extra: Partial<RawPointer> = {}) => {
      const r = plane.rect;
      const handled = platform.pointer!({ kind, x: r.x + px, y: r.y + py, buttons: 0, deltaY: 0, shift: false, ctrl: false, ...extra });
      chart.flush();
      return handled;
    };
    /**
     * The value an axis shows at a point of the plot given as fractions of its width and height. The plot area itself
     * can change size when tick labels change width, so positions are compared as fractions of whatever it is now.
     */
    const under = (axis: Axis, fx: number, fy: number) =>
      axis.orientation === 'bottom' || axis.orientation === 'top' ? axis.denormalize(fx) : axis.denormalize(1 - fy);
    const px = (fx: number, fy: number): [number, number] => [fx * plane.rect.width, fy * plane.rect.height];
    const wheel = (px: number, py: number, deltaY: number) => send('wheel', px, py, { deltaY });
    const drag = (from: [number, number], to: [number, number]) => {
      send('down', ...from, { buttons: 1 });
      send('move', ...to, { buttons: 1 });
      return send('up', ...to);
    };
    return {
      x,
      y,
      pz,
      plane,
      chart,
      platform,
      get r() {
        return plane.rect;
      },
      send,
      under,
      px,
      wheel,
      drag,
    };
  }
  const near = (a: number, b: number, what: string) =>
    assert(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${what}: ${a} vs ${b}`);

  // ── The value under the pointer stays under the pointer, however the axes are set up.
  const configs: [string, Options][] = [
    ['bottom/left', {}],
    ['top/right', { xSide: 'top', ySide: 'right' }],
    ['inverted x', { xInverted: true }],
    ['inverted y', { yInverted: true }],
    ['non-linear y', { yScale: () => new RootScale() }],
    ['everything at once', { xSide: 'top', ySide: 'right', xInverted: true, yInverted: true, yScale: () => new RootScale() }],
  ];
  for (const [name, options] of configs) {
    const t = setup(options);
    // Zoom about a point: that point's value does not move.
    const at: [number, number] = [0.3, 0.6];
    const [vx, vy] = [t.under(t.x, ...at), t.under(t.y, ...at)];
    assert.equal(t.wheel(...t.px(...at), -400), true);
    near(t.under(t.x, ...at), vx, `${name}: zoom keeps x under the pointer`);
    near(t.under(t.y, ...at), vy, `${name}: zoom keeps y under the pointer`);
    assert(t.x.isZoomed && t.y.isZoomed);
    assert(t.x.range.max - t.x.range.min < 10 * 0.9, `${name}: zoomed in`);
    // Drag: the value that was under the pointer when it went down is under it when it comes up.
    const from: [number, number] = [0.5, 0.5],
      to: [number, number] = [0.55, 0.45];
    const [dx, dy] = [t.under(t.x, ...from), t.under(t.y, ...from)];
    assert.equal(t.drag(t.px(...from), t.px(...to)), true, `${name}: a drag is handled`);
    near(t.under(t.x, ...to), dx, `${name}: pan keeps x under the pointer`);
    near(t.under(t.y, ...to), dy, `${name}: pan keeps y under the pointer`);
  }

  // ── Limits: no zooming out past the data, no panning off it.
  {
    const t = setup();
    const natural = { ...t.x.range };
    assert.deepEqual(natural, { min: 0, max: 10 });
    t.wheel(t.r.width / 2, t.r.height / 2, -800);
    const span = t.x.range.max - t.x.range.min;
    assert(span < 3 && t.x.isZoomed);
    t.drag([10, 10], [10 + t.r.width * 20, 10]); // far to the right
    assert(t.x.range.min >= 0 - 1e-9 && t.x.range.max <= 10 + 1e-9, 'stays inside the data');
    near(t.x.range.max - t.x.range.min, span, 'panning does not change the span');
    near(t.x.range.min, 0, 'and rests against the edge');
    t.wheel(100, 100, 10000); // zoom out as far as it will go
    assert.deepEqual({ ...t.x.range }, natural);
    assert(!t.x.isZoomed && !t.y.isZoomed, 'fully zoomed out is no view at all: the axis fits its data again');
    assert.equal(t.wheel(100, 100, 400), true, "the rest of a hard spin is still the chart's, so the page does not start to scroll");
  }
  {
    // A turn that starts with nothing to zoom is the page's to scroll.
    const t = setup();
    assert.equal(t.wheel(100, 100, 400), false, 'a fresh turn at the limit scrolls the page');
  }
  {
    const t = setup({ pz: { limit: false } });
    t.wheel(t.r.width / 2, t.r.height / 2, -800);
    t.drag([10, 10], [10 + t.r.width * 20, 10]);
    assert(t.x.range.min < -1, 'without a limit the view can leave the data');
    t.wheel(100, 100, 10000);
    assert(t.x.range.max - t.x.range.min > 10, 'and zoom out past it');
  }

  // ── Direction and axes.
  {
    const t = setup({ pz: { along: 'x' } });
    t.wheel(100, 100, -400);
    assert(t.x.isZoomed && !t.y.isZoomed, 'horizontal moves only the horizontal axis');
  }
  {
    const t = setup({ pz: { along: 'y' } });
    t.drag([50, 50], [80, 90]);
    assert.equal(t.x.isZoomed, false);
    const z = setup({ pz: { along: 'y' } });
    z.wheel(100, 100, -400);
    assert(z.y.isZoomed && !z.x.isZoomed);
  }
  {
    const t = setup({ pz: { axes: ['y'] } });
    t.wheel(100, 100, -400);
    assert(t.y.isZoomed && !t.x.isZoomed, 'axes names which axes move');
  }
  {
    const t = setup({ pz: { axes: [] } });
    t.wheel(100, 100, -400);
    assert(!t.x.isZoomed && !t.y.isZoomed, 'an empty list moves nothing');
  }

  // ── Switches, and what the browser is told.
  {
    const t = setup({ pz: { pan: false } });
    assert.equal(t.drag([50, 50], [90, 90]), false, 'pan off: a drag is left to the browser');
    assert(!t.x.isZoomed);
    assert.equal(t.wheel(100, 100, -300), true);
    assert(t.x.isZoomed, 'zoom still works');
  }
  {
    const t = setup({ pz: { zoom: false } });
    assert.equal(t.wheel(100, 100, -300), false, 'zoom off: the wheel is left to the page');
    assert(!t.x.isZoomed);
    t.wheel(100, 100, -300);
  }
  {
    const t = setup();
    assert.equal(t.send('move', 50, 50), false, 'hovering is not handled');
    assert.equal(t.platform.cursor, 'grab');
    t.send('down', 50, 50, { buttons: 1 });
    assert.equal(t.platform.cursor, 'grabbing');
    t.send('up', 50, 50);
    assert.equal(t.platform.cursor, 'grab');
    t.send('move', -100, -100); // outside the plane: it is told the pointer left
    assert.equal(t.platform.cursor, '');
    assert.equal(setup({ pz: { pan: false } }).send('move', 50, 50), false);
    const noPan = setup({ pz: { pan: false } });
    noPan.send('move', 50, 50);
    assert.equal(noPan.platform.cursor, '', 'no grab hand when it cannot grab');
  }
  {
    // A button released outside the window: the next move without a button ends the drag instead of continuing it.
    const t = setup();
    t.wheel(100, 100, -400);
    t.send('down', 50, 50, { buttons: 1 });
    const before = { ...t.x.range };
    t.send('move', 70, 50, { buttons: 0 });
    assert.deepEqual({ ...t.x.range }, before);
  }

  // ── Double click resets, and a slow second click does not.
  {
    const t = setup();
    t.wheel(100, 100, -600);
    assert(t.x.isZoomed);
    t.send('down', 60, 60, { buttons: 1 });
    t.send('up', 60, 60);
    assert(t.x.isZoomed, 'one press is just a press');
    assert.equal(t.send('down', 61, 60, { buttons: 1 }), true);
    assert(!t.x.isZoomed && !t.y.isZoomed, 'the second press resets');
    const u = setup({ pz: { resetOnDoubleClick: false } });
    u.wheel(100, 100, -600);
    u.send('down', 60, 60, { buttons: 1 });
    u.send('up', 60, 60);
    u.send('down', 60, 60, { buttons: 1 });
    assert(u.x.isZoomed, 'switched off');
  }

  // ── With a decimator, zooming in refills from the full data, and the other axis fits what is in view.
  {
    const n = 200_000,
      ys = new Float64Array(n);
    for (let i = 0; i < n; i++) ys[i] = Math.sin(i / 3000) * (1 + i / n) + (i % 7) * 0.01;
    const x = new Axis({ orientation: 'bottom' }, new LinearScale());
    const y = new Axis({ orientation: 'left' }, new LinearScale());
    const series = new DomainSeries(
      new Decimator({}, new MinMaxKernel(), new FlatDataSource({ data: ys, regularDomain: { start: 0, step: 1 } })),
      new LinePath(new LinearCurve()),
    );
    const plane = new CartesianPlane({}, x, y, series, new PanZoom({ along: 'x' }));
    const chart = new Chart({ theme: lightTheme }, plane);
    const platform = new FakePlatform({ width: 500, height: 300 });
    chart.attach(platform).flush();
    const fullY = { ...y.range };
    const r = plane.rect;
    const stats = [];
    for (let i = 0; i < 6; i++) {
      platform.pointer!({ kind: 'wheel', x: r.x + r.width * 0.2, y: r.y + 50, buttons: 0, deltaY: -1000, shift: false, ctrl: false });
      stats.push(chart.flush());
    }
    assert(x.range.max - x.range.min < n / 1000, 'zoomed in by a factor of a thousand or more');
    assert(
      stats.every((s) => s.pointsDrawn <= 2 * r.width + 2),
      'always bounded by the width',
    );
    assert(
      stats.every((s) => s.filled === 1),
      'each step reads again from the full data',
    );
    assert(y.range.max - y.range.min < (fullY.max - fullY.min) / 2, 'the value axis fits what is in view');
    const visible = x.range.max - x.range.min;
    assert(
      series.points.count >= Math.min(visible, r.width) - 2,
      `every point in view survives when there are fewer than columns (${series.points.count} for ${visible.toFixed(0)})`,
    );
  }

  // ── Both axes zoom smoothly on a decimated chart: the value limit is the full data, not the windowed fit.
  {
    const n = 500_000,
      ys = new Float64Array(n);
    let w = 0,
      sd = 7;
    for (let i = 0; i < n; i++) {
      sd = (sd * 1664525 + 1013904223) >>> 0;
      w += (sd / 4294967296 - 0.5) * 0.05;
      ys[i] = w;
    }
    const x = new Axis({ orientation: 'bottom' }, new LinearScale());
    const y = new Axis({ orientation: 'left', nice: true }, new LinearScale());
    const plane = new CartesianPlane(
      {},
      x,
      y,
      new DomainSeries(
        new Decimator({}, new MinMaxKernel(), new FlatDataSource({ data: ys, regularDomain: { start: 0, step: 10 / (n - 1) } })),
        new LinePath(new LinearCurve()),
      ),
      new PanZoom({ along: 'xy' }),
    );
    const chart = new Chart({ theme: lightTheme }, plane);
    const p = new FakePlatform({ width: 960, height: 400 });
    chart.attach(p).flush();
    let spans: number[] = [],
      centres: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = plane.rect;
      p.pointer!({ kind: 'wheel', x: r.x + r.width / 2, y: r.y + r.height / 2, buttons: 0, deltaY: -150, shift: false, ctrl: false });
      chart.flush();
      spans.push(y.range.max - y.range.min);
      centres.push((y.range.max + y.range.min) / 2);
    }
    assert(y.isZoomed, 'the value axis is zoomed, not auto-fitting');
    for (let i = 1; i < spans.length; i++)
      assert(Math.abs(spans[i]! / spans[i - 1]! - Math.exp(-0.3)) < 1e-6, `constant y zoom factor at step ${i}`);
    assert(
      centres.every((c) => Math.abs(c - centres[0]!) < 1e-6),
      'the y anchor stays put',
    );
  }

  // ── On a radial plane the radius axis is the one that moves: the value at the pointer's radius stays at it, at any angle.
  for (const kind of ['polar', 'radar'] as const) {
    const angle = new Axis({ id: 'angle', orientation: 'angle', min: 0, max: 6, tickCount: 7 }, new LinearScale());
    const radius = new Axis({ id: 'radius', orientation: 'radius', min: 0, max: 10 }, new LinearScale());
    const series = new DomainSeries(
      new FlatDataSource({ data: new Float64Array([2, 9, 4, 10, 3, 8]), regularDomain: { start: 0, step: 1 }, isSorted: true, wrap: 6 }),
      new LinePath(new LinearCurve()),
    );
    const pz = new PanZoom({});
    const plane =
      kind === 'polar'
        ? new PolarPlane({ innerRadius: 0.2 }, angle, radius, series, pz)
        : new RadarPlane({ innerRadius: 0.2 }, angle, radius, series, pz);
    const chart = new Chart({ theme: lightTheme }, plane);
    const platform = new FakePlatform({ width: 400, height: 400 });
    chart.attach(platform).flush();
    const send = (k: RawPointer['kind'], x: number, y: number, extra: Partial<RawPointer> = {}) => {
      const handled = platform.pointer!({
        kind: k,
        x: plane.rect.x + x,
        y: plane.rect.y + y,
        buttons: 0,
        deltaY: 0,
        shift: false,
        ctrl: false,
        ...extra,
      });
      chart.flush();
      return handled;
    };
    const cx = () => plane.rect.width / 2,
      cy = () => plane.rect.height / 2;
    // A point `rho` of the way out in the plot at angle `a` (radians clockwise from the top), as a fraction of its own ring (a radar's edge is nearer between spokes).
    const spot = (rho: number, a: number): [number, number] => [
      cx() + rho * plane.radius * Math.sin(a),
      cy() - rho * plane.radius * Math.cos(a),
    ];
    const hexagon = (a: number) =>
      kind === 'radar' ? Math.cos(Math.PI / 6) / Math.cos((((a % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6) : 1;
    for (const a of [0, 0.4, Math.PI / 6, 2.2, 4.5]) {
      const k = hexagon(a),
        from = spot(0.6 * k, a);
      const before = radius.denormalize((0.6 - 0.2) / 0.8);
      assert.equal(send('wheel', ...from, { deltaY: -400 }), true, `${kind}: wheel is handled at ${a}`);
      assert(radius.isZoomed && radius.range.max - radius.range.min < 9, `${kind}: zoomed in`);
      near(radius.denormalize((0.6 - 0.2) / 0.8), before, `${kind}: the value at the pointer stays put at angle ${a}`);
      assert(!angle.isZoomed, `${kind}: the angle axis is left alone`);
      send('down', ...from, { buttons: 1 });
      const to = spot(0.7 * k, a);
      send('move', ...to, { buttons: 1 });
      send('up', ...to);
      near(radius.denormalize((0.7 - 0.2) / 0.8), before, `${kind}: a drag carries the value with the pointer at angle ${a}`);
      pz.reset();
      chart.flush();
      assert(!radius.isZoomed);
    }
  }

  // ── An XY series is zoomed and panned through the same two axes, limited by all of its data; a floating axis is no different.
  for (const floating of [false, true]) {
    const x = new Axis({ id: 'x', orientation: 'bottom', ...(floating && { crossesAt: 0 }) }, new LinearScale());
    const y = new Axis({ id: 'y', orientation: 'left', ...(floating && { crossesAt: 0 }) }, new LinearScale());
    const rows = Array.from({ length: 60 }, (_, i) => ({ x: Math.sin(i * 0.3) * 8, y: Math.cos(i * 0.5) * 5 }));
    const series = new XYSeries(
      { x: 'x' },
      new ObjectDataSource({ source: rows, channels: { x: 'x', y: 'y' } }),
      new LinePath(new LinearCurve()),
    );
    const pz = new PanZoom({});
    const plane = new CartesianPlane({}, x, y, series, pz);
    const chart = new Chart({ theme: lightTheme }, plane);
    const platform = new FakePlatform({ width: 400, height: 300 });
    chart.attach(platform).flush();
    const send = (kind: RawPointer['kind'], fx: number, fy: number, extra: Partial<RawPointer> = {}) => {
      const r = plane.rect;
      platform.pointer!({
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
    };
    const name = floating ? 'floating' : 'fixed';
    const natural = { x: { ...x.range }, y: { ...y.range } };
    const [vx, vy] = [x.denormalize(0.3), y.denormalize(1 - 0.6)];
    send('wheel', 0.3, 0.6, { deltaY: -400 });
    assert(x.isZoomed && y.isZoomed, `${name}: both axes zoom`);
    near(x.denormalize(0.3), vx, `${name}: x under the pointer stays`);
    near(y.denormalize(1 - 0.6), vy, `${name}: y under the pointer stays`);
    assert(x.range.max - x.range.min < natural.x.max - natural.x.min, `${name}: zoomed in`);
    const [dx, dy] = [x.denormalize(0.5), y.denormalize(0.5)];
    send('down', 0.5, 0.5, { buttons: 1 });
    send('move', 0.6, 0.4, { buttons: 1 });
    send('up', 0.6, 0.4);
    near(x.denormalize(0.6), dx, `${name}: a drag carries x with the pointer`);
    near(y.denormalize(1 - 0.4), dy, `${name}: and y`);
    // Zooming back out is held at what all the data asks for, not the part in view.
    for (let i = 0; i < 20; i++) send('wheel', 0.5, 0.5, { deltaY: 600 });
    assert(!x.isZoomed && !y.isZoomed, `${name}: out past the data is back to natural`);
    if (floating) assert(Math.abs(x.ruler.at(0)[1] - plane.rect.height / 2) < 2, `${name}: and the axes cross near the middle again`);
  }

  // ── A trackpad pinch (Ctrl and small wheel steps) zooms with its own, much higher gain than a wheel notch.
  {
    const { x, send } = setup();
    const before = x.range.max - x.range.min;
    send('wheel', 100, 100, { deltaY: -5, ctrl: true });
    const pinch = (x.range.max - x.range.min) / before;
    assert(pinch < 0.93 && pinch > 0.85, `a 5px pinch step is about 10%: ${pinch}`);
    const t = setup();
    t.send('wheel', 100, 100, { deltaY: -5 });
    assert((t.x.range.max - t.x.range.min) / before > 0.98, 'and a 5px wheel step is about 1%');
    // A gesture the platform recognised (Safari) zooms by its factor.
    const g = setup();
    g.send('pinch', 100, 100, { scale: 2 });
    near((g.x.range.max - g.x.range.min) / before, 0.5, 'a pinch event of 2 halves the range');
  }

  // ── Over an axis, wheel, pinch and drag move that axis alone; `axisZoom: false` makes the axes inert.
  {
    const { x, y, plane, send, wheel } = setup();
    const below = plane.rect.height + 8,
      left = -8;
    wheel(100, below, -400);
    assert(x.isZoomed && !y.isZoomed, 'wheel over the horizontal axis zooms x only');
    wheel(left, 100, -400);
    assert(y.isZoomed, 'and over the vertical axis zooms y');
    const [x0, y0] = [{ ...x.range }, { ...y.range }];
    send('down', 100, below, { buttons: 1 });
    send('move', 140, below, { buttons: 1 });
    send('up', 140, below);
    assert(x.range.min !== x0.min && y.range.min === y0.min, 'a drag along an axis pans that axis only');
    send('down', 100, below, { buttons: 1 });
    send('up', 100, below);
    send('down', 100, below, { buttons: 1 });
    send('up', 100, below);
    assert(!x.isZoomed && y.isZoomed, 'a double press on an axis resets that axis only');
    const off = setup({ pz: { axisZoom: false } });
    off.wheel(100, off.plane.rect.height + 8, -400);
    assert(!off.x.isZoomed && !off.y.isZoomed, 'with axisZoom off an axis takes no input');
    off.wheel(100, 100, -400);
    assert(off.x.isZoomed && off.y.isZoomed, 'and the plot zooms both');
    const tooltipSide = setup();
    assert.equal(
      tooltipSide.send('wheel', 100, tooltipSide.plane.rect.height + 200, { deltaY: -400 }),
      false,
      'beyond the axis strip the page keeps the wheel',
    );
  }

  // ── Sideways wheel travel pans horizontal axes only.
  {
    const { x, y, wheel, send } = setup();
    wheel(100, 100, -400);
    const [x0, y0] = [x.range.min, y.range.min];
    send('wheel', 100, 100, { deltaX: 60, deltaY: 2 });
    assert(x.range.min > x0 && y.range.min === y0, 'moves x along, not y');
  }

  // ── Touch: two fingers pinch and pan together; one finger pans only when asked to; a level pinch leaves the vertical axis alone.
  {
    const touch = (t: ReturnType<typeof setup>, kind: RawPointer['kind'], id: number, px: number, py: number) =>
      t.send(kind, px, py, { id, pointerType: 'touch', buttons: kind === 'up' ? 0 : 1 });
    const t = setup();
    const vx = t.x.denormalize(0.4);
    const [a0, b0] = [t.px(0.4, 0.5), t.px(0.6, 0.5)];
    touch(t, 'down', 1, ...a0);
    touch(t, 'down', 2, ...b0);
    const [a1, b1] = [t.px(0.3, 0.5), t.px(0.7, 0.5)];
    touch(t, 'move', 1, ...a1);
    touch(t, 'move', 2, ...b1);
    assert(t.x.isZoomed, 'spreading two fingers zooms');
    near(t.x.denormalize(0.3), vx, 'the value under the first finger stays under it');
    assert(
      !t.y.isZoomed || Math.abs(t.y.range.max - t.y.range.min - (t.y.denormalize(1) - t.y.denormalize(0))) < 1e-9,
      'a level pinch does not zoom y',
    );
    assert(!t.y.isZoomed, 'a level pinch leaves y alone');
    touch(t, 'up', 1, ...a1);
    touch(t, 'up', 2, ...b1);
    // One finger: the page's by default, the chart's with touch: 'always'.
    const one = setup();
    touch(one, 'down', 1, 100, 100);
    touch(one, 'move', 1, 140, 100);
    touch(one, 'up', 1, 140, 100);
    assert(!one.x.isZoomed, 'a one-finger drag does nothing by default (the page scrolls)');
    const always = setup({ pz: { touch: 'always' } });
    touch(always, 'down', 1, 100, 100);
    touch(always, 'move', 1, 140, 100);
    touch(always, 'up', 1, 140, 100);
    assert(always.pz.attrs.touch === 'always');
    const zoomed = setup({ pz: { touch: 'always' } });
    zoomed.wheel(100, 100, -400);
    const start = zoomed.x.range.min;
    touch(zoomed, 'down', 1, 100, 100);
    touch(zoomed, 'move', 1, 140, 100);
    touch(zoomed, 'up', 1, 140, 100);
    assert(zoomed.x.range.min < start, "one finger pans with touch: 'always'");
    // A diagonal pinch zooms both axes; fingers on one axis' strip zoom that axis.
    const d = setup();
    const [p, q] = [d.px(0.4, 0.4), d.px(0.6, 0.6)];
    touch(d, 'down', 1, ...p);
    touch(d, 'down', 2, ...q);
    touch(d, 'move', 1, ...d.px(0.3, 0.3));
    touch(d, 'move', 2, ...d.px(0.7, 0.7));
    assert(d.x.isZoomed && d.y.isZoomed, 'a diagonal pinch zooms both');
    const strip = setup(),
      below = strip.plane.rect.height + 8;
    touch(strip, 'down', 1, 100, below);
    touch(strip, 'down', 2, 160, below);
    touch(strip, 'move', 1, 60, below);
    touch(strip, 'move', 2, 200, below);
    assert(strip.x.isZoomed && !strip.y.isZoomed, 'a pinch along an axis zooms that axis');
  }

  // ── `onViewChange` on an axis hears each change of view, and a view set to what it already is is not one.
  {
    const seen: (Extent | null)[] = [];
    const x = new Axis({ orientation: 'bottom', onViewChange: (v) => seen.push(v && { ...v }) }, new LinearScale());
    const plane = new CartesianPlane(
      {},
      x,
      new Axis({ orientation: 'left' }, new LinearScale()),
      new DomainSeries(new FlatDataSource({ data: [1, 2, 3], regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve())),
    );
    new Chart({ theme: lightTheme }, plane).attach(new FakePlatform({ width: 400, height: 300 })).flush();
    x.setViewRange({ min: 0, max: 1 });
    x.setViewRange({ min: 0, max: 1 });
    x.setViewRange(null);
    x.setViewRange(null);
    assert.deepEqual(seen, [{ min: 0, max: 1 }, null]);
  }

  // ── A flick: a touch that lets go while moving carries on and slows to a stop; a touch stops it; a rest does not flick.
  {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const make = (pz: PanZoomAttributes = {}) => {
      const t = setup({ pz: { touch: 'always', ...pz } });
      const queue: (() => void)[] = [];
      t.platform.schedule = (cb) => {
        queue.push(cb);
        return () => {
          const i = queue.indexOf(cb);
          if (i >= 0) queue.splice(i, 1);
        };
      };
      t.x.setViewRange({ min: 5, max: 7 });
      t.chart.flush();
      return {
        ...t,
        queue,
        drain: () => {
          const run = queue.splice(0);
          for (const cb of run) cb();
          t.chart.flush();
        },
      };
    };
    const swipe = async (t: ReturnType<typeof make>, rest = 0) => {
      const tc = (kind: RawPointer['kind'], px: number) =>
        t.send(kind, px, 150, { id: 1, pointerType: 'touch', buttons: kind === 'up' ? 0 : 1 });
      tc('down', 300);
      for (const px of [280, 260, 240]) {
        await sleep(8);
        tc('move', px);
      }
      if (rest) await sleep(rest);
      tc('up', 240);
    };
    const t = make();
    await swipe(t);
    const released = t.x.range.min;
    for (let i = 0; i < 400 && t.queue.length; i++) {
      await sleep(8);
      t.drain();
    }
    assert(t.x.range.min > released, 'the view carried on to the right after release');
    assert.equal(t.queue.length, 0, 'and came to rest');
    // A new touch stops a coast in progress.
    const u = make();
    await swipe(u);
    const at = u.x.range.min;
    u.send('down', 100, 100, { id: 2, pointerType: 'touch', buttons: 1 });
    await sleep(20);
    u.drain();
    assert.equal(u.x.range.min, at, 'a touch stops it');
    // Resting before letting go, or inertia off, leaves it where it was let go.
    const r = make();
    await swipe(r, 150);
    const rested = r.x.range.min;
    await sleep(20);
    r.drain();
    assert.equal(r.x.range.min, rested, 'no flick after a rest');
    const off = make({ inertia: false });
    await swipe(off);
    assert.equal(off.queue.filter((cb) => cb.name === 'tick').length, 0);
    const still = off.x.range.min;
    await sleep(20);
    off.drain();
    assert.equal(off.x.range.min, still, 'inertia: false');
  }
});

/**
 * Brush: drag a rectangle on the plot to pick a range of the data, and say what was picked. It zooms nothing.
 *
 *   new CartesianPlane({}, x, y, series, new Brush({ mode: 'x', onBrush: (b) => filter(b?.ranges) }), new PanZoom())
 *
 * It is the other half of `BoxZoom`: the same drag, but the rectangle stays drawn (and follows the axes as they pan and
 * zoom, since it is held in data terms) and the ranges it covers go to `onBrush`, for the app to filter a table, link another
 * chart or total a selection. A click (a box under `minSize`) or `clear()` takes it away and calls `onBrush(null)`.
 *
 * `mode` is which axes the brush covers: 'xy', or 'x' / 'y' for a band across the plot (a time range). By default
 * (`activate: 'always'`) every drag brushes, so give a plane that also pans `activate: 'shift'`; like `BoxZoom` it has to come
 * **before** `PanZoom` to see a press first. With `live`, `onBrush` is called as the box is dragged and not only at the end.
 * A touch brushes only with `activate: 'always'` and the plane taking every touch; a rim (polar) cannot be brushed.
 * `select()` sets it from code, which is how two charts follow one another.
 */
import { type AttrTypesFor, AUTO, BOOLEAN, NUMBER } from './attrs.ts';
import { Axis } from './axis.ts';
import { type BaseAttributes, ChartElement, type ElementRef, fail, resolveRef } from './element.ts';
import { InteractiveElement } from './input.ts';
import { type ChartEvent, EVENT_ATTACH, EVENT_PAINT, EVENT_POINTER } from './events.ts';
import { f2 } from './geometry.ts';
import type { Plane } from './plane.ts';

/** What a brush covers on one axis, in that axis' own values. */
export interface BrushRange {
  axis: Axis;
  min: number;
  max: number;
}
/** What `onBrush` hears: every axis covered, with the first horizontal and first vertical ones' ranges also by name. */
export interface BrushSelection {
  ranges: readonly BrushRange[];
  x?: { min: number; max: number };
  y?: { min: number; max: number };
}

export interface BrushAttributes extends BaseAttributes {
  /** The axes it may cover, as elements or ids. Default: all of the plane's that can be followed along. */
  axes?: readonly ElementRef<Axis>[];
  /** When a drag brushes: always (the default) or with Shift held, to leave a plain drag to `PanZoom`. */
  activate?: 'shift' | 'always';
  /** Which axes it covers. Default 'xy'. */
  mode?: 'xy' | 'x' | 'y';
  /** Smallest side of a brush, in pixels, along an axis it covers; below that a drag only clears. Default 4. */
  minSize?: number;
  /** Call `onBrush` while dragging too. Default false. */
  live?: boolean;
  /** Called with the selection, or null when it is cleared. */
  onBrush?: (selection: BrushSelection | null) => void;
}

export class Brush extends InteractiveElement<Plane, [], BrushAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    minSize: NUMBER,
    live: BOOLEAN,
    onBrush: AUTO,
  } satisfies AttrTypesFor<BrushAttributes>;
  #from: { x: number; y: number } | null = null;
  #to = { x: 0, y: 0 };
  #ranges: BrushRange[] = [];

  /** True while a box is being dragged. */
  get selecting(): boolean {
    return this.#from !== null;
  }
  /** What is brushed now, or null. */
  get selection(): BrushSelection | null {
    return this.#ranges.length ? this.#describe(this.#ranges) : null;
  }

  /** Brushes these ranges (as if dragged), or clears with an empty list. */
  select(ranges: readonly BrushRange[]): void {
    this.#ranges = ranges.map((r) => ({ axis: r.axis, min: Math.min(r.min, r.max), max: Math.max(r.min, r.max) }));
    this.invalidate();
    this.attrs.onBrush?.(this.selection);
  }
  clear(): void {
    if (!this.#ranges.length) return;
    this.#ranges = [];
    this.invalidate();
    this.attrs.onBrush?.(null);
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH: {
        const plane = this.requireParent();
        for (let sibling = plane.firstChild; sibling; sibling = sibling.nextSibling) {
          if (sibling === this) break;
          if (sibling.claimsPress) fail('add a Brush before PanZoom in a plane: the brush has to see a press first to take it');
        }
        return;
      }
      case EVENT_PAINT:
        this.#paint();
        return;
      case EVENT_POINTER:
        this.#pointer(ev);
        return;
    }
  }

  #describe(ranges: readonly BrushRange[]): BrushSelection {
    const out: BrushSelection = { ranges };
    for (const r of ranges) {
      const key = r.axis.ruler.horizontal ? 'x' : 'y';
      out[key] ??= { min: r.min, max: r.max };
    }
    return out;
  }

  #axes(): Axis[] {
    const a = this.attrs,
      mode = a.mode ?? 'xy';
    const axes = a.axes ? a.axes.map((ref) => resolveRef<Axis>(ref, this, Axis)) : this.requireParent().axes;
    return axes.filter((axis) => axis.ruler.fractionAt && (mode === 'xy' || (mode === 'x') === axis.ruler.horizontal));
  }

  /** The ranges a box from `from` to `to` covers. */
  #cover(from: { x: number; y: number }, to: { x: number; y: number }): BrushRange[] {
    const out: BrushRange[] = [];
    for (const axis of this.#axes()) {
      const ruler = axis.ruler;
      if (typeof ruler.fractionAt !== 'function') continue; // `#axes` keeps only rulers that have one
      const v0 = axis.denormalize(ruler.fractionAt(from.x, from.y)),
        v1 = axis.denormalize(ruler.fractionAt(to.x, to.y));
      if (v0 !== v0 || v1 !== v1) continue;
      out.push({ axis, min: Math.min(v0, v1), max: Math.max(v0, v1) });
    }
    return out;
  }

  #pointer(ev: Extract<ChartEvent, { type: typeof EVENT_POINTER }>): void {
    const a = this.attrs,
      always = (a.activate ?? 'always') === 'always';
    if ((ev.pointerType === 'touch' && !always) || ev.kind === 'wheel' || ev.kind === 'pinch') return;
    const plane = this.requireParent(),
      r = plane.rect,
      min = a.minSize ?? 4,
      mode = a.mode ?? 'xy';
    const clampX = (x: number) => Math.min(r.width, Math.max(0, x)),
      clampY = (y: number) => Math.min(r.height, Math.max(0, y));
    // A box a pixel or two across is a click; along an axis it does not cover its size does not count.
    const small = (from: { x: number; y: number }, to: { x: number; y: number }) =>
      (mode !== 'y' && Math.abs(to.x - from.x) < min) || (mode !== 'x' && Math.abs(to.y - from.y) < min);
    switch (ev.kind) {
      case 'down':
        if (ev.handled || ev.outside || !(ev.buttons & 1) || !plane.covers(ev.x, ev.y)) return;
        if (!always && !ev.shift) return;
        this.#from = this.#to = { x: ev.x, y: ev.y };
        this.chart?.platform?.setCursor?.('crosshair');
        ev.handled = true;
        return;
      case 'move': {
        if (!this.#from) return;
        if (!(ev.buttons & 1)) {
          this.#abandon();
          return;
        }
        this.#to = { x: clampX(ev.x), y: clampY(ev.y) };
        this.invalidate();
        if (a.live && !small(this.#from, this.#to)) a.onBrush?.(this.#describe(this.#cover(this.#from, this.#to)));
        ev.handled = true;
        return;
      }
      case 'up': {
        const from = this.#from;
        if (!from) return;
        const to = { x: clampX(ev.x), y: clampY(ev.y) };
        this.#abandon();
        if (small(from, to)) this.clear();
        else this.select(this.#cover(from, to));
        ev.handled = true;
        return;
      }
      case 'leave':
        return;
    }
  }

  #abandon(): void {
    this.#from = null;
    this.chart?.platform?.setCursor?.('');
    this.invalidate();
  }

  /** The rectangle in plot pixels for the box being dragged, else for what is brushed (which follows the axes). */
  #rect(): { x0: number; y0: number; x1: number; y1: number } | null {
    const r = this.requireParent().rect;
    if (this.#from)
      return {
        x0: Math.min(this.#from.x, this.#to.x),
        y0: Math.min(this.#from.y, this.#to.y),
        x1: Math.max(this.#from.x, this.#to.x),
        y1: Math.max(this.#from.y, this.#to.y),
      };
    if (!this.#ranges.length) return null;
    let x0 = 0,
      x1 = r.width,
      y0 = 0,
      y1 = r.height;
    for (const { axis, min, max } of this.#ranges) {
      const ruler = axis.ruler,
        p = ruler.at(axis.fractionOf(min)),
        q = ruler.at(axis.fractionOf(max));
      if (ruler.horizontal) {
        x0 = Math.min(p[0], q[0]);
        x1 = Math.max(p[0], q[0]);
      } else {
        y0 = Math.min(p[1], q[1]);
        y1 = Math.max(p[1], q[1]);
      }
    }
    return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(r.width, x1), y1: Math.min(r.height, y1) };
  }

  #paint(): void {
    const s = this.surface,
      box = this.#rect();
    // A range outside the plot clamps to nothing (or to a negative size); NaN fails these tests too.
    if (!box || !(box.x1 - box.x0 >= 0) || !(box.y1 - box.y0 >= 0)) {
      s.remove('brush');
      return;
    }
    const look = this.styleFor(['selection', 'shape']);
    const node = s.node('brush', 'rect', { above: true });
    s.set(node, 'x', f2(box.x0));
    s.set(node, 'y', f2(box.y0));
    s.set(node, 'width', f2(box.x1 - box.x0));
    s.set(node, 'height', f2(box.y1 - box.y0));
    s.set(node, 'fill', look.fill);
    s.set(node, 'stroke', look.stroke);
    s.set(node, 'stroke-width', look.strokeWidth);
    s.set(node, 'opacity', look.opacity);
    s.set(node, 'pointer-events', 'none');
  }
}

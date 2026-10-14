/**
 * Box zoom: drag a rectangle on the plot and the axes zoom to it.
 *
 *   new CartesianPlane({}, x, y, series, new BoxZoom(), new PanZoom())
 *
 * It is a plane child like `PanZoom`, and the two share the plane: by default (`activate: 'shift'`) the box is drawn with
 * Shift held and a plain drag still pans. With `activate: 'always'` every drag is a box, which suits a chart whose `PanZoom`
 * has `pan: false`. A box takes a press, so it has to come **before** `PanZoom` in the plane (as a `PointerListener` does).
 *
 * `mode` is which axes the box zooms: both, only the horizontal ones, only the vertical ones, or 'auto', which takes the one
 * direction the box is much longer in (a wide, flat box zooms x alone) and both otherwise. It sets the same view ranges
 * `PanZoom` does, so a pinch, a reset and `setViewRange(null)` all undo it. A box smaller than `minSize` pixels is not a box
 * and does nothing, which is how to take one back: drag it small again before letting go. It looks as `selection` says (a shape).
 *
 * A touch makes no box: two fingers pinch. A rim (polar or radar plane) cannot be boxed.
 */
import { type AttrTypesFor, AUTO, NUMBER } from './attrs.ts';
import { Axis } from './axis.ts';
import { type BaseAttributes, ChartElement, type ElementRef, fail, resolveRef } from './element.ts';
import { inputOf } from './input.ts';
import { type ChartEvent, EVENT_ATTACH, EVENT_PAINT, EVENT_POINTER } from './events.ts';
import { f2 } from './geometry.ts';
import type { Plane } from './plane.ts';

export interface BoxZoomAttributes extends BaseAttributes {
  /** The axes it may zoom, as elements or ids. Default: all of the plane's that can be followed along (not the rim of a polar plane). */
  axes?: readonly ElementRef<Axis>[];
  /** When a drag makes a box: with Shift held (the default), so a plain drag can pan, or always. */
  activate?: 'shift' | 'always';
  /** Which axes the box zooms. Default 'xy'. */
  mode?: 'xy' | 'x' | 'y' | 'auto';
  /** Smallest side of a box, in pixels, along an axis it zooms; below that the box does nothing. Default 8. */
  minSize?: number;
  /** Called after a zoom, with the box in plot pixels. */
  onZoom?: (box: { x: number; y: number; width: number; height: number }) => void;
}

export class BoxZoom extends ChartElement<Plane, [], BoxZoomAttributes> {
  static override takesInput = inputOf;
  static override attrTypes = { ...ChartElement.attrTypes, minSize: NUMBER, onZoom: AUTO } satisfies AttrTypesFor<BoxZoomAttributes>;
  #from: { x: number; y: number } | null = null;
  #to = { x: 0, y: 0 };

  /** True while a box is being drawn. */
  get selecting(): boolean {
    return this.#from !== null;
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH: {
        const plane = this.requireParent();
        for (const sibling of plane) {
          if (sibling === this) break;
          if (sibling.claimsPress) fail('add a BoxZoom before PanZoom in a plane: the box has to see a press first to take it');
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

  #pointer(ev: Extract<ChartEvent, { type: typeof EVENT_POINTER }>): void {
    if (ev.pointerType === 'touch' || ev.kind === 'wheel' || ev.kind === 'pinch') return;
    const plane = this.requireParent(),
      a = this.attrs,
      r = plane.rect;
    const clampX = (x: number) => Math.min(r.width, Math.max(0, x)),
      clampY = (y: number) => Math.min(r.height, Math.max(0, y));
    switch (ev.kind) {
      case 'down':
        if (ev.handled || ev.outside || !(ev.buttons & 1) || !plane.covers(ev.x, ev.y)) return;
        if ((a.activate ?? 'shift') === 'shift' && !ev.shift) return;
        this.#from = this.#to = { x: ev.x, y: ev.y };
        this.chart?.platform?.setCursor?.('crosshair');
        this.invalidate();
        ev.handled = true;
        return;
      case 'move':
        if (!this.#from) return;
        if (!(ev.buttons & 1)) {
          this.#cancel();
          return;
        }
        this.#to = { x: clampX(ev.x), y: clampY(ev.y) };
        this.invalidate();
        ev.handled = true;
        return;
      case 'up': {
        const from = this.#from;
        if (!from) return;
        const to = { x: clampX(ev.x), y: clampY(ev.y) };
        this.#cancel();
        this.#zoom(from, to);
        ev.handled = true;
        return;
      }
      case 'leave':
        return;
    }
  }

  #cancel(): void {
    this.#from = null;
    this.chart?.platform?.setCursor?.('');
    this.invalidate();
  }

  /** The axes this may zoom. */
  #axes(): Axis[] {
    const a = this.attrs;
    const axes = a.axes ? a.axes.map((ref) => resolveRef<Axis>(ref, this, Axis)) : [...this.requireParent().axes];
    return axes.filter((axis) => typeof axis.ruler.fractionAt === 'function');
  }

  #zoom(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const w = Math.abs(to.x - from.x),
      h = Math.abs(to.y - from.y),
      min = this.attrs.minSize ?? 8,
      mode = this.attrs.mode ?? 'xy';
    // 'auto': a box much longer one way than the other is a zoom along that way only.
    const only = mode === 'auto' ? (w > 3 * h ? 'x' : h > 3 * w ? 'y' : 'xy') : mode;
    const alongX = only !== 'y',
      alongY = only !== 'x';
    if ((alongX && w < min) || (alongY && h < min)) return;
    for (const axis of this.#axes()) {
      const ruler = axis.ruler;
      if (typeof ruler.fractionAt !== 'function' || (ruler.horizontal ? !alongX : !alongY)) continue; // `#axes` keeps only rulers that have one
      const v0 = axis.denormalize(ruler.fractionAt(from.x, from.y)),
        v1 = axis.denormalize(ruler.fractionAt(to.x, to.y));
      if (v0 !== v0 || v1 !== v1 || v0 === v1) continue;
      axis.setViewRange({ min: Math.min(v0, v1), max: Math.max(v0, v1) });
    }
    this.attrs.onZoom?.({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: w, height: h });
  }

  #paint(): void {
    const s = this.surface,
      from = this.#from;
    if (!from) {
      s.remove('box');
      return;
    }
    const look = this.styleFor(['selection', 'shape']),
      to = this.#to;
    const node = s.node('box', 'rect', { above: true });
    s.set(node, 'x', f2(Math.min(from.x, to.x)));
    s.set(node, 'y', f2(Math.min(from.y, to.y)));
    s.set(node, 'width', f2(Math.abs(to.x - from.x)));
    s.set(node, 'height', f2(Math.abs(to.y - from.y)));
    s.set(node, 'fill', look.fill);
    s.set(node, 'stroke', look.stroke);
    s.set(node, 'stroke-width', look.strokeWidth);
    s.set(node, 'opacity', look.opacity);
    s.set(node, 'pointer-events', 'none');
  }
}

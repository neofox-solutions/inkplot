/**
 * Annotations: marks that sit in a plane and are positioned in *data* space.
 *
 * Why data space: an annotation says "the target is 40" or "this point is interesting", not "pixel 212". So both kinds
 * here take values on the plane's axes and ask the plane where they are: the axes turn values into fractions, and the
 * plane's `place` turns fractions into pixels, exactly as for a series. Nothing here knows what shape the plane is, so a
 * line at a constant value is a horizontal line on a rectangle, a circle on a polar plane, and a polygon on a radar.
 *
 * Both are children of the plane, drawn after the series (so over them) and redrawn every flush, which is what keeps them
 * on their data while the view pans and zooms.
 */
/* oxlint-disable typescript/no-non-null-assertion -- flat [x, y] buffers walked in steps of two; every index is bounded by the buffer length */
import { type AttrTypesFor, STRING, NUMBER } from './attrs.ts';
import { Axis } from './axis.ts';
import { type AnyElement, type BaseAttributes, ChartElement, type ElementRef, fail, resolveRef } from './element.ts';
import { type ChartEvent, EVENT_ATTACH, EVENT_PAINT } from './events.ts';
import { type Rect, f2 } from './geometry.ts';
import type { Plane } from './plane.ts';
import { type CalloutLook, DIRECTIONS, boxTrouble, calloutSize, clearCallout, paintCallout } from './callout.ts';
import { applyText } from './text.ts';

/** Space between a line and its label, in pixels. */
const LABEL_GAP = 4;

/** Where a pair of axes comes from: named by the annotation, or the plane's own first and second. */
function axesOf(
  element: AnyElement,
  plane: Plane,
  domainAxis: ElementRef<Axis> | undefined,
  valueAxis: ElementRef<Axis> | undefined,
): [Axis, Axis] {
  return [
    resolveRef<Axis>(domainAxis, element, Axis) ?? plane.defaultAxis('first') ?? fail(102),
    resolveRef<Axis>(valueAxis, element, Axis) ?? plane.defaultAxis('second') ?? fail(101),
  ];
}

// ─── Lines ───

export interface LineAnnotationCommon extends BaseAttributes {
  /** Default: the plane's first axis, as for a series. */
  domainAxis?: ElementRef<Axis>;
  /** Default: the plane's second axis. */
  valueAxis?: ElementRef<Axis>;
  /** Text beside the line. Where along the line it sits is the style property `align` of `annotationLabel`. */
  label?: string;
  /** Line colour: the same as `style: { annotationLine: { color } }`, set directly. */
  stroke?: string;
  /** Line width in pixels: the same as `style: { annotationLine: { width } }`, set directly. */
  strokeWidth?: number;
  /** A horizontal line at this value (give one of `value` or `domain`). */
  value?: number;
  /** A vertical line at this domain (give one of `value` or `domain`). */
  domain?: number;
}
/**
 * Which line: give one of
 *  - `value`: constant value across the whole domain (horizontal on a rectangle, a circle on a polar plane);
 *  - `domain`: constant domain across the whole value range (vertical on a rectangle, a spoke on a radial plane).
 *
 * A line between two points in data space (a trend, a diagonal) is a series with two points, which interpolates as its curve says:
 * see the recipe "A straight line between two points".
 */
export type LineAnnotationAttributes = LineAnnotationCommon &
  ({ value: number; domain?: undefined } | { domain: number; value?: undefined });

/**
 * A reference line in data space: a target or a threshold. It runs along one axis at a fixed place on the other, so the plane
 * draws it in its own terms (`alignedPath`): straight on a rectangle, a circle or a spoke on a polar plane, a polygon on a
 * radar. The line is clipped to the plot; its label is not.
 */
export class LineAnnotation extends ChartElement<Plane, [], LineAnnotationAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    domainAxis: STRING,
    label: STRING,
    stroke: STRING,
    strokeWidth: NUMBER,
    valueAxis: STRING,
  } satisfies AttrTypesFor<LineAnnotationAttributes>;
  #label = false;

  /** The line in the plane's terms: its fraction along the other axis, and whether it runs along the first axis. Null where it has none. */
  private locate(first: Axis, second: Axis): { fixed: number; alongFirst: boolean } | null {
    const a = this.attrs;
    if (a.value !== undefined) {
      const f = second.fractionOf(a.value);
      return Number.isFinite(f) ? { fixed: f, alongFirst: true } : null;
    }
    if (a.domain !== undefined) {
      const f = first.fractionOf(a.domain);
      return Number.isFinite(f) ? { fixed: f, alongFirst: false } : null;
    }
    return null; // the attribute type allows nothing else; a hand-built JSON spec with none of them draws nothing
  }

  /** The point a fraction of the way along the line (in the plane's terms) in plot pixels, and the direction it is heading there. */
  private labelSpot(
    plane: Plane,
    first: Axis,
    second: Axis,
    at: { fixed: number; alongFirst: boolean },
    fraction: number,
  ): { x: number; y: number; tx: number; ty: number } | null {
    const E = 0.01;
    const lo = Math.max(0, fraction - E),
      hi = Math.min(1, fraction + E);
    const buf = new Float64Array(6);
    [lo, fraction, hi].forEach((t, i) => {
      buf[2 * i] = at.alongFirst ? t : at.fixed;
      buf[2 * i + 1] = at.alongFirst ? at.fixed : t;
    });
    plane.place({ data: buf, stride: 2, count: 3 }, first, second);
    const dx = buf[4]! - buf[0]!,
      dy = buf[5]! - buf[1]!,
      len = Math.hypot(dx, dy);
    if (!(len > 0) || !Number.isFinite(buf[2]!) || !Number.isFinite(buf[3]!)) return null;
    return { x: buf[2]!, y: buf[3]!, tx: dx / len, ty: dy / len };
  }

  override onEvent(ev: ChartEvent): void {
    if (ev.type !== EVENT_PAINT) return;
    const plane = this.requireParent(),
      s = this.surface,
      a = this.attrs;
    const [first, second] = axesOf(this, plane, a.domainAxis, a.valueAxis);
    const at = this.locate(first, second);
    const look = this.styleFor(['annotationLine', 'line'], { color: a.stroke, width: a.strokeWidth });
    const d = at
      ? plane.alignedPath(new Float64Array(at.alongFirst ? [0, at.fixed, 1, at.fixed] : [at.fixed, 0, at.fixed, 1]), 2, first, second)
      : '';
    const line = s.node('line', 'path');
    s.set(line, 'd', d);
    s.set(line, 'fill', 'none');
    s.set(line, 'stroke', look.color);
    s.set(line, 'stroke-width', look.width);
    s.set(line, 'stroke-dasharray', look.dash);
    s.set(line, 'opacity', look.opacity);
    s.set(line, 'clip-path', plane.clipUrl ?? 'none');

    if (!a.label || !at) {
      if (this.#label) {
        s.remove('label');
        this.#label = false;
      }
      return;
    }
    const text = this.styleFor(['annotationLabel', 'annotationLine', 'text'], { color: a.stroke });
    const spot = this.labelSpot(plane, first, second, at, text.align === 'start' ? 0 : text.align === 'middle' ? 0.5 : 1);
    if (!spot) return;
    // The label sits on the side of the line that faces up (or, for a vertical line, right), which on a circle is outwards.
    let nx = spot.ty,
      ny = -spot.tx;
    if (ny > 1e-6 || (Math.abs(ny) <= 1e-6 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const n = s.node('label', 'text');
    this.#label = true;
    applyText(s, n, text, Math.abs(nx) > 0.5 ? (nx > 0 ? 'start' : 'end') : text.align);
    s.set(n, 'x', f2(spot.x + nx * LABEL_GAP));
    s.set(n, 'y', f2(spot.y + ny * LABEL_GAP + (ny > 0.3 ? text.size * 0.8 : ny < -0.3 ? 0 : text.size * 0.35)));
    s.text(n, a.label);
  }
}

// ─── Callouts ───

export interface CalloutAnnotationAttributes extends BaseAttributes {
  /** Default: the plane's first axis. */
  domainAxis?: ElementRef<Axis>;
  /** Default: the plane's second axis. */
  valueAxis?: ElementRef<Axis>;
  /** The point being called out, in data space. */
  domain: number;
  /** The value of the point being called out. */
  value: number;
  /** What it says. A '\n' starts another line; `align` (style) says how the lines sit in the box. */
  text: string;
  /**
   * Where the middle of the box is, in pixels from the point. Leave both out to have it placed automatically, in the
   * emptiest nearby spot; give either (the other is 0) to place it yourself.
   */
  dx?: number;
  /** Pixels down from the point to the text box (negative is up). */
  dy?: number;
}

/**
 * A note attached to a data point by an arm. Its look is four selectors (the text, the box, the arm and the callout's
 * own metrics), and `outline` (in `callout`) chooses between a full border, only the edge the arm meets, or none.
 *
 * Placement: with no offset given, the box is tried in the eight directions round the point and the spot with the least
 * trouble wins: parts of the box outside the plot, series points under it, and earlier callouts it would cover, with a
 * slight preference for the upper right. It is a heuristic, which is why `dx` and `dy` exist.
 */
export class CalloutAnnotation extends ChartElement<Plane, [], CalloutAnnotationAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    domainAxis: STRING,
    text: STRING,
    valueAxis: STRING,
  } satisfies AttrTypesFor<CalloutAnnotationAttributes>;
  #box: Rect | null = null;
  #lines = 0;

  /** Where the box was drawn, in plot pixels; null while it is not (point out of view). Later callouts keep clear of it. */
  get box(): Readonly<Rect> | null {
    return this.#box;
  }

  /** The data point in plot pixels, or null when it is off the plot. */
  private locate(plane: Plane, first: Axis, second: Axis): [number, number] | null {
    const a = this.attrs,
      buf = new Float64Array([a.domain, a.value]);
    first.normalize(buf, 1, 2, 0);
    second.normalize(buf, 1, 2, 1);
    plane.place({ data: buf, stride: 2, count: 1 }, first, second);
    const [x, y] = [buf[0]!, buf[1]!],
      r = plane.rect;
    return x >= 0 && x <= r.width && y >= 0 && y <= r.height ? [x, y] : null;
  }

  /** How bad a box is as a place for a callout: lower is better. Earlier callouts in the plane count as taken. */
  private trouble(plane: Plane, box: Rect, order: number): number {
    const taken: Rect[] = [];
    for (let c = plane.firstChild; c; c = c.nextSibling) {
      if (c === this) break;
      if (c instanceof CalloutAnnotation && c.box) taken.push(c.box);
    }
    return boxTrouble(plane, box, order, taken);
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper(); // carries the text style, which every line inherits
        break;
      case EVENT_PAINT:
        this.paint();
        break;
    }
  }

  private paint(): void {
    const plane = this.requireParent(),
      s = this.surface,
      a = this.attrs;
    const [first, second] = axesOf(this, plane, a.domainAxis, a.valueAxis);
    const at = this.locate(plane, first, second);
    if (!at) {
      // Off the plot (panned away): draw nothing, and take up no room.
      clearCallout(s, this.#lines);
      this.#lines = 0;
      this.#box = null;
      return;
    }
    const [px, py] = at;
    const look: CalloutLook = {
      metrics: this.styleFor(['callout']),
      text: this.styleFor(['calloutText', 'text']),
      box: this.styleFor(['calloutBox', 'shape']),
      arm: this.styleFor(['calloutArm', 'line']),
    };
    const { metrics } = look,
      { width: w, height: h } = calloutSize(this.requireChart().measureText, a.text, look);
    const place = (cx: number, cy: number): Rect => ({ x: cx - w / 2, y: cy - h / 2, width: w, height: h });

    let box: Rect;
    if (a.dx !== undefined || a.dy !== undefined) {
      box = place(px + (a.dx ?? 0), py + (a.dy ?? 0));
    } else {
      let best = Infinity;
      box = place(px, py);
      DIRECTIONS.forEach(([ux, uy], i) => {
        const candidate = place(px + ux * (w / 2 + metrics.offset), py + uy * (h / 2 + metrics.offset));
        const score = this.trouble(plane, candidate, i);
        if (score < best) {
          best = score;
          box = candidate;
        }
      });
    }
    this.#box = box;
    this.#lines = paintCallout(s, a.text, box, [px, py], look, this.#lines);
  }
}

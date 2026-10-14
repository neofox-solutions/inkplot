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
import { type CalloutLook, calloutSize, clearCallout, paintCallout } from './callout.ts';
import { applyText } from './text.ts';

/** Points used to trace a line that has to bend with the plane (a circle, a diagonal on a log axis), per sweep. */
const CURVE_STEPS = 96;
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
    resolveRef<Axis>(domainAxis, element, Axis) ?? plane.defaultAxis('first') ?? fail('plane has no axis for the domain'),
    resolveRef<Axis>(valueAxis, element, Axis) ?? plane.defaultAxis('second') ?? fail('plane has no axis for the value'),
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
  /** A horizontal line at this value (give one of `value`, `domain`, or `from` and `to`). */
  value?: number;
  /** A vertical line at this domain (give one of `value`, `domain`, or `from` and `to`). */
  domain?: number;
  /** One end of a diagonal line, as `[domain, value]` (with `to`). */
  from?: readonly [domain: number, value: number];
  /** The other end of a diagonal line, as `[domain, value]` (with `from`). */
  to?: readonly [domain: number, value: number];
}
/**
 * Which line: give one of
 *  - `value`: constant value across the whole domain (horizontal on a rectangle);
 *  - `domain`: constant domain across the whole value range (vertical on a rectangle, a spoke on a radial plane);
 *  - `from` and `to`: straight between two `[domain, value]` points in data space (diagonal).
 */
export type LineAnnotationAttributes = LineAnnotationCommon &
  (
    | { value: number; domain?: undefined; from?: undefined; to?: undefined }
    | { domain: number; value?: undefined; from?: undefined; to?: undefined }
    | {
        from: readonly [domain: number, value: number];
        to: readonly [domain: number, value: number];
        value?: undefined;
        domain?: undefined;
      }
  );

/**
 * A reference line in data space: a target, a threshold, a trend. It is traced as a polyline through the plane, with as
 * few points as the plane allows: two when the line stays straight (anything axis-aligned on a rectangle, a diagonal
 * between linear scales), enough to follow the curve otherwise, and for a radar just the corners, at its spokes. The line is clipped to the plot; its label is not.
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

  /** The line as placed points in plot pixels, `[x, y]` per row, in order along the line; NaN where there is none. */
  private trace(plane: Plane, first: Axis, second: Axis): Float64Array | null {
    const a = this.attrs;
    let fractions: number[], buf: Float64Array;
    if (a.value !== undefined) {
      // Constant value: run along the first axis. Where the plane bends, sample it, and put a point on every corner.
      const f = second.fractionOf(a.value);
      if (!Number.isFinite(f)) return null;
      fractions = plane.curved ? along(first, plane) : [0, 1];
      buf = new Float64Array(fractions.length * 2);
      fractions.forEach((t, i) => {
        buf[2 * i] = t;
        buf[2 * i + 1] = f;
      });
    } else if (a.domain !== undefined) {
      const f = first.fractionOf(a.domain);
      if (!Number.isFinite(f)) return null;
      buf = new Float64Array([f, 0, f, 1]);
    } else if (a.from && a.to) {
      // Straight in data space, so interpolate there; it only stays straight on the page if nothing bends it.
      const [d0, v0] = a.from,
        [d1, v1] = a.to;
      const n = plane.curved || !first.scale.isLinear || !second.scale.isLinear ? CURVE_STEPS + 1 : 2;
      buf = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        buf[2 * i] = d0 + t * (d1 - d0);
        buf[2 * i + 1] = v0 + t * (v1 - v0);
      }
      first.normalize(buf, n, 2, 0);
      second.normalize(buf, n, 2, 1);
    } else {
      return null; // the attribute type allows nothing else; a hand-built JSON spec with none of them draws nothing
    }
    plane.place({ data: buf, stride: 2, count: buf.length / 2 }, first, second);
    return buf;
  }

  override onEvent(ev: ChartEvent): void {
    if (ev.type !== EVENT_PAINT) return;
    const plane = this.requireParent(),
      s = this.surface,
      a = this.attrs;
    const [first, second] = axesOf(this, plane, a.domainAxis, a.valueAxis);
    const pts = this.trace(plane, first, second);
    const look = this.styleFor(['annotationLine', 'line'], { color: a.stroke, width: a.strokeWidth });
    let d = '',
      pen = false;
    if (pts)
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i]!,
          y = pts[i + 1]!;
        if (!(Number.isFinite(x) && Number.isFinite(y))) {
          pen = false;
          continue;
        }
        d += (pen ? 'L' : 'M') + f2(x) + ' ' + f2(y);
        pen = true;
      }
    const line = s.node('line', 'path');
    s.set(line, 'd', d);
    s.set(line, 'fill', 'none');
    s.set(line, 'stroke', look.color);
    s.set(line, 'stroke-width', look.width);
    s.set(line, 'stroke-dasharray', look.dash);
    s.set(line, 'opacity', look.opacity);
    s.set(line, 'clip-path', plane.clipUrl ?? 'none');

    if (!a.label || !pts) {
      if (this.#label) {
        s.remove('label');
        this.#label = false;
      }
      return;
    }
    const text = this.styleFor(['annotationLabel', 'annotationLine', 'text'], { color: a.stroke });
    const at = pointAlong(pts, text.align === 'start' ? 0 : text.align === 'middle' ? 0.5 : 1);
    if (!at) return;
    // The label sits on the side of the line that faces up (or, for a vertical line, right), which on a circle is outwards.
    let nx = at.ty,
      ny = -at.tx;
    if (ny > 1e-6 || (Math.abs(ny) <= 1e-6 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const n = s.node('label', 'text');
    this.#label = true;
    applyText(s, n, text, Math.abs(nx) > 0.5 ? (nx > 0 ? 'start' : 'end') : text.align);
    s.set(n, 'x', f2(at.x + nx * LABEL_GAP));
    s.set(n, 'y', f2(at.y + ny * LABEL_GAP + (ny > 0.3 ? text.size * 0.8 : ny < -0.3 ? 0 : text.size * 0.35)));
    s.text(n, a.label);
  }
}

/**
 * Fractions along an axis to trace a line that runs along it at. A plane that says where it bends (a radar) is straight
 * between those places, so they are all that is needed and the line is exact; any other curved plane is sampled evenly.
 */
function along(axis: Axis, plane: Plane): number[] {
  const out = new Set<number>([0, 1]);
  const corners = plane.breaks(axis);
  if (corners.length > 0)
    for (const b of corners) {
      if (b >= 0 && b <= 1) out.add(Math.round(b * 1e9) / 1e9);
    }
  else for (let i = 1; i < CURVE_STEPS; i++) out.add(i / CURVE_STEPS);
  return [...out].sort((p, q) => p - q);
}

/** The point a fraction of the way along a polyline's length, and the direction it is heading there. Null without two real points. */
function pointAlong(pts: Float64Array, fraction: number): { x: number; y: number; tx: number; ty: number } | null {
  const n = pts.length / 2,
    real = (i: number) => Number.isFinite(pts[2 * i]!) && Number.isFinite(pts[2 * i + 1]!);
  let total = 0;
  for (let i = 1; i < n; i++)
    if (real(i) && real(i - 1)) total += Math.hypot(pts[2 * i]! - pts[2 * i - 2]!, pts[2 * i + 1]! - pts[2 * i - 1]!);
  if (!(total > 0)) return null;
  let target = fraction * total;
  for (let i = 1; i < n; i++) {
    if (!real(i) || !real(i - 1)) continue;
    const x0 = pts[2 * i - 2]!,
      y0 = pts[2 * i - 1]!,
      dx = pts[2 * i]! - x0,
      dy = pts[2 * i + 1]! - y0,
      len = Math.hypot(dx, dy);
    if (target <= len || i === n - 1) {
      const t = len > 0 ? Math.min(1, target / len) : 0;
      return { x: x0 + t * dx, y: y0 + t * dy, tx: len > 0 ? dx / len : 1, ty: len > 0 ? dy / len : 0 };
    }
    target -= len;
  }
  return null;
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

/** The eight places an automatically placed box may go, as the direction from the point, in order of preference. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [0, -1],
  [0, 1],
];
/** The most series points looked at when judging a spot: more are skipped evenly. */
const MAX_PROBES = 2000;

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

  /** How bad a box is as a place for a callout: lower is better. */
  private trouble(plane: Plane, box: Rect, order: number): number {
    const r = plane.rect;
    // Outside the plot: by how much of its area.
    const inX = Math.max(0, Math.min(box.x + box.width, r.width) - Math.max(box.x, 0));
    const inY = Math.max(0, Math.min(box.y + box.height, r.height) - Math.max(box.y, 0));
    let score = (1 - (inX * inY) / (box.width * box.height)) * 1000;
    // Series points under it.
    for (const s of plane.series) {
      const { data, count, stride } = s.points,
        step = Math.max(1, Math.ceil(count / MAX_PROBES));
      for (let i = 0; i < count; i += step) {
        const x = data[i * stride]!,
          y = data[i * stride + 1]!;
        if (x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y - 2 && y <= box.y + box.height + 2) score += step;
      }
    }
    // Earlier callouts: much worse than a point.
    for (const c of plane) {
      if (c === this) break;
      const o = c instanceof CalloutAnnotation ? c.box : null;
      if (o && box.x < o.x + o.width && box.x + box.width > o.x && box.y < o.y + o.height && box.y + box.height > o.y) score += 500;
    }
    return score + order * 0.01;
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

/**
 * Bars: from a baseline to a value, one for each point of a series.
 *
 * A bar is drawn in the plane's own terms, never in pixels: its four corners are placed through the axes and the plane
 * like any other point, so the same code gives upright bars on a rectangle, horizontal ones when the domain is on the
 * vertical axis, and wedges on a polar plane (where the two edges along the angle are subdivided into arcs, since a
 * straight line between the corners would cut across: the domain's when the domain is the angle, the value's when the value is,
 * as in a ring or pie).
 *
 * Two renderers share all of that, through `BarRenderer`: `BarPath` fills each bar, and `BarLinePath` draws only its
 * stem, a line from the foot to the value (a spike plot; add a marker to the series for a lollipop). A stem has no
 * width, so the width rule matters only to series that share a band.
 *
 * Where a bar starts is the series' `baseline`, or, in a `Stack`, the row's own start (the layer below it). Its width:
 *  - on a band axis, the band's `bandwidth`, which the scale's `gap` sets;
 *  - otherwise `width` (default 0.8) of the smallest gap between neighbouring points, since that is what the bars would
 *    have to share. With one point and no band there is nothing to measure and the bar takes a fifth of the axis.
 * Series that stack side by side divide that width between them, in the order the stack lists them.
 *
 * The geometry is a free function over `Series.drawn` that hands back polygons, which is also what a pointer hit on a
 * bar is measured against, so what is clicked is exactly what is drawn.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { f2 } from './geometry.ts';
import type { HitMode } from './hit.ts';
import type { PlatformNode } from './platform.ts';
import { type AnchorSet, type PolygonSet, SeriesRenderer, type SeriesRendererAttributes, paintBox } from './renderer.ts';
import type { Series } from './series.ts';
import { notImplemented } from './stub.ts';
import type { Surface } from './surface.ts';

/** How far outside the axes' range a bar may reach before it is cut short: only to keep the numbers sane, the clip does the rest. */
const REACH = 2;
/** Most pieces the edge of a bar on a curved plane is cut into. */
const MAX_ARC = 16;
/** The same, along the value, when the value is the angle: a segment may span a whole turn. */
const MAX_VALUE_ARC = 48;

export interface BarOptions {
  /** Fraction of the room each bar fills. Default: a band's own `bandwidth`, else 0.8. */
  width?: number;
  /** The value bars grow from when there is no stack to say. Default 0. */
  baseline?: number;
}

/** Everything about a series' bars that does not depend on how they are drawn, in fractions of the axes. */
export interface BarLayout {
  readonly n: number;
  /** Centre along the domain, start and end along the value, for each bar: three numbers a row. */
  readonly norm: Float64Array;
  /** The width of one bar's slot along the domain, and how far this series' slot is from the centre. */
  readonly slot: number;
  readonly shift: number;
}

export function layoutBars(series: Series, options: BarOptions): BarLayout | null {
  const d = series.drawn;
  if (!d) return null;
  const n = d.points.count,
    rs = d.stride,
    raw = d.raw,
    first = series.firstAxis,
    second = series.secondAxis;
  const baseline = options.baseline ?? 0;
  const norm = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = raw[i * rs + d.secondColumn]!,
      ok = Number.isFinite(v);
    norm[3 * i] = raw[i * rs + d.firstColumn]!;
    norm[3 * i + 1] = ok ? (d.base ? d.base[i]! : baseline) : NaN;
    norm[3 * i + 2] = ok ? (d.top ? d.top[i]! : v) : NaN;
  }
  first.normalize(norm, n, 3, 0);
  second.normalize(norm, n, 3, 1);
  second.normalize(norm, n, 3, 2);

  // The room one bar (or one group of them) has along the domain.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a scale is read for the optional `bandwidth` and `gap` that only a band scale has
  const scale = first.scale as unknown as { bandwidth?: number; attrs?: { gap?: number } };
  let room = 0;
  if (typeof scale.bandwidth === 'number' && options.width === undefined) {
    room = scale.bandwidth;
  } else {
    let pitch = Infinity,
      prev = NaN;
    for (let i = 0; i < n; i++) {
      const x = norm[3 * i]!;
      if (!Number.isFinite(x)) continue;
      if (prev === prev && x > prev && x - prev < pitch) pitch = x - prev;
      prev = x;
    }
    if (typeof scale.bandwidth === 'number') pitch = scale.bandwidth / (1 - (scale.attrs?.gap ?? 0.2));
    room = (options.width ?? 0.8) * (pitch < Infinity ? pitch : 0.25);
  }
  const { index, count } = d.slot,
    slot = room / count;
  return { n, norm, slot, shift: (index - (count - 1) / 2) * slot };
}

/**
 * How far along the domain (as a fraction of the axis) a series' own bars sit from the point's place, when it shares a band
 * with others (`Stack` in 'group' mode). What goes on the bars (error bars) uses it to stay on them. 0 for a series alone.
 */
export function barShift(series: Series, options: BarOptions = {}): number {
  const d = series.drawn;
  return d && d.slot.count > 1 ? (layoutBars(series, options)?.shift ?? 0) : 0;
}

const clamp = (v: number) => (v < -REACH ? -REACH : v > 1 + REACH ? 1 + REACH : v);
/** The three stems drawn in a bar series' legend sample: position across, height up. */
const STEM_SAMPLE: readonly (readonly [at: number, up: number])[] = [
  [0.2, 0.6],
  [0.5, 1],
  [0.8, 0.4],
];

/**
 * The outline of every bar of a series in plot pixels, `perShape` points each, in the order of the series' points
 * (a point that is a gap leaves a shape of NaN). Null before the first projection.
 */
export function barShapes(series: Series, options: BarOptions = {}): PolygonSet | null {
  const lay = layoutBars(series, options),
    plane = series.drawn?.plane;
  if (!lay || !plane) return null;
  const { n, norm, slot, shift } = lay;
  // On a curved plane the edges that run along the angle become arcs: the ones along the domain normally, the ones along
  // the value when the value is the angle (a ring or pie: each bar is a segment of a ring).
  const roundValue = plane.curved && series.secondAxis.orientation === 'angle';
  const steps = roundValue ? MAX_VALUE_ARC : plane.curved ? Math.min(MAX_ARC, Math.max(2, Math.ceil(slot * 64))) : 1,
    per = 2 * (steps + 1);
  const out = new Float64Array(n * per * 2);
  for (let i = 0; i < n; i++) {
    const x = norm[3 * i]! + shift,
      from = norm[3 * i + 1]!,
      to = norm[3 * i + 2]!;
    const bad = !Number.isFinite(x) || !Number.isFinite(from) || !Number.isFinite(to);
    const x0 = x - slot / 2,
      b = bad ? NaN : clamp(from),
      t = bad ? NaN : clamp(to);
    let k = i * per * 2;
    // Along the start edge one way, then back along the end edge: a closed outline.
    if (roundValue) {
      for (let j = 0; j <= steps; j++) {
        out[k++] = x0;
        out[k++] = b + ((t - b) * j) / steps;
      }
      for (let j = steps; j >= 0; j--) {
        out[k++] = x0 + slot;
        out[k++] = b + ((t - b) * j) / steps;
      }
      continue;
    }
    for (let j = 0; j <= steps; j++) {
      out[k++] = x0 + (slot * j) / steps;
      out[k++] = b;
    }
    for (let j = steps; j >= 0; j--) {
      out[k++] = x0 + (slot * j) / steps;
      out[k++] = t;
    }
  }
  plane.place({ data: out, stride: 2, count: n * per }, series.firstAxis, series.secondAxis);
  return { data: out, perShape: per, count: n };
}

/**
 * The stem of every bar: a line from its foot to its value, two points each, as a `PolygonSet` of two-point shapes (so a
 * hit measures the distance to the line). Straight on every plane, since a line along the value is a straight line (a
 * spoke) on a polar one. Gaps leave NaN.
 */
export function stemLines(series: Series, options: BarOptions = {}): PolygonSet | null {
  const lay = layoutBars(series, options),
    plane = series.drawn?.plane;
  if (!lay || !plane) return null;
  const { n, norm, shift } = lay;
  const out = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = norm[3 * i]! + shift,
      from = norm[3 * i + 1]!,
      to = norm[3 * i + 2]!;
    const bad = !Number.isFinite(x) || !Number.isFinite(from) || !Number.isFinite(to);
    out[4 * i] = out[4 * i + 2] = bad ? NaN : x;
    out[4 * i + 1] = bad ? NaN : clamp(from);
    out[4 * i + 3] = bad ? NaN : clamp(to);
  }
  plane.place({ data: out, stride: 2, count: n * 2 }, series.firstAxis, series.secondAxis);
  return { data: out, perShape: 2, count: n };
}

export interface BarRendererAttributes extends SeriesRendererAttributes, BarOptions {}

/**
 * What every bar renderer shares: where bars start and how wide they are (`BarOptions`), that the value axis has to reach
 * the baseline, and that a pointer hit is measured against the geometry it draws. A subclass says what that geometry is
 * (`outline`) and how to draw it.
 */
export abstract class BarRenderer<A extends BarRendererAttributes = BarRendererAttributes> extends SeriesRenderer<A> {
  protected abstract outline(): PolygonSet | null;
  override get includes(): readonly number[] {
    return [this.attrs.baseline ?? 0];
  }
  /** Half of a bar's room: its width, in the gaps between points (a band's own bars fit it already). */
  override get spans(): number {
    return (this.attrs.width ?? 0.8) / 2;
  }
  override get hitMode(): HitMode {
    return 'shape';
  }
  override shapes(): PolygonSet | null {
    return this.outline();
  }
  override anchors(): AnchorSet | null {
    const shapes = this.outline();
    return shapes ? barAnchors(shapes) : null;
  }
}

export interface BarPathAttributes extends BarRendererAttributes {}

/**
 * Anchors for the bars of `shapes` (see `barShapes`): each outline runs along the foot of a bar and back along its far end, so the
 * anchor is the middle of the far end and the direction leads from the middle of the foot to it. That is up for a bar above its
 * baseline and down for one below it, out along the radius for a polar bar, and out to the rim for a ring segment.
 */
export function barAnchors(shapes: PolygonSet): AnchorSet {
  const { data, perShape, count } = shapes,
    half = perShape / 2;
  const out = new Float64Array(count * 4);
  // The middle of one edge of `half` points, taken along the edge (an arc is cut where it is half way round, not at its mean).
  const middle = (k: number, from: number, into: number): void => {
    const at = (half - 1) / 2,
      lo = Math.floor(at),
      f = at - lo;
    const i0 = k + 2 * (from + lo),
      i1 = k + 2 * (from + Math.min(half - 1, lo + 1));
    out[into] = data[i0]! + (data[i1]! - data[i0]!) * f;
    out[into + 1] = data[i0 + 1]! + (data[i1 + 1]! - data[i0 + 1]!) * f;
  };
  const foot = new Float64Array(2);
  for (let i = 0; i < count; i++) {
    const k = i * perShape * 2,
      o = i * 4;
    if (!Number.isFinite(data[k]!)) {
      out.fill(NaN, o, o + 4);
      continue;
    }
    middle(k, 0, o); // the foot's middle, for now
    foot[0] = out[o]!;
    foot[1] = out[o + 1]!;
    middle(k, half, o);
    const dx = out[o]! - foot[0],
      dy = out[o + 1]! - foot[1],
      len = Math.hypot(dx, dy);
    // A bar of no length (a value at its baseline) leaves the label above it.
    out[o + 2] = len > 1e-9 ? dx / len : 0;
    out[o + 3] = len > 1e-9 ? dy / len : -1;
  }
  return { data: out, count };
}

/** One path holding every bar of the series: the cost of a bar chart is its path text, not a node for each bar. */
export class BarPath extends BarRenderer<BarPathAttributes> {
  private look() {
    const a = this.attrs;
    return this.styleFor(
      ['seriesBar', 'shape'],
      { fill: a.fill, stroke: a.stroke, strokeWidth: a.strokeWidth, opacity: a.opacity },
      { fill: this.requireParent().accentColor },
    );
  }
  override get swatch(): string {
    return this.look().fill;
  }
  protected outline(): PolygonSet | null {
    return barShapes(this.requireParent(), this.attrs);
  }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    paintBox(s, parent, key, width, height, this.look());
  }

  protected draw(): void {
    const counters = this.counters,
      s = this.surface,
      a = this.attrs;
    if (a.bind) notImplemented('BarPath bindings');
    const look = this.look();
    const t0 = performance.now();
    const shapes = this.outline();
    let d = '';
    if (shapes) {
      const { data, perShape, count } = shapes;
      for (let i = 0, k = 0; i < count; i++, k += perShape * 2) {
        const x = data[k]!,
          y = data[k + 1]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        d += 'M' + f2(x) + ' ' + f2(y) + 'L';
        for (let j = 1; j < perShape; j++) d += (j > 1 ? ' ' : '') + f2(data[k + 2 * j]!) + ' ' + f2(data[k + 2 * j + 1]!);
        d += 'Z';
      }
    }
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += d.length;
    const n = s.node('bars', 'path');
    s.set(n, 'd', d);
    s.set(n, 'fill', look.fill);
    s.set(n, 'stroke', look.stroke);
    s.set(n, 'stroke-width', look.strokeWidth);
    s.set(n, 'stroke-linejoin', 'round');
    s.set(n, 'opacity', look.opacity);
  }
}

export interface BarLinePathAttributes extends BarRendererAttributes {
  /** How the end of a stem is finished: 'butt' (flat, at the value), 'round' or 'square' (both reach half a width past). Default 'butt'. */
  cap?: 'butt' | 'round' | 'square';
}

/**
 * Bars as lines: each is a stem from the foot to the value, stroked rather than filled, in one path. The width is the
 * stroke's, so it stays the same however many bars there are, which is what makes it the answer for dense data where
 * filled bars would be slivers. The look is the line's (`seriesLine`), with the series' colour as its stroke; give the
 * series a marker as well for a lollipop.
 */
export class BarLinePath extends BarRenderer<BarLinePathAttributes> {
  private look() {
    const a = this.attrs;
    return this.styleFor(
      ['seriesLine', 'line'],
      { color: a.stroke, width: a.strokeWidth, opacity: a.opacity },
      { color: this.requireParent().accentColor },
    );
  }
  override get swatch(): string {
    return this.look().color;
  }
  protected outline(): PolygonSet | null {
    return stemLines(this.requireParent(), this.attrs);
  }
  /** Three stems of different heights, as wide as the stroke says. */
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const look = this.look(),
      n = s.node(key, 'path', { parent });
    let d = '';
    for (const [at, up] of STEM_SAMPLE) d += `M${f2(width * at)} ${f2(height)}V${f2(height * (1 - up))}`;
    s.set(n, 'd', d);
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', look.color);
    s.set(n, 'stroke-width', look.width);
    s.set(n, 'stroke-linecap', this.attrs.cap ?? 'butt');
    s.set(n, 'opacity', look.opacity);
    s.set(n, 'stroke-dasharray', look.dash);
  }

  protected draw(): void {
    const counters = this.counters,
      s = this.surface,
      a = this.attrs;
    if (a.bind) notImplemented('BarLinePath bindings');
    const look = this.look();
    const t0 = performance.now();
    const stems = this.outline();
    let d = '';
    if (stems) {
      const { data, count } = stems;
      for (let i = 0, k = 0; i < count; i++, k += 4) {
        const x = data[k]!,
          y = data[k + 1]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        d += 'M' + f2(x) + ' ' + f2(y) + 'L' + f2(data[k + 2]!) + ' ' + f2(data[k + 3]!);
      }
    }
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += d.length;
    const n = s.node('stems', 'path');
    s.set(n, 'd', d);
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', look.color);
    s.set(n, 'stroke-width', look.width);
    s.set(n, 'stroke-linecap', a.cap ?? 'butt');
    s.set(n, 'opacity', look.opacity);
    s.set(n, 'stroke-dasharray', look.dash);
  }
}

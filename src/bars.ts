/**
 * Bars: from a baseline to a value, one for each point of a series.
 *
 * A bar is drawn in the plane's own terms, never in pixels: its four corners are placed through the axes and the plane
 * like any other point, so the same code gives upright bars on a rectangle, horizontal ones when the domain is on the
 * vertical axis, and wedges on a polar plane (where the two edges along the angle are subdivided into arcs, since a
 * straight line between the corners would cut across: the domain's when the domain is the angle, the value's when the value is,
 * as in a ring or pie).
 *
 * Two renderers share all of that, through `BarRenderer`: `BarPath` fills each bar, and `StemPath` draws only its
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
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import { fractionsOf, lookKey, lookValues, resolveBindings, stepsFor } from './bucket.ts';
import { EVENT_ATTACH, type ChartEvent } from './events.ts';
import { f2 } from './geometry.ts';
import type { HitMode } from './hit.ts';
import type { PlatformNode } from './platform.ts';
import {
  type AnchorSet,
  type ShapeSet,
  SeriesRenderer,
  type ResolvedBinding,
  type SeriesRendererAttributes,
  type Spread,
  type StyleBindable,
  type SpreadView,
  paintBox,
} from './renderer.ts';
import type { Series } from './series.ts';
import type { Surface } from './surface.ts';

/** How far outside the axes' range a bar may reach before it is cut short: only to keep the numbers sane, the clip does the rest. */
const REACH = 2;

type Styled = readonly { b: ResolvedBinding; f: Float64Array }[];

export interface BarOptions {
  /** Fraction of the room each bar fills. Default: a band's own `bandwidth`, else 0.8. */
  width?: number;
  /** The value bars grow from when there is no stack to say. Default 0; on a log axis, which cannot place 0, the bars start at the edge of the axis. */
  baseline?: number;
  /**
   * The channel of the data that holds where each bar starts, for bars that float: a waterfall's steps, a candlestick's body
   * (the series' value is where it ends). A row with no number there is a gap. A stack's own starts win; the baseline is not used.
   */
  from?: string;
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

/**
 * What was worked out for a series since its last projection, by the options it was asked with (a renderer's, an error bar's, a
 * box plot's can differ). Nothing here depends on anything but the projection and the options, so a repaint (a pointer
 * moving, a legend hovered) and every reader of the same bars (the path, the hits, the labels, the error bars) share one result.
 */
interface BarCacheEntry {
  layout: BarLayout | null;
  shapes?: ShapeSet | null;
  stems?: ShapeSet | null;
}
const barCaches = new WeakMap<Series, { projection: number; byOptions: Map<string, BarCacheEntry> }>();
function entryFor(series: Series, options: BarOptions): BarCacheEntry {
  let c = barCaches.get(series);
  if (!c || c.projection !== series.projection) barCaches.set(series, (c = { projection: series.projection, byOptions: new Map() }));
  const key = `${options.width}|${options.baseline}|${options.from}`;
  let e = c.byOptions.get(key);
  if (!e) c.byOptions.set(key, (e = { layout: computeLayout(series, options) }));
  return e;
}

export function layoutBars(series: Series, options: BarOptions): BarLayout | null {
  return series.drawn ? entryFor(series, options).layout : null;
}

function computeLayout(series: Series, options: BarOptions): BarLayout | null {
  const d = series.drawn;
  if (!d) return null;
  const n = d.points.count,
    rs = d.stride,
    raw = d.raw,
    first = series.firstAxis,
    second = series.secondAxis;
  const baseline = options.baseline ?? 0;
  const fromColumn = options.from === undefined ? -1 : d.columnOf(options.from);
  const norm = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = raw[i * rs + d.secondColumn]!,
      ok = Number.isFinite(v);
    norm[3 * i] = raw[i * rs + d.firstColumn]!;
    norm[3 * i + 1] = ok ? (d.base ? d.base[i]! : fromColumn >= 0 ? raw[i * rs + fromColumn]! : baseline) : NaN;
    norm[3 * i + 2] = ok ? (d.top ? d.top[i]! : v) : NaN;
  }
  first.normalize(norm, n, 3, 0);
  second.normalize(norm, n, 3, 1);
  second.normalize(norm, n, 3, 2);
  // A baseline the value scale cannot place (0 on a log axis) is the start of the axis instead, so the bars are drawn.
  if (!d.base && fromColumn < 0 && !second.scale.canPlace(baseline))
    for (let i = 0; i < n; i++) if (!Number.isFinite(norm[3 * i + 1]!) && Number.isFinite(norm[3 * i + 2]!)) norm[3 * i + 1] = 0;

  // The room one bar (or one group of them) has along the domain.
  const slots = first.scale.slots;
  let room = 0;
  if (slots && options.width === undefined) {
    room = slots.width;
  } else {
    let pitch = Infinity,
      prev = NaN;
    for (let i = 0; i < n; i++) {
      const x = norm[3 * i]!;
      if (!Number.isFinite(x)) continue;
      if (prev === prev && x > prev && x - prev < pitch) pitch = x - prev;
      prev = x;
    }
    if (slots) pitch = slots.pitch;
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
 * Every bar of a series as a rectangle in the plane's own terms (see `ShapeSet`): its width along the domain, then its foot and its end along
 * the value, in the order of the series' points (a point that is a gap leaves a shape of NaN). Null before the first projection.
 */
export function barShapes(series: Series, options: BarOptions = {}): ShapeSet | null {
  if (!series.drawn) return null;
  const entry = entryFor(series, options);
  return entry.shapes !== undefined ? entry.shapes : (entry.shapes = computeShapes(entry.layout, false));
}
function computeShapes(lay: BarLayout | null, stem: boolean): ShapeSet | null {
  if (!lay) return null;
  const { n, norm, slot, shift } = lay;
  const out = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = norm[3 * i]! + shift,
      from = norm[3 * i + 1]!,
      to = norm[3 * i + 2]!;
    const bad = !Number.isFinite(x) || !Number.isFinite(from) || !Number.isFinite(to);
    out[4 * i] = bad ? NaN : stem ? x : x - slot / 2;
    out[4 * i + 1] = bad ? NaN : stem ? x : x + slot / 2;
    out[4 * i + 2] = bad ? NaN : clamp(from);
    out[4 * i + 3] = bad ? NaN : clamp(to);
  }
  return { data: out, count: n };
}

/**
 * The stem of every bar: a line from its foot to its value, as a `ShapeSet` of rectangles with no width (so a hit measures the distance to the
 * line). Gaps leave NaN.
 */
export function stemLines(series: Series, options: BarOptions = {}): ShapeSet | null {
  if (!series.drawn) return null;
  const entry = entryFor(series, options);
  return entry.stems !== undefined ? entry.stems : (entry.stems = computeShapes(entry.layout, true));
}

export interface BarRendererAttributes<Bindable extends object = StyleBindable> extends SeriesRendererAttributes<Bindable>, BarOptions {}

/**
 * What every bar renderer shares: where bars start and how wide they are (`BarOptions`), that the value axis has to reach
 * the baseline, and that a pointer hit is measured against the geometry it draws. A subclass says what that geometry is
 * (`outline`) and how to draw it.
 */
export abstract class BarRenderer<A extends BarRendererAttributes<object> = BarRendererAttributes> extends SeriesRenderer<A> {
  static override attrTypes = {
    ...SeriesRenderer.attrTypes,
    baseline: NUMBER,
    from: STRING,
    width: NUMBER,
  } satisfies Partial<AttrTypesFor<Omit<BarRendererAttributes, 'bind'>>>;
  protected abstract outline(): ShapeSet | null;
  override slotShift(): number {
    return barShift(this.requireParent(), this.attrs);
  }
  override slotKey(): string {
    return `${this.attrs.width}|${this.attrs.baseline}|${this.attrs.from}`;
  }
  override get includes(): readonly number[] {
    if (this.attrs.from !== undefined) return [];
    const baseline = this.attrs.baseline ?? 0;
    // A baseline the value axis cannot place is not asked of it: the bars start at the axis edge (see layoutBars).
    return this.parent?.secondAxis.scale.canPlace(baseline) === false ? [] : [baseline];
  }
  override get channelNames(): readonly string[] {
    return this.attrs.from === undefined ? [] : [this.attrs.from];
  }
  /** Floating bars start where their channel says, which the value axis has to reach as well as the ends. */
  override spread(view: SpreadView): Spread | null {
    const c = this.attrs.from === undefined ? -1 : view.channelColumn(this.attrs.from);
    if (c < 0) return null;
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < view.count; i++) {
      const v = view.raw[i * view.stride + c]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return min <= max ? { second: { min, max } } : null;
  }
  override limit(series: Series): Spread | null {
    const e = this.attrs.from === undefined ? null : series.data.channelExtent(this.attrs.from);
    return e ? { second: e } : null;
  }
  /** Half of a bar's room: its width, in the gaps between points (a band's own bars fit it already). */
  override get spans(): number {
    return (this.attrs.width ?? 0.8) / 2;
  }
  override get hitMode(): HitMode {
    return 'shape';
  }
  override shapes(): ShapeSet | null {
    return this.outline();
  }
  override anchors(): AnchorSet | null {
    const shapes = this.outline();
    return shapes ? barAnchors(this.requireParent(), shapes) : null;
  }
  /** The bound properties, with their dimensions (or functions) resolved. Every one varies per path. */
  override get bindings(): readonly ResolvedBinding[] {
    return resolveBindings(this.attrs.bind, this, () => false);
  }
  override get stepsPerBinding(): number {
    return stepsFor(this.bindings, this.attrs.maxNodes ?? 1000);
  }
  override onEvent(ev: ChartEvent): void {
    if (ev.type === EVENT_ATTACH) void this.stepsPerBinding; // throws now rather than at the first paint
    super.onEvent(ev);
  }

  // The nodes written by the last draw, so the ones a look no longer needs can be removed.
  #nodes = new Set<string>();
  /**
   * Draw `count` shapes (`path(i)` is the path data of the i-th, empty for a gap) as one node for each look the bindings give them:
   * with none, a single node called `name`. `write` sets a node's attributes from `v`, which starts as `base` and has the bound
   * values written over it. Returns the length of the path data, for the counters.
   */
  // The path text of the last draw by look, and what it was made from: while none of that changes (a repaint for a pointer moving) it is reused.
  #memo: {
    source: object;
    projection: number;
    bind: unknown;
    steps: number;
    paths: Map<number, string>;
    bytes: number;
    styled: Styled;
  } | null = null;
  protected paint(
    count: number,
    path: (i: number) => string,
    base: Record<string, string | number>,
    write: (node: PlatformNode, v: Record<string, string | number>) => void,
    name: string,
    source: object | null = null,
  ): number {
    const s = this.surface,
      series = this.requireParent(),
      d = series.drawn,
      steps = this.stepsPerBinding;
    const memo = this.#memo;
    let paths: Map<number, string>, bytes: number, styled: Styled;
    if (
      source &&
      memo &&
      memo.source === source &&
      memo.projection === series.projection &&
      memo.bind === this.attrs.bind &&
      memo.steps === steps
    ) {
      ({ paths, bytes, styled } = memo);
    } else {
      styled = d
        ? this.bindings.map((b) => ({
            b,
            f: fractionsOf(b, d.raw, d.columnOf(b.channel), d.stride, count),
          }))
        : [];
      paths = new Map<number, string>();
      bytes = 0;
      for (let i = 0; i < count; i++) {
        const p = path(i);
        if (!p) continue;
        bytes += p.length;
        const key = steps ? lookKey(styled, i, steps) : 0;
        paths.set(key, (paths.get(key) ?? '') + p);
      }
      this.#memo = source ? { source, projection: series.projection, bind: this.attrs.bind, steps, paths, bytes, styled } : null;
    }
    const names = new Set<string>();
    const v: Record<string, string | number> = {};
    // With nothing bound there is one node, named plainly, even when it has no bars.
    if (!steps && paths.size === 0) paths.set(0, '');
    for (const [key, p] of paths) {
      Object.assign(v, base);
      if (steps)
        lookValues(key, styled, steps, (property, value) => {
          v[property] = value;
        });
      const node = steps ? `${name}${key}` : name;
      names.add(node);
      const n = s.node(node, 'path');
      s.set(n, 'd', p);
      write(n, v);
    }
    for (const old of this.#nodes) if (!names.has(old)) s.remove(old);
    this.#nodes = names;
    return bytes;
  }

  /** The first bar that is there says which way bars grow (its anchor's direction) and, by the middle of its foot, where the baseline is. */
  override enterFrom(): { kind: 'grow-y' | 'grow-x'; x: number; y: number } | null {
    const shapes = this.outline();
    if (!shapes) return null;
    const ends = shapeEnds(this.requireParent(), shapes);
    for (let i = 0; i < shapes.count; i++) {
      const dx = ends[4 * i + 2]! - ends[4 * i]!,
        dy = ends[4 * i + 3]! - ends[4 * i + 1]!;
      if (dx !== dx || dy !== dy) continue;
      // A bar of no length grows upwards, as its anchor leads upwards.
      const len = Math.hypot(dx, dy);
      return { kind: len > 1e-9 && Math.abs(dx / len) > Math.abs(dy / len) ? 'grow-x' : 'grow-y', x: ends[4 * i]!, y: ends[4 * i + 1]! };
    }
    return null;
  }
}

export interface BarPathAttributes extends BarRendererAttributes {}

/**
 * Where each bar of `shapes` starts and ends, in plot pixels, as `[footX, footY, endX, endY]`: the middle of its foot and the middle of its far
 * end, found by placing them. Across the domain normally; across the value when the value is the angle (a ring or pie), where the foot is the
 * inner edge of a segment and the far end the rim. NaN for a gap.
 */
function shapeEnds(series: Series, shapes: ShapeSet): Float64Array {
  let found = endsCache.get(shapes);
  if (found) return found;
  const plane = series.drawn?.plane;
  const { data, count } = shapes;
  const out = new Float64Array(count * 4).fill(NaN);
  if (plane) {
    const ring = series.secondAxis.orientation === 'angle';
    for (let i = 0; i < count; i++) {
      const a0 = data[4 * i]!,
        a1 = data[4 * i + 1]!,
        b0 = data[4 * i + 2]!,
        b1 = data[4 * i + 3]!;
      out[4 * i] = ring ? a0 : (a0 + a1) / 2;
      out[4 * i + 1] = ring ? (b0 + b1) / 2 : b0;
      out[4 * i + 2] = ring ? a1 : (a0 + a1) / 2;
      out[4 * i + 3] = ring ? (b0 + b1) / 2 : b1;
    }
    plane.place({ data: out, stride: 2, count: count * 2 }, series.firstAxis, series.secondAxis);
  }
  endsCache.set(shapes, (found = out));
  return found;
}
const endsCache = new WeakMap<ShapeSet, Float64Array>();

/**
 * Anchors for the bars of `shapes` (see `barShapes`): the anchor is the middle of the far end of a bar and the direction leads from the middle of its foot to
 * it. That is up for a bar above its baseline and down for one below it, out along the radius for a polar bar, and out to the rim for a ring segment.
 */
export function barAnchors(series: Series, shapes: ShapeSet): AnchorSet {
  let found = anchorCache.get(shapes);
  if (!found) {
    const ends = shapeEnds(series, shapes),
      out = new Float64Array(shapes.count * 4);
    for (let i = 0; i < shapes.count; i++) {
      const o = 4 * i,
        fx = ends[o]!,
        fy = ends[o + 1]!;
      if (!Number.isFinite(fx) || !Number.isFinite(fy)) {
        out.fill(NaN, o, o + 4);
        continue;
      }
      out[o] = ends[o + 2]!;
      out[o + 1] = ends[o + 3]!;
      const dx = ends[o + 2]! - fx,
        dy = ends[o + 3]! - fy,
        len = Math.hypot(dx, dy);
      // A bar of no length (a value at its baseline) leaves the label above it.
      out[o + 2] = len > 1e-9 ? dx / len : 0;
      out[o + 3] = len > 1e-9 ? dy / len : -1;
    }
    anchorCache.set(shapes, (found = { data: out, count: shapes.count }));
  }
  return found;
}
const anchorCache = new WeakMap<ShapeSet, AnchorSet>();

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
  override get swatch(): string | null {
    return this.attrs.bind?.fill ? null : this.look().fill;
  }
  protected outline(): ShapeSet | null {
    return barShapes(this.requireParent(), this.attrs);
  }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    paintBox(s, parent, key, width, height, this.look());
  }

  protected draw(): void {
    const counters = this.counters;
    const look = this.look();
    const t0 = performance.now();
    // Each bar is a rectangle in the plane's terms, drawn by the plane: straight edges on a rectangle, arcs and spokes on a polar plane.
    const series = this.requireParent(),
      shapes = this.outline(),
      plane = series.drawn?.plane;
    const corners = new Float64Array(8);
    const path = (i: number): string => {
      if (!shapes || !plane) return '';
      const x0 = shapes.data[4 * i]!,
        x1 = shapes.data[4 * i + 1]!,
        b = shapes.data[4 * i + 2]!,
        t = shapes.data[4 * i + 3]!;
      if (!Number.isFinite(x0) || !Number.isFinite(b)) return '';
      corners[0] = x0;
      corners[1] = b;
      corners[2] = x1;
      corners[3] = b;
      corners[4] = x1;
      corners[5] = t;
      corners[6] = x0;
      corners[7] = t;
      return plane.alignedPath(corners, 4, series.firstAxis, series.secondAxis, true);
    };
    const bytes = this.paint(
      shapes?.count ?? 0,
      path,
      { fill: look.fill, stroke: look.stroke, strokeWidth: look.strokeWidth, opacity: look.opacity },
      (n, v) => {
        const s = this.surface;
        s.set(n, 'fill', String(v.fill));
        s.set(n, 'stroke', String(v.stroke));
        s.set(n, 'stroke-width', Number(v.strokeWidth));
        s.set(n, 'stroke-linejoin', 'round');
        s.set(n, 'opacity', Number(v.opacity));
      },
      'bars',
      shapes,
    );
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += bytes;
  }
}

export interface StemPathAttributes extends BarRendererAttributes<Omit<StyleBindable, 'fill'>> {
  /** How the end of a stem is finished: 'butt' (flat, at the value), 'round' or 'square' (both reach half a width past). Default 'butt'. */
  cap?: 'butt' | 'round' | 'square';
}

/**
 * Bars as lines: each is a stem from the foot to the value, stroked rather than filled, in one path. The width is the
 * stroke's, so it stays the same however many bars there are, which is what makes it the answer for dense data where
 * filled bars would be slivers. The look is the line's (`seriesLine`), with the series' colour as its stroke; give the
 * series a marker as well for a lollipop.
 */
export class StemPath extends BarRenderer<StemPathAttributes> {
  private look() {
    const a = this.attrs;
    return this.styleFor(
      ['seriesLine', 'line'],
      { color: a.stroke, width: a.strokeWidth, opacity: a.opacity },
      { color: this.requireParent().accentColor },
    );
  }
  override get swatch(): string | null {
    return this.attrs.bind?.stroke ? null : this.look().color;
  }
  protected outline(): ShapeSet | null {
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
      cap = this.attrs.cap ?? 'butt';
    const look = this.look();
    const t0 = performance.now();
    const stems = this.outline(),
      series = this.requireParent(),
      plane = series.drawn?.plane;
    const ends = new Float64Array(4);
    const path = (i: number): string => {
      if (!stems || !plane) return '';
      const { data } = stems,
        k = i * 4;
      if (!Number.isFinite(data[k]!) || !Number.isFinite(data[k + 2]!)) return '';
      ends[0] = data[k]!;
      ends[1] = data[k + 2]!;
      ends[2] = data[k]!;
      ends[3] = data[k + 3]!;
      return plane.alignedPath(ends, 2, series.firstAxis, series.secondAxis);
    };
    const bytes = this.paint(
      stems?.count ?? 0,
      path,
      { stroke: look.color, strokeWidth: look.width, opacity: look.opacity },
      (n, v) => {
        const s = this.surface;
        s.set(n, 'fill', 'none');
        s.set(n, 'stroke', String(v.stroke));
        s.set(n, 'stroke-width', Number(v.strokeWidth));
        s.set(n, 'stroke-linecap', cap);
        s.set(n, 'opacity', Number(v.opacity));
        s.set(n, 'stroke-dasharray', look.dash);
      },
      'stems',
      stems,
    );
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += bytes;
  }
}

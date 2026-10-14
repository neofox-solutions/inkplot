/**
 * Series renderers: turn placed points into platform nodes.
 *
 * A renderer is a child of a series and is handed that series' projected points (plot pixels) on PAINT. It knows nothing
 * of axes, planes or data: that is why one renderer works unchanged on a rectangle, a circle or a radar. Renderers that
 * vary a look by data (markers) declare `bindings`, which the series reads to know which channels to request; the
 * values themselves come from `MappedDimension`s (colour and size axes).
 *
 * Defaults come from the theme (see theme.ts); the attributes `stroke`, `strokeWidth`, `fill` and `opacity` are the same
 * properties set directly. The colour a series gets from the palette is the lowest-priority default for its colour.
 *
 * A point that is NaN or infinite in either coordinate is a gap. `Number.isFinite` tests for it (it is as fast as
 * any hand-rolled compare in V8, measured), so the hot loops use it.
 */
import { type AttrTypesFor, STRING, NUMBER } from './attrs.ts';
import type { PointBuffer } from './data.ts';
import type { Extent } from './geometry.ts';
import type { HitMode } from './hit.ts';
import { Curve } from './curve.ts';
import { type AnyElement, type BaseAttributes, ChartElement } from './element.ts';
import { type ChartEvent, EVENT_PAINT } from './events.ts';
import type { BoundDimension, Bindings } from './mapped.ts';
import type { PlatformNode } from './platform.ts';
import type { Series } from './series.ts';
import type { Surface } from './surface.ts';
import { notImplemented } from './stub.ts';

/** The attributes any renderer can bind. Colours are CSS colour strings; widths and opacity are numbers. */
export interface StyleBindable {
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
}

export interface SeriesRendererAttributes<Bindable extends object = StyleBindable> extends BaseAttributes {
  /** Outline colour (a CSS colour). Default: from the theme. */
  stroke?: string;
  /** Outline width in pixels. Default: from the theme. */
  strokeWidth?: number;
  /** Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. */
  fill?: string;
  /** Opacity from 0 to 1. Default 1. */
  opacity?: number;
  /**
   * Attributes fed from data instead of fixed. The constant above stays as the fallback, so
   * `{ strokeWidth: 0.5, bind: { stroke: { axis: heat, channel: 'p' } } }` mixes the two freely.
   * Binding an attribute the renderer cannot vary is a compile error; so is a dimension of the wrong type.
   */
  bind?: Bindings<Bindable>;
  /**
   * Most paths this renderer may create. Each stylistic binding (one that has to vary per path: a colour, a width,
   * an opacity) is quantized to `floor(maxNodes ** (1 / k))` buckets for k such bindings, so the count of paths
   * in use cannot exceed it. Geometric bindings (a cross's size, a bubble's radius) go into the path data and cost
   * nothing. Attaching throws if that leaves fewer than 2 buckets. Default 1000.
   */
  maxNodes?: number;
}

/** The rows a renderer is asked about by `spread`: the series' values as they sit, which columns hold what, and where a stack puts each row. */
export interface SpreadView {
  readonly raw: Float64Array;
  readonly count: number;
  readonly stride: number;
  readonly firstColumn: number;
  readonly secondColumn: number;
  /** The column of a channel in `raw`, or -1. */
  channelColumn(name: string): number;
  /** Where a stack plots each row's value, or null outside a stack. */
  readonly top: Float64Array | null;
}
/** Extents a renderer asks of the series' two axes, in data units. */
export interface Spread {
  first?: Extent;
  second?: Extent;
}

/** What a renderer ended up binding, after resolving refs. The series reads this to know which channels to request. */
export interface ResolvedBinding {
  readonly property: string;
  readonly channel: string;
  readonly axis: BoundDimension;
  /** True when the value varies per path (and so is quantized), false when it goes into the path data. */
  readonly stylistic: boolean;
}

/** Closed outlines in plot pixels, `perShape` points each (a `NaN` shape is left out): what a renderer that draws shapes can say it drew. */
export interface PolygonSet {
  readonly data: Float64Array;
  readonly perShape: number;
  readonly count: number;
}

/**
 * Where a label for each point of a series belongs: for every point, in the order of the series' points, the place on what is
 * drawn for it that a label should sit beside (the end of a bar, the rim of a wedge) and the direction that leads away from it,
 * as four numbers `x, y, nx, ny` (plot pixels; a unit vector). A gap leaves NaN.
 */
export interface AnchorSet {
  readonly data: Float64Array;
  readonly count: number;
}

/**
 * The line a renderer actually draws, when it is not the straight one through the series' points (steps, curves): the
 * path of placed points that a pointer is measured against, so that a hit or a reading is on what is on the screen.
 */
export interface Trace {
  /** The path in plot pixels, each run of it (a stretch between gaps) ended by a NaN point. */
  readonly line: PointBuffer;
  /** For each vertex of `line`, the index of the series' own point it belongs to, which is what a hit on it reports; -1 at the NaN ending a run. */
  readonly owner: Int32Array;
  /** For a filled shape, the path it closes back along (its baseline), run for run with `line`, and null for a line. */
  readonly base: PointBuffer | null;
}

/** Any series renderer. `any` because renderers are invariant in their attributes and children, so no concrete renderer type accepts every one. */
// oxlint-disable-next-line typescript/no-explicit-any -- see the comment above
export type AnySeriesRenderer = SeriesRenderer<any, any>;

/** Draws a series' projected points into its own surface. */
export abstract class SeriesRenderer<
  A extends SeriesRendererAttributes<object> = SeriesRendererAttributes,
  Children extends readonly AnyElement[] = [],
> extends ChartElement<Series, Children, A> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    fill: STRING,
    maxNodes: NUMBER,
    stroke: STRING,
    strokeWidth: NUMBER,
  } satisfies Partial<AttrTypesFor<SeriesRendererAttributes>>;
  /** Create or update this renderer's nodes from the placed points. Runs on every PAINT, so it must be idempotent. */
  protected abstract draw(points: Readonly<PointBuffer>): void;

  /**
   * The one colour that stands for what this draws, for a key or a tooltip to show beside the series' name: its line, its
   * fill. Null when it has none (the colour is bound to data, so there is not one).
   */
  get swatch(): string | null {
    return null;
  }
  /**
   * Draw a sample of what this draws into `parent` (a node of `surface`, the caller's), in a box `width` by `height` from
   * its own top left corner: a short line for a line, a box for an area or bars, one marker for markers. It takes the look
   * the renderer would draw with (theme, attributes, dashes), so a legend or a tooltip shows what is on the plot. Several
   * renderers on a series draw their samples one over another. Nodes are keyed `key…` in `surface`. Default: a box of the
   * `swatch` colour, or nothing for a renderer that has none.
   */
  sample(surface: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const colour = this.swatch;
    if (!colour || colour === 'none') {
      surface.remove(key);
      return;
    }
    const n = surface.node(key, 'path', { parent });
    surface.set(n, 'd', `M0 0H${width}V${height}H0Z`);
    surface.set(n, 'fill', colour);
    surface.set(n, 'stroke', 'none');
  }
  /** Values this renderer needs the value axis to reach whatever the data says: the baseline bars grow from. Default none. */
  get includes(): readonly number[] {
    return [];
  }
  /**
   * Pixels this draws beyond the places of its points (a marker's radius), which the axes leave room for so that a mark
   * on the end of the data is not cut by the edge of the plot. Default 0.
   */
  get reach(): number {
    return 0;
  }
  /** Half the width of what this draws along the domain, as a fraction of the gap between neighbouring points (bars), which the domain axis leaves room for. Default 0. */
  get spans(): number {
    return 0;
  }
  /** What a pointer hit on the series should measure by default, if this renderer knows: bars say 'shape'. Default no opinion. */
  get hitMode(): HitMode | undefined {
    return undefined;
  }
  /** The shapes this draws, one for each point of the series in the same order, for a 'shape' hit. Default none. */
  shapes?(): PolygonSet | null;
  /** Where a label for each point should sit, if this knows better than the point itself (a bar: the middle of its far end). Default none. */
  anchors?(): AnchorSet | null;
  /**
   * For a renderer whose marks grow from a line when the chart first appears (bars): which way they grow (`grow-y` upwards or downwards,
   * `grow-x` sideways) and a point on the line they stand on, in plot pixels. Null: nothing to grow from, so the series is drawn on instead.
   */
  enterFrom?(): { kind: 'grow-y' | 'grow-x'; x: number; y: number } | null;
  /** The path this draws as a line (or the top of a shape), if it is not the straight one through the points. Hits and readings follow it. Default none. */
  trace?(): Trace | null;
  /**
   * Channels of the data this needs as plain numbers beside each point (error bars: how far each value may be out), with no mapped
   * axis to turn them into anything. The series requests them with the bound ones; in `points` they follow the two coordinates,
   * raw, in the order of `Series.channels`. Default none.
   */
  get channelNames(): readonly string[] {
    return [];
  }
  /**
   * What this draws beyond the values on each axis, over the rows now in view (a stack's rows are at their stacked places):
   * the extents the series adds to its axes, so that error bars are not cut off by the plot. Default none.
   */
  spread?(view: SpreadView): Spread | null;
  /** The same over all the data, for the range zooming is held to. It may be generous. Default none. */
  limit?(series: Series): Spread | null;
  /** Nothing is bound until bindings are written; a renderer that has some will report them here. */
  get bindings(): readonly ResolvedBinding[] {
    return [];
  }
  /** Buckets per stylistic binding, from `maxNodes`. 0 when nothing is stylistically bound. */
  get stepsPerBinding(): number {
    return 0;
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_PAINT:
        if (this.requireParent().shown) this.draw(this.requireParent().points);
        break;
    }
  }
}

/** A box in the look of a filled shape: what an area and a bar are in a legend. */
export function paintBox(
  s: Surface,
  parent: PlatformNode,
  key: string,
  width: number,
  height: number,
  look: { fill: string; stroke: string; strokeWidth: number; opacity: number },
): void {
  const n = s.node(key, 'path', { parent });
  s.set(n, 'd', `M0 0H${width}V${height}H0Z`);
  s.set(n, 'fill', look.fill);
  s.set(n, 'fill-opacity', look.opacity);
  s.set(n, 'stroke', look.stroke);
  s.set(n, 'stroke-width', look.strokeWidth);
  s.set(n, 'stroke-linejoin', 'round');
}

export interface LinePathAttributes extends SeriesRendererAttributes {}
/**
 * One path through the points, in the way its `Curve` says: straight lines (`LinearCurve`), a spline, steps. A gap in the
 * data lifts the pen, or is crossed if the series says its `gaps` are 'connect'.
 */
export class LinePath extends SeriesRenderer<LinePathAttributes, [curve: Curve]> {
  /** How the points are joined. */
  get curve(): Curve {
    return this.child(0, Curve);
  }
  /** The series' palette colour is the default; a dash pattern is style only (`style: { seriesLine: { dash } }`). */
  protected look() {
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
  override trace(): Trace | null {
    return this.curve.trace(this.requireParent(), null);
  }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const look = this.look(),
      n = s.node(key, 'path', { parent });
    s.set(n, 'd', `M0 ${height / 2}H${width}`);
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', look.color);
    s.set(n, 'stroke-width', look.width);
    s.set(n, 'stroke-linecap', 'butt');
    s.set(n, 'opacity', look.opacity);
    s.set(n, 'stroke-dasharray', look.dash);
  }

  protected draw(): void {
    const counters = this.counters,
      s = this.surface,
      a = this.attrs;
    if (a.bind) notImplemented('LinePath bindings');
    const look = this.look();
    const t0 = performance.now();
    const d = this.curve.line(this.requireParent());
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += d.length;

    const n = s.node('line', 'path');
    s.set(n, 'd', d);
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', look.color);
    s.set(n, 'stroke-width', look.width);
    s.set(n, 'stroke-linejoin', 'round');
    s.set(n, 'stroke-linecap', 'round');
    s.set(n, 'opacity', look.opacity);
    s.set(n, 'stroke-dasharray', look.dash);
  }
}

export interface AreaPathAttributes extends SeriesRendererAttributes {
  /** The value the area is filled from, kept inside the value axis' range. Default 0. */
  baseline?: number;
}

/**
 * The region between a line and a baseline, the line drawn in the way its `Curve` says. It is the data forward and the
 * baseline backward, closed: the baseline is placed by the plane exactly as the data is, so on a rectangle this is the
 * usual area under a line, and on a PolarPlane it is the ring or wedge between the curve and the baseline circle, with
 * nothing here to say so. A gap in the data splits it into separate shapes. Outlines are off by default; give a `stroke`
 * to draw one.
 */
export class AreaPath extends SeriesRenderer<AreaPathAttributes, [curve: Curve]> {
  /** How the points are joined. */
  get curve(): Curve {
    return this.child(0, Curve);
  }
  protected look() {
    const a = this.attrs;
    return this.styleFor(
      ['seriesArea', 'shape'],
      { fill: a.fill, stroke: a.stroke, strokeWidth: a.strokeWidth, opacity: a.opacity },
      { fill: this.requireParent().accentColor },
    );
  }
  override get swatch(): string {
    return this.look().fill;
  }
  override trace(): Trace | null {
    return this.curve.trace(this.requireParent(), this.attrs.baseline ?? 0);
  }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    paintBox(s, parent, key, width, height, this.look());
  }

  protected draw(): void {
    const counters = this.counters,
      s = this.surface,
      a = this.attrs;
    if (a.bind) notImplemented('AreaPath bindings');
    const look = this.look();
    const t0 = performance.now();
    const d = this.curve.area(this.requireParent(), a.baseline ?? 0);
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += d.length;

    const n = s.node('area', 'path');
    s.set(n, 'd', d);
    s.set(n, 'fill', look.fill);
    s.set(n, 'fill-opacity', look.opacity);
    s.set(n, 'stroke', look.stroke);
    s.set(n, 'stroke-width', look.strokeWidth);
    s.set(n, 'stroke-linejoin', 'round');
  }
}

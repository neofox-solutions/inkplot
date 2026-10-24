/**
 * Series: a data pipeline, the axes it reads through, and the renderers that draw it.
 *
 * A series is two things. The base class is everything about getting points from a source and into plot pixels; a
 * subclass says which axes the first and second coordinate ride on, and which columns of the data they come from.
 *
 *  - `DomainSeries`: the domain goes along one axis and the value along another, as in a line chart, or round and out
 *    on a polar plane. Points are windowed to the visible domain.
 *  - `XYSeries`: two values, one on each axis, in the order the source holds them. The source's domain is only the
 *    order (by default the row's index), so a path can cross itself and a scatter needs none.
 *
 * Whichever it is, renderers are handed the same thing: `points`, laid out `[first, second, ...bound channels]` in plot
 * pixels, so they never need to know.
 *
 * The life of a point, and who owns each step (so a change lands in the right place)
 * ─────────────────────────────────────────────────────────────────────────────────
 *   data stage ──fill──▶ raw buffer ──gather columns──▶ points ──axis.normalize──▶ 0..1 ──plane.place──▶ pixels
 *   (source, Decimator)  (this class;   (this class;    (this     (Axis: scale,      (Plane: Cartesian
 *                         cached by key)  `project`)      class)    inversion)         rectangle, polar, radar)
 * The raw buffer is filled once per change of data, window or width (`fill`) and is *not* touched by projection, so
 * resizing the plot or panning a value axis only re-runs the cheap normalise-and-place tail (`project`). Subclasses
 * choose which raw columns are the two coordinates; nothing after the gather step knows how they were chosen.
 */
/* oxlint-disable typescript/no-non-null-assertion -- stride-addressed rows of the managed buffers: every index is bounded by the row count */
import { type AttrTypesFor, STRING } from './attrs.ts';
import { Axis } from './axis.ts';
import { type DataNode, DataSource, DataTransform, distinct, type PlanContext, type PointBuffer } from './data.ts';
import { type AnyElement, type BaseAttributes, ChartElement, type ElementRef, fail, resolveRef } from './element.ts';
import { writeAria } from './aria.ts';
import { type ChartEvent, EVENT_ATTACH, EVENT_PAINT } from './events.ts';
import type { Extent, Size } from './geometry.ts';
import type { Plane } from './plane.ts';
import type { PlatformNode } from './platform.ts';
import type { Surface } from './surface.ts';
import { type AnySeriesRenderer, type ShapeSet, SeriesRenderer, type SpreadView, type Trace } from './renderer.ts';
import type { HitOptions, HitMode } from './hit.ts';

export interface SeriesAttributes extends BaseAttributes {
  /** What the series is called where it is named: a tooltip's heading. */
  name?: string;
  /**
   * How pointer hits find this series: a mode name, options, or `false` for a series that should never be hit (a
   * selection overlay, a reference line). Only the series knows what its renderers draw, so this is set here and not
   * guessed: a line series that should be grabbable anywhere along the line says `'line'`, a filled one `'area'`.
   */
  hit?: false | HitMode | HitOptions;
  /**
   * What a missing value (NaN, or infinite) means. 'break' (default): nothing is there, so a line stops and starts again
   * and an area splits. 'connect': the line goes straight across to the next value there is. 'zero': the value is 0 (and
   * the axis reaches it). Markers and bars draw nothing at a gap whichever; and the readings of a tooltip and a drag
   * stay the data's own. In a `Stack`, 'zero' is not applied: a gap there leaves its layer out.
   */
  missing?: 'break' | 'connect' | 'zero';
}
/**
 * Where a `Stack` puts one of its series: the value each row starts from and the one it is plotted at, in the value
 * axis' own units, and which place it takes beside the others when they sit side by side. Rows line up with the series'
 * own rows. `additive` says the plotted value is the series' own plus a shift, so an edit can be undone back to the own.
 */
export interface StackLayer {
  readonly base: Float64Array;
  readonly top: Float64Array;
  readonly slot: { readonly index: number; readonly count: number };
  readonly additive: boolean;
  /** The extent of everything the stack plots in the value axis' units, for what is limited by the data's extent. */
  readonly extent: Extent | null;
}
/** The rows a series draws from: its own fill, or what a stack made of them to line them up with the others. */
export interface Rows {
  readonly raw: Float64Array;
  readonly count: number;
  readonly stride: number;
  readonly rowOf: ((index: number) => number) | null;
}
/** A plane child that holds series of its own (a `Stack`, a `SeriesGroup`): the plane sees through it, and hands it their loading. */
export interface SeriesHolder {
  readonly members: readonly Series[];
  load(estimate: Size): void;
}
/** A plane child that holds series of its own (a stack), or null. Recognised by what it offers, so this file need not import every kind of group. */
export function groupOf(child: unknown): (SeriesHolder & AnyElement) | null {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- `members` was probed on the line above
  return typeof child === 'object' && child !== null && 'members' in child ? (child as SeriesHolder & AnyElement) : null;
}
/** The series a plane child stands for: itself, the members of a group, or none. */
export function seriesOf(child: unknown): readonly Series[] {
  if (child instanceof Series) return [child];
  return groupOf(child)?.members ?? [];
}

/** One data source, then any number of renderers. */
export type SeriesChildren<Channel extends string = string> = [data: DataNode<Channel>, ...renderers: AnySeriesRenderer[]];

/** A number for each data node that has been asked, so that a series whose data is swapped for another node (of the same version) refills. */
const nodeIds = new WeakMap<object, number>();
let lastNodeId = 0;
function nodeId(node: object): number {
  let id = nodeIds.get(node);
  if (id === undefined) nodeIds.set(node, (id = ++lastNodeId));
  return id;
}
/** What `points` is before the first projection, so renderers never need a null check. */
const NO_DRAWN_POINTS: Readonly<PointBuffer> = { data: new Float64Array(0), stride: 2, count: 0 };
/** The contribution of a column the fill did not report (never happens for a valid source); NaN is ignored by axes. */
const NO_EXTENT: Extent = { min: NaN, max: NaN };
const DOMAIN_VALUE = ['domain', 'value'] as const;

/**
 * What `Series.drawn` hands out: the plane, the points in plot pixels (`points`), and the data values they were made
 * from (`raw`, `stride` numbers to a row, the two coordinates at `firstColumn` and `secondColumn`, the bound channels
 * last, in the order of `channels`). `rowOf` names the source row of a drawn point, when they are the source's.
 */
export interface Drawn {
  readonly plane: Plane;
  readonly points: Readonly<PointBuffer>;
  readonly raw: Float64Array;
  readonly stride: number;
  readonly firstColumn: number;
  readonly secondColumn: number;
  readonly channels: readonly string[];
  /** The column of `raw` that holds a named column of the data (a bound channel, or `domain` or `value`), or -1. */
  readonly columnOf: (name: string) => number;
  readonly rowOf: ((index: number) => number) | null;
  readonly alongDomain: boolean;
  /** In a stack: where each row starts and is plotted, and the series' place beside the others. Null otherwise. */
  readonly base: Float64Array | null;
  readonly top: Float64Array | null;
  readonly slot: { readonly index: number; readonly count: number };
  /** The plotted value is the own value plus a shift (see `StackLayer`). */
  readonly additive: boolean;
}

/** The shared pipeline: raw fill (cached), column gather, normalise, place. Subclasses say which columns and axes. */
export abstract class Series<A extends SeriesAttributes = SeriesAttributes, Channel extends string = string> extends ChartElement<
  Plane | (SeriesHolder & AnyElement),
  SeriesChildren<Channel>,
  A
> {
  static override attrTypes = { ...ChartElement.attrTypes, name: STRING } satisfies AttrTypesFor<SeriesAttributes>;
  // The projected points handed to renderers; grown as needed and reused so a redraw allocates nothing.
  #points: PointBuffer | null = null;
  // The buffer the next projection is made in, and the thing `place` is handed; what the last projection depended on besides its points.
  #spare: Float64Array = new Float64Array(0);
  readonly #scratch: PointBuffer = { data: new Float64Array(0), stride: 2, count: 0 };
  #signature = '';
  #usedLayer: StackLayer | null = null;
  #usedAligned: Rows | null = null;
  // Counts the refills of the raw buffer: the rows the points are made from are the same while this is.
  #fills = 0;
  // The unprojected fill, with the key it was made for: data version, window, width and requested columns.
  #raw: Float64Array = new Float64Array(0);
  #rawCount = 0;
  #extents: readonly Extent[] = [];
  #rowOf: ((index: number) => number) | null = null;
  #key = '';
  #stride = 2;
  // For `baseline`: the plane of the last projection, a counter that says whether it moved, and the cached result.
  #plane: Plane | null = null;
  #projections = 0;
  #base: PointBuffer = { data: new Float64Array(0), stride: 2, count: 0 };
  #fractions: Float64Array | null = null;
  #fractionsKey = -1;
  #baseKey = '';
  // A stack's say over this series: the shift of its rows, and a table of rows lined up with the others' (else its own).
  #layer: StackLayer | null = null;
  #aligned: Rows | null = null;

  /** Whether a missing value is drawn as 0 (not in a stack, which has its own say). */
  get #zero(): boolean {
    return this.attrs.missing === 'zero' && this.#layer === null;
  }
  /** The plane this series is drawn on, which is its parent unless a stack sits between them. */
  get plane(): Plane {
    let p: Plane | (SeriesHolder & AnyElement) = this.requireParent();
    // A stack, a group, or a group in a stack: climb until the plane.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- `members` was probed in the condition: the parent of a series holder is another holder or the plane
    while ('members' in p) p = p.requireParent() as Plane | (SeriesHolder & AnyElement);
    return p;
  }
  /** The rows drawn from: a stack's lined-up table when it made one, else the series' own fill. */
  protected rows(): Rows {
    return this.#aligned ?? { raw: this.#raw, count: this.#rawCount, stride: this.#stride, rowOf: this.#rowOf };
  }
  /** Engine protocol for a `Stack`: the series' own fill as it stands (call after `prepare`). */
  ownRows(): Rows {
    return { raw: this.#raw, count: this.#rawCount, stride: this.#stride, rowOf: this.#rowOf };
  }
  /** Engine protocol for a `Stack`: take a place in a stack, with rows lined up to its others'. Null for both leaves it. */
  join(layer: StackLayer | null, rows: Rows | null): void {
    this.#layer = layer;
    this.#aligned = rows;
  }
  /** Counts the times the series' rows were read afresh: what a stack's layout depends on, besides which series are in it. */
  get fillSerial(): number {
    return this.#fills;
  }
  /** What a stack has made of this series, if it is in one. */
  get layer(): StackLayer | null {
    return this.#layer;
  }

  get data(): DataNode<Channel> {
    return this.child(0, DataSource, DataTransform);
  }
  /**
   * Every channel its renderers bind or ask for (`channelNames`): what a renderer can ask for by name. In `points` they follow the two coordinates
   * in this order, so a channel's column is `2 + channels.indexOf(name)`. (A channel may be the name of a coordinate too: `domain`, `value`.)
   */
  get channels(): readonly string[] {
    const names = new Set<string>();
    for (let r = this.firstChild; r; r = r.nextSibling)
      if (r instanceof SeriesRenderer) {
        for (const b of r.bindings) names.add(b.channel);
        for (const c of r.channelNames) names.add(c);
      }
    return [...names];
  }
  /**
   * The colour this series takes from the theme's palette: by its position among the plane's series, round again when
   * there are more series than colours. It is only a default: a renderer's own colour attribute or any `style` beats it.
   */
  get accentColor(): string {
    const palette = (this.chart ?? fail(210)).attrs.theme.palette;
    const index = Math.max(0, this.plane.allSeries.indexOf(this));
    return palette[index % palette.length] ?? '#888';
  }
  /**
   * Whether the series is on show: neither it nor a `Stack` or `SeriesGroup` it is in has `visible` false. One that is not takes
   * no part: it is not drawn, does not set the axes' ranges, and is not hit.
   */
  get shown(): boolean {
    if (this.attrs.visible === false) return false;
    for (let p = this.parent; p && groupOf(p); p = p.parent) if (p.attrs.visible === false) return false;
    return true;
  }
  /**
   * Draw a sample of what this series looks like into `parent`, `width` by `height` from its top left corner: each renderer's
   * own sample (a line, a box, a marker), one over another in drawing order, in the look the renderer resolves from the
   * theme and its attributes. A legend and a tooltip use it. Nodes are keyed `key/…` in `surface`.
   */
  sample(surface: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    let n = 0;
    for (let r = this.firstChild; r; r = r.nextSibling)
      if (r instanceof SeriesRenderer) r.sample(surface, parent, `${key}/${n++}`, width, height);
  }
  /**
   * The colour that stands for this series: what its first renderer says (its line, its fill, a marker's colour),
   * else the palette colour. A key or tooltip shows it beside the name.
   */
  get color(): string {
    for (let r = this.firstChild; r; r = r.nextSibling)
      if (r instanceof SeriesRenderer) {
        const c = r.swatch;
        if (c && c !== 'none') return c;
      }
    return this.accentColor;
  }
  /** What the first renderer that has an opinion says a hit on this series should measure: bars say the shapes they draw. */
  get hitHint(): HitMode | undefined {
    for (let r = this.firstChild; r; r = r.nextSibling) if (r instanceof SeriesRenderer && r.hitMode) return r.hitMode;
    return undefined;
  }
  /** The shapes the series draws, as polygons in plot pixels, if a renderer draws any (bars): what a 'shape' hit is inside. */
  shapes(): ShapeSet | null {
    for (let r = this.firstChild; r; r = r.nextSibling)
      if (r instanceof SeriesRenderer) {
        const g = r.shapes?.();
        if (g) return g;
      }
    return null;
  }
  /** The path the series' renderer draws, if it draws other than straight lines through the points (steps, curves): what a line hit or a reading follows. */
  trace(): Trace | null {
    for (let r = this.firstChild; r; r = r.nextSibling)
      if (r instanceof SeriesRenderer) {
        const t = r.trace?.();
        if (t) return t;
      }
    return null;
  }
  /**
   * A number that changes when the series' points do, or what they were made from (its rows, its stack, its plane, its axes' ranges): a pass that leaves them
   * as they were leaves this alone. A renderer that works something out from the points can keep it against this number.
   */
  get projection(): number {
    return this.#projections;
  }
  /** The last projected points, in plot pixels: `[first, second, ...channels]` in each row of `points.stride` numbers. */
  get points(): Readonly<PointBuffer> {
    return this.#points ?? NO_DRAWN_POINTS;
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper(); // carries the clip
        break;
      case EVENT_PAINT: {
        const clip = this.plane.clipUrl;
        if (clip) this.surface.set(this.surface.wrapper(), 'clip-path', clip);
        writeAria(this.surface, this.surface.wrapper(), this.attrs.meta, { role: 'group' });
        break;
      }
    }
  }

  /** Write an attribute on the series' own group, for an element that decorates it (`Entrance`). */
  decorate(name: string, value: string | number): void {
    this.surface.set(this.surface.wrapper(), name, value);
  }

  /**
   * The last projection, as the series holds it, for what reads a drawn series back: hit testing (hit.ts), which is
   * kept out of the series so that a chart that never hit-tests does not carry it. Null before the first projection.
   */
  get drawn(): Drawn | null {
    const plane = this.#plane,
      points = this.#points;
    if (!plane || !points) return null;
    const rows = this.rows(),
      layer = this.#layer;
    return {
      plane,
      points,
      raw: rows.raw,
      stride: rows.stride,
      firstColumn: this.firstColumn,
      secondColumn: this.secondColumn,
      channels: this.channels,
      columnOf: (name) => this.columns.indexOf(name),
      rowOf: rows.rowOf,
      alongDomain: this.alongDomain,
      base: layer?.base ?? null,
      top: layer?.top ?? null,
      slot: layer?.slot ?? { index: 0, count: 1 },
      additive: layer?.additive ?? true,
    };
  }
  /** Whether the first coordinate is a position along the line, so that a value can be read between two points. */
  protected get alongDomain(): boolean {
    return false;
  }

  // ─── What a kind of series says. ───

  /** The axis the first coordinate rides on, which a plane places along its first role. */
  abstract get firstAxis(): Axis;
  /** The axis the second coordinate rides on. */
  abstract get secondAxis(): Axis;
  /** The names of the two coordinates, as the data is asked for them: `domain` and `value` for a series along a domain, x and y otherwise. */
  protected abstract get coordinates(): readonly [first: string, second: string];
  /**
   * The columns of the raw rows, by name and in order: the two coordinates, then each bound channel not already among them. This is
   * what the data is asked for (see `PlanContext`), and a name's column is its index here.
   */
  get columns(): readonly string[] {
    return distinct([...this.coordinates, ...this.channels]);
  }
  /**
   * Whether the data is asked for ascending along the first coordinate, which is the domain: so for a series along a domain, and
   * for one that draws x against the domain. Otherwise the points come in the order the source stores them.
   */
  protected get sorted(): boolean {
    return this.coordinates[0] === 'domain';
  }
  /** Which column of the raw rows is the first coordinate. */
  protected get firstColumn(): number {
    return this.columns.indexOf(this.coordinates[0]);
  }
  /** Which column of the raw rows is the second coordinate. */
  protected get secondColumn(): number {
    return this.columns.indexOf(this.coordinates[1]);
  }
  /** Pick the axes, from attributes or else the plane's. */
  abstract resolveAxes(plane: Plane): void;
  /** Report what is known of the domain before any data is read, so that fills can depend on it. */
  abstract contributeDomain(): void;
  /** Settle whatever `contributeDomain` fed, once every series has contributed. */
  abstract resolveDomain(): void;
  /** Read the data, and report every extent it has to the axes. `estimate` is the room the plot is expected to have. */
  abstract load(estimate: Size): void;
  /** The extent all of the data asks of an axis, not the part in view: what zooming is limited by. Null if it uses none of it. */
  abstract extentFor(axis: Axis): Extent | null;

  // ─── Engine protocol: the plane calls these, in this order, each pass. ───

  /**
   * Fill the raw buffer, or reuse it when nothing it depends on has changed. Returns every column's extent: the
   * domain, the value, then each requested channel.
   */
  protected fill(ctx: PlanContext): readonly Extent[] {
    const data = this.data,
      counters = this.counters;
    const stride = ctx.columns.length;
    const key = `${nodeId(data)}.${data.version}|${ctx.domainRange.min}|${ctx.domainRange.max}|${ctx.width}|${ctx.sorted ? 1 : 0}|${ctx.columns.join()}`;
    if (key === this.#key) {
      counters.cached++;
    } else {
      const t0 = performance.now(),
        d0 = counters.stages.decimate;
      const plan = data.plan(ctx);
      if (this.#raw.length < plan.capacity * stride) this.#raw = new Float64Array(plan.capacity * stride);
      const result = plan.fill(this.#raw);
      this.#rawCount = result.count;
      this.#rowOf = result.rowOf ?? null;
      this.#extents = result.extents;
      this.#key = key;
      this.#stride = stride;
      this.#fills++;
      counters.filled++;
      counters.pointsIn += data.pointCount;
      counters.stages.generate += performance.now() - t0 - (counters.stages.decimate - d0);
    }
    return this.#extents;
  }

  /**
   * Ask both axes for the room the renderers draw beyond the places of the points (a marker's radius), before the ranges
   * are settled. It is pixels, which an axis turns into data by its length.
   */
  protected contributeReach(): void {
    const px = this.reachPx;
    if (px > 0) {
      this.firstAxis.reach(px);
      // Markers on the ends of bars stand beyond the far ends only: the value axis is given that room once the data is read (`load`), not at the baseline.
      if (!this.onBars) this.secondAxis.reach(px);
    }
  }
  /** The most any renderer draws beyond a point, in pixels. */
  protected get reachPx(): number {
    let px = 0;
    for (let r = this.firstChild; r; r = r.nextSibling) if (r instanceof SeriesRenderer && r.reach > px) px = r.reach;
    return px;
  }
  /** Whether bars (anything with a baseline to grow from) are drawn here, which markers then stand on the ends of. */
  protected get onBars(): boolean {
    for (let r = this.firstChild; r; r = r.nextSibling) if (r instanceof SeriesRenderer && r.includes.length > 0) return true;
    return false;
  }
  /** The largest `spans` of the renderers: how far they draw beyond a point along the domain, as a fraction of the gap between points. */
  protected get spans(): number {
    let m = 0;
    for (let r = this.firstChild; r; r = r.nextSibling) if (r instanceof SeriesRenderer && r.spans > m) m = r.spans;
    return m;
  }

  /**
   * Widen the range of every mapped dimension a renderer binds to cover the whole of its channel. This is the whole
   * of the data and not the part in view, so colours and sizes stay put while you zoom.
   */
  protected contributeChannels(): void {
    if (this.#zero) {
      const { raw, count: n, stride: rs } = this.rows(),
        c = this.secondColumn;
      for (let i = 0; i < n; i++)
        if (!Number.isFinite(raw[i * rs + c]!)) {
          this.secondAxis.contribute(0, 0);
          break;
        }
    }
    // Values a renderer needs on the value axis whatever the data says: the baseline bars grow from.
    for (let r = this.firstChild; r; r = r.nextSibling)
      if (r instanceof SeriesRenderer) for (const v of r.includes) this.secondAxis.contribute(v, v);
    // What renderers draw beyond the values (error bars) is part of what the axes must show.
    const view = this.spreadView();
    for (let r = this.firstChild; r; r = r.nextSibling) {
      if (!(r instanceof SeriesRenderer) || !r.spread) continue;
      const s = r.spread(view);
      if (s?.first) this.firstAxis.contribute(s.first.min, s.first.max);
      if (s?.second) this.secondAxis.contribute(s.second.min, s.second.max);
    }
    for (let r = this.firstChild; r; r = r.nextSibling) {
      if (!(r instanceof SeriesRenderer)) continue;
      for (const b of r.bindings) {
        const e = this.data.channelExtent(b.channel);
        if (e) b.axis.contribute(e.min, e.max);
      }
    }
  }

  /** The rows as a renderer's `spread` sees them. */
  private spreadView(): SpreadView {
    const { raw, count, stride } = this.rows(),
      columns = this.columns,
      layer = this.#layer;
    return {
      raw,
      count,
      stride,
      firstColumn: this.firstColumn,
      secondColumn: this.secondColumn,
      top: layer?.top ?? null,
      channelColumn: (name) => {
        return columns.indexOf(name);
      },
    };
  }
  /** The extent the data alone asks of the first (`'first'`) or second axis, over all of it: no renderer's spread in it. */
  abstract ownExtent(role: 'first' | 'second'): Extent | null;
  /** An axis' natural extent: the data's, widened by what the renderers draw beyond it. Zooming is held to this. */
  protected widened(axis: Axis, base: Extent | null): Extent | null {
    let e = base;
    if (this.#layer) return e;
    for (let r = this.firstChild; r; r = r.nextSibling) {
      if (!(r instanceof SeriesRenderer) || !r.limit) continue;
      const s = r.limit(this),
        w = axis === this.firstAxis ? s?.first : axis === this.secondAxis ? s?.second : undefined;
      if (w) e = e ? { min: Math.min(e.min, w.min), max: Math.max(e.max, w.max) } : w;
    }
    return e;
  }

  /**
   * Normalize and place into plot pixels. The raw buffer is left alone, so a re-projection needs no refill.
   * The result is `[first, second, ...bound channels]` whatever order the data held them in.
   */
  project(plane: Plane): void {
    const counters = this.counters,
      first = this.firstAxis,
      second = this.secondAxis;
    const { raw, count: n, stride: rs } = this.rows(),
      layer = this.#layer;
    const c0 = this.firstColumn,
      c1 = this.secondColumn,
      boundColumns = this.channels.map((name) => this.columns.indexOf(name)),
      bound = boundColumns.length,
      stride = 2 + bound;
    // The points are made in the spare buffer and compared with the ones the renderers have. Most passes (a pointer moving, a
    // legend hovered) change nothing the points depend on, and then the series keeps its points and its `projection`, so
    // everything made from them (path text, traces, hit geometry) is kept too.
    if (this.#spare.length < n * stride) this.#spare = new Float64Array(Math.max(n * stride, Math.ceil(this.#spare.length * 1.5)));
    const out = this.#spare;
    if (c0 === 0 && c1 === 1 && rs === stride && boundColumns.every((c, k) => c === 2 + k)) {
      out.set(raw.subarray(0, n * stride));
    } else {
      // The raw rows are not laid out as the points are: gather the coordinates, then the bound channels, each from where it is.
      for (let i = 0; i < n; i++) {
        out[i * stride] = raw[i * rs + c0]!;
        out[i * stride + 1] = raw[i * rs + c1]!;
        for (let k = 0; k < bound; k++) out[i * stride + 2 + k] = raw[i * rs + boundColumns[k]!]!;
      }
    }
    if (this.#zero)
      for (let i = 0; i < n; i++) {
        const v = out[i * stride + 1]!;
        if (!Number.isFinite(v) && Number.isFinite(out[i * stride]!)) out[i * stride + 1] = 0;
      }
    // In a stack a point is drawn where the stack puts it: the row's own value has already served its purpose.
    if (layer)
      for (let i = 0; i < n; i++) {
        const v = out[i * stride + 1]!;
        out[i * stride + 1] = Number.isFinite(v) ? layer.top[i]! : NaN;
      }
    let t = performance.now();
    first.normalize(out, n, stride, 0);
    second.normalize(out, n, stride, 1);
    counters.stages.normalize += performance.now() - t;
    t = performance.now();
    const scratch = this.#scratch;
    scratch.data = out;
    scratch.stride = stride;
    scratch.count = n;
    plane.place(scratch, first, second);
    counters.stages.place += performance.now() - t;
    counters.projected++;
    counters.pointsDrawn += n;
    // What else the result depends on, apart from the points: the rows, the stack's layer, the plane, and the axes (a series
    // whose points do not move can still have its bars start somewhere else).
    const signature = `${this.#fills}|${first.range.min},${first.range.max},${second.range.min},${second.range.max}`;
    const kept = this.#points;
    if (
      kept &&
      this.#plane === plane &&
      this.#usedLayer === layer &&
      this.#usedAligned === this.#aligned &&
      this.#signature === signature &&
      kept.stride === stride &&
      kept.count === n &&
      sameNumbers(kept.data, out, n * stride)
    )
      return;
    this.#signature = signature;
    this.#usedLayer = layer;
    this.#usedAligned = this.#aligned;
    if (kept) {
      this.#spare = kept.data;
      kept.data = out;
      kept.stride = stride;
      kept.count = n;
    } else {
      this.#points = { data: out, stride, count: n };
      this.#spare = new Float64Array(0);
    }
    this.#plane = plane;
    this.#projections++;
  }

  /**
   * The line the series is measured from, as placed points: one for each drawn point, in the same place along the first
   * coordinate, with the second held at `value` (kept inside its axis' range). Gaps stay gaps. The plane places it
   * exactly as it places the data, so a renderer that fills between the two needs to know nothing about the plane:
   * the data forward and this backward is a closed shape on a rectangle and on a circle alike.
   */
  baseline(value: number): Readonly<PointBuffer> {
    const plane = this.#plane ?? fail(209),
      n = this.rows().count;
    const key = `${this.#projections}|${value}`;
    if (key === this.#baseKey) return this.#base;
    this.#baseKey = key;
    if (this.#base.data.length < n * 2) this.#base.data = new Float64Array(n * 2);
    const b = this.#base;
    b.count = n;
    this.baselineFractions(value, b.data);
    plane.place(b, this.firstAxis, this.secondAxis);
    return b;
  }

  /**
   * The points of the series as fractions of the two axes, `[first, second]` for each, before the plane has placed them: what a plane draws from
   * when it draws the points itself (`Plane.exactPath`). Gaps are NaN. Worked out when asked, and kept until the series is projected again.
   */
  fractions(): Float64Array {
    if (this.#fractionsKey === this.#projections && this.#fractions) return this.#fractions;
    const { raw, count: n, stride: rs } = this.rows(),
      layer = this.#layer;
    const c0 = this.firstColumn,
      c1 = this.secondColumn;
    const out = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = raw[i * rs + c0]!;
      let v = raw[i * rs + c1]!;
      // As `project` makes them: a gap in a zero-filled series is a zero, and a stack's layer is where a point is drawn.
      if (this.#zero && !Number.isFinite(v) && Number.isFinite(x)) v = 0;
      out[2 * i] = x;
      out[2 * i + 1] = layer ? (Number.isFinite(v) ? layer.top[i]! : NaN) : v;
    }
    this.firstAxis.normalize(out, n, 2, 0);
    this.secondAxis.normalize(out, n, 2, 1);
    this.#fractionsKey = this.#projections;
    return (this.#fractions = out);
  }

  /** `baseline(value)` as fractions of the two axes (see `fractions`): `[first, second]` for each point, written into `out`, which holds at least two numbers a point. */
  baselineFractions(value: number, out: Float64Array): void {
    const { raw, count: n, stride: rs } = this.rows(),
      layer = this.#layer;
    const c0 = this.firstColumn,
      c1 = this.secondColumn;
    for (let i = 0; i < n; i++) {
      out[2 * i] = raw[i * rs + c0]!;
      // A gap in the data stays a gap in the baseline.
      // In a stack the baseline is the layer below, row by row, and `value` is not asked.
      out[2 * i + 1] =
        Number.isFinite(raw[i * rs + c1]!) || (this.#zero && Number.isFinite(raw[i * rs + c0]!)) ? (layer ? layer.base[i]! : value) : NaN;
    }
    this.firstAxis.normalize(out, n, 2, 0);
    this.secondAxis.normalize(out, n, 2, 1);
    // Keep the baseline inside its axis, so a fill to a value outside the range closes along the edge.
    // A baseline the scale cannot place (0 on a log axis) is the edge of the axis; a gap in the data stays a gap.
    const unplaced = !layer && !this.secondAxis.scale.canPlace(value);
    for (let i = 1; i < 2 * n; i += 2) {
      const v = out[i]!;
      if (v < 0) out[i] = 0;
      else if (v > 1) out[i] = 1;
      else if (unplaced && v !== v && Number.isFinite(raw[(i >> 1) * rs + c1]!)) out[i] = 0;
    }
  }
}

// ─── Domain and value ───

export interface DomainSeriesAttributes extends SeriesAttributes {
  /** Default: the plane's first axis (a Cartesian plane's horizontal one, a polar plane's angle). */
  domainAxis?: ElementRef<Axis>;
  /** Default: the plane's second axis (the vertical one, the radius). */
  valueAxis?: ElementRef<Axis>;
}

/**
 * A value at every position along a domain, drawn against two axes. The source delivers ascending in the domain and only
 * the visible part is read, so a view that zooms in refills from the full data, and the value axis fits what is in view.
 */
export class DomainSeries extends Series<DomainSeriesAttributes> {
  static override attrTypes = { ...Series.attrTypes, domainAxis: STRING, valueAxis: STRING } satisfies AttrTypesFor<DomainSeriesAttributes>;
  #domainAxis: Axis | null = null;
  #valueAxis: Axis | null = null;

  get domainAxis(): Axis {
    return this.#domainAxis ?? fail(208);
  }
  get valueAxis(): Axis {
    return this.#valueAxis ?? fail(208);
  }
  get firstAxis(): Axis {
    return this.domainAxis;
  }
  get secondAxis(): Axis {
    return this.valueAxis;
  }
  protected get coordinates(): readonly [string, string] {
    return DOMAIN_VALUE;
  }
  protected override get alongDomain(): boolean {
    return true;
  }

  resolveAxes(plane: Plane): void {
    const a = this.attrs;
    this.#domainAxis = resolveRef<Axis>(a.domainAxis, this, Axis) ?? plane.defaultAxis('first') ?? fail(102);
    this.#valueAxis = resolveRef<Axis>(a.valueAxis, this, Axis) ?? plane.defaultAxis('second') ?? fail(101);
  }

  contributeDomain(): void {
    const d = this.data.domain(),
      n = this.data.pointCount,
      spans = this.spans;
    if (d) {
      // Bars centred on the first and last points reach half a bar past them: the mean gap is what is known before reading.
      const room = spans > 0 && n > 1 && !('bandwidth' in this.domainAxis.scale) ? (spans * (d.max - d.min)) / (n - 1) : 0;
      this.domainAxis.contribute(d.min - room, d.max + room);
    }
    this.contributeReach();
  }
  resolveDomain(): void {
    this.domainAxis.resolve();
  }

  load(estimate: Size): void {
    const ext =
      this.fill({ ...estimate, domainRange: this.domainAxis.range, sorted: this.sorted, columns: this.columns })[this.secondColumn] ??
      NO_EXTENT;
    this.valueAxis.contribute(ext.min, ext.max);
    this.reachBeyondBars(ext);
    this.contributeChannels();
  }

  /** Room on the value axis for markers on the far ends of bars: above the baseline for bars that rise, below it for bars that fall. */
  private reachBeyondBars(ext: Extent): void {
    if (!this.onBars || this.reachPx <= 0) return;
    let base = 0;
    for (let r = this.firstChild; r; r = r.nextSibling) if (r instanceof SeriesRenderer && r.includes.length > 0) base = r.includes[0] ?? 0;
    if (ext.max > base) this.valueAxis.reach(this.reachPx, 'hi');
    if (ext.min < base) this.valueAxis.reach(this.reachPx, 'lo');
  }

  /** Engine protocol for a `Stack`: read the data (the first half of `load`) and give the rows, leaving the extents to the stack. */
  prepare(estimate: Size): Rows {
    this.fill({ ...estimate, domainRange: this.domainAxis.range, sorted: this.sorted, columns: this.columns });
    return this.ownRows();
  }
  /** Engine protocol for a `Stack`: the rest of `load`, with the value extent the stack worked out for its stacked values. */
  settle(extent: Extent | null): void {
    if (extent) {
      this.valueAxis.contribute(extent.min, extent.max);
      this.reachBeyondBars(extent);
    }
    this.contributeChannels();
  }

  ownExtent(role: 'first' | 'second'): Extent | null {
    return role === 'first' ? this.data.domain() : this.data.valueExtent();
  }
  extentFor(axis: Axis): Extent | null {
    if (axis === this.valueAxis && this.layer) return this.layer.extent;
    return axis === this.domainAxis
      ? this.widened(axis, this.data.domain())
      : axis === this.valueAxis
        ? this.widened(axis, this.data.valueExtent())
        : null;
  }
}

// ─── X and Y ───

export interface XYSeriesAttributes<Channel extends string = string> extends SeriesAttributes {
  /**
   * The channel of the source that is x. Default 'x', which a `FlatDataSource` of x,y pairs offers by itself. The points are
   * drawn in the order the source stores them, not sorted by x, unless x is `'domain'`. The type checker confirms the source offers the channel when its
   * channels are spelled out. `'domain'` is the source's own domain column (what a transform that makes a sequence of
   * positions, like a trendline or a density, writes its x to).
   */
  x?: Channel;
  /** The channel that is y. Default 'y'. `'value'` is the source's own value column, which is where a transform writes its y. */
  y?: Channel;
  /** Default: the plane's first axis (a Cartesian plane's horizontal one). */
  xAxis?: ElementRef<Axis>;
  /** Default: the plane's second axis (the vertical one). */
  yAxis?: ElementRef<Axis>;
}

/**
 * Two values per point, one on each axis, joined in the order the source holds them: a scatter, a trajectory, a loop.
 *
 * The points come in the order the source stores them (leave `domain` out and it is the row's index), not sorted by x; with
 * `x: 'domain'` they are asked for ascending along it, as a `DomainSeries` does. x and y are channels, named by
 * the `x` and `y` attributes (default 'x' and 'y'; a `FlatDataSource` of x,y pairs has both without being told). Because
 * order is all there is to go by:
 *  - every point is always read, whatever the view: there is nothing to window by;
 *  - a `Decimator` refuses it, since kernels thin by pixel column of the domain; draw it undecimated (markers already
 *    leave out what is off the plot);
 *  - an axis fits all the data, and zooming one axis does not refit the other to the points in view: with no order
 *    along x, finding those would be a scan of every point on every change.
 */
export class XYSeries<Channel extends string = string> extends Series<XYSeriesAttributes<Channel>, Channel> {
  static override attrTypes = { ...Series.attrTypes, xAxis: STRING, yAxis: STRING } satisfies Partial<AttrTypesFor<XYSeriesAttributes>>;
  #xAxis: Axis | null = null;
  #yAxis: Axis | null = null;

  get xAxis(): Axis {
    return this.#xAxis ?? fail(208);
  }
  get yAxis(): Axis {
    return this.#yAxis ?? fail(208);
  }
  get firstAxis(): Axis {
    return this.xAxis;
  }
  get secondAxis(): Axis {
    return this.yAxis;
  }
  // The data is asked for x and y by name, then the bound channels: any of them may be the source's `domain` or `value`.
  protected get coordinates(): readonly [string, string] {
    return [this.attrs.x ?? 'x', this.attrs.y ?? 'y'];
  }

  resolveAxes(plane: Plane): void {
    const a = this.attrs;
    this.#xAxis = resolveRef<Axis>(a.xAxis, this, Axis) ?? plane.defaultAxis('first') ?? fail(207);
    this.#yAxis = resolveRef<Axis>(a.yAxis, this, Axis) ?? plane.defaultAxis('second') ?? fail(206);
  }

  // An order has no extent to agree on before reading, so there is nothing to do ahead of `load`.
  contributeDomain(): void {
    this.contributeReach();
  }
  resolveDomain(): void {}

  load(estimate: Size): void {
    const ext = this.fill({ ...estimate, domainRange: { min: -Infinity, max: Infinity }, sorted: this.sorted, columns: this.columns });
    const x = ext[this.firstColumn] ?? NO_EXTENT,
      y = ext[this.secondColumn] ?? NO_EXTENT;
    this.xAxis.contribute(x.min, x.max);
    this.yAxis.contribute(y.min, y.max);
    this.contributeChannels();
  }

  #extentOf(name: string): Extent | null {
    return name === 'domain' ? this.data.domain() : name === 'value' ? this.data.valueExtent() : this.data.channelExtent(name);
  }
  ownExtent(role: 'first' | 'second'): Extent | null {
    return this.#extentOf(role === 'first' ? (this.attrs.x ?? 'x') : (this.attrs.y ?? 'y'));
  }
  extentFor(axis: Axis): Extent | null {
    return axis === this.xAxis
      ? this.widened(axis, this.#extentOf(this.attrs.x ?? 'x'))
      : axis === this.yAxis
        ? this.widened(axis, this.#extentOf(this.attrs.y ?? 'y'))
        : null;
  }
}

/**
 * What `paintSample` remembers of each group it draws: whose sample it holds and of how many renderers.
 * @internal
 */
export type SampleCache = Map<string, { series: Series; renderers: number }>;

/**
 * A sample of `series` in a group of `surface` keyed `key`, set at (x, y), `width` by `height`. A group that last held another
 * series (a tooltip line that now reads another one) is made afresh, so nothing of the old one is left; `cache` is what the
 * caller keeps between calls. Returns the group, for what the caller wants to do to it (dim it).
 * @internal
 */
export function paintSample(
  surface: Surface,
  key: string,
  series: Series,
  x: number,
  y: number,
  width: number,
  height: number,
  cache: SampleCache,
): PlatformNode {
  let renderers = 0;
  for (let r = series.firstChild; r; r = r.nextSibling) if (r instanceof SeriesRenderer) renderers++;
  const last = cache.get(key);
  if (!last || last.series !== series || last.renderers !== renderers) {
    surface.removePrefix(key);
    cache.set(key, { series, renderers });
  }
  const group = surface.node(key, 'g');
  surface.set(group, 'transform', `translate(${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100})`);
  series.sample(surface, group, key, width, height);
  return group;
}

/** Whether the first `length` numbers of two buffers are the same, a gap (NaN) being the same as a gap. */
function sameNumbers(a: Float64Array, b: Float64Array, length: number): boolean {
  for (let i = 0; i < length; i++) {
    const x = a[i]!,
      y = b[i]!;
    if (x !== y && (x === x || y === y)) return false;
  }
  return true;
}

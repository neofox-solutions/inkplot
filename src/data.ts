/**
 * The data contract and the base of data sources (the sources themselves are in sources.ts): always delivered domain-sorted, read in place when already sorted.
 *
 * The data contract, and why it is shaped this way
 * ─────────────────────────────────────────────────
 * A *point* is a row of numbers: `[domain, value, ...channels]`. The domain is the position along the independent
 * axis; the channels are extra named columns (size, colour, the x of an XY plot) that a series asks for by name.
 *
 * Everything downstream (windowing to the visible range, decimation to the pixel width, path generation) wants the
 * domain *ascending*: it can then binary-search a window and sweep pixel columns in one pass. So the contract is that
 * every stage **delivers** ascending points. How a source achieves that is its own business:
 *   - Already sorted (`isSorted`, a regular domain, generated data): read where it is stored, no copy ("in place").
 *   - Otherwise: copied once per change into a buffer the source owns ("managed"), NaN domains dropped, sorted if needed.
 * Callers see the same interface either way, which is what lets a million sorted points cost nothing to set up while
 * unsorted object data still just works.
 *
 * Stages form a pipeline (`DataStage`): a source, optionally wrapped by transforms (a Decimator). Each stage answers
 * `plan(context)` with a capacity and a `fill` that writes points into a caller-supplied buffer — the caller owns the
 * memory, so a series can reuse one allocation across redraws. `version` increases on every change and keys all
 * caches (fills, extents). `view()` is the optional zero-copy path used by decimators and extent scans.
 *
 * Extents are tracked per column and reported by `fill`, because the loop that writes a value is the cheapest place
 * to see it. `valueExtent`/`channelExtent` additionally report the extent of *all* the data regardless of the window,
 * which zoom limits and mapped scales need.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, BOOLEAN } from './attrs.ts';
import { type AnyElement, type BaseAttributes, ChartElement, fail } from './element.ts';
import type { Extent } from './geometry.ts';
import type { Series } from './series.ts';

/** Points in pixel space as a series hands them to planes and renderers: `count` rows of `stride` numbers in `data`. */
export interface PointBuffer { data: Float64Array; stride: number; count: number }

/** What a series tells the data about the plot it will draw in, so stages can deliver only what is needed. */
export interface PlanContext {
  readonly width: number;
  readonly height: number;
  readonly domainRange: Extent;
  /**
   * Extra columns to deliver after the domain and the value, in this order: a point is then `2 + channels.length`
   * numbers wide. A series asks for the channels its renderers bind.
   */
  readonly channels: readonly string[];
  /**
   * True when the domain is only the order of the points, as in an XY plot where a path wanders across the plane, and
   * not a position on an axis. Nothing may window or thin such points by pixel column, so a `Decimator` refuses them.
   * Default false.
   */
  readonly sequence?: boolean;
}
/**
 * `extents` has one entry per column: the domain, the value, then each channel.
 *
 * `rowOf` says which row of the source's own storage each written point is. It is there when the points *are* the
 * source's (in place, or sorted into the managed copy) and left out when something made them up (a decimator's
 * min and max), so that an edit can never be aimed at a row that is not there.
 */
export interface FillResult { readonly count: number; readonly extents: readonly Extent[]; readonly rowOf?: (index: number) => number }
/** A promise of points: how much room `fill` may need, and the function that writes them. */
export interface FillPlan { readonly capacity: number; fill(out: Float64Array): FillResult }

/** A read-only look at a source's own storage, so a decimator can scan it without copying. */
export interface PointView {
  readonly data: ArrayLike<number>;
  readonly count: number;
  readonly stride: number;
  readonly domainOffset: number;
  readonly valueOffset: number;
  /** When set, the domain is `start + step * i` and is never read from `data`. */
  readonly regularDomain: { start: number; step: number } | null;
}

/**
 * What the type checker knows of the channels a stage offers, so that a series asking for one by name can be checked
 * against its source. A stage whose channels are not spelled out (`string`) is not checked.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- the wildcard: `any` is assignable to and from every channel set, `never`, `unknown` and `Record` each break a source/series pairing
export type Offers<Channel extends string> = string extends Channel ? any : { [K in Channel]: true };

/** What every stage of the data pipeline provides, whether it is a source or a transform. */
export interface DataStage {
  /** Increases whenever the data changes. Fills are cached against it. */
  readonly version: number;
  readonly pointCount: number;
  /** The extent of the domain, or null if there are no points. */
  domain(): Extent | null;
  /** The extent of every value, whatever part of the domain is being drawn. Null if there are none. */
  valueExtent(): Extent | null;
  /** The extent of every value of a channel, whatever part of the domain is being drawn. Null if there are none. */
  channelExtent(name: string): Extent | null;
  /** Points always come out ascending in the domain, whatever the storage order was. */
  plan(context: PlanContext): FillPlan;
  /**
   * The points, ascending in the domain, as storage that can be read in place and is valid until the next change.
   * Null when there is no such storage (generated data, a transform): use `plan` instead.
   */
  view?(): PointView | null;
  /** The channels it can deliver by name, in order: what to ask for to read all of it. Absent or empty when there are none. */
  readonly channelNames?: readonly string[];
  /** Optional hint for in-place edits: only [start, end) changed. */
  invalidateRange?(start: number, end: number): void;
}

export interface DataSourceAttributes extends BaseAttributes {
  /**
   * The stored points already ascend in the domain. Default false.
   *
   * A source always *delivers* ascending points; this says whether it has to arrange that. When false, the source
   * loads the points once per change into a buffer it owns, drops any with a NaN domain, and sorts them if they are
   * not already in order. When true that copy is skipped and the data is read where it is, so set it for large
   * data you know is ordered. Setting it for data that is not ordered draws wrong lines.
   */
  isSorted?: boolean;
  /**
   * The domain repeats with this period, and the source delivers one more point: the first, again, one period on.
   * That closes the turn for a plane that wraps (a radar or polar plot) so a line or an area meets itself; `wrap: 6`
   * for six categories at 0 to 5 puts a copy of the first at 6. The period must reach past the last point. A wrapped
   * source is always loaded into its own buffer, so `isSorted` only saves it the sort.
   */
  wrap?: number;
}

/** What a source's loader is given: nothing about the plot, since loading from storage does not depend on it. */
const LOAD_CONTEXT: PlanContext = { width: 0, height: 0, domainRange: { min: -Infinity, max: Infinity }, channels: [] };

/** A source's own sorted copy of its points, valid for one `version`. `extents` has one entry per column. */
interface ManagedPoints {
  version: number; data: Float64Array; count: number; stride: number; extents: readonly Extent[];
  /** The storage row of each sorted point, or null when sorted order is storage order. */
  rows: Uint32Array | null;
}
const identity = (i: number) => i;

/** The extent of an empty column: min above max, so any real value replaces it and `min <= max` tests emptiness. */
export const NO_POINTS: Extent = { min: Infinity, max: -Infinity };
/** Shared with sources.ts. Missing values become NaN, which every stage treats as a gap. */
export const num = (v: unknown): number => (v === null || v === undefined ? NaN : +v);

/** The first and last finite values of `n` readings, which for an ascending domain are its extent. */
export function endsOf(n: number, at: (i: number) => number): Extent | null {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) { const x = at(i); if (Number.isFinite(x)) { min = x; break; } }
  for (let i = n - 1; i >= 0; i--) { const x = at(i); if (Number.isFinite(x)) { max = x; break; } }
  return min <= max ? { min, max } : null;
}

/** The extent of every column of `count` rows of `stride` numbers, NaN skipped. The domain column is ascending, so only its ends matter. */
function columnExtents(buf: Float64Array, count: number, stride: number): Extent[] {
  const out: Extent[] = [count > 0 ? { min: buf[0]!, max: buf[stride * (count - 1)]! } : NO_POINTS];
  for (let c = 1; c < stride; c++) {
    let min = Infinity, max = -Infinity;
    for (let i = 0, j = c; i < count; i++, j += stride) { const v = buf[j]!; if (v < min) min = v; if (v > max) max = v; }
    out.push(count > 0 && min <= max ? { min, max } : NO_POINTS);
  }
  return out;
}

/**
 * Everything the contract needs that does not depend on where the numbers are stored: ordering, the managed buffer,
 * wrapping, extents and caching. A concrete source supplies only `fill`, `scanDomain` and (if it can) `orderedView`.
 */
export abstract class DataSource<A extends DataSourceAttributes = DataSourceAttributes, Channel extends string = string>
  extends ChartElement<Series | DataTransform, [], A> implements DataStage {
  static override attrTypes = { ...ChartElement.attrTypes, isSorted: BOOLEAN } satisfies AttrTypesFor<DataSourceAttributes>;
  /** Type checking only: the channel names this source offers. Never present at run time. */
  declare readonly offers?: Offers<Channel>;
  #version = 0;
  private domainCache: { version: number; extent: Extent | null } | null = null;
  private valueCache: { version: number; extent: Extent | null } | null = null;
  private channelCache: { version: number; byName: Map<string, Extent | null> } | null = null;

  /** Increases whenever the data changes. Cached fills are keyed on it. */
  get version(): number { return this.#version; }
  abstract get pointCount(): number;

  /**
   * True when `fill` already writes ascending points, so nothing needs arranging: the data is flagged sorted,
   * or the source generates it in order. A generated source overrides this.
   */
  protected get ordered(): boolean { return this.attrs.isSorted === true; }
  /** Ordered, and so read where it is stored: not when wrapped, since the extra point has to live somewhere. */
  private get inPlace(): boolean { return this.ordered && this.attrs.wrap === undefined; }

  /** The channels this source can deliver, in the order `managed` stores them. Default none. */
  get channelNames(): readonly string[] { return []; }

  /**
   * Write every point into `out`, in storage order, as the domain, the value and then each of `context.channels`,
   * and report the extent of every column, NaN skipped. This is the hot loop, so each source writes its own
   * against its own storage.
   */
  protected abstract fill(out: Float64Array, context: PlanContext): FillResult;
  /**
   * The extent of the domain of an `ordered` source, or null if there are no points. Only the two ends matter,
   * so this never scans. Cached per version by `domain()`.
   */
  protected abstract scanDomain(): Extent | null;
  /** An `ordered` source that can be read in place offers its storage here. Default: nothing to offer. */
  protected orderedView(): PointView | null { return null; }

  // The managed copy is rebuilt lazily, at most once per version, and only for sources that need arranging.
  #managed: ManagedPoints | null = null;
  #loadBuffer = new Float64Array(0);

  /**
   * The points in a buffer this source owns, ascending, rebuilt lazily after each change. An ordered source is
   * only copied; any other has NaN-domain points dropped and is sorted (stably) unless it happens to be in order.
   */
  protected managed(): ManagedPoints {
    const cached = this.#managed;
    if (cached && cached.version === this.version) return cached;
    const names = this.channelNames, stride = 2 + names.length, n = this.pointCount;
    if (this.#loadBuffer.length < stride * (n + 1)) this.#loadBuffer = new Float64Array(stride * (n + 1));
    const loaded = this.fill(this.#loadBuffer, { ...LOAD_CONTEXT, channels: names });
    let buf = this.#loadBuffer, count = loaded.count, extents = loaded.extents;
    let rows: Uint32Array | null = null;
    if (!this.inPlace) {
      // One pass: close the gaps left by NaN domains (compacting in place) and notice whether the order is already right.
      // `origin` (made at the first gap) remembers which stored row each kept point came from.
      let kept = 0, ascending = true, prev = -Infinity, origin: Uint32Array | null = null;
      for (let i = 0; i < count; i++) {
        const x = buf[stride * i]!;
        if (!Number.isFinite(x)) {
          if (!origin) { origin = new Uint32Array(count); for (let k = 0; k < kept; k++) origin[k] = k; }
          continue;
        }
        if (x < prev) ascending = false;
        prev = x;
        if (kept !== i) for (let c = 0; c < stride; c++) buf[stride * kept + c] = buf[stride * i + c]!;
        if (origin) origin[kept] = i;
        kept++;
      }
      rows = origin;
      count = kept;
      if (!ascending) {
        // Sort an index rather than the rows, with the index as tie-break so equal domains keep their original order.
        const order = new Uint32Array(count);
        for (let i = 0; i < count; i++) order[i] = i;
        order.sort((a, b) => buf[stride * a]! - buf[stride * b]! || a - b);
        const sorted = new Float64Array(stride * (count + 1));
        for (let i = 0; i < count; i++) for (let c = 0; c < stride; c++) sorted[stride * i + c] = buf[stride * order[i]! + c]!;
        buf = sorted;
        rows = order.map((o) => (origin ? origin[o]! : o));
      }
      // The closing point is a copy of the first one period on; the loader allocated one spare row for it.
      const wrap = this.attrs.wrap;
      if (wrap !== undefined && count > 0) {
        if (buf[0]! + wrap < buf[stride * (count - 1)]!) fail('the wrap period is shorter than the domain of the data');
        for (let c = 1; c < stride; c++) buf[stride * count + c] = buf[c]!;
        buf[stride * count] = buf[0]! + wrap;
        // The copy is the first point again, so an edit to it lands on the first point's row.
        const longer = new Uint32Array(count + 1);
        if (rows) longer.set(rows.subarray(0, count)); else for (let k = 0; k < count; k++) longer[k] = k;
        longer[count] = longer[0]!;
        rows = longer;
        count++;
      }
      extents = columnExtents(buf, count, stride);
    }
    return (this.#managed = { version: this.version, data: buf, count, stride, extents, rows });
  }

  /** The managed buffer as a view. */
  protected managedView(): PointView {
    const m = this.managed();
    return { data: m.data, count: m.count, stride: m.stride, domainOffset: 0, valueOffset: 1, regularDomain: null };
  }

  /** The points ascending in the domain, to read in place; valid until the next change. Null: use `plan`. */
  view(): PointView | null { return this.inPlace ? this.orderedView() : this.managedView(); }

  /** Any change to the data bumps the version, which is what discards cached fills. */
  override invalidate(): void {
    this.#version++;
    super.invalidate();
  }

  /** Cached per version; an in-place source only looks at its two ends, a managed one already knows. */
  domain(): Extent | null {
    const c = this.domainCache;
    if (c && c.version === this.version) return c.extent;
    const extent = this.inPlace ? this.scanDomain() : (this.managed().extents[0] ?? null);
    const result = extent && extent.min <= extent.max ? extent : null;
    this.domainCache = { version: this.version, extent: result };
    return result;
  }

  /**
   * The extent of all the values, gaps skipped. A scan of the stored points, made once per change and only when asked,
   * for anything that needs the whole range while drawing only part of it (the limits of a zoom).
   */
  valueExtent(): Extent | null {
    const c = this.valueCache;
    if (c && c.version === this.version) return c.extent;
    let min = Infinity, max = -Infinity;
    const v = this.view();
    if (v) {
      const d = v.data, s = v.stride, n = v.count;
      for (let i = 0, j = v.valueOffset; i < n; i++, j += s) { const y = d[j]!; if (y < min) min = y; if (y > max) max = y; }
    } else {
      const plan = this.plan(LOAD_CONTEXT), extent = plan.fill(new Float64Array(2 * plan.capacity)).extents[1];
      if (extent) { min = extent.min; max = extent.max; }
    }
    const extent = min <= max ? { min, max } : null;
    this.valueCache = { version: this.version, extent };
    return extent;
  }

  /** Like `valueExtent` for one channel: a scan made once per change and name, for anything that needs the whole range. */
  channelExtent(name: string): Extent | null {
    let c = this.channelCache;
    if (!c || c.version !== this.version) c = this.channelCache = { version: this.version, byName: new Map() };
    const known = c.byName.get(name);
    if (known !== undefined) return known;
    const plan = this.plan({ ...LOAD_CONTEXT, channels: [name] }), column = plan.fill(new Float64Array(3 * plan.capacity)).extents[2];
    const extent = column && column.min <= column.max ? column : null;
    c.byName.set(name, extent);
    return extent;
  }

  /**
   * In place: fill straight from storage in the requested column order. Managed: copy the sorted buffer, repacking rows
   * only when the series wants a different selection of channels than the source stores.
   */
  plan(context: PlanContext): FillPlan {
    if (this.inPlace) return { capacity: this.pointCount, fill: (out) => ({ ...this.fill(out, context), rowOf: identity }) };
    const m = this.managed(), want = context.channels, have = this.channelNames;
    const rows = m.rows, rowOf = rows ? (i: number) => rows[i]! : identity;
    if (want.length === have.length && want.every((w, i) => w === have[i])) {
      return {
        capacity: m.count,
        fill: (out) => { out.set(m.data.subarray(0, m.stride * m.count)); return { count: m.count, extents: m.extents, rowOf }; },
      };
    }
    // A different selection of channels: repack each row.
    const columns = want.map((name) => { const i = have.indexOf(name); return i < 0 ? fail(`the data has no channel "${name}"`) : 2 + i; });
    const out2 = 2 + want.length;
    return {
      capacity: m.count,
      fill: (out) => {
        for (let i = 0; i < m.count; i++) {
          out[out2 * i] = m.data[m.stride * i]!;
          out[out2 * i + 1] = m.data[m.stride * i + 1]!;
          for (let c = 0; c < columns.length; c++) out[out2 * i + 2 + c] = m.data[m.stride * i + columns[c]!]!;
        }
        return { count: m.count, extents: [m.extents[0]!, m.extents[1]!, ...columns.map((c) => m.extents[c]!)], rowOf };
      },
    };
  }
}

/** A stage that takes another stage as input: a decimator, a filter, a resampler. It has no storage of its own, so it implements the stage interface directly. */
export abstract class DataTransform<A extends BaseAttributes = BaseAttributes, Children extends readonly AnyElement[] = [source: DataNode], Channel extends string = string>
  extends ChartElement<Series | DataTransform, Children, A> implements DataStage {
  /** Type checking only: the channel names this stage offers. Never present at run time. */
  declare readonly offers?: Offers<Channel>;
  abstract get version(): number;
  abstract get pointCount(): number;
  /** The channels it delivers by name. Default none; a transform that passes its source's through, or makes its own, says so. */
  get channelNames(): readonly string[] { return []; }
  /** A transform that keeps its output in a typed array may offer it for reading in place. */
  view?(): PointView | null;
  abstract domain(): Extent | null;
  abstract valueExtent(): Extent | null;
  abstract channelExtent(name: string): Extent | null;
  abstract plan(context: PlanContext): FillPlan;
}

/** A source or a transform. `DataNode<'x'>` is one the type checker knows offers a channel called x. */
export type DataNode<Channel extends string = string> = DataSource<DataSourceAttributes, Channel> | DataTransform<BaseAttributes, readonly AnyElement[], Channel>;

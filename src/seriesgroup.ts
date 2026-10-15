/**
 * Series groups: one series for each value of a channel of the data.
 *
 *   new SeriesGroup({ channel: 'country', name: (key) => names[key] },
 *     new FlatDataSource({ data, stride: 3, channels: { country: 2 } }),
 *     new LinePath(new LinearCurve()))
 *
 * A group splits what its source delivers by the group channel and draws each part as a series of its own, with a copy of
 * the renderers it was given. The series are real ones (they have a name, a palette colour, a legend entry, hits), made
 * from the data and not written into the tree: they are not children as far as iteration and JSON go, so a saved chart
 * holds the group as it was written and never what it made of the data.
 *
 * What the elements inside the group are: a template. The source is read by the group; each renderer is copied for each
 * series (so its `id` gets the key added), and the originals draw nothing.
 *
 * A key is a number, as every channel is. `name` turns it into the series' name; `bind` gives each series an attribute
 * from a colour or size axis, worked out from the key (or from `map(key)`), once for the series and not once per point.
 */
/* oxlint-disable typescript/no-non-null-assertion -- stride-addressed rows of the managed buffers: every index is bounded by the row count */
/* oxlint-disable typescript/consistent-type-assertions -- elements are copied and refreshed without knowing their classes: a constructor, and an attribute bag read by name, are known only structurally */
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import type { Axis } from './axis.ts';
import { type DataNode, DataSource, DataTransform, type FillResult, type FillPlan, type PlanContext, type PointView } from './data.ts';
import { type AnyElement, type BaseAttributes, ChartElement, type ElementRef, fail, resolveRef } from './element.ts';
import { type ChartEvent, EVENT_PAINT } from './events.ts';
import type { Extent, Size } from './geometry.ts';
import type { MappedDimension } from './mapped.ts';
import type { Plane } from './plane.ts';
import { type AnySeriesRenderer, SeriesRenderer } from './renderer.ts';
import { DomainSeries, type Series, type SeriesHolder, XYSeries } from './series.ts';

/**
 * What a group gives one attribute of its series' renderers, worked out once for each series from its key: either the value
 * of a colour or size axis at the key (or at `value(key)`, which is how a series is coloured by something about it), or
 * whatever `map(key)` says, as a renderer's own `{ channel, map }` binding does. Both are read at every paint, so what they
 * read from outside (a playback year) takes effect when the group is invalidated.
 */
export type GroupBinding =
  | { axis: ElementRef<MappedDimension<unknown>>; value?: (key: number) => number }
  | { map: (key: number) => string | number };

export interface SeriesGroupAttributes extends BaseAttributes {
  /** The channel of the data that says which series a point is in. It is not offered to the renderers. */
  channel: string;
  /** What a series is called, from its key. Default: the key as text. */
  name?: (key: number) => string;
  /** The axes of every series (as a `DomainSeries` names them). */
  domainAxis?: ElementRef<Axis>;
  valueAxis?: ElementRef<Axis>;
  /** The channel that is x, when the series are `XYSeries` (a path or scatter for each key, or a heat map): leave it out for `DomainSeries`. */
  x?: string;
  xAxis?: ElementRef<Axis>;
  yAxis?: ElementRef<Axis>;
  /** What a missing value means in every series (see `Series`). */
  gaps?: 'break' | 'connect' | 'zero';
  /** An attribute of the renderers of every series, from the key: `{ stroke: { axis: 'heat' }, opacity: { map: (key) => key > year ? 0.2 : 1 } }`. */
  bind?: Readonly<Record<string, GroupBinding>>;
  /** The order of the series, so their palette colours: 'first' (as the keys first appear in the domain, the default), 'sorted' (by key), or a comparison of keys. */
  order?: 'first' | 'sorted' | ((a: number, b: number) => number);
  /** The most series made; more keys than this are left out (`omitted` says how many). Default 100. */
  maxGroups?: number;
}

const DEFAULT_MAX = 100;
const EVERYTHING: Extent = { min: -Infinity, max: Infinity };

/**
 * An element made again from its class and attributes, children too (every element is `new X(attrs, ...children)`), with the
 * suffix added to each id. In a chain of data transforms the source at the bottom is not copied but replaced by `leaf`.
 */
function copyOf<E extends AnyElement>(e: E, suffix: string, leaf?: GroupSlice): E {
  if (leaf && e instanceof DataSource) return leaf as unknown as E;
  const Class = e.constructor as new (...args: unknown[]) => E;
  const attrs: Record<string, unknown> = { ...e.attrs };
  if (typeof attrs.id === 'string') attrs.id = `${attrs.id}/${suffix}`;
  return new Class(attrs, ...[...e].map((c) => copyOf(c, suffix, leaf)));
}
/** Bring a copy's attributes back in line with what it was copied from, children too, leaving alone the attributes in `keep` (a group binds them). */
function refresh(from: AnyElement, to: AnyElement, keep: ReadonlySet<string>): void {
  if (from instanceof DataSource) return;
  const patch: Record<string, unknown> = {};
  const was = to.attrs as Record<string, unknown>,
    is = from.attrs as Record<string, unknown>;
  for (const k of Object.keys(is)) if (k !== 'id' && !keep.has(k) && was[k] !== is[k]) patch[k] = is[k];
  for (const k of Object.keys(was)) if (k !== 'id' && !keep.has(k) && !(k in is)) patch[k] = undefined;
  if (Object.keys(patch).length > 0) to.setAttributes(patch as never);
  const copies = [...to];
  [...from].forEach((c, i) => {
    const t = copies[i];
    if (t) refresh(c, t, keep);
  });
}
/** The colour or size axis a binding names (a `MappedDimension` is not imported here, so that a group costs nothing to a chart that does not bind). */
function dimensionOf(spec: { axis: ElementRef<MappedDimension<unknown>> }, from: AnyElement): MappedDimension<unknown> {
  const d = resolveRef<MappedDimension<unknown>>(spec.axis, from);
  return 'valueAt' in d ? d : fail('SeriesGroup: a binding needs a ColorAxis or a ScalarAxis');
}
/** The source at the bottom of a chain of data transforms: what the group splits. */
function leafOf(node: DataNode): DataSource {
  let n: AnyElement = node;
  while (!(n instanceof DataSource)) {
    let next: AnyElement | undefined;
    for (const c of n) if (c instanceof DataSource || c instanceof DataTransform) next = c;
    n = next ?? fail('SeriesGroup: a data transform in the group has no source beneath it');
  }
  return n;
}

/** The rows of one key, as a data source of their own: ascending, because the rows they were taken from were. */
class GroupSlice extends DataSource {
  #rows = new Float64Array(0);
  #count = 0;
  #stride = 2;
  #names: readonly string[] = [];
  #origin: Uint32Array = new Uint32Array(0);

  /** Take new rows: `stride` numbers each (domain, value, then `names`), and the row of the group's source each came from. */
  load(rows: Float64Array<ArrayBuffer>, count: number, stride: number, names: readonly string[], origin: Uint32Array): void {
    this.#rows = rows;
    this.#count = count;
    this.#stride = stride;
    this.#names = names;
    this.#origin = origin;
    this.invalidate();
  }
  get pointCount(): number {
    return this.#count;
  }
  override get channelNames(): readonly string[] {
    return this.#names;
  }
  protected override get ordered(): boolean {
    return true;
  }
  protected override orderedView(): PointView {
    return { data: this.#rows, count: this.#count, stride: this.#stride, domainOffset: 0, valueOffset: 1, regularDomain: null };
  }
  protected scanDomain(): Extent | null {
    const n = this.#count;
    return n === 0 ? null : { min: this.#rows[0]!, max: this.#rows[this.#stride * (n - 1)]! };
  }
  protected fill(out: Float64Array, context: PlanContext): FillResult {
    const names = context.channels,
      k = names.length,
      os = 2 + k,
      n = this.#count,
      s = this.#stride,
      rows = this.#rows;
    const columns = names.map((name) => {
      const i = this.#names.indexOf(name);
      return i < 0 ? fail(`the data has no channel "${name}"`) : 2 + i;
    });
    const min = new Float64Array(os).fill(Infinity),
      max = new Float64Array(os).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < os; c++) {
        const v = rows[s * i + (c < 2 ? c : columns[c - 2]!)]!;
        out[os * i + c] = v;
        if (v < min[c]!) min[c] = v;
        if (v > max[c]!) max[c] = v;
      }
    }
    const extents: Extent[] = [];
    for (let c = 0; c < os; c++) extents.push(min[c]! <= max[c]! ? { min: min[c]!, max: max[c]! } : { min: Infinity, max: -Infinity });
    return { count: n, extents };
  }
  override plan(context: PlanContext): FillPlan {
    return { capacity: this.#count, fill: (out) => ({ ...this.fill(out, context), rowOf: (i) => this.#origin[i]! }) };
  }
}

export class SeriesGroup
  extends ChartElement<Plane, [data: DataNode, ...renderers: AnySeriesRenderer[]], SeriesGroupAttributes>
  implements SeriesHolder
{
  static override attrTypes = {
    ...ChartElement.attrTypes,
    channel: STRING,
    domainAxis: STRING,
    valueAxis: STRING,
    x: STRING,
    xAxis: STRING,
    yAxis: STRING,
    gaps: STRING,
    maxGroups: NUMBER,
  } satisfies Partial<AttrTypesFor<SeriesGroupAttributes>>;

  #series = new Map<number, Series>();
  #list: readonly Series[] = [];
  #slices = new Map<number, GroupSlice>();
  #source: DataNode | null = null;
  #version = -1;
  #omitted = 0;
  // Something in or under the group changed: its copies are brought in line with what they were copied from, once.
  #dirty = true;

  /** The template's data: what the group splits. */
  get data(): DataNode {
    return this.child(0, DataSource, DataTransform);
  }
  /** How many keys were left out at the last split because `maxGroups` was reached. */
  get omitted(): number {
    this.sync();
    return this.#omitted;
  }
  /** The keys that have a series, in the series' order. */
  get keys(): readonly number[] {
    this.sync();
    return [...this.#series.keys()];
  }

  /** The children that were written, not the series made from the data. */
  override *[Symbol.iterator](): Generator<AnySeriesRenderer | DataNode> {
    const made = new Set<AnyElement>(this.#series.values());
    for (const c of super[Symbol.iterator]()) if (!made.has(c)) yield c;
  }

  override invalidate(): void {
    this.#dirty = true;
    super.invalidate();
  }

  /** The series, one for each key, split afresh when the data has changed. */
  get members(): readonly Series[] {
    this.sync();
    return this.#list;
  }

  /** Engine protocol, called by the plane in place of each series' own `load`. */
  load(estimate: Size): void {
    for (const m of this.members) if (m.shown) m.load(estimate);
    const bind = this.attrs.bind;
    if (bind)
      for (const spec of Object.values(bind)) {
        if (!('axis' in spec)) continue;
        const dimension = dimensionOf(spec, this);
        for (const key of this.#series.keys()) {
          const v = spec.value ? spec.value(key) : key;
          dimension.contribute(v, v);
        }
      }
  }

  override onEvent(ev: ChartEvent): void {
    if (ev.type === EVENT_PAINT) this.paintBindings();
  }

  /** Give each series' renderers the attributes the bindings say for its key. The axes are settled by now, since drawing is what reads them. */
  private paintBindings(): void {
    const bind = this.attrs.bind;
    if (!bind) return;
    for (const [attribute, spec] of Object.entries(bind)) {
      const dimension = 'axis' in spec ? dimensionOf(spec, this) : null;
      for (const [key, series] of this.#series) {
        const look =
          'map' in spec ? spec.map(key) : (dimension?.valueAt(dimension.fractionOf(spec.value ? spec.value(key) : key)) as string | number);
        for (const r of series) if (r instanceof SeriesRenderer) r.restyle(attribute, look);
      }
    }
  }

  /** Read the source and give each key its rows when the data has changed; bring the series in line with the group when it has. */
  private sync(): void {
    const data = this.data;
    if (data !== this.#source || data.version !== this.#version) this.split(data);
    if (this.#dirty) {
      this.#dirty = false;
      const keep = new Set(Object.keys(this.attrs.bind ?? {}));
      for (const [key, series] of this.#series) {
        series.setAttributes(this.seriesAttributes(key));
        const renderers = [...series].filter((c) => c instanceof SeriesRenderer);
        const template = [...this].filter((c) => c instanceof SeriesRenderer);
        renderers.forEach((r, i) => template[i] && refresh(template[i], r, keep));
        refresh(data, series.data, new Set());
      }
    }
  }

  private split(data: DataNode): void {
    this.#source = data;
    this.#version = data.version;
    const a = this.attrs;
    const leaf = leafOf(data);
    const names = leaf.channelNames;
    const g = names.indexOf(a.channel);
    if (g < 0) fail(`SeriesGroup: the data has no channel "${a.channel}"`);
    const stride = 2 + names.length;
    const plan = leaf.plan({ width: 1, height: 1, domainRange: EVERYTHING, channels: names });
    const all = new Float64Array(plan.capacity * stride);
    const filled = plan.fill(all);
    // Pass one: how many rows each key has, in the order the keys first appear.
    const counts = new Map<number, number>();
    for (let i = 0; i < filled.count; i++) {
      const key = all[stride * i + 2 + g]!;
      if (Number.isFinite(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let keys = [...counts.keys()];
    const order = a.order ?? 'first';
    if (order === 'sorted') keys.sort((x, y) => x - y);
    else if (typeof order === 'function') keys.sort(order);
    const max = a.maxGroups ?? DEFAULT_MAX;
    this.#omitted = Math.max(0, keys.length - max);
    keys = keys.slice(0, max);
    // Pass two: the rows of each kept key, without the group column, with where each came from.
    const outStride = stride - 1;
    const fresh = new Map<number, { rows: Float64Array<ArrayBuffer>; origin: Uint32Array; n: number }>();
    for (const key of keys) {
      const n = counts.get(key) ?? 0;
      fresh.set(key, { rows: new Float64Array(n * outStride), origin: new Uint32Array(n), n: 0 });
    }
    const rest = names.filter((_, i) => i !== g);
    for (let i = 0; i < filled.count; i++) {
      const part = fresh.get(all[stride * i + 2 + g]!);
      if (!part) continue;
      let o = part.n * outStride;
      for (let c = 0; c < stride; c++) if (c !== 2 + g) part.rows[o++] = all[stride * i + c]!;
      part.origin[part.n++] = filled.rowOf ? filled.rowOf(i) : i;
    }
    // Series for keys that came, and an end to those that went; the ones that stay keep their place and their `visible`.
    for (const [key, series] of this.#series)
      if (!fresh.has(key)) {
        this.release(series);
        this.#series.delete(key);
        this.#slices.delete(key);
      }
    const made = new Map<number, Series>();
    for (const key of keys) {
      const part = fresh.get(key);
      if (!part) continue;
      let series = this.#series.get(key),
        slice = this.#slices.get(key);
      if (!series || !slice) {
        slice = new GroupSlice({});
        series = this.makeSeries(key, slice);
        this.#slices.set(key, slice);
        this.adopt(series);
      }
      slice.load(part.rows, part.n, outStride, rest, part.origin);
      made.set(key, series);
    }
    this.#series = made;
    this.#list = keys.flatMap((k) => made.get(k) ?? []);
  }

  private seriesAttributes(key: number): Record<string, unknown> {
    const a = this.attrs;
    const attrs: Record<string, unknown> = { name: a.name ? a.name(key) : String(key), gaps: a.gaps };
    if (a.x === undefined) {
      attrs.domainAxis = a.domainAxis;
      attrs.valueAxis = a.valueAxis;
    } else {
      attrs.x = a.x;
      attrs.xAxis = a.xAxis;
      attrs.yAxis = a.yAxis;
    }
    return attrs;
  }

  private makeSeries(key: number, slice: GroupSlice): Series {
    const attrs = this.seriesAttributes(key);
    for (const k of Object.keys(attrs)) if (attrs[k] === undefined) delete attrs[k];
    const suffix = String(key);
    const renderers: AnySeriesRenderer[] = [];
    for (const c of this) if (c instanceof SeriesRenderer) renderers.push(copyOf(c, suffix));
    const chain = copyOf(this.data, suffix, slice);
    return this.attrs.x === undefined
      ? new DomainSeries(attrs, chain, ...renderers)
      : new XYSeries(attrs as { x: string }, chain, ...renderers);
  }
}

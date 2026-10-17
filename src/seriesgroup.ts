/**
 * Series groups: one series for each value of a channel of the data.
 *
 *   new SeriesGroup({ channel: 'country', name: (key) => names[key] },
 *     new FlatDataSource({ data, stride: 3, channels: { country: 2 } }),
 *     new LinePath(new LinearCurve()))
 *
 * A group counts the rows of what its source delivers by the group channel and draws each key as a series of its own, with a
 * copy of the renderers it was given. The series are real ones (they have a name, a palette colour, a legend entry, hits), made
 * from the data and not written into the tree: they are not children as far as iteration and JSON go, so a saved chart
 * holds the group as it was written and never what it made of the data.
 *
 * What the elements inside the group are: a template. The source is read by the group; each renderer is copied for each
 * series (so its `id` gets the key added), and the originals draw nothing. The data stages between the source and the
 * renderers are not copied: each is a `KeyedTransform`, which works on the rows of one key when it is asked for them.
 *
 * A key is a number, as every channel is. `name` turns it into the series' name; `bind` gives each series an attribute
 * from a colour or size axis, worked out from the key (or from `map(key)`), once for the series and not once per point.
 */
/* oxlint-disable typescript/consistent-type-assertions -- elements are copied and refreshed without knowing their classes: a constructor, and an attribute bag read by name, are known only structurally */
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import type { Axis } from './axis.ts';
import { type DataNode, DataSource, DataTransform } from './data.ts';
import { canPartition, copyOf, KeySource, leafOf, type Partition, partitionOf, refresh } from './partition.ts';
import { type AnyElement, type BaseAttributes, ChartElement, childrenOfType, type ElementRef, fail, resolveRef } from './element.ts';
import { type ChartEvent, EVENT_PAINT } from './events.ts';
import type { Size } from './geometry.ts';
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
/** The colour or size axis a binding names (a `MappedDimension` is not imported here, so that a group costs nothing to a chart that does not bind). */
function dimensionOf(spec: { axis: ElementRef<MappedDimension<unknown>> }, from: AnyElement): MappedDimension<unknown> {
  const d = resolveRef<MappedDimension<unknown>>(spec.axis, from);
  return 'valueAt' in d ? d : fail('SeriesGroup: a binding needs a ColorAxis or a ScalarAxis');
}
/** The name of the stage in a chain of data stages that a group cannot work through: the lowest one that is not a `KeyedTransform`, for the error. */
function stageThatCannot(node: DataNode): string {
  let n: AnyElement = node;
  for (;;) {
    let below: DataNode | undefined;
    for (let c = n.firstChild; c; c = c.nextSibling) if (c instanceof DataSource || c instanceof DataTransform) below = c;
    if (!below || canPartition(below)) return n.constructor.name;
    n = below;
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
  #parts = new Map<number, KeySource>();
  #partition: Partition | null = null;
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
    this.contribute();
  }

  /** Engine protocol: add what the bindings read from their axes to the axes' ranges. A `Stack` that holds the group calls it after it has loaded the members itself. */
  contribute(): void {
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
        for (let r = series.firstChild; r; r = r.nextSibling) if (r instanceof SeriesRenderer) r.restyle(attribute, look);
      }
    }
  }

  /** Read the source and give each key its rows when the data has changed; bring the series in line with the group when it has. */
  private sync(): void {
    const data = this.data;
    if (data !== this.#source || data.version !== this.#version) {
      this.partition(data);
    }
    if (this.#dirty) {
      this.#dirty = false;
      const keep = new Set(Object.keys(this.attrs.bind ?? {}));
      for (const [key, series] of this.#series) {
        series.setAttributes(this.seriesAttributes(key));
        const renderers = childrenOfType(series, SeriesRenderer);
        const template = childrenOfType(this, SeriesRenderer);
        renderers.forEach((r, i) => template[i] && refresh(template[i], r, keep));
      }
    }
  }

  /**
   * Count the rows of each key and give each key a series, which reads its rows from the template's stages by key (see
   * partition.ts): nothing is copied out of the source, and nothing of the template is copied for the series.
   */
  private partition(data: DataNode): void {
    const a = this.attrs;
    if (!canPartition(data))
      fail(
        `SeriesGroup: ${stageThatCannot(data)} cannot work on the rows of a key: a data transform in a group has to extend KeyedTransform`,
      );
    const leaf = leafOf(data);
    const old = this.#partition;
    const max = a.maxGroups ?? DEFAULT_MAX,
      order = a.order ?? 'first';
    // Rows that are kept somewhere else (a worker) are counted there, and the partition is what it last said.
    let remote: Partition | null | undefined;
    if (data instanceof DataTransform && data.partitionBy) {
      if (typeof order === 'function')
        fail('SeriesGroup: over a WorkerBoundary the series are in the order of `first` or `sorted`: a function cannot go to the worker');
      remote = data.partitionBy(a.channel, order, max);
    }
    if (remote ? remote === old : data === this.#source && old && old.source === leaf && old.version === leaf.version) {
      // Only a stage above the source changed: the same rows, asked for again.
      this.#version = data.version;
      for (const part of this.#parts.values()) part.touch();
      return;
    }
    const partition = remote ?? partitionOf(leaf, a.channel, order, max) ?? fail(`SeriesGroup: the data has no channel "${a.channel}"`);
    this.#source = data;
    this.#version = data.version;
    this.#partition = partition;
    this.#omitted = partition.omitted;
    const rest = leaf.channelNames.filter((n) => n !== a.channel);
    const keep = new Set(partition.keys);
    for (const [key, series] of this.#series)
      if (!keep.has(key)) {
        this.release(series);
        this.#series.delete(key);
        this.#parts.delete(key);
      }
    const made = new Map<number, Series>();
    partition.keys.forEach((key, slot) => {
      let series = this.#series.get(key),
        part = this.#parts.get(key);
      if (!series || !part) {
        part = new KeySource(() => this.data);
        series = this.makeSeries(key, part);
        this.#parts.set(key, part);
        this.adopt(series);
      }
      part.load(partition, slot, rest);
      made.set(key, series);
    });
    this.#series = made;
    this.#list = partition.keys.flatMap((k) => made.get(k) ?? []);
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

  private makeSeries(key: number, data: KeySource): Series {
    const attrs = this.seriesAttributes(key);
    for (const k of Object.keys(attrs)) if (attrs[k] === undefined) delete attrs[k];
    const suffix = String(key);
    const renderers: AnySeriesRenderer[] = [];
    for (const c of this) if (c instanceof SeriesRenderer) renderers.push(copyOf(c, suffix));
    return this.attrs.x === undefined
      ? new DomainSeries(attrs, data, ...renderers)
      : new XYSeries(attrs as { x: string }, data, ...renderers);
  }
}

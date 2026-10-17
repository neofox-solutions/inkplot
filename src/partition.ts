/**
 * Partitions: the rows of a source split by the value of one channel (a `SeriesGroup`'s key), without being copied.
 *
 * Reading the rows once to count them is all a partition costs to make, however many keys there are. What each key then needs
 * is asked of the stages above the source with `planPartitioned`, which is a `plan` for one key. A stage that thins the rows
 * (a `Decimator`) can do it for every key in one pass over the storage, instead of once for each key over its own copy.
 */
/* oxlint-disable typescript/no-non-null-assertion -- stride-addressed rows of a view: every index is bounded by the row count */
import {
  DataSource,
  DataTransform,
  type DataNode,
  type FillPlan,
  type FillResult,
  NO_POINTS,
  type PlanContext,
  type PointView,
} from './data.ts';
import { type AnyElement, type BaseAttributes, fail } from './element.ts';
import type { Extent } from './geometry.ts';

/** Integer keys in this range are found with a table; any other key (a fraction, a large number) with a map. */
export const TABLE_BASE = 32768;
const TABLE_SIZE = 65536;

/** What a stage that can serve one key at a time offers: the room a key may need, and the points of a key. */
export interface PartitionedPlan {
  capacity(slot: number): number;
  fill(slot: number, out: Float64Array): FillResult;
}

/** The rows of a source split by a channel. A key's *slot* is its place in `keys`. */
export interface Partition {
  readonly channel: string;
  readonly source: DataSource;
  /** The source's rows, in place when it can offer them (else one copy of them), with the channel among its offsets. */
  readonly view: PointView;
  readonly keyOffset: number;
  /** The version of the source this was made at. */
  readonly version: number;
  /** The keys that are kept, in the order of their series. */
  readonly keys: readonly number[];
  /** How many keys were left out because there were more than were wanted. */
  readonly omitted: number;
  /** The storage row of row `i` of `view`: what an edit to that point has to aim at. */
  storageRow(i: number): number;
  /** The rows each key has. */
  readonly counts: Int32Array;
  /** The first and last row of each key in `view`. */
  readonly firstRows: Int32Array;
  readonly lastRows: Int32Array;
  /** The extent of each key's domain and values (null for a key without a finite one). */
  readonly domains: readonly (Extent | null)[];
  readonly values: readonly (Extent | null)[];
  /** The slot of a key, or -1 if it has none (a gap in the keys, or a key that was left out). */
  readonly slotOf: (key: number) => number;
  /** `slotOf` as a table for whole-number keys (index: key + `TABLE_BASE`), and whether every row's key is one: the hot loops then skip the checks. */
  readonly table: Int32Array;
  readonly tableOnly: boolean;
  /** The rows of each key, as indexes into `view`, found once on first use. */
  rows(): readonly Uint32Array[];
  /**
   * Each key's domain and values on their own, side by side, made once on first use (a copy of the two columns). A pass over
   * these is several times quicker than one over the rows of all the keys together, so a stage that is asked for the same
   * rows again and again (a pan or a zoom) is better off with them; one asked once is not.
   */
  alone(): readonly PointView[];
  /** Whether `alone` has been made. */
  readonly gathered: boolean;
  /** The extent of one channel's values, for each key. */
  channelExtents(name: string): readonly (Extent | null)[];
}

type Order = 'first' | 'sorted' | ((a: number, b: number) => number);

/**
 * Split the rows of `source` by `channel`. Null when the source has no such channel. A source that cannot offer its rows in
 * place (one that makes them up as it is asked) is filled once into a buffer, which is the only copy there is.
 */
export function partitionOf(source: DataSource, channel: string, order: Order, max: number): Partition | null {
  let view = source.view();
  let storageRow = (i: number) => source.storageRow(i);
  if (view?.channelOffsets?.[channel] === undefined) {
    const names = source.channelNames;
    if (!names.includes(channel)) return null;
    const stride = 2 + names.length;
    const plan = source.plan({ width: 1, height: 1, domainRange: { min: -Infinity, max: Infinity }, channels: names });
    const buffer = new Float64Array(plan.capacity * stride);
    const filled = plan.fill(buffer);
    const channelOffsets: Record<string, number> = {};
    names.forEach((name, i) => (channelOffsets[name] = 2 + i));
    view = { data: buffer, count: filled.count, stride, domainOffset: 0, valueOffset: 1, regularDomain: null, channelOffsets };
    storageRow = filled.rowOf ?? ((i) => i);
  }
  const keyOffset = view.channelOffsets?.[channel] ?? fail(`the data has no channel "${channel}"`);
  const d = view.data,
    s = view.stride,
    n = view.count,
    yo = view.valueOffset;
  // One pass: which keys there are (in the order they first appear), how many rows each has, and where its values reach.
  const table = new Int32Array(TABLE_SIZE).fill(-1);
  const others = new Map<number, number>();
  const found: number[] = [];
  let tableOnly = true;
  const count: number[] = [],
    first: number[] = [],
    last: number[] = [],
    vMin: number[] = [],
    vMax: number[] = [];
  for (let i = 0, p = keyOffset, q = yo; i < n; i++, p += s, q += s) {
    const k = d[p]!;
    const j = k + TABLE_BASE;
    let slot: number;
    if (j >= 0 && j < TABLE_SIZE && (j | 0) === j) {
      slot = table[j]!;
      if (slot < 0) {
        slot = table[j] = found.length;
        found.push(k);
        count.push(0);
        first.push(i);
        last.push(i);
        vMin.push(Infinity);
        vMax.push(-Infinity);
      }
    } else if (Number.isFinite(k)) {
      tableOnly = false;
      let known = others.get(k);
      if (known === undefined) {
        known = found.length;
        others.set(k, known);
        found.push(k);
        count.push(0);
        first.push(i);
        last.push(i);
        vMin.push(Infinity);
        vMax.push(-Infinity);
      }
      slot = known;
    } else {
      tableOnly = false;
      continue;
    }
    count[slot]!++;
    last[slot] = i;
    const y = d[q]!;
    if (y < vMin[slot]!) vMin[slot] = y;
    if (y > vMax[slot]!) vMax[slot] = y;
  }
  // The order of the series, and the cut at the most wanted.
  const appeared = found.map((_, i) => i);
  if (order === 'sorted') appeared.sort((a, b) => found[a]! - found[b]!);
  else if (typeof order === 'function') appeared.sort((a, b) => order(found[a]!, found[b]!));
  const kept = appeared.slice(0, max);
  const keys = kept.map((a) => found[a]!);
  const reg = view.regularDomain;
  const xAt = (i: number) => (reg ? reg.start + reg.step * i : d[i * s + view.domainOffset]!);
  const domains = kept.map((a) => (count[a]! > 0 ? { min: xAt(first[a]!), max: xAt(last[a]!) } : null));
  const values = kept.map((a) => (vMin[a]! <= vMax[a]! ? { min: vMin[a]!, max: vMax[a]! } : null));
  // The table and map of the kept keys alone, which is what the hot loops of the stages above look keys up in.
  const slots = new Int32Array(TABLE_SIZE).fill(-1);
  const otherSlots = new Map<number, number>();
  keys.forEach((k, slot) => {
    const j = k + TABLE_BASE;
    if (j >= 0 && j < TABLE_SIZE && (j | 0) === j) slots[j] = slot;
    else otherSlots.set(k, slot);
  });
  const slotOf = (k: number): number => {
    const j = k + TABLE_BASE;
    if (j >= 0 && j < TABLE_SIZE && (j | 0) === j) return slots[j]!;
    return otherSlots.get(k) ?? -1;
  };
  const counts = Int32Array.from(kept, (a) => count[a]!);
  let rowLists: Uint32Array[] | null = null;
  let aloneViews: PointView[] | null = null;
  const extentsOf = new Map<string, (Extent | null)[]>();
  return {
    channel,
    source,
    view,
    keyOffset,
    version: source.version,
    storageRow,
    keys,
    omitted: Math.max(0, found.length - kept.length),
    counts,
    firstRows: Int32Array.from(kept, (a) => first[a]!),
    lastRows: Int32Array.from(kept, (a) => last[a]!),
    domains,
    values,
    slotOf,
    table: slots,
    tableOnly,
    rows() {
      if (rowLists) return rowLists;
      const lists = keys.map((_, slot) => new Uint32Array(counts[slot]!));
      const at = new Int32Array(keys.length);
      for (let i = 0, p = keyOffset; i < n; i++, p += s) {
        const slot = slotOf(d[p]!);
        if (slot >= 0) lists[slot]![at[slot]!++] = i;
      }
      return (rowLists = lists);
    },
    get gathered() {
      return aloneViews !== null;
    },
    alone() {
      if (aloneViews) return aloneViews;
      const arrays = keys.map((_, slot) => new Float64Array(2 * counts[slot]!));
      const at = new Int32Array(keys.length);
      const dxo = view.domainOffset;
      for (let i = 0, p = keyOffset; i < n; i++, p += s) {
        const slot = slotOf(d[p]!);
        if (slot < 0) continue;
        const out = arrays[slot]!,
          m = 2 * at[slot]!++;
        out[m] = reg ? reg.start + reg.step * i : d[i * s + dxo]!;
        out[m + 1] = d[i * s + yo]!;
      }
      return (aloneViews = arrays.map((data, slot) => ({
        data,
        count: counts[slot]!,
        stride: 2,
        domainOffset: 0,
        valueOffset: 1,
        regularDomain: null,
      })));
    },
    channelExtents(name) {
      let known = extentsOf.get(name);
      if (known) return known;
      const o = view.channelOffsets?.[name] ?? fail(`the data has no channel "${name}"`);
      const lo = new Float64Array(keys.length).fill(Infinity),
        hi = new Float64Array(keys.length).fill(-Infinity);
      for (let i = 0, p = keyOffset, q = o; i < n; i++, p += s, q += s) {
        const slot = slotOf(d[p]!);
        if (slot < 0) continue;
        const v = d[q]!;
        if (v < lo[slot]!) lo[slot] = v;
        if (v > hi[slot]!) hi[slot] = v;
      }
      known = keys.map((_, slot) => (lo[slot]! <= hi[slot]! ? { min: lo[slot]!, max: hi[slot]! } : null));
      extentsOf.set(name, known);
      return known;
    },
  };
}

/** The source at the bottom of a chain of data transforms: what a group splits. */
export function leafOf(node: DataNode): DataSource {
  let n: AnyElement = node;
  while (!(n instanceof DataSource)) {
    let next: AnyElement | undefined;
    for (let c = n.firstChild; c; c = c.nextSibling) if (c instanceof DataSource || c instanceof DataTransform) next = c;
    n = next ?? fail('a data transform has no source beneath it');
  }
  return n;
}

/** Whether `node` can serve a partition: a source that can be read in place, or a stage above one that says it can. */
export function canPartition(node: DataNode): boolean {
  if (node instanceof DataSource) return true;
  return node.partitionable?.() === true;
}

/** The plan of one key of a partition for any stage that can serve one. */
export function planPartitioned(node: DataNode, context: PlanContext, partition: Partition): PartitionedPlan {
  if (node instanceof DataSource) return rawPlan(partition, context);
  if (node.planPartitioned) return node.planPartitioned(context, partition);
  return fail(`${node.constructor.name} cannot be split by a channel`);
}

/** All the rows of a key, as a source's own `plan` gives them: the domain, the value, then the channels asked for. */
export function rawPlan(p: Partition, context: PlanContext, window?: readonly [first: number, end: number]): PartitionedPlan {
  const v = p.view,
    d = v.data,
    s = v.stride;
  const names = context.channels;
  const offsets = names.map((name) => v.channelOffsets?.[name] ?? fail(`the data has no channel "${name}"`));
  const k = offsets.length,
    os = 2 + k;
  const reg = v.regularDomain;
  // The rows of a key that lie within the window of rows, if there is one: a key's rows ascend, so they are found by searching.
  const bounds = (slot: number): [number, number] => {
    const rows = p.rows()[slot]!;
    if (!window) return [0, rows.length];
    const search = (at: number) => {
      let a = 0,
        b = rows.length;
      while (a < b) {
        const mid = (a + b) >>> 1;
        if (rows[mid]! < at) a = mid + 1;
        else b = mid;
      }
      return a;
    };
    return [search(window[0]), search(window[1])];
  };
  return {
    capacity: (slot) => {
      if (!window) return p.counts[slot]!;
      const [a, b] = bounds(slot);
      return b - a;
    },
    fill(slot, out) {
      const all = p.rows()[slot]!;
      const [from, to] = bounds(slot);
      const rows = window ? all.subarray(from, to) : all;
      const n = rows.length;
      if (n === 0) return { count: 0, extents: [NO_POINTS, NO_POINTS, ...names.map(() => NO_POINTS)] };
      const lo = new Float64Array(os).fill(Infinity),
        hi = new Float64Array(os).fill(-Infinity);
      for (let m = 0; m < n; m++) {
        const r = rows[m]!,
          j = r * s;
        const x = reg ? reg.start + reg.step * r : d[j + v.domainOffset]!;
        out[os * m] = x;
        const y = (out[os * m + 1] = d[j + v.valueOffset]!);
        if (x < lo[0]!) lo[0] = x;
        if (x > hi[0]!) hi[0] = x;
        if (y < lo[1]!) lo[1] = y;
        if (y > hi[1]!) hi[1] = y;
        for (let c = 0; c < k; c++) {
          const value = (out[os * m + 2 + c] = d[j + offsets[c]!]!);
          if (value < lo[2 + c]!) lo[2 + c] = value;
          if (value > hi[2 + c]!) hi[2 + c] = value;
        }
      }
      const extents: Extent[] = [];
      for (let c = 0; c < os; c++) extents.push(lo[c]! <= hi[c]! ? { min: lo[c]!, max: hi[c]! } : NO_POINTS);
      return { count: n, extents, rowOf: (m) => p.storageRow(rows[m]!) };
    },
  };
}

// ─── The rows of one key as a data source, and the transforms that work on them ───

/**
 * An element made again from its class and attributes, children too (every element is `new X(attrs, ...children)`), with the
 * suffix added to each id. In a chain of data stages the source at the bottom is not copied but replaced by `leaf`.
 */
export function copyOf<E extends AnyElement>(e: E, suffix: string, leaf?: DataSource): E {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the leaf stands in for the source it replaces, which is the same kind of element
  if (leaf && e instanceof DataSource) return leaf as unknown as E;
  // oxlint-disable-next-line typescript/consistent-type-assertions -- elements are copied without knowing their classes: a constructor is known only structurally
  const Class = e.constructor as new (...args: unknown[]) => E;
  const attrs: Record<string, unknown> = { ...e.attrs };
  if (typeof attrs.id === 'string') attrs.id = `${attrs.id}/${suffix}`;
  const children: AnyElement[] = [];
  for (let c = e.firstChild; c; c = c.nextSibling) children.push(copyOf(c, suffix, leaf));
  return new Class(attrs, ...children);
}
/** Bring a copy's attributes back in line with what it was copied from, children too, leaving alone the attributes in `keep` (a group binds them). */
export function refresh(from: AnyElement, to: AnyElement, keep: ReadonlySet<string>): void {
  if (from instanceof DataSource) return;
  const patch: Record<string, unknown> = {};
  // oxlint-disable-next-line typescript/consistent-type-assertions -- an attribute bag read by name: its keys are known only at run time
  const was = to.attrs as Record<string, unknown>,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- as above
    is = from.attrs as Record<string, unknown>;
  for (const k of Object.keys(is)) if (k !== 'id' && !keep.has(k) && was[k] !== is[k]) patch[k] = is[k];
  for (const k of Object.keys(was)) if (k !== 'id' && !keep.has(k) && !(k in is)) patch[k] = undefined;
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the patch was made from the copy's own attributes
  if (Object.keys(patch).length > 0) to.setAttributes(patch as never);
  for (let f = from.firstChild, t = to.firstChild; f && t; f = f.nextSibling, t = t.nextSibling) refresh(f, t, keep);
}

/**
 * The rows of one key of a partition, as a data source. The data of a group's series is one, answering with what the template's
 * stages make of the key (`top`); the bottom of a copy of a stage is one too, answering with the key's rows as they are.
 */
export class KeySource extends DataSource {
  #partition: Partition | null = null;
  #slot = 0;
  #names: readonly string[] = [];
  #top: (() => DataNode) | null;

  constructor(top: (() => DataNode) | null = null) {
    super({});
    this.#top = top;
  }
  /** Take the key at `slot` of a new partition. */
  load(partition: Partition, slot: number, names: readonly string[]): void {
    this.#partition = partition;
    this.#slot = slot;
    this.#names = names;
    this.invalidate();
  }
  /** Something above the source changed (a Decimator's resolution): the points are asked for again. */
  touch(): void {
    this.invalidate();
  }
  /** What answers for the key's extents and channels: the stage that stands for the template on it, or null for the rows as they are. */
  #stage(): DataNode | null {
    const top = this.#top?.();
    if (!top || top instanceof DataSource || !this.#partition) return null;
    return top.keyStage?.(this.#partition, this.#slot) ?? null;
  }
  get pointCount(): number {
    return this.#stage()?.pointCount ?? this.#partition?.counts[this.#slot] ?? 0;
  }
  override get channelNames(): readonly string[] {
    return this.#stage()?.channelNames ?? this.#names;
  }
  protected override get ordered(): boolean {
    return true;
  }
  protected scanDomain(): Extent | null {
    return this.#partition?.domains[this.#slot] ?? null;
  }
  override domain(): Extent | null {
    const stage = this.#stage();
    return stage ? stage.domain() : super.domain();
  }
  override valueExtent(): Extent | null {
    const stage = this.#stage();
    return stage ? stage.valueExtent() : (this.#partition?.values[this.#slot] ?? null);
  }
  override channelExtent(name: string): Extent | null {
    const stage = this.#stage();
    return stage ? stage.channelExtent(name) : (this.#partition?.channelExtents(name)[this.#slot] ?? null);
  }
  protected fill(): FillResult {
    return fail('the rows of a key are read through plan');
  }
  override plan(context: PlanContext): FillPlan {
    const partition = this.#partition ?? fail('a key has no rows');
    const plan = this.#top ? planPartitioned(this.#top(), context, partition) : rawPlan(partition, context);
    const slot = this.#slot;
    return { capacity: plan.capacity(slot), fill: (out) => plan.fill(slot, out) };
  }
}

/**
 * A data transform that can work on the rows of a `SeriesGroup`'s series. By default it does what it does to the rows of each
 * key on their own: it makes a copy of itself (and of whatever is beneath it) for every key, with the rows of the key at the bottom,
 * and keeps the copies in line with itself. A transform that can serve all the keys better overrides `planPartitioned` (a
 * `Decimator` does the whole partition in one pass), and may hand the choice to an attribute (a `Slice` can window the data as a whole).
 * A transform that does not extend this cannot be used in a group.
 */
export abstract class KeyedTransform<
  A extends BaseAttributes = BaseAttributes,
  Children extends readonly AnyElement[] = [source: DataNode],
  Channel extends string = string,
> extends DataTransform<A, Children, Channel> {
  #keyed: { partition: Partition; copies: { copy: DataNode; at: number }[] } | null = null;

  /** The stage this one reads: the last of its children that is a data stage. */
  protected get input(): DataNode {
    let found: DataNode | null = null;
    for (let c = this.firstChild; c; c = c.nextSibling) if (c instanceof DataSource || c instanceof DataTransform) found = c;
    return found ?? fail(`${this.constructor.name} has no data beneath it`);
  }
  override partitionable(): boolean {
    return canPartition(this.input);
  }
  override planPartitioned(context: PlanContext, partition: Partition): PartitionedPlan {
    const plans = new Map<number, FillPlan>();
    const planOf = (slot: number): FillPlan => {
      let plan = plans.get(slot);
      if (!plan) plans.set(slot, (plan = this.#copyFor(partition, slot).plan(context)));
      return plan;
    };
    return { capacity: (slot) => planOf(slot).capacity, fill: (slot, out) => planOf(slot).fill(out) };
  }
  override keyStage(partition: Partition, slot: number): DataNode | null {
    return this.#copyFor(partition, slot);
  }
  #copyFor(partition: Partition, slot: number): DataNode {
    let keyed = this.#keyed;
    if (!keyed || keyed.partition !== partition) keyed = this.#keyed = { partition, copies: [] };
    let made = keyed.copies[slot];
    if (!made) {
      const leaf = new KeySource();
      leaf.load(
        keyed.partition,
        slot,
        keyed.partition.source.channelNames.filter((n) => n !== keyed.partition.channel),
      );
      // oxlint-disable-next-line typescript/consistent-type-assertions -- a copy of this transform is the same kind of node
      made = keyed.copies[slot] = { copy: copyOf<AnyElement>(this, String(slot), leaf) as DataNode, at: this.version };
    } else if (made.at !== this.version) {
      refresh(this, made.copy, new Set());
      made.at = this.version;
    }
    return made.copy;
  }
}

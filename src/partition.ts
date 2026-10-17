/**
 * Partitions: the rows of a source split by the value of one channel (a `SeriesGroup`'s key), without being copied.
 *
 * Reading the rows once to count them is all a partition costs to make, however many keys there are. What each key then needs
 * is asked of the stages above the source with `planPartitioned`, which is a `plan` for one key. A stage that thins the rows
 * (a `Decimator`) can do it for every key in one pass over the storage, instead of once for each key over its own copy.
 */
/* oxlint-disable typescript/no-non-null-assertion -- stride-addressed rows of a view: every index is bounded by the row count */
import { DataSource, type DataNode, type FillResult, NO_POINTS, type PlanContext, type PointView } from './data.ts';
import { fail } from './element.ts';
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
  /** The source's rows in place, with the channel among its offsets. */
  readonly view: PointView;
  readonly keyOffset: number;
  /** The version of the source this was made at. */
  readonly version: number;
  /** The keys that are kept, in the order of their series. */
  readonly keys: readonly number[];
  /** How many keys were left out because there were more than were wanted. */
  readonly omitted: number;
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
 * Split the rows of `source` by `channel`. Null when the source cannot be read in place with that channel among its columns
 * (then the rows have to be copied out by key, as a group does when it cannot partition).
 */
export function partitionOf(source: DataSource, channel: string, order: Order, max: number): Partition | null {
  const view = source.view();
  const keyOffset = view?.channelOffsets?.[channel];
  if (!view || keyOffset === undefined) return null;
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

/** Whether `node` can serve a partition: a source that can be read in place, or a stage above one that says it can. */
export function canPartition(node: DataNode): boolean {
  if (node instanceof DataSource) return node.view()?.channelOffsets !== undefined;
  return node.partitionable?.() === true;
}

/** The plan of one key of a partition for any stage that can serve one. */
export function planPartitioned(node: DataNode, context: PlanContext, partition: Partition): PartitionedPlan {
  if (node instanceof DataSource) return rawPlan(partition, context);
  if (node.planPartitioned) return node.planPartitioned(context, partition);
  return fail(`${node.constructor.name} cannot be split by a channel`);
}

/** All the rows of a key, as a source's own `plan` gives them: the domain, the value, then the channels asked for. */
function rawPlan(p: Partition, context: PlanContext): PartitionedPlan {
  const v = p.view,
    d = v.data,
    s = v.stride;
  const names = context.channels;
  const offsets = names.map((name) => v.channelOffsets?.[name] ?? fail(`the data has no channel "${name}"`));
  const k = offsets.length,
    os = 2 + k;
  const reg = v.regularDomain;
  return {
    capacity: (slot) => p.counts[slot]!,
    fill(slot, out) {
      const rows = p.rows()[slot]!;
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
      return { count: n, extents, rowOf: (m) => p.source.storageRow(rows[m]!) };
    },
  };
}

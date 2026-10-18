/**
 * Decimation: reducing many points to the few a plot can show, by pixel column.
 *
 * Why: a line over a million points cannot show more than about one distinct value per pixel column, yet generating,
 * normalising and stringifying a million points is the dominant cost of a redraw. Reducing to the extremes of each
 * column first keeps the picture (to within a pixel) at a cost proportional to the plot's width, not the data's size.
 *
 * Structure: a `Decimator` (a data transform) owns a `DecimationKernel` (the reduction rule, swappable) and a source.
 * It windows the source to the visible domain, hands the kernel a zero-copy `PointView`, and reports extents of what the
 * kernel *saw* so the value axis fits the visible data rather than the whole of it.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import {
  type DataNode,
  DataSource,
  DataTransform,
  expectDomainValue,
  type FillPlan,
  type FillResult,
  NO_POINTS,
  type PlanContext,
  type PointView,
} from './data.ts';
import { KeyedTransform, type Partition, type PartitionedPlan, planPartitioned, TABLE_BASE } from './partition.ts';
import { type BaseAttributes, ChartElement, fail } from './element.ts';
import type { Extent } from './geometry.ts';

/** Tuning for the reduction. */
export interface DecimatorAttributes extends BaseAttributes {
  /** Pixel columns reduced to per pixel of plot width. Default 1; raise it for high-DPI output. */
  resolution?: number;
  /** Turn it off without removing it. Default true. */
  enabled?: boolean;
}

/** What a kernel reports besides the points it wrote: the value extent of the data it looked at. */
export interface ReduceResult {
  readonly count: number;
  readonly yMin: number;
  readonly yMax: number;
}

/**
 * The reduction itself. A kernel is an element so its parameters serialize and a new one is just a class.
 * Kernels read the source's storage in place; sources always deliver the domain ascending.
 */
export abstract class DecimationKernel<A extends BaseAttributes = BaseAttributes> extends ChartElement<Decimator, [], A> {
  /** The most points `reduce` can write for this many columns. */
  abstract capacity(columns: number): number;
  /**
   * Reduce `view` to at most `capacity` points over `domainRange`, writing (domain, value) pairs into `out`.
   * Points outside the range land in the edge columns. A gap (NaN value) is kept as one NaN point if the kernel handles gaps.
   */
  abstract reduce(view: PointView, domainRange: Extent, columns: number, out: Float64Array, capacity: number): ReduceResult;
  /**
   * `reduce` for every key of a partition at once, in one pass over `view`: the rows of the keys that `want` marks, each written
   * into that slot's `outs`. Absent in a kernel that needs the rows of a key side by side (it is then given them one key at a time).
   */
  reduceKeyed?(
    view: PointView,
    keys: KeyedRows,
    domainRange: Extent,
    columns: number,
    outs: readonly Float64Array[],
    capacity: number,
  ): KeyedResult;
}

/** The key of each row of a view, and which of the keys are to be reduced. */
export interface KeyedRows {
  readonly keyOffset: number;
  /** The slot of a key, or -1 for none. */
  readonly slotOf: (key: number) => number;
  /** 1 for each slot that is reduced. */
  readonly want: Uint8Array;
  /** The rows `[from, to)` of the view that each slot reduces: its own rows in the window, and one either side. */
  readonly from: Int32Array;
  readonly to: Int32Array;
  /**
   * The slot of each whole-number key within reach of a table (`tableBase` is added to the key to index it; -1 is none), and
   * whether that holds for every key of the data, so a row's slot is a table read with nothing to check.
   */
  readonly table: Int32Array;
  readonly tableBase: number;
  readonly tableOnly: boolean;
}
/** What `reduceKeyed` reports for each slot: `ReduceResult` and the ends of the domain it saw. */
export interface KeyedResult {
  readonly count: Int32Array;
  readonly yMin: Float64Array;
  readonly yMax: Float64Array;
  readonly xMin: Float64Array;
  readonly xMax: Float64Array;
}

/** Writes point `i` of a view into `out` slot `m`, if there is room. */
function putPoint(v: PointView, out: Float64Array, m: number, cap: number, i: number): number {
  if (m < cap) {
    const r = v.regularDomain;
    out[2 * m] = r ? r.start + r.step * i : v.data[i * v.stride + v.domainOffset]!;
    out[2 * m + 1] = v.data[i * v.stride + v.valueOffset]!;
    m++;
  }
  return m;
}
/** A gap point, unless the last point written already is one. */
function putGap(v: PointView, out: Float64Array, m: number, cap: number, i: number): number {
  if (m < cap && !(m > 0 && out[2 * m - 1] !== out[2 * m - 1])) {
    const r = v.regularDomain;
    out[2 * m] = r ? r.start + r.step * i : v.data[i * v.stride + v.domainOffset]!;
    out[2 * m + 1] = NaN;
    m++;
  }
  return m;
}

/** Writes the kept points of one column in domain order: [first,] min/max by position, [last]. */
function emitRun(
  v: PointView,
  out: Float64Array,
  m: number,
  cap: number,
  keepEnds: boolean,
  f: number,
  l: number,
  im: number,
  iM: number,
): number {
  const a = im < iM ? im : iM,
    b = im < iM ? iM : im;
  if (!keepEnds) {
    m = putPoint(v, out, m, cap, a);
    if (b !== a) m = putPoint(v, out, m, cap, b);
    return m;
  }
  let prev = -1;
  if (f !== prev) {
    m = putPoint(v, out, m, cap, f);
    prev = f;
  }
  if (a !== prev) {
    m = putPoint(v, out, m, cap, a);
    prev = a;
  }
  if (b !== prev) {
    m = putPoint(v, out, m, cap, b);
    prev = b;
  }
  if (l !== prev) {
    m = putPoint(v, out, m, cap, l);
  }
  return m;
}

/**
 * The value extent of the data one `reduceByColumn` call saw. Module-level so the hot loop returns nothing but a count
 * and allocates nothing; safe because reduction is synchronous and never re-entered.
 */
const runExtent = { min: Infinity, max: -Infinity };

/** Slow path for a column that contains NaN: split it into runs between the gaps and reduce each. */
function reduceAroundGaps(
  v: PointView,
  i0: number,
  i1: number,
  out: Float64Array,
  m: number,
  cap: number,
  keepEnds: boolean,
  keyOffset = -1,
  slotOf?: (key: number) => number,
  slot = 0,
): number {
  const d = v.data,
    s = v.stride,
    yo = v.valueOffset;
  let run = false,
    f = 0,
    l = 0,
    mn = 0,
    mx = 0,
    im = 0,
    iM = 0;
  for (let i = i0; i <= i1; i++) {
    // Rows of other keys are not part of this one's runs; the step past the end is, since it closes the last run.
    if (slotOf && i < i1 && slotOf(d[i * s + keyOffset]!) !== slot) continue;
    const y = i < i1 ? d[i * s + yo]! : NaN;
    if (y !== y) {
      if (run) {
        if (mn < runExtent.min) runExtent.min = mn;
        if (mx > runExtent.max) runExtent.max = mx;
        m = emitRun(v, out, m, cap, keepEnds, f, l, im, iM);
        run = false;
      }
      if (i < i1) m = putGap(v, out, m, cap, i);
      continue;
    }
    if (!run) {
      run = true;
      f = i;
      mn = mx = y;
      im = iM = i;
    } else if (y < mn) {
      mn = y;
      im = i;
    } else if (y > mx) {
      mx = y;
      iM = i;
    }
    l = i;
  }
  return m;
}

/** One past the last row of pixel column `c`, searched from `i0`: arithmetic for a regular domain, binary search otherwise. */
function columnEnd(v: PointView, c: number, W: number, x0: number, k: number, i0: number): number {
  const n = v.count,
    reg = v.regularDomain;
  if (c === W - 1) return n;
  if (reg) {
    const ux = reg.start,
      dx = reg.step;
    let i1 = Math.ceil((x0 + (c + 1) / k - ux) / dx);
    if (i1 > n) i1 = n;
    if (i1 < i0) i1 = i0;
    // Agree exactly with the multiply-and-truncate the column test uses.
    while (i1 > i0 && (((ux + dx * (i1 - 1) - x0) * k) | 0) > c) i1--;
    while (i1 < n && (((ux + dx * i1 - x0) * k) | 0) <= c) i1++;
    return i1;
  }
  const d = v.data,
    s = v.stride,
    xo = v.domainOffset;
  let lo = i0,
    hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((((d[mid * s + xo]! - x0) * k) | 0) <= c) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Per pixel column, find the range of points it covers (arithmetic for a regular domain, binary search otherwise),
 * then scan only the values in that range. Four values at a time are checked against the running extremes,
 * and a group strictly inside them costs one comparison chain and nothing else.
 */
function reduceByColumn(v: PointView, domainRange: Extent, W: number, out: Float64Array, cap: number, keepEnds: boolean): ReduceResult {
  const d = v.data,
    s = v.stride,
    yo = v.valueOffset,
    n = v.count;
  const x0 = domainRange.min,
    k = W / (domainRange.max - domainRange.min);
  runExtent.min = Infinity;
  runExtent.max = -Infinity;
  let m = 0,
    i0 = 0;
  for (let c = 0; c < W && i0 < n; c++) {
    const i1 = columnEnd(v, c, W, x0, k, i0);
    if (i1 <= i0) continue;
    const y0 = d[i0 * s + yo]!;
    let mn = y0,
      mx = y0,
      im = i0,
      iM = i0,
      nan = y0 !== y0;
    let i = i0 + 1,
      p = i * s + yo;
    const s2 = 2 * s,
      s3 = 3 * s;
    for (; i + 3 < i1; i += 4, p += 4 * s) {
      const a = d[p]!,
        b = d[p + s]!,
        e = d[p + s2]!,
        f = d[p + s3]!;
      // Four values strictly inside (min, max) change nothing. NaN fails both compares, so it falls
      // through to the careful loop and is flagged there.
      if (a > mn && a < mx && b > mn && b < mx && e > mn && e < mx && f > mn && f < mx) continue;
      for (let j = i, q = p; j < i + 4; j++, q += s) {
        const y = d[q]!;
        if (y < mn) {
          mn = y;
          im = j;
        } else if (y > mx) {
          mx = y;
          iM = j;
        } else if (y !== y) nan = true;
      }
    }
    for (; i < i1; i++, p += s) {
      const y = d[p]!;
      if (y < mn) {
        mn = y;
        im = i;
      } else if (y > mx) {
        mx = y;
        iM = i;
      } else if (y !== y) nan = true;
    }
    if (nan) m = reduceAroundGaps(v, i0, i1, out, m, cap, keepEnds);
    else {
      if (mn < runExtent.min) runExtent.min = mn;
      if (mx > runExtent.max) runExtent.max = mx;
      m = emitRun(v, out, m, cap, keepEnds, i0, i1 - 1, im, iM);
    }
    i0 = i1;
  }
  return { count: m, yMin: runExtent.min, yMax: runExtent.max };
}

/**
 * `reduceByColumn` for the rows of several keys that are interleaved in one view: one pass, with the running extremes of each key
 * in arrays by slot. A column's rows are the same for every key, so they are found once; each key's own rows in them are then
 * reduced as if alone. A key whose column holds a gap (NaN) is reduced again on its own rows, around the gaps.
 */
function reduceByColumnKeyed(
  v: PointView,
  keys: KeyedRows,
  domainRange: Extent,
  W: number,
  outs: readonly Float64Array[],
  cap: number,
  keepEnds: boolean,
): KeyedResult {
  const d = v.data,
    s = v.stride,
    yo = v.valueOffset,
    n = v.count,
    ko = keys.keyOffset,
    slotOf = keys.slotOf,
    slots = keys.want.length;
  const reg = v.regularDomain;
  const xAt = (i: number) => (reg ? reg.start + reg.step * i : d[i * s + v.domainOffset]!);
  const x0 = domainRange.min,
    k = W / (domainRange.max - domainRange.min);
  // One more slot than there are keys, for the rows that no key reduces: its bounds let nothing in, so a row needs one test, not three.
  const NONE = slots;
  const from = new Int32Array(slots + 1),
    to = new Int32Array(slots + 1);
  for (let sl = 0; sl < slots; sl++) {
    from[sl] = keys.want[sl] ? keys.from[sl]! : 0x7fffffff;
    to[sl] = keys.want[sl] ? keys.to[sl]! : 0;
  }
  from[NONE] = 0x7fffffff;
  // Where the keys are whole numbers within reach of a table, they are looked up there and not through a call.
  let table: Int32Array | null = null;
  if (keys.tableOnly) {
    table = new Int32Array(keys.table.length);
    for (let t = 0; t < table.length; t++) table[t] = keys.table[t]! < 0 ? NONE : keys.table[t]!;
  }
  const base = keys.tableBase;
  const mn = new Float64Array(slots + 1),
    mx = new Float64Array(slots + 1),
    f = new Int32Array(slots + 1).fill(-1),
    l = new Int32Array(slots + 1).fill(-1),
    im = new Int32Array(slots + 1),
    iM = new Int32Array(slots + 1),
    nan = new Uint8Array(slots + 1),
    firstRow = new Int32Array(slots + 1).fill(-1),
    lastRow = new Int32Array(slots + 1),
    touched = new Int32Array(slots + 1);
  const count = new Int32Array(slots),
    yMin = new Float64Array(slots).fill(Infinity),
    yMax = new Float64Array(slots).fill(-Infinity),
    xMin = new Float64Array(slots).fill(Infinity),
    xMax = new Float64Array(slots).fill(-Infinity);
  let i0 = 0;
  for (let c = 0; c < W && i0 < n; c++) {
    const i1 = columnEnd(v, c, W, x0, k, i0);
    if (i1 <= i0) continue;
    let tn = 0;
    for (let i = i0, p = i0 * s + ko, q = i0 * s + yo; i < i1; i++, p += s, q += s) {
      let sl: number;
      if (table) sl = table[(d[p]! + base) | 0]!;
      else {
        sl = slotOf(d[p]!);
        if (sl < 0) sl = NONE;
      }
      if (i < from[sl]! || i >= to[sl]!) continue;
      const y = d[q]!;
      if (f[sl]! < 0) {
        f[sl] = i;
        mn[sl] = mx[sl] = y;
        im[sl] = iM[sl] = i;
        nan[sl] = y !== y ? 1 : 0;
        touched[tn++] = sl;
      } else if (y < mn[sl]!) {
        mn[sl] = y;
        im[sl] = i;
      } else if (y > mx[sl]!) {
        mx[sl] = y;
        iM[sl] = i;
      } else if (y !== y) nan[sl] = 1;
    }
    // The last row each key has in the column: looked for from the end, which is a few rows for every key but a sparse one.
    for (let i = i1 - 1, left = tn; i >= i0 && left > 0; i--) {
      const kk = d[i * s + ko]!;
      let sl = table ? table[(kk + base) | 0]! : slotOf(kk);
      if (sl < 0) sl = NONE;
      if (sl !== NONE && f[sl]! >= 0 && l[sl]! < 0 && i >= from[sl]! && i < to[sl]!) {
        l[sl] = i;
        left--;
      }
    }
    for (let t = 0; t < tn; t++) {
      const sl = touched[t]!;
      if (firstRow[sl]! < 0) firstRow[sl] = f[sl]!;
      lastRow[sl] = l[sl]!;
      if (nan[sl]) {
        runExtent.min = Infinity;
        runExtent.max = -Infinity;
        count[sl] = reduceAroundGaps(v, i0, i1, outs[sl]!, count[sl]!, cap, keepEnds, ko, slotOf, sl);
        if (runExtent.min < yMin[sl]!) yMin[sl] = runExtent.min;
        if (runExtent.max > yMax[sl]!) yMax[sl] = runExtent.max;
      } else {
        if (mn[sl]! < yMin[sl]!) yMin[sl] = mn[sl]!;
        if (mx[sl]! > yMax[sl]!) yMax[sl] = mx[sl]!;
        count[sl] = emitRun(v, outs[sl]!, count[sl]!, cap, keepEnds, f[sl]!, l[sl]!, im[sl]!, iM[sl]!);
      }
      f[sl] = -1;
      l[sl] = -1;
    }
    i0 = i1;
  }
  for (let sl = 0; sl < slots; sl++)
    if (firstRow[sl]! >= 0) {
      xMin[sl] = xAt(firstRow[sl]!);
      xMax[sl] = xAt(lastRow[sl]!);
    }
  return { count, yMin, yMax, xMin, xMax };
}

/**
 * The lowest and highest value in each pixel column, in the order they occur. Every extreme survives, so the
 * drawn line covers what the full data would to within a pixel. Keeps gaps. At most 2 points per column.
 */
export class MinMaxKernel extends DecimationKernel {
  capacity(columns: number): number {
    return 2 * columns + 2;
  }
  reduce(view: PointView, range: Extent, columns: number, out: Float64Array, capacity: number): ReduceResult {
    return reduceByColumn(view, range, columns, out, capacity, false);
  }
  override reduceKeyed(
    view: PointView,
    keys: KeyedRows,
    range: Extent,
    columns: number,
    outs: readonly Float64Array[],
    capacity: number,
  ): KeyedResult {
    return reduceByColumnKeyed(view, keys, range, columns, outs, capacity, false);
  }
}
/** Min/max plus the first and last value in each column, which keeps joins between columns exact. At most 4 per column. */
export class M4Kernel extends DecimationKernel {
  capacity(columns: number): number {
    return 4 * columns + 4;
  }
  reduce(view: PointView, range: Extent, columns: number, out: Float64Array, capacity: number): ReduceResult {
    return reduceByColumn(view, range, columns, out, capacity, true);
  }
  override reduceKeyed(
    view: PointView,
    keys: KeyedRows,
    range: Extent,
    columns: number,
    outs: readonly Float64Array[],
    capacity: number,
  ): KeyedResult {
    return reduceByColumnKeyed(view, keys, range, columns, outs, capacity, true);
  }
}

/**
 * Largest Triangle Three Buckets: one point per column, chosen to keep the line's shape. It does not keep extremes,
 * so spikes can vanish, and it does not handle gaps (a NaN value poisons its bucket). Prefer MinMaxKernel.
 */
export class LttbKernel extends DecimationKernel {
  capacity(columns: number): number {
    return columns + 2;
  }
  reduce(v: PointView, _range: Extent, W: number, out: Float64Array, cap: number): ReduceResult {
    const d = v.data,
      s = v.stride,
      xo = v.domainOffset,
      yo = v.valueOffset,
      n = v.count,
      reg = v.regularDomain;
    const ux = reg ? reg.start : 0,
      dx = reg ? reg.step : 1;
    let m = 0,
      yMin = Infinity,
      yMax = -Infinity;
    m = putPoint(v, out, m, cap, 0);
    const every = (n - 2) / (W - 2);
    let a = 0;
    for (let b = 0; b < W - 2; b++) {
      const ns = Math.floor((b + 1) * every) + 1;
      let ne = Math.floor((b + 2) * every) + 1;
      if (ne > n) ne = n;
      let avgX = 0,
        avgY = 0;
      for (let i = ns; i < ne; i++) {
        avgX += reg ? ux + dx * i : d[i * s + xo]!;
        avgY += d[i * s + yo]!;
      }
      const cnt = ne - ns;
      avgX /= cnt;
      avgY /= cnt;
      const rs = Math.floor(b * every) + 1,
        re = Math.floor((b + 1) * every) + 1;
      const ax = reg ? ux + dx * a : d[a * s + xo]!,
        ay = d[a * s + yo]!;
      let best = -1,
        bi = rs;
      for (let i = rs; i < re; i++) {
        const x = reg ? ux + dx * i : d[i * s + xo]!,
          y = d[i * s + yo]!;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
        const area = Math.abs((ax - avgX) * (y - ay) - (ax - x) * (avgY - ay));
        if (area > best) {
          best = area;
          bi = i;
        }
      }
      m = putPoint(v, out, m, cap, bi);
      a = bi;
    }
    m = putPoint(v, out, m, cap, n - 1);
    const y0 = d[yo]!,
      yl = d[(n - 1) * s + yo]!;
    if (y0 < yMin) yMin = y0;
    if (y0 > yMax) yMax = y0;
    if (yl < yMin) yMin = yl;
    if (yl > yMax) yMax = yl;
    return { count: m, yMin, yMax };
  }
}

/** Every k-th point. The cheapest possible, and it aliases: extremes are lost. For previews and for comparison. */
export class StrideKernel extends DecimationKernel {
  capacity(columns: number): number {
    return columns + 2;
  }
  reduce(v: PointView, _range: Extent, columns: number, out: Float64Array, cap: number): ReduceResult {
    const n = v.count,
      d = v.data,
      s = v.stride,
      yo = v.valueOffset;
    let m = 0,
      yMin = Infinity,
      yMax = -Infinity;
    const steps = Math.min(columns, n);
    for (let j = 0; j < steps; j++) {
      const i = steps === 1 ? 0 : Math.round((j * (n - 1)) / (steps - 1));
      const y = d[i * s + yo]!;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      m = putPoint(v, out, m, cap, i);
    }
    return { count: m, yMin, yMax };
  }
}

/**
 * Narrows a view to the points that can touch `range`, plus one either side so lines enter and leave correctly.
 * Needs a sorted domain and storage that can be sliced without copying (a typed array); otherwise returns the view.
 */
function windowView(v: PointView, range: Extent): PointView {
  const [first, end] = windowBounds(v, range);
  return subView(v, first, end);
}
/** The rows `[first, end)` of a view, read in place (not possible for storage that cannot be sliced: the whole view then). */
function subView(v: PointView, first: number, end: number): PointView {
  const n = v.count,
    r = v.regularDomain;
  if (first === 0 && end === n) return v;
  // oxlint-disable-next-line typescript/consistent-type-assertions -- typed arrays have `subarray`, plain arrays do not: it is probed on the next line
  const data = v.data as ArrayLike<number> & { subarray?: (start: number) => ArrayLike<number> };
  if (typeof data.subarray !== 'function') return v;
  return {
    ...v,
    data: data.subarray(first * v.stride),
    count: end - first,
    regularDomain: r ? { start: r.start + r.step * first, step: r.step } : null,
  };
}
/** The rows `[first, end)` of a sorted view that can touch `range`: those in it and one either side. */
function windowBounds(v: PointView, range: Extent): [number, number] {
  const [lo, past] = windowSplit(v, range);
  return [lo > 0 ? lo - 1 : 0, past < v.count ? past + 1 : v.count];
}
/** The first row of a sorted view that is at or after the start of `range`, and the first that is after its end. */
function windowSplit(v: PointView, range: Extent): [number, number] {
  const n = v.count,
    r = v.regularDomain;
  if (n < 3) return [0, n];
  const x = r ? (i: number) => r.start + r.step * i : (i: number) => v.data[i * v.stride + v.domainOffset]!;
  if (x(0) >= range.min && x(n - 1) <= range.max) return [0, n];
  let lo = 0,
    hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x(mid) < range.min) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x(mid) <= range.max) lo = mid + 1;
    else hi = mid;
  }
  return [first, lo];
}

/**
 * Sits between a series and its source and reduces the source to what the plot can show:
 * `new Series(new Decimator({}, new MinMaxKernel(), source), new LinePath(new LinearCurve()))`.
 * Only the visible part of the domain is read, so zooming in refills from the full data again.
 * Sources always deliver points ascending in the domain, so any source works; one flagged `isSorted` is read in place.
 */
export class Decimator extends KeyedTransform<DecimatorAttributes, [kernel: DecimationKernel, source: DataNode]> {
  #version = 0;
  #scratch = new Float64Array(0);

  get kernel(): DecimationKernel {
    return this.child(0, DecimationKernel);
  }
  get source(): DataNode {
    return this.child(1, DataSource, DataTransform);
  }
  override get channelNames(): readonly string[] {
    return this.source.channelNames ?? [];
  }

  /** Anything beneath bubbles an invalidation up through here, so one counter covers source, kernel and attributes. */
  override invalidate(): void {
    this.#version++;
    super.invalidate();
  }
  get version(): number {
    return this.#version;
  }
  get pointCount(): number {
    return this.source.pointCount;
  }
  domain(): Extent | null {
    return this.source.domain();
  }
  valueExtent(): Extent | null {
    return this.source.valueExtent();
  }
  channelExtent(name: string): Extent | null {
    return this.source.channelExtent(name);
  }

  plan(context: PlanContext): FillPlan {
    const source = this.source,
      kernel = this.kernel,
      a = this.attrs;
    const inner = source.plan(context);
    if (a.enabled === false) return inner;
    // Kernels thin by pixel column of the domain, which a path that only has an order does not have.
    expectDomainValue(context, 'a Decimator');
    // Kernels reduce (domain, value) pairs; a channel column would not follow the points they keep.
    if (context.columns.length > 2) fail('a Decimator cannot carry channels: bind on undecimated data, or turn the Decimator off');
    // At least 3 so the kernels' first/last handling has columns to work with.
    const columns = Math.max(3, Math.floor(context.width * (a.resolution ?? 1)));
    const capacity = kernel.capacity(columns);
    // Already small enough: reducing would only cost time and change nothing.
    if (inner.capacity <= capacity) return inner;
    return {
      capacity,
      fill: (out) => {
        const view = this.#read(source, inner);
        const reg = view.regularDomain;
        if (reg && !(reg.step > 0)) fail('a Decimator needs a regular domain that ascends');
        const windowed = windowView(view, context.domainRange);
        const t0 = performance.now();
        const r = kernel.reduce(windowed, context.domainRange, columns, out, capacity);
        const counters = this.countersOrNull;
        if (counters) counters.stages.decimate += performance.now() - t0;
        const n = windowed.count;
        const x = (i: number) =>
          windowed.regularDomain
            ? windowed.regularDomain.start + windowed.regularDomain.step * i
            : windowed.data[i * windowed.stride + windowed.domainOffset]!;
        return {
          count: r.count,
          extents: [n > 0 ? { min: x(0), max: x(n - 1) } : NO_POINTS, { min: r.yMin, max: r.yMax }],
        };
      },
    };
  }

  /** What the last pass over a partition made, for every key, so the keys that follow the first in a flush cost a copy and no more. */
  #keyed: {
    partition: Partition;
    version: number;
    columns: number;
    capacity: number;
    min: number;
    max: number;
    results: Map<number, FillResult>;
    outs: Float64Array[];
  } | null = null;

  /** A `Decimator` leaves the extents and channels of a key as its source has them. */
  override keyStage(partition: Partition, slot: number): DataNode | null {
    const source = this.source;
    return source instanceof DataSource ? null : (source.keyStage?.(partition, slot) ?? null);
  }
  /**
   * `plan` for one key of a partition: a key with few rows is passed on as it is. The others are reduced together in one pass over
   * the source's rows when the source is directly beneath; over a stage between (a `Slice`), each key is reduced from what that stage makes of it.
   */
  override planPartitioned(context: PlanContext, partition: Partition): PartitionedPlan {
    const inner = planPartitioned(this.source, context, partition);
    const a = this.attrs;
    if (a.enabled === false) return inner;
    expectDomainValue(context, 'a Decimator');
    if (context.columns.length > 2) fail('a Decimator cannot carry channels: bind on undecimated data, or turn the Decimator off');
    const columns = Math.max(3, Math.floor(context.width * (a.resolution ?? 1)));
    const capacity = this.kernel.capacity(columns);
    if (!(this.source instanceof DataSource)) return this.#viaSource(inner, columns, capacity, context.domainRange);
    const small = (slot: number) => partition.counts[slot]! <= capacity;
    return {
      capacity: (slot) => (small(slot) ? inner.capacity(slot) : capacity),
      fill: (slot, out) => {
        if (small(slot)) return inner.fill(slot, out);
        const pass = this.#reduceKeys(partition, context.domainRange, columns, capacity);
        const made = pass.results.get(slot) ?? fail('a Decimator was asked for a key it did not reduce');
        out.set((pass.outs[slot] ?? fail('a Decimator has no room for a key')).subarray(0, 2 * made.count));
        return made;
      },
    };
  }
  /** Each key reduced from what the stage beneath makes of it, as a `Decimator` does over any stage. */
  #viaSource(inner: PartitionedPlan, columns: number, capacity: number, range: Extent): PartitionedPlan {
    const kernel = this.kernel;
    return {
      capacity: (slot) => Math.min(inner.capacity(slot), capacity),
      fill: (slot, out) => {
        const room = inner.capacity(slot);
        if (room <= capacity) return inner.fill(slot, out);
        if (this.#scratch.length < room * 2) this.#scratch = new Float64Array(room * 2);
        const filled = inner.fill(slot, this.#scratch);
        const all: PointView = {
          data: this.#scratch,
          count: filled.count,
          stride: 2,
          domainOffset: 0,
          valueOffset: 1,
          regularDomain: null,
        };
        const windowed = windowView(all, range);
        const t0 = performance.now();
        const r = kernel.reduce(windowed, range, columns, out, capacity);
        const counters = this.countersOrNull;
        if (counters) counters.stages.decimate += performance.now() - t0;
        const n = windowed.count;
        const x = (i: number) => windowed.data[i * windowed.stride + windowed.domainOffset]!;
        return { count: r.count, extents: [n > 0 ? { min: x(0), max: x(n - 1) } : NO_POINTS, { min: r.yMin, max: r.yMax }] };
      },
    };
  }
  #reduceKeys(partition: Partition, range: Extent, columns: number, capacity: number) {
    const known = this.#keyed;
    if (
      known &&
      known.partition === partition &&
      known.version === this.#version &&
      known.columns === columns &&
      known.min === range.min &&
      known.max === range.max
    )
      return known;
    const kernel = this.kernel;
    const slots = partition.keys.length;
    const want = new Uint8Array(slots);
    for (let slot = 0; slot < slots; slot++) want[slot] = partition.counts[slot]! > capacity ? 1 : 0;
    // The buffers are kept between passes while their size holds, so a drag allocates nothing for them.
    const outs = known && known.partition === partition && known.capacity === capacity ? known.outs : [];
    if (outs.length === 0) for (let slot = 0; slot < slots; slot++) outs.push(new Float64Array(want[slot] ? 2 * capacity : 0));
    const t0 = performance.now();
    const results = new Map<number, FillResult>();
    const view = partition.view;
    const [lo, past] = windowSplit(view, range);
    // One pass over the rows of all the keys for the first view of some data; once it is asked for again (a pan, a zoom) each key's
    // rows are made to lie side by side, which a kernel reads several times faster.
    const again = known !== null && known.partition === partition;
    if (kernel.reduceKeyed && !again && !partition.gathered) {
      // Each key reduces its own rows in the window and the one on either side, as if it were alone; those lie beyond the window of
      // the view as a whole by as far as the key's rows are apart, so they are found by looking out from its ends.
      const from = new Int32Array(slots).fill(lo),
        to = new Int32Array(slots).fill(past);
      const d = view.data,
        s = view.stride,
        ko = partition.keyOffset;
      let before = 0,
        after = 0;
      for (let slot = 0; slot < slots; slot++)
        if (want[slot]) {
          if (partition.firstRows[slot]! < lo) before++;
          if (partition.lastRows[slot]! >= past) after++;
        }
      for (let i = lo - 1; i >= 0 && before > 0; i--) {
        const slot = partition.slotOf(d[i * s + ko]!);
        if (slot >= 0 && want[slot] && from[slot] === lo) {
          from[slot] = i;
          before--;
        }
      }
      const seen = new Uint8Array(slots);
      for (let i = past; i < view.count && after > 0; i++) {
        const slot = partition.slotOf(d[i * s + ko]!);
        if (slot >= 0 && want[slot] && !seen[slot]) {
          seen[slot] = 1;
          to[slot] = i + 1;
          after--;
        }
      }
      let base = view.count,
        stop = 0;
      for (let slot = 0; slot < slots; slot++)
        if (want[slot]) {
          if (from[slot]! < base) base = from[slot]!;
          if (to[slot]! > stop) stop = to[slot]!;
        }
      const windowed = subView(view, base, stop);
      // A view that could not be sliced is read from its start, and the bounds stay as they are.
      const shift = windowed === view ? 0 : base;
      for (let slot = 0; slot < slots; slot++) {
        from[slot] = from[slot]! - shift;
        to[slot] = to[slot]! - shift;
      }
      const r = kernel.reduceKeyed(
        windowed,
        {
          keyOffset: partition.keyOffset,
          slotOf: partition.slotOf,
          want,
          from,
          to,
          table: partition.table,
          tableBase: TABLE_BASE,
          tableOnly: partition.tableOnly,
        },
        range,
        columns,
        outs,
        capacity,
      );
      for (let slot = 0; slot < slots; slot++)
        if (want[slot])
          results.set(slot, {
            count: r.count[slot]!,
            extents: [
              r.xMin[slot]! <= r.xMax[slot]! ? { min: r.xMin[slot]!, max: r.xMax[slot]! } : NO_POINTS,
              { min: r.yMin[slot]!, max: r.yMax[slot]! },
            ],
          });
    } else {
      // A key at a time, on its own rows: the same as a `Decimator` over a source of just those.
      const views = partition.alone();
      for (let slot = 0; slot < slots; slot++) {
        if (!want[slot]) continue;
        const windowed = windowView(views[slot]!, range);
        const r = kernel.reduce(windowed, range, columns, outs[slot]!, capacity);
        const n = windowed.count;
        const x = (i: number) => windowed.data[i * windowed.stride + windowed.domainOffset]!;
        results.set(slot, {
          count: r.count,
          extents: [n > 0 ? { min: x(0), max: x(n - 1) } : NO_POINTS, { min: r.yMin, max: r.yMax }],
        });
      }
    }
    const counters = this.countersOrNull;
    if (counters) counters.stages.decimate += performance.now() - t0;
    return (this.#keyed = { partition, version: this.#version, columns, capacity, min: range.min, max: range.max, results, outs });
  }

  /** The source's own storage if it offers it, else the source filled into a scratch buffer. */
  #read(source: DataNode, inner: FillPlan): PointView {
    const own = source.view?.();
    if (own) return own; // null for generated data and for transforms, which fill a scratch buffer instead
    if (this.#scratch.length < inner.capacity * 2) this.#scratch = new Float64Array(inner.capacity * 2);
    const filled = inner.fill(this.#scratch);
    return { data: this.#scratch, count: filled.count, stride: 2, domainOffset: 0, valueOffset: 1, regularDomain: null };
  }
}

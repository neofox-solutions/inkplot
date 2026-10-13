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
import { type DataNode, DataSource, DataTransform, type FillPlan, NO_POINTS, type PlanContext, type PointView } from './data.ts';
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
export interface ReduceResult { readonly count: number; readonly yMin: number; readonly yMax: number }

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
function emitRun(v: PointView, out: Float64Array, m: number, cap: number, keepEnds: boolean, f: number, l: number, im: number, iM: number): number {
  const a = im < iM ? im : iM, b = im < iM ? iM : im;
  if (!keepEnds) {
    m = putPoint(v, out, m, cap, a);
    if (b !== a) m = putPoint(v, out, m, cap, b);
    return m;
  }
  let prev = -1;
  if (f !== prev) { m = putPoint(v, out, m, cap, f); prev = f; }
  if (a !== prev) { m = putPoint(v, out, m, cap, a); prev = a; }
  if (b !== prev) { m = putPoint(v, out, m, cap, b); prev = b; }
  if (l !== prev) { m = putPoint(v, out, m, cap, l); }
  return m;
}

/**
 * The value extent of the data one `reduceByColumn` call saw. Module-level so the hot loop returns nothing but a count
 * and allocates nothing; safe because reduction is synchronous and never re-entered.
 */
const runExtent = { min: Infinity, max: -Infinity };

/** Slow path for a column that contains NaN: split it into runs between the gaps and reduce each. */
function reduceAroundGaps(v: PointView, i0: number, i1: number, out: Float64Array, m: number, cap: number, keepEnds: boolean): number {
  const d = v.data, s = v.stride, yo = v.valueOffset;
  let run = false, f = 0, l = 0, mn = 0, mx = 0, im = 0, iM = 0;
  for (let i = i0; i <= i1; i++) {
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
    if (!run) { run = true; f = i; mn = mx = y; im = iM = i; }
    else if (y < mn) { mn = y; im = i; }
    else if (y > mx) { mx = y; iM = i; }
    l = i;
  }
  return m;
}

/**
 * Per pixel column, find the range of points it covers (arithmetic for a regular domain, binary search otherwise),
 * then scan only the values in that range. Four values at a time are checked against the running extremes,
 * and a group strictly inside them costs one comparison chain and nothing else.
 */
function reduceByColumn(v: PointView, domainRange: Extent, W: number, out: Float64Array, cap: number, keepEnds: boolean): ReduceResult {
  const d = v.data, s = v.stride, xo = v.domainOffset, yo = v.valueOffset, n = v.count;
  const reg = v.regularDomain;
  const ux = reg ? reg.start : 0, dx = reg ? reg.step : 1;
  const x0 = domainRange.min, k = W / (domainRange.max - domainRange.min);
  runExtent.min = Infinity; runExtent.max = -Infinity;
  let m = 0, i0 = 0;
  for (let c = 0; c < W && i0 < n; c++) {
    let i1: number;
    if (c === W - 1) i1 = n;
    else if (reg) {
      i1 = Math.ceil((x0 + (c + 1) / k - ux) / dx);
      if (i1 > n) i1 = n;
      if (i1 < i0) i1 = i0;
      // Agree exactly with the multiply-and-truncate the column test uses.
      while (i1 > i0 && (((ux + dx * (i1 - 1) - x0) * k) | 0) > c) i1--;
      while (i1 < n && (((ux + dx * i1 - x0) * k) | 0) <= c) i1++;
    } else {
      let lo = i0, hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((((d[mid * s + xo]! - x0) * k) | 0) <= c) lo = mid + 1; else hi = mid;
      }
      i1 = lo;
    }
    if (i1 <= i0) continue;
    const y0 = d[i0 * s + yo]!;
    let mn = y0, mx = y0, im = i0, iM = i0, nan = y0 !== y0;
    let i = i0 + 1, p = i * s + yo;
    const s2 = 2 * s, s3 = 3 * s;
    for (; i + 3 < i1; i += 4, p += 4 * s) {
      const a = d[p]!, b = d[p + s]!, e = d[p + s2]!, f = d[p + s3]!;
      // Four values strictly inside (min, max) change nothing. NaN fails both compares, so it falls
      // through to the careful loop and is flagged there.
      if (a > mn && a < mx && b > mn && b < mx && e > mn && e < mx && f > mn && f < mx) continue;
      for (let j = i, q = p; j < i + 4; j++, q += s) {
        const y = d[q]!;
        if (y < mn) { mn = y; im = j; }
        else if (y > mx) { mx = y; iM = j; }
        else if (y !== y) nan = true;
      }
    }
    for (; i < i1; i++, p += s) {
      const y = d[p]!;
      if (y < mn) { mn = y; im = i; }
      else if (y > mx) { mx = y; iM = i; }
      else if (y !== y) nan = true;
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
 * The lowest and highest value in each pixel column, in the order they occur. Every extreme survives, so the
 * drawn line covers what the full data would to within a pixel. Keeps gaps. At most 2 points per column.
 */
export class MinMaxKernel extends DecimationKernel {
  capacity(columns: number): number { return 2 * columns + 2; }
  reduce(view: PointView, range: Extent, columns: number, out: Float64Array, capacity: number): ReduceResult {
    return reduceByColumn(view, range, columns, out, capacity, false);
  }
}
/** Min/max plus the first and last value in each column, which keeps joins between columns exact. At most 4 per column. */
export class M4Kernel extends DecimationKernel {
  capacity(columns: number): number { return 4 * columns + 4; }
  reduce(view: PointView, range: Extent, columns: number, out: Float64Array, capacity: number): ReduceResult {
    return reduceByColumn(view, range, columns, out, capacity, true);
  }
}

/**
 * Largest Triangle Three Buckets: one point per column, chosen to keep the line's shape. It does not keep extremes,
 * so spikes can vanish, and it does not handle gaps (a NaN value poisons its bucket). Prefer MinMaxKernel.
 */
export class LttbKernel extends DecimationKernel {
  capacity(columns: number): number { return columns + 2; }
  reduce(v: PointView, _range: Extent, W: number, out: Float64Array, cap: number): ReduceResult {
    const d = v.data, s = v.stride, xo = v.domainOffset, yo = v.valueOffset, n = v.count, reg = v.regularDomain;
    const ux = reg ? reg.start : 0, dx = reg ? reg.step : 1;
    let m = 0, yMin = Infinity, yMax = -Infinity;
    m = putPoint(v, out, m, cap, 0);
    const every = (n - 2) / (W - 2);
    let a = 0;
    for (let b = 0; b < W - 2; b++) {
      const ns = Math.floor((b + 1) * every) + 1;
      let ne = Math.floor((b + 2) * every) + 1;
      if (ne > n) ne = n;
      let avgX = 0, avgY = 0;
      for (let i = ns; i < ne; i++) { avgX += reg ? ux + dx * i : d[i * s + xo]!; avgY += d[i * s + yo]!; }
      const cnt = ne - ns;
      avgX /= cnt; avgY /= cnt;
      const rs = Math.floor(b * every) + 1, re = Math.floor((b + 1) * every) + 1;
      const ax = reg ? ux + dx * a : d[a * s + xo]!, ay = d[a * s + yo]!;
      let best = -1, bi = rs;
      for (let i = rs; i < re; i++) {
        const x = reg ? ux + dx * i : d[i * s + xo]!, y = d[i * s + yo]!;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
        const area = Math.abs((ax - avgX) * (y - ay) - (ax - x) * (avgY - ay));
        if (area > best) { best = area; bi = i; }
      }
      m = putPoint(v, out, m, cap, bi);
      a = bi;
    }
    m = putPoint(v, out, m, cap, n - 1);
    const y0 = d[yo]!, yl = d[(n - 1) * s + yo]!;
    if (y0 < yMin) yMin = y0;
    if (y0 > yMax) yMax = y0;
    if (yl < yMin) yMin = yl;
    if (yl > yMax) yMax = yl;
    return { count: m, yMin, yMax };
  }
}

/** Every k-th point. The cheapest possible, and it aliases: extremes are lost. For previews and for comparison. */
export class StrideKernel extends DecimationKernel {
  capacity(columns: number): number { return columns + 2; }
  reduce(v: PointView, _range: Extent, columns: number, out: Float64Array, cap: number): ReduceResult {
    const n = v.count, d = v.data, s = v.stride, yo = v.valueOffset;
    let m = 0, yMin = Infinity, yMax = -Infinity;
    const steps = Math.min(columns, n);
    for (let j = 0; j < steps; j++) {
      const i = steps === 1 ? 0 : Math.round(j * (n - 1) / (steps - 1));
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
  const n = v.count, r = v.regularDomain;
  if (n < 3) return v;
  const x = r ? (i: number) => r.start + r.step * i : (i: number) => v.data[i * v.stride + v.domainOffset]!;
  if (x(0) >= range.min && x(n - 1) <= range.max) return v;
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (x(mid) < range.min) lo = mid + 1; else hi = mid; }
  const first = lo > 0 ? lo - 1 : 0;
  hi = n;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (x(mid) <= range.max) lo = mid + 1; else hi = mid; }
  const end = lo < n ? lo + 1 : n;
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

/**
 * Sits between a series and its source and reduces the source to what the plot can show:
 * `new Series(new Decimator({}, new MinMaxKernel(), source), new LinePath(new LinearCurve()))`.
 * Only the visible part of the domain is read, so zooming in refills from the full data again.
 * Sources always deliver points ascending in the domain, so any source works; one flagged `isSorted` is read in place.
 */
export class Decimator extends DataTransform<DecimatorAttributes, [kernel: DecimationKernel, source: DataNode]> {
  #version = 0;
  #scratch = new Float64Array(0);

  get kernel(): DecimationKernel { return this.child(0, DecimationKernel); }
  get source(): DataNode { return this.child(1, DataSource, DataTransform); }
  override get channelNames(): readonly string[] { return this.source.channelNames ?? []; }

  /** Anything beneath bubbles an invalidation up through here, so one counter covers source, kernel and attributes. */
  override invalidate(): void {
    this.#version++;
    super.invalidate();
  }
  get version(): number { return this.#version; }
  get pointCount(): number { return this.source.pointCount; }
  domain(): Extent | null { return this.source.domain(); }
  valueExtent(): Extent | null { return this.source.valueExtent(); }
  channelExtent(name: string): Extent | null { return this.source.channelExtent(name); }

  plan(context: PlanContext): FillPlan {
    const source = this.source, kernel = this.kernel, a = this.attrs;
    const inner = source.plan(context);
    if (a.enabled === false) return inner;
    // Kernels thin by pixel column of the domain, which a path that only has an order does not have.
    if (context.sequence) fail('a Decimator needs a domain that is a position on an axis: an XY series has only an order, so draw it undecimated');
    // Kernels reduce (domain, value) pairs; a channel column would not follow the points they keep.
    if (context.channels.length > 0) fail('a Decimator cannot carry channels: bind on undecimated data, or turn the Decimator off');
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
        const x = (i: number) => windowed.regularDomain
          ? windowed.regularDomain.start + windowed.regularDomain.step * i
          : windowed.data[i * windowed.stride + windowed.domainOffset]!;
        return {
          count: r.count,
          extents: [n > 0 ? { min: x(0), max: x(n - 1) } : NO_POINTS, { min: r.yMin, max: r.yMax }],
        };
      },
    };
  }

  /** The source's own storage if it offers it, else the source filled into a scratch buffer. */
  #read(source: DataNode, inner: FillPlan): PointView {
    const own = source.view?.();
    if (own) return own;   // null for generated data and for transforms, which fill a scratch buffer instead
    if (this.#scratch.length < inner.capacity * 2) this.#scratch = new Float64Array(inner.capacity * 2);
    const filled = inner.fill(this.#scratch);
    return { data: this.#scratch, count: filled.count, stride: 2, domainOffset: 0, valueOffset: 1, regularDomain: null };
  }
}

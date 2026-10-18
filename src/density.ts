/**
 * Binning as a data transform: points in, a count (or a sum, or a mean) for each bin out. A histogram is this and `BarPath`;
 * a heat map is this over two dimensions and `HeatMap`.
 *
 *   <DomainSeries>
 *     <Density width={5}><ObjectDataSource source={people} domain="age" value="age" /></Density>
 *     <BarPath width={1} />
 *   </DomainSeries>
 *
 * `by` names the dimensions to bin, any number of them: `'domain'` and `'value'` are the source's own two columns, and any
 * other name is one of its channels. The default is `['domain']`. Every point that has a finite number in each of those
 * dimensions lands in one bin. Each bin is one point of the output, at the bin's centre:
 *
 *   one dimension    domain = the bin's centre, value = the statistic (`stat`)
 *   two or more      domain = the first dimension's centre, value = the second's, and each further dimension is a channel of its name
 *
 * and these channels in any case: `domain` (the first dimension's centre again, as a channel by name), `count` (the points in the bin), `sum` (the total of the `weight` channel, which
 * is `count` when there is none), `mean` (`sum / count`), `fraction` (the bin's share of the total), `density` (the share per unit
 * of the bin's size, so a histogram of it has area 1), and `width` and `height`: the size of the bin along the first and the
 * second dimension, so a renderer can draw a bin as the box it is. `weight` is what each point counts for: left out, a point
 * counts as 1; with a channel (or `'value'`) named, `sum` and `mean` are of it. `stat` is the value of a one-dimensional
 * output: `'count'` (the default; with a `weight`, `'sum'`), `'sum'`, `'mean'`, `'fraction'` or `'density'`.
 *
 * `halfLife` makes the points fade with their place in the source: the last counts in full, the one `halfLife` points before
 * it counts half, and so on. Over a window moved along the data by a `Slice` that is a trail that fades behind the newest
 * point, which is how a phosphor screen draws, and each bin's `sum` is how bright it is.
 *
 * Bin size is set for each dimension, as a number (every dimension) or an array with one for each:
 *   `width`   the size of a bin, in the dimension's own units. Edges fall at `origin` plus a whole number of widths (origin 0 by default).
 *   `bins`    how many bins, spread evenly over the dimension's extent.
 *   `extent`  the span to bin over, `{ min, max }`, instead of the data's own; points outside it are left out.
 * With neither `width` nor `bins` the Freedman–Diaconis rule picks a width from the spread of the points (Sturges' rule when
 * that is zero), never more than `maxBins` (default 200) bins along a dimension. A bin is closed on the left and open on the
 * right, except the last, which holds the top edge. With one dimension empty bins are kept as zeros (so bars are evenly
 * spaced); with more they are left out (`empty` says otherwise). The result is worked out once for each change of the source or the attributes.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, AUTO, NUMBER, STRING } from './attrs.ts';
import { type DataNode, DataSource, DataTransform, type FillPlan, isDomainName, isValueName, type PlanContext } from './data.ts';
import { KeyedTransform } from './partition.ts';
import { type BaseAttributes, fail } from './element.ts';
import type { Extent } from './geometry.ts';
import { quantile } from './quantile.ts';

/* oxlint-disable typescript/consistent-type-assertions -- stat and size channel names are checked against the `STATS` and `SIZES` lists at runtime and then narrowed to the literal union */

export type Stat = 'count' | 'sum' | 'mean' | 'fraction' | 'density';
const STATS: readonly Stat[] = ['count', 'sum', 'mean', 'fraction', 'density'];
/** Channels beside the statistics: the bin's size along the first two dimensions. */
const SIZES = ['width', 'height'] as const;
/** Most cells a grid may have: a dense array of them is held. */
const MAX_CELLS = 4_000_000;

export interface DensityAttributes extends BaseAttributes {
  /** The dimensions to bin: 'domain', 'value' or channel names. Default ['domain']. */
  by?: readonly string[];
  /** What each point counts for: a channel name or 'value'. Default: 1 for each point. */
  weight?: string;
  /**
   * Points count for less the further they are before the last one the source delivers (in the domain's order): one
   * `halfLife` points back counts half. Multiplies the `weight`, and, like it, is what `sum` adds up. Default: all alike.
   */
  halfLife?: number;
  /** The value of a one-dimensional output: 'count', 'sum', 'mean', 'fraction' (the share of the total, 0 to 1) or 'density'. Default 'count', or 'sum' when a `weight` or a `halfLife` is given. */
  stat?: Stat;
  /** Bin size in each dimension's units: one number for all, or one for each dimension. */
  width?: number | readonly number[];
  /** Number of bins in each dimension, spread evenly over its extent (by default the data's own range). */
  bins?: number | readonly number[];
  /** Where a bin edge falls when `width` is used, in each dimension: edges are at `origin` plus whole widths. Default 0. */
  origin?: number | readonly number[];
  /** The span to bin over in each dimension, as `{ min, max }` (one for all, or an array with one for each); points outside are left out. Default: the data's extent. */
  extent?: Extent | readonly (Extent | null)[];
  /** Most bins along a dimension when the size is chosen by the rule. Default 200. */
  maxBins?: number;
  /** 'keep' bins with no points as zeros, 'omit' leaves them out. Default 'keep' for one dimension, 'omit' for more. */
  empty?: 'keep' | 'omit';
}

/** One dimension's bins: edge `lo`, `n` bins `width` wide. */
interface Axis {
  lo: number;
  width: number;
  n: number;
}

interface Computed {
  /** The dimensions' centres, each a column of one value for every output bin. */
  centres: Float64Array[];
  columns: Record<Stat | 'width' | 'height', Float64Array>;
  count: number;
}

const list = <T>(v: T | readonly T[] | undefined, k: number): T | undefined =>
  Array.isArray(v) ? (v as readonly T[])[k] : (v as T | undefined);

export class Density extends KeyedTransform<DensityAttributes, [source: DataNode]> {
  static override attrTypes = {
    ...DataTransform.attrTypes,
    by: AUTO,
    weight: STRING,
    halfLife: NUMBER,
    stat: STRING,
    width: AUTO,
    bins: AUTO,
    origin: AUTO,
    extent: AUTO,
    maxBins: NUMBER,
    empty: STRING,
  } satisfies AttrTypesFor<DensityAttributes>;
  #version = 0;
  #cache: { version: number; value: Computed } | null = null;

  get source(): DataNode {
    return this.child(0, DataSource, DataTransform);
  }
  override invalidate(): void {
    this.#version++;
    super.invalidate();
  }
  get version(): number {
    return this.#version;
  }

  get #dims(): readonly string[] {
    return this.attrs.by ?? ['domain'];
  }
  /** What it offers: the other dimensions, then the statistics and sizes. */
  override get channelNames(): readonly string[] {
    const dims = this.#dims;
    return ['domain', ...(dims.length > 2 ? dims.slice(2) : []), ...STATS, ...SIZES];
  }

  #compute(): Computed {
    if (this.#cache && this.#cache.version === this.#version) return this.#cache.value;
    const a = this.attrs,
      dims = this.#dims,
      k = dims.length;
    if (k === 0) fail('Density: `by` needs at least one dimension');
    if (new Set(dims).size !== k) fail('Density: `by` names a dimension twice');
    const weightName = a.weight;
    // Read what is needed from the source: its own two columns, and a channel for each other name.
    const names = [...new Set([...dims, ...(weightName ? [weightName] : [])].filter((n) => n !== 'domain' && n !== 'value'))];
    const plan = this.source.plan({
      width: 0,
      height: 0,
      domainRange: { min: -Infinity, max: Infinity },
      sorted: true,
      columns: ['domain', 'value', ...names],
    });
    const stride = 2 + names.length,
      buf = new Float64Array(plan.capacity * stride),
      { count: n } = plan.fill(buf);
    const column = (name: string) => (name === 'domain' ? 0 : name === 'value' ? 1 : 2 + names.indexOf(name));
    const cols = dims.map(column),
      wcol = weightName ? column(weightName) : -1;

    // The points that count: every dimension (and the weight) a number.
    const rows: number[] = [];
    for (let i = 0; i < n; i++) {
      let ok = true;
      for (const c of cols) {
        const v = buf[stride * i + c]!;
        if (!Number.isFinite(v)) {
          ok = false;
          break;
        }
      }
      if (ok && wcol >= 0) {
        const w = buf[stride * i + wcol]!;
        if (!Number.isFinite(w)) ok = false;
      }
      if (ok) rows.push(i);
    }

    // One dimension's bins from the data and the attributes.
    const axes: Axis[] = dims.map((_, d) => {
      const v = Float64Array.from(rows, (i) => buf[stride * i + cols[d]!]!);
      const given =
        a.extent === undefined ? undefined : Array.isArray(a.extent) ? (a.extent as readonly (Extent | null)[])[d] : (a.extent as Extent);
      let min = Infinity,
        max = -Infinity;
      if (given) {
        min = given.min;
        max = given.max;
      } else
        for (const x of v) {
          if (x < min) min = x;
          if (x > max) max = x;
        }
      if (!(min <= max)) return { lo: 0, width: 1, n: 0 };
      const width = list(a.width, d),
        bins = list(a.bins, d),
        origin = list(a.origin, d) ?? 0,
        maxBins = a.maxBins ?? 200;
      if (width !== undefined && !(width > 0)) fail(`Density: width must be above 0 (got ${width})`);
      if (bins !== undefined && !(bins >= 1)) fail(`Density: bins must be at least 1 (got ${bins})`);
      if (width !== undefined) {
        const i0 = Math.floor((min - origin) / width + 1e-9),
          i1 = Math.floor((max - origin) / width + 1e-9);
        if (i1 - i0 + 1 > MAX_CELLS) fail(`Density: width ${width} makes ${i1 - i0 + 1} bins along "${dims[d]}": use a wider bin`);
        return { lo: origin + i0 * width, width, n: i1 - i0 + 1 };
      }
      const span = max - min;
      if (span === 0) return { lo: min - 0.5, width: 1, n: 1 }; // no spread: one bin round the value
      if (bins !== undefined) {
        const nb = Math.floor(bins);
        return { lo: min, width: span > 0 ? span / nb : 1, n: nb };
      }
      // The rule: Freedman–Diaconis from the spread of the points, else Sturges.
      v.sort();
      const m = v.length;
      const iqr = m > 1 ? quantile(v, 0.75) - quantile(v, 0.25) : 0;
      let nb = iqr > 0 && span > 0 ? Math.ceil(span / ((2 * iqr) / Math.cbrt(m))) : Math.ceil(Math.log2(Math.max(m, 1)) + 1);
      nb = Math.max(1, Math.min(maxBins, nb));
      return { lo: min, width: span > 0 ? span / nb : 1, n: nb };
    });

    let cells = 1;
    for (const ax of axes) {
      cells *= Math.max(ax.n, 1);
      if (cells > MAX_CELLS)
        fail(`Density: ${axes.map((x) => x.n).join(' by ')} bins is too many cells: use \`width\` or \`bins\` to make them fewer`);
    }
    const fade = a.halfLife !== undefined && a.halfLife > 0 ? 1 / a.halfLife : 0;
    const counts = new Float64Array(cells),
      sums = new Float64Array(cells);
    if (!axes.some((ax) => ax.n === 0)) {
      for (const i of rows) {
        let at = 0,
          inside = true;
        for (let d = 0; d < k; d++) {
          const ax = axes[d]!,
            v = buf[stride * i + cols[d]!]!,
            ratio = (v - ax.lo) / ax.width,
            x = Math.floor(ratio + 1e-9);
          // The top edge belongs to the last bin (to within rounding: `lo + n * width` is rarely exactly the maximum when
          // `width` came from a division); a point past the ends (an explicit extent) is left out.
          const idx = x === ax.n && ratio <= ax.n + 1e-9 ? ax.n - 1 : x;
          if (idx < 0 || idx >= ax.n) {
            inside = false;
            break;
          }
          at = at * ax.n + idx;
        }
        if (!inside) continue;
        counts[at]!++;
        sums[at]! += (wcol >= 0 ? buf[stride * i + wcol]! : 1) * (fade > 0 ? 2 ** (-(n - 1 - i) * fade) : 1);
      }
    }

    // The output: each bin, ascending in the first dimension and then the second…
    const keepEmpty = (a.empty ?? (k === 1 ? 'keep' : 'omit')) === 'keep';
    const kept: number[] = [];
    for (let c = 0; c < cells; c++) if (keepEmpty ? counts.length > 0 && axes.every((x) => x.n > 0) : counts[c]! > 0) kept.push(c);
    const m = kept.length;
    let total = 0;
    for (const c of kept) total += sums[c]!;
    const volume = axes.reduce((p, ax) => p * ax.width, 1);
    const centres = axes.map(() => new Float64Array(m));
    const out = Object.fromEntries([...STATS, ...SIZES].map((s) => [s, new Float64Array(m)])) as Computed['columns'];
    kept.forEach((cell, r) => {
      let rest = cell;
      for (let d = k - 1; d >= 0; d--) {
        const ax = axes[d]!,
          idx = rest % ax.n;
        rest = (rest - idx) / ax.n;
        centres[d]![r] = ax.lo + (idx + 0.5) * ax.width;
      }
      const cnt = counts[cell]!,
        sum = sums[cell]!;
      out.count[r] = cnt;
      out.sum[r] = sum;
      out.mean[r] = cnt > 0 ? sum / cnt : NaN;
      out.fraction[r] = total > 0 ? sum / total : NaN;
      out.density[r] = total > 0 ? sum / total / volume : NaN;
      out.width[r] = axes[0]!.width;
      out.height[r] = k > 1 ? axes[1]!.width : NaN;
    });
    const value: Computed = { centres, columns: out, count: m };
    this.#cache = { version: this.#version, value };
    return value;
  }

  /** The value column: the statistic for one dimension, else the second dimension's centres. */
  #value(c: Computed): Float64Array {
    if (this.#dims.length > 1) return c.centres[1]!;
    const stat = this.attrs.stat ?? (this.attrs.weight || this.attrs.halfLife ? 'sum' : 'count');
    if (!STATS.includes(stat)) fail(`Density: stat is one of ${STATS.join(', ')} (got "${stat}")`);
    return c.columns[stat];
  }
  /** A named channel's column. */
  #channel(c: Computed, name: string): Float64Array {
    const dims = this.#dims,
      extra = dims.indexOf(name);
    if (name === 'domain') return c.centres[0]!;
    if (extra >= 2) return c.centres[extra]!;
    if ((STATS as readonly string[]).includes(name) || (SIZES as readonly string[]).includes(name)) return c.columns[name as Stat];
    return fail(`Density has no channel "${name}" (it has ${this.channelNames.join(', ')})`);
  }
  #extent(a: Float64Array): Extent | null {
    let min = Infinity,
      max = -Infinity;
    for (const v of a)
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    return min <= max ? { min, max } : null;
  }

  get pointCount(): number {
    return this.#compute().count;
  }
  domain(): Extent | null {
    const c = this.#compute(),
      d = c.centres[0]!;
    return d.length > 0 ? { min: d[0]!, max: d[d.length - 1]! } : null;
  }
  valueExtent(): Extent | null {
    return this.#extent(this.#value(this.#compute()));
  }
  channelExtent(name: string): Extent | null {
    return this.#extent(this.#channel(this.#compute(), name));
  }

  plan(context: PlanContext): FillPlan {
    const c = this.#compute(),
      domain = c.centres[0]!,
      value = this.#value(c),
      count = c.count;
    const want = context.columns.map((n) => (isDomainName(n) ? domain : isValueName(n) ? value : this.#channel(c, n))),
      stride = want.length;
    return {
      capacity: count,
      fill: (out) => {
        for (let i = 0; i < count; i++) {
          for (let j = 0; j < stride; j++) out[stride * i + j] = want[j]![i]!;
        }
        const none: Extent = { min: Infinity, max: -Infinity };
        return { count, extents: want.map((w) => this.#extent(w) ?? none) };
      },
    };
  }
}

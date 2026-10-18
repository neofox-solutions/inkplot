/**
 * Statistics as a data transform: samples in, the numbers that summarise them out.
 *
 *   <DomainSeries>
 *     <BoxStats><ObjectDataSource source={samples} domain="group" value="x" /></BoxStats>
 *     <BoxPath />
 *   </DomainSeries>
 *
 * `BoxStats` sits between a series and a source whose points are samples: the domain says which group a sample belongs to
 * (samples with the same domain are one group) and the value is the measurement. Its output has a point for each group, at the
 * group's domain, with the **median** as the value (`value="mean"` for the mean) and these channels:
 *
 *   min, q1, median, q3, max   the box and its whiskers
 *   mean, sd, sem, n           for error bars (`sd` is the sample standard deviation, `sem` that over √n)
 *
 * so `BoxPath` finds what it needs by their names, and with `value="mean"`, `<ErrorBars error="sd" />` (or `sem`) on a
 * series of its output draws the mean with its spread. Whiskers reach the furthest sample within `fence` times the interquartile range of the box (1.5 by default,
 * Tukey's rule); samples beyond are **outliers**. `fence="minmax"` has the whiskers reach the extremes and no outliers.
 * `output="outliers"` gives those outliers instead (a point for each, at its group's domain, with the sample as the value) to feed
 * a series of markers, so the two series are made from the one source:
 *
 *   <BoxStats output="outliers">{source}</BoxStats>
 *
 * `method` is how a quartile falls between samples: 'inclusive' (the default: linear between the closest ranks, as most
 * packages do) or 'exclusive' (the quartile of the data without its ends, as the textbook method does). Gaps (NaN samples)
 * are left out. The result is cached against the source's version, so a change of the samples recomputes it once.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, AUTO, STRING } from './attrs.ts';
import { quantile } from './quantile.ts';
import { type DataNode, DataSource, DataTransform, type FillPlan, isDomainName, isValueName, type PlanContext } from './data.ts';
import { KeyedTransform } from './partition.ts';
import { type BaseAttributes, fail } from './element.ts';
import type { Extent } from './geometry.ts';

/* oxlint-disable typescript/consistent-type-assertions -- summary channel names are checked against the `SUMMARY` list at runtime and then narrowed to the literal union */

export interface BoxStatsAttributes extends BaseAttributes {
  /** 'summary' (the default): a point for each group. 'outliers': a point for each sample beyond the whiskers. */
  output?: 'summary' | 'outliers';
  /** How far the whiskers may reach past the box, in interquartile ranges (default 1.5), or 'minmax' for the whole range. */
  fence?: number | 'minmax';
  /** How a quartile is found between samples. Default 'inclusive'. */
  method?: 'inclusive' | 'exclusive';
  /** Which statistic is the point's value: 'median' (the default; what a box is drawn round) or 'mean' (what error bars from `sd` or `sem` are drawn round). */
  value?: 'median' | 'mean';
}

/** The channels of a summary, in the order they are stored. */
const SUMMARY = ['min', 'q1', 'median', 'q3', 'max', 'mean', 'sd', 'sem', 'n'] as const;
type SummaryChannel = (typeof SUMMARY)[number];

interface Computed {
  /** Group domains, ascending. */
  groups: Float64Array;
  /** One column per summary channel, a value for each group. */
  columns: Record<SummaryChannel, Float64Array>;
  outlierDomain: Float64Array;
  outlierValue: Float64Array;
}

export class BoxStats extends KeyedTransform<BoxStatsAttributes, [source: DataNode]> {
  static override attrTypes = {
    ...DataTransform.attrTypes,
    output: STRING,
    fence: AUTO,
    method: STRING,
    value: STRING,
  } satisfies AttrTypesFor<BoxStatsAttributes>;
  #version = 0;
  #cache: { version: number; value: Computed } | null = null;

  get source(): DataNode {
    return this.child(0, DataSource, DataTransform);
  }
  override get channelNames(): readonly string[] {
    return this.attrs.output === 'outliers' ? [] : SUMMARY;
  }
  /** Anything beneath (the source) bubbles an invalidation up through here, so one counter covers the source and the attributes. */
  override invalidate(): void {
    this.#version++;
    super.invalidate();
  }
  get version(): number {
    return this.#version;
  }

  #compute(): Computed {
    if (this.#cache && this.#cache.version === this.#version) return this.#cache.value;
    const src = this.source,
      plan = src.plan({ width: 0, height: 0, domainRange: { min: -Infinity, max: Infinity }, columns: ['domain', 'value'] });
    const buf = new Float64Array(plan.capacity * 2),
      { count } = plan.fill(buf);
    const a = this.attrs,
      fence = a.fence === 'minmax' ? Infinity : (a.fence ?? 1.5),
      method = a.method ?? 'inclusive';
    if (a.fence !== undefined && a.fence !== 'minmax' && !(typeof a.fence === 'number' && a.fence >= 0))
      fail('BoxStats: fence is a number of interquartile ranges, or "minmax"');
    const groups: number[] = [],
      cols: Record<SummaryChannel, number[]> = { min: [], q1: [], median: [], q3: [], max: [], mean: [], sd: [], sem: [], n: [] };
    const outD: number[] = [],
      outV: number[] = [];
    for (let i = 0; i < count;) {
      const key = buf[2 * i]!;
      let j = i;
      const values: number[] = [];
      for (; j < count && buf[2 * j] === key; j++) {
        const y = buf[2 * j + 1]!;
        if (Number.isFinite(y)) values.push(y);
      }
      i = j;
      if (values.length === 0) continue;
      values.sort((p, q) => p - q);
      const n = values.length,
        q1 = quantile(values, 0.25, method),
        med = quantile(values, 0.5, method),
        q3 = quantile(values, 0.75, method);
      const reach = fence * (q3 - q1);
      let lo = values[0]!,
        hi = values[n - 1]!;
      if (reach !== Infinity) {
        // The furthest samples still inside the fences; those beyond are outliers.
        lo = values.find((v) => v >= q1 - reach) ?? q1;
        hi = [...values].reverse().find((v) => v <= q3 + reach) ?? q3;
        for (const v of values)
          if (v < q1 - reach || v > q3 + reach) {
            outD.push(key);
            outV.push(v);
          }
      }
      let sum = 0;
      for (const v of values) sum += v;
      const mean = sum / n;
      let ss = 0;
      for (const v of values) ss += (v - mean) * (v - mean);
      const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : NaN;
      groups.push(key);
      cols.min.push(lo);
      cols.q1.push(q1);
      cols.median.push(med);
      cols.q3.push(q3);
      cols.max.push(hi);
      cols.mean.push(mean);
      cols.sd.push(sd);
      cols.sem.push(sd / Math.sqrt(n));
      cols.n.push(n);
    }
    const value: Computed = {
      groups: Float64Array.from(groups),
      columns: Object.fromEntries(SUMMARY.map((c) => [c, Float64Array.from(cols[c])])) as Computed['columns'],
      outlierDomain: Float64Array.from(outD),
      outlierValue: Float64Array.from(outV),
    };
    this.#cache = { version: this.#version, value };
    return value;
  }

  get pointCount(): number {
    const c = this.#compute();
    return this.attrs.output === 'outliers' ? c.outlierDomain.length : c.groups.length;
  }
  domain(): Extent | null {
    const c = this.#compute(),
      d = this.attrs.output === 'outliers' ? c.outlierDomain : c.groups;
    return d.length > 0 ? { min: d[0]!, max: d[d.length - 1]! } : null;
  }
  #extent(a: Float64Array): Extent | null {
    let min = Infinity,
      max = -Infinity;
    for (const v of a) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return min <= max ? { min, max } : null;
  }
  valueExtent(): Extent | null {
    const c = this.#compute();
    return this.#extent(this.attrs.output === 'outliers' ? c.outlierValue : c.columns[this.attrs.value ?? 'median']);
  }
  channelExtent(name: string): Extent | null {
    if (this.attrs.output === 'outliers') return null;
    return (SUMMARY as readonly string[]).includes(name) ? this.#extent(this.#compute().columns[name as SummaryChannel]) : null;
  }

  plan(context: PlanContext): FillPlan {
    const c = this.#compute(),
      outliers = this.attrs.output === 'outliers';
    const want = context.columns.map((n) => {
      if (isDomainName(n) || isValueName(n)) return isDomainName(n) ? 'domain' : 'value';
      if (outliers) fail('BoxStats: the outliers have no channels, only the sample (the value)');
      return (SUMMARY as readonly string[]).includes(n)
        ? (n as SummaryChannel)
        : fail(`BoxStats has no channel "${n}" (it has ${SUMMARY.join(', ')})`);
    });
    const count = outliers ? c.outlierDomain.length : c.groups.length,
      stride = want.length;
    return {
      capacity: count,
      fill: (out) => {
        const domain = outliers ? c.outlierDomain : c.groups,
          value = outliers ? c.outlierValue : c.columns[this.attrs.value ?? 'median'];
        const arrays = want.map((w) => (w === 'domain' ? domain : w === 'value' ? value : c.columns[w]));
        for (let i = 0; i < count; i++) for (let k = 0; k < stride; k++) out[stride * i + k] = arrays[k]![i]!;
        const extents = want.map((w, k) =>
          w === 'domain' && domain.length > 0
            ? { min: domain[0]!, max: domain[domain.length - 1]! }
            : (this.#extent(arrays[k]!) ?? { min: Infinity, max: -Infinity }),
        );
        return { count, extents };
      },
    };
  }
}

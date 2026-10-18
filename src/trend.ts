/**
 * Trendlines: a curve fitted to the data, which can be read anywhere along the domain.
 *
 *   <DomainSeries>
 *     <LinearTrend><ObjectDataSource source={rows} domain="t" value="v" /></LinearTrend>
 *     <LinePath><LinearCurve /></LinePath>
 *   </DomainSeries>
 *
 *   Trendline
 *   ├─ LinearTrend        the least-squares line
 *   ├─ PolynomialTrend    a polynomial of a given `degree`
 *   ├─ SinusoidalTrend    a constant plus a sine wave: of a given `period`, or the one that fits best
 *   └─ LoessTrend         local linear regression, as smooth as `smoothness` says: 0 joins the points, 1 is the line
 *
 * A trendline is a `DataTransform` that behaves like a `SyntheticDataSource`: the fit is made once for each change of
 * its source, and the points it gives are samples of the fitted curve, made when drawn: one for each pixel of width across
 * the part of the domain in view (or `count`, always, across the whole of it). So zooming in stays smooth, and the line
 * reaches `extend` further than the data at each end (a fraction of the data's span; one number, or `[before, after]`),
 * which is how a trendline is extrapolated. Default 0.
 *
 * It fits the source's value against its domain. `x` names a channel of the source to fit against instead, which is how a
 * scatter (an `XYSeries`) gets a trendline: `<LinearTrend x="x">`. Its own points have the sampled positions as the domain
 * and the fitted values as the value, which is what an `XYSeries` reads with `x="domain" y="value"`. A point with a gap in either column is left out of the fit.
 *
 * Read it from code too, outside any chart: `trend.evaluate(x)` is the fitted value at a number, or at every number of an
 * array (a `Float64Array` back), and `trend.fit` says how good the fit is: the number of points, `r2`, `rmse`, and what the
 * kind of fit knows (coefficients, period, bandwidth). `readTable(trend)` is the sampled curve as a table.
 *
 * To write another, extend `Trendline` and make a `TrendModel` from the points in `fitModel`.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, AUTO, NUMBER, STRING } from './attrs.ts';
import { type DataNode, DataSource, DataTransform, type FillPlan, type PlanContext } from './data.ts';
import { KeyedTransform } from './partition.ts';
import { type BaseAttributes, fail } from './element.ts';
import type { Extent } from './geometry.ts';

/** How well a trendline fits its points, and what it found. */
export interface TrendFit {
  /** Points the fit used. */
  readonly n: number;
  /** The share of the values' variance the curve explains (1 is a perfect fit; it is below 0 when the curve does worse than the mean). */
  readonly r2: number;
  /** Root mean square of the distances from the curve to the points. */
  readonly rmse: number;
  /** A polynomial's coefficients lowest power first, in `u = (x - center) / scale`; a line's `[intercept, slope]` in x itself; a sinusoid's `[offset, a, b]` for `offset + a cos(w (x - center)) + b sin(w (x - center))` with `w = 2π / period`. */
  readonly coefficients?: readonly number[];
  readonly center?: number;
  readonly scale?: number;
  /** A sinusoid's period, and its amplitude. */
  readonly period?: number;
  readonly amplitude?: number;
  /** A loess or mean line's reach on each side of a point, in the domain's units (it is wider where the points are few). */
  readonly bandwidth?: number;
}

/** A fitted curve: its value at a position (NaN where it has none), and what it found beside that. */
export interface TrendModel {
  at(x: number): number;
  readonly details?: Omit<TrendFit, 'n' | 'r2' | 'rmse'>;
}

export interface TrendlineAttributes extends BaseAttributes {
  /** A channel of the source to fit against instead of its domain. */
  x?: string;
  /** How far past the data the line goes at each end, as a fraction of the data's span: one number, or `[before, after]`. Default 0. */
  extend?: number | readonly [number, number];
  /** Samples, evenly spaced over the whole span, always. Left out: one for each pixel of width across the part in view. */
  count?: number;
}

const DEFAULT_SAMPLES = 512;
const NONE: Extent = { min: Infinity, max: -Infinity };

/** The base of trendlines: reads the points, fits them once for each change, and samples the curve. */
export abstract class Trendline<A extends TrendlineAttributes = TrendlineAttributes> extends KeyedTransform<A, [source: DataNode]> {
  static override attrTypes = {
    ...DataTransform.attrTypes,
    x: STRING,
    extend: AUTO,
    count: NUMBER,
  } satisfies AttrTypesFor<TrendlineAttributes>;
  #version = 0;
  #cache: { version: number; xs: Float64Array; ys: Float64Array; model: TrendModel | null } | null = null;
  #fit: { version: number; value: TrendFit | null } | null = null;

  get source(): DataNode {
    return this.child(0, DataSource, DataTransform);
  }
  /** Make the curve from the points: ascending in x, every value finite, at least one. Null when they do not determine one. */
  protected abstract fitModel(xs: Float64Array, ys: Float64Array): TrendModel | null;

  override invalidate(): void {
    this.#version++;
    super.invalidate();
  }
  get version(): number {
    return this.#version;
  }
  override get channelNames(): readonly string[] {
    return ['domain'];
  }
  get pointCount(): number {
    return this.attrs.count ?? DEFAULT_SAMPLES;
  }

  /** The points the fit is made from and the curve, made again only after a change. */
  #state() {
    if (this.#cache && this.#cache.version === this.#version) return this.#cache;
    const name = this.attrs.x,
      src = this.source;
    const plan = src.plan({
      width: 0,
      height: 0,
      domainRange: { min: -Infinity, max: Infinity },
      sorted: true,
      columns: name ? ['domain', 'value', name] : ['domain', 'value'],
    });
    const stride = name ? 3 : 2,
      buf = new Float64Array(plan.capacity * stride),
      { count } = plan.fill(buf);
    const xc = name ? 2 : 0;
    let xs = new Float64Array(count),
      ys = new Float64Array(count),
      n = 0;
    for (let i = 0; i < count; i++) {
      const x = buf[stride * i + xc]!,
        y = buf[stride * i + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      xs[n] = x;
      ys[n] = y;
      n++;
    }
    xs = xs.slice(0, n);
    ys = ys.slice(0, n);
    let sorted = true;
    for (let i = 1; i < n; i++)
      if (xs[i]! < xs[i - 1]!) {
        sorted = false;
        break;
      }
    if (!sorted) {
      const order = Uint32Array.from({ length: n }, (_, i) => i).sort((p, q) => xs[p]! - xs[q]!);
      xs = Float64Array.from(order, (i) => xs[i]!);
      ys = Float64Array.from(order, (i) => ys[i]!);
    }
    const model = n > 0 ? this.fitModel(xs, ys) : null;
    return (this.#cache = { version: this.#version, xs, ys, model });
  }

  /** How well the curve fits, or null when there are too few points to fit one. */
  get fit(): TrendFit | null {
    if (this.#fit && this.#fit.version === this.#version) return this.#fit.value;
    const { xs, ys, model } = this.#state();
    let value: TrendFit | null = null;
    if (model) {
      const n = xs.length;
      let mean = 0;
      for (let i = 0; i < n; i++) mean += ys[i]!;
      mean /= n;
      let sse = 0,
        sst = 0;
      for (let i = 0; i < n; i++) {
        const r = ys[i]! - model.at(xs[i]!);
        sse += r * r;
        sst += (ys[i]! - mean) ** 2;
      }
      value = { n, r2: sst > 0 ? 1 - sse / sst : sse === 0 ? 1 : 0, rmse: Math.sqrt(sse / n), ...model.details };
    }
    this.#fit = { version: this.#version, value };
    return value;
  }

  /** The fitted value at a position, or at each of an array of them. NaN where there is no fit, or the position is not a number. */
  evaluate(x: number): number;
  evaluate(x: ArrayLike<number>): Float64Array;
  evaluate(x: number | ArrayLike<number>): number | Float64Array {
    const model = this.#state().model;
    if (typeof x === 'number') return model ? model.at(x) : NaN;
    const out = new Float64Array(x.length);
    for (let i = 0; i < out.length; i++) out[i] = model ? model.at(x[i]!) : NaN;
    return out;
  }

  /** The span the line covers: the data's, and the extension at each end. */
  #span(): Extent | null {
    const { xs } = this.#state();
    if (!xs.length) return null;
    const lo = xs[0]!,
      hi = xs[xs.length - 1]!,
      e = this.attrs.extend ?? 0;
    const [before, after] = typeof e === 'number' ? [e, e] : e;
    if (!(before >= 0 && after >= 0)) fail(`${this.constructor.name}: extend must be 0 or more (got ${String(e)})`);
    return { min: lo - (hi - lo) * before, max: hi + (hi - lo) * after };
  }
  /** The samples for a plot: where they are and how many. */
  #samples(context: PlanContext): Float64Array {
    const span = this.#span();
    if (!span) return new Float64Array(0);
    const count = this.attrs.count;
    const lo = count === undefined ? Math.max(span.min, context.domainRange.min) : span.min;
    const hi = count === undefined ? Math.min(span.max, context.domainRange.max) : span.max;
    if (!(lo <= hi)) return new Float64Array(0);
    const n = count ?? (context.width > 0 ? Math.max(2, Math.ceil(context.width)) : DEFAULT_SAMPLES);
    return Float64Array.from({ length: n }, (_, i) => (n === 1 ? lo : i === n - 1 ? hi : lo + ((hi - lo) * i) / (n - 1)));
  }

  domain(): Extent | null {
    return this.#span();
  }
  valueExtent(): Extent | null {
    const ys = this.evaluate(
      this.#samples({ width: 0, height: 0, domainRange: { min: -Infinity, max: Infinity }, sorted: true, columns: ['domain', 'value'] }),
    );
    let min = Infinity,
      max = -Infinity;
    for (const y of ys)
      if (Number.isFinite(y)) {
        if (y < min) min = y;
        if (y > max) max = y;
      }
    return min <= max ? { min, max } : null;
  }
  channelExtent(name: string): Extent | null {
    if (name !== 'domain') fail(`${this.constructor.name} has no channel "${name}" (it has domain)`);
    return this.domain();
  }

  plan(context: PlanContext): FillPlan {
    // The curve is `domain` and `value`, and `domain` again for anything else it is asked for by that name.
    const kinds = context.columns.map((c) =>
      c === 'domain' || c === 'x'
        ? 0
        : c === 'value' || c === 'y'
          ? 1
          : fail(`${this.constructor.name} has no channel "${c}" (it has domain)`),
    );
    const xs = this.#samples(context),
      n = xs.length,
      stride = kinds.length;
    return {
      capacity: n,
      fill: (out) => {
        const ys = this.evaluate(xs);
        let min = Infinity,
          max = -Infinity;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < stride; j++) out[stride * i + j] = kinds[j] === 0 ? xs[i]! : ys[i]!;
          if (ys[i]! < min) min = ys[i]!;
          if (ys[i]! > max) max = ys[i]!;
        }
        const x: Extent = n ? { min: xs[0]!, max: xs[n - 1]! } : NONE;
        const y: Extent = min <= max ? { min, max } : NONE;
        return { count: n, extents: kinds.map((k) => (k === 0 ? x : y)) };
      },
    };
  }
}

// ─── Linear ───

export interface LinearTrendAttributes extends TrendlineAttributes {}
/** The least-squares line. `fit.coefficients` is `[intercept, slope]`. */
export class LinearTrend extends Trendline<LinearTrendAttributes> {
  protected fitModel(xs: Float64Array, ys: Float64Array): TrendModel | null {
    return leastSquares(xs, ys);
  }
}
/** The least-squares line through the points; null when they share one position. */
function leastSquares(xs: Float64Array, ys: Float64Array): TrendModel | null {
  const n = xs.length;
  let mx = 0,
    my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - my);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx,
    intercept = my - slope * mx;
  return { at: (x) => intercept + slope * x, details: { coefficients: [intercept, slope] } };
}

// ─── Polynomial ───

export interface PolynomialTrendAttributes extends TrendlineAttributes {
  /** The highest power, 1 to 12. Default 2. */
  degree?: number;
}
const MAX_DEGREE = 12;

/** Solve `a x = b` for a square `a` (rows of `m` numbers) by elimination with pivoting; null when it is singular. Both are overwritten. */
function solve(a: Float64Array, b: Float64Array, m: number): Float64Array | null {
  let scale = 0;
  for (let i = 0; i < m; i++) scale = Math.max(scale, Math.abs(a[i * m + i]!));
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(a[r * m + c]!) > Math.abs(a[p * m + c]!)) p = r;
    if (!(Math.abs(a[p * m + c]!) > 1e-13 * scale)) return null;
    if (p !== c) {
      for (let k = 0; k < m; k++) {
        const t = a[c * m + k]!;
        a[c * m + k] = a[p * m + k]!;
        a[p * m + k] = t;
      }
      const t = b[c]!;
      b[c] = b[p]!;
      b[p] = t;
    }
    for (let r = c + 1; r < m; r++) {
      const f = a[r * m + c]! / a[c * m + c]!;
      for (let k = c; k < m; k++) a[r * m + k]! -= f * a[c * m + k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const x = new Float64Array(m);
  for (let r = m - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < m; k++) s -= a[r * m + k]! * x[k]!;
    x[r] = s / a[r * m + r]!;
  }
  return x;
}

/**
 * A polynomial of `degree` (2 by default: a parabola). It is fitted on the positions centred and scaled to -1..1, which
 * keeps high degrees well-behaved; `fit.coefficients` are in that scaled position `u = (x - center) / scale`. It needs
 * more distinct positions than its degree.
 */
export class PolynomialTrend extends Trendline<PolynomialTrendAttributes> {
  static override attrTypes = { ...Trendline.attrTypes, degree: NUMBER } satisfies AttrTypesFor<PolynomialTrendAttributes>;
  protected fitModel(xs: Float64Array, ys: Float64Array): TrendModel | null {
    const d = this.attrs.degree ?? 2;
    if (!Number.isInteger(d) || d < 1 || d > MAX_DEGREE)
      fail(`PolynomialTrend: degree is a whole number from 1 to ${MAX_DEGREE} (got ${d})`);
    const n = xs.length,
      m = d + 1;
    const lo = xs[0]!,
      hi = xs[n - 1]!,
      center = (lo + hi) / 2,
      scale = (hi - lo) / 2;
    if (!(scale > 0) || n < m) return null;
    const pow = new Float64Array(2 * d + 1),
      rhs = new Float64Array(m);
    for (let i = 0; i < n; i++) {
      const u = (xs[i]! - center) / scale;
      let p = 1;
      for (let k = 0; k <= 2 * d; k++) {
        pow[k]! += p;
        if (k < m) rhs[k]! += p * ys[i]!;
        p *= u;
      }
    }
    const a = new Float64Array(m * m);
    for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) a[r * m + c] = pow[r + c]!;
    const coefficients = solve(a, rhs, m);
    if (!coefficients) return null;
    return {
      at: (x) => {
        const u = (x - center) / scale;
        let v = 0;
        for (let k = d; k >= 0; k--) v = v * u + coefficients[k]!;
        return v;
      },
      details: { coefficients: Array.from(coefficients), center, scale },
    };
  }
}

// ─── Sinusoidal ───

export interface SinusoidalTrendAttributes extends TrendlineAttributes {
  /** The period in the domain's units. Left out, the period that fits best is found. */
  period?: number;
}
/** Frequencies tried when the period is not given, and points used to try them (the best is then refined on all). */
/** The scan of a sinusoid's period tries about this many (frequency, point) pairs at most: roughly a tenth of a second. */
const SCAN_BUDGET = 4_000_000;
/** Most points the scan uses, and the fewest it falls back to when there are many frequencies to try. */
const SCAN_POINTS = 2000;
const SCAN_MIN_POINTS = 256;

/** Sums for the least-squares fit of `c + a cos(wx) + b sin(wx)` at one frequency: the coefficients and the squared error left. */
/** A number from 0 up to 1 that depends on `k` in no pattern a signal could line up with (an integer mixing hash, the finalizer of murmur3). */
function hashed(k: number): number {
  let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

function sinFit(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  idx: ((i: number) => number) | null,
  n: number,
  w: number,
  center: number,
): { c: number; a: number; b: number; sse: number } | null {
  let s1 = 0,
    sc = 0,
    ss = 0,
    scc = 0,
    sss = 0,
    scs = 0,
    sy = 0,
    syc = 0,
    sys = 0,
    syy = 0;
  for (let k = 0; k < n; k++) {
    const i = idx ? idx(k) : k,
      t = w * (xs[i]! - center),
      c = Math.cos(t),
      s = Math.sin(t),
      y = ys[i]!;
    s1++;
    sc += c;
    ss += s;
    scc += c * c;
    sss += s * s;
    scs += c * s;
    sy += y;
    syc += y * c;
    sys += y * s;
    syy += y * y;
  }
  const a = Float64Array.of(s1, sc, ss, sc, scc, scs, ss, scs, sss),
    b = Float64Array.of(sy, syc, sys);
  const beta = solve(a, Float64Array.from(b), 3);
  if (!beta) return null;
  const sse = syy - (beta[0]! * sy + beta[1]! * syc + beta[2]! * sys);
  return { c: beta[0]!, a: beta[1]!, b: beta[2]!, sse: Math.max(0, sse) };
}

/**
 * A constant plus one sine wave. Give the `period` and only the offset, amplitude and phase are fitted (a linear fit). Without
 * it the period is found too: a periodogram over the periods the data can show (from the whole span down to about two of its
 * typical gaps, which works for unevenly spaced points), then a refinement of the best on every point. `fit.period` and
 * `fit.amplitude` say what was found. A wave with fewer than three points, or with every point at one position, has no fit.
 */
export class SinusoidalTrend extends Trendline<SinusoidalTrendAttributes> {
  static override attrTypes = { ...Trendline.attrTypes, period: NUMBER } satisfies AttrTypesFor<SinusoidalTrendAttributes>;
  protected fitModel(xs: Float64Array, ys: Float64Array): TrendModel | null {
    const n = xs.length,
      given = this.attrs.period;
    if (given !== undefined && !(given > 0)) fail(`SinusoidalTrend: period must be above 0 (got ${given})`);
    const lo = xs[0]!,
      hi = xs[n - 1]!,
      span = hi - lo,
      center = (lo + hi) / 2;
    if (n < 3 || !(span > 0)) return null;
    let period = given;
    if (period === undefined) {
      // Typical gap: the median of the positive ones.
      const gaps: number[] = [];
      for (let i = 1; i < n; i++) if (xs[i]! > xs[i - 1]!) gaps.push(xs[i]! - xs[i - 1]!);
      gaps.sort((p, q) => p - q);
      const gap = gaps[gaps.length >> 1]!;
      const fMin = 1 / span,
        fMax = Math.max(fMin * 2, 1 / (2 * gap));
      // Frequencies a quarter of a peak's width apart (the peak is 1 / span wide) so none is stepped over, on as many of the
      // points as the budget allows. A few hundred points find a peak as well as thousands do; the refinement below uses them all.
      const wanted = Math.max(8, Math.ceil(4 * span * (fMax - fMin)));
      const use =
        wanted * Math.min(n, SCAN_POINTS) > SCAN_BUDGET
          ? Math.min(n, Math.max(SCAN_MIN_POINTS, Math.floor(SCAN_BUDGET / wanted)))
          : Math.min(n, SCAN_POINTS);
      const steps = Math.min(wanted, Math.max(8, Math.floor(SCAN_BUDGET / use)));
      const df = (fMax - fMin) / steps;
      // A subsample at an even stride would alias: a period under twice the stride is indistinguishable from a longer one, and the
      // scan reaches up to the periods of the whole data. Jittering each pick inside its stride (a fixed hash, so the fit is
      // repeatable) turns the alias into noise instead of a peak.
      const picks = new Int32Array(use);
      for (let k = 0; k < use; k++) picks[k] = use < n ? Math.min(n - 1, Math.floor((k + hashed(k)) * (n / use))) : k;
      const idx = (k: number) => picks[k]!;
      let best = fMin,
        bestSse = Infinity;
      for (let f = fMin; f <= fMax + 1e-12; f += df) {
        const r = sinFit(xs, ys, idx, use, 2 * Math.PI * f, center);
        if (r && r.sse < bestSse) {
          bestSse = r.sse;
          best = f;
        }
      }
      // Refine on all the points by golden-section search within a step of the best.
      let a = Math.max(fMin * 0.5, best - df),
        b = best + df;
      const phi = (Math.sqrt(5) - 1) / 2,
        cost = (f: number) => sinFit(xs, ys, null, n, 2 * Math.PI * f, center)?.sse ?? Infinity;
      let c = b - phi * (b - a),
        d = a + phi * (b - a),
        fc = cost(c),
        fd = cost(d);
      for (let it = 0; it < 40; it++) {
        if (fc < fd) {
          b = d;
          d = c;
          fd = fc;
          c = b - phi * (b - a);
          fc = cost(c);
        } else {
          a = c;
          c = d;
          fc = fd;
          d = a + phi * (b - a);
          fd = cost(d);
        }
      }
      period = 1 / ((a + b) / 2);
    }
    const w = (2 * Math.PI) / period,
      r = sinFit(xs, ys, null, n, w, center);
    if (!r) return null;
    const { c, a, b } = r;
    return {
      at: (x) => c + a * Math.cos(w * (x - center)) + b * Math.sin(w * (x - center)),
      details: { coefficients: [c, a, b], center, period, amplitude: Math.hypot(a, b) },
    };
  }
}

// ─── Loess ───

export interface LoessTrendAttributes extends TrendlineAttributes {
  /** 0 to 1: 0 joins the points, 1 is the least-squares line, and between them the line is smoother the larger it is. Default 0.5. Under about 0.2, with unevenly spaced points, the curve follows single points and can swing between close ones. */
  smoothness?: number;
  /** How a point's weight falls with its distance. Default 'tricube'. */
  kernel?: 'tricube' | 'gaussian';
}
/** A window holds at least this many points, so a small bandwidth between sparse points still has a line to fit. */
const MIN_WINDOW = 3;
/** How far past the farthest of those points the window reaches, as a multiple of its distance. */
const WIDEN = 1.25;
/** The reach at smoothness 0.5, as a fraction of the span; `smoothness / (1 - smoothness)` times this is the reach in general. */
const REACH_AT_HALF = 0.3;

/**
 * Local linear regression (the method behind LOESS and LOWESS), centred on each position and reaching both ways: at each place
 * it fits a straight line to the points near it, weighting nearer ones more, and takes that line's value. `smoothness` sets
 * how far it reaches, as `smoothness / (1 - smoothness)` times 0.3 of the data's span: 0 reaches nowhere and the curve joins the
 * points (straight between neighbours; points sharing a position are averaged), larger values are smoother, and 1 reaches everywhere
 * equally, which is the least-squares line (it is that exactly). Where the points are sparse the reach widens to hold at least
 * three of them. Past the ends of the data it continues the local line at the end, with a slope over a wide reach. Each place costs the points in its reach, so a very smooth curve over very many points is slow to sample: pick `count`.
 * It needs sorted points, which it makes itself. `fit.bandwidth` is the reach.
 */
export class LoessTrend extends Trendline<LoessTrendAttributes> {
  static override attrTypes = { ...Trendline.attrTypes, smoothness: NUMBER, kernel: STRING } satisfies AttrTypesFor<LoessTrendAttributes>;

  protected fitModel(xs: Float64Array, ys: Float64Array): TrendModel | null {
    const s = this.attrs.smoothness ?? 0.5,
      kernel = this.attrs.kernel ?? 'tricube';
    if (!(s >= 0 && s <= 1)) fail(`LoessTrend: smoothness is from 0 to 1 (got ${s})`);
    if (kernel !== 'tricube' && kernel !== 'gaussian') fail(`LoessTrend: kernel is 'tricube' or 'gaussian' (got "${String(kernel)}")`);
    const n = xs.length,
      span = xs[n - 1]! - xs[0]!;
    if (!(span > 0)) return null;
    if (s === 1) return leastSquares(xs, ys);
    if (s === 0) return interpolation(xs, ys);
    const h0 = (REACH_AT_HALF * span * s) / (1 - s);
    const weight = kernelWeight(kernel);
    // The local line at x0 (its value there and its slope) from the points within `reach`, widened to hold three.
    const local = (x0: number, reach: number): { a: number; b: number } | null => {
      const { lo, hi, h } = window(xs, x0, reach);
      let s0 = 0,
        s1 = 0,
        s2 = 0,
        t0 = 0,
        t1 = 0;
      for (let j = lo; j < hi; j++) {
        const dx = xs[j]! - x0,
          w = weight(Math.abs(dx) / h);
        s0 += w;
        s1 += w * dx;
        s2 += w * dx * dx;
        t0 += w * ys[j]!;
        t1 += w * dx * ys[j]!;
      }
      if (!(s0 > 0)) return null;
      // Points bunched in a corner of the window say little about the slope (and a line through two near neighbours, read off
      // anywhere else, flies away): where the weighted spread of the points is under 1/8 of the reach, add the missing spread.
      s2 += Math.max(0, s0 * (Math.min(h, span) / 8) ** 2 - (s2 - (s1 * s1) / s0));
      const det = s0 * s2 - s1 * s1;
      return det > 1e-12 * s0 * s2 ? { a: (t0 * s2 - t1 * s1) / det, b: (s0 * t1 - s1 * t0) / det } : { a: t0 / s0, b: 0 };
    };
    const first = xs[0]!,
      last = xs[n - 1]!;
    const at = (x: number): number => {
      if (!Number.isFinite(x)) return NaN;
      if (x >= first && x <= last) return local(x, h0)?.a ?? NaN;
      // Past the data: the local line at the end, continued with a slope taken over a wide reach, since the few points nearest
      // the end give a slope that is mostly noise.
      const end = x < first ? first : last,
        edge = local(end, h0),
        slope = local(end, Math.max(h0, REACH_AT_HALF * span));
      return edge && slope ? edge.a + slope.b * (x - end) : NaN;
    };
    return { at, details: { bandwidth: h0 } };
  }
}

/** How a point's weight falls with its distance `q` (as a fraction of the reach, 0 to 1) under a kernel. */
function kernelWeight(kernel: unknown): (q: number) => number {
  if (kernel !== 'tricube' && kernel !== 'gaussian') fail(`kernel is 'tricube' or 'gaussian' (got "${String(kernel)}")`);
  return kernel === 'tricube'
    ? (q) => {
        const t = 1 - q * q * q;
        return t * t * t;
      }
    : (q) => Math.exp(-4.5 * q * q); // sigma = h / 3: the weight is negligible at the window's edge
}

/** The points within `reach` of `x0` (indices `lo` to `hi`), widening the reach to hold at least MIN_WINDOW of them. */
function window(xs: Float64Array, x0: number, reach: number): { lo: number; hi: number; h: number } {
  const n = xs.length;
  let h = reach;
  let lo = lowerBound(xs, x0 - h),
    hi = lowerBound(xs, x0 + h, true);
  if (hi - lo < MIN_WINDOW) {
    // Widen to the distance of the third nearest point.
    let l = lowerBound(xs, x0) - 1,
      r = l + 1,
      d = 0;
    for (let k = 0; k < Math.min(MIN_WINDOW, n); k++) {
      const dl = l >= 0 ? x0 - xs[l]! : Infinity,
        dr = r < n ? xs[r]! - x0 : Infinity;
      if (dl <= dr) {
        d = dl;
        l--;
      } else {
        d = dr;
        r++;
      }
    }
    // A little past the third point, so that it still counts for something.
    h = Math.max(h, d * WIDEN);
    lo = lowerBound(xs, x0 - h);
    hi = lowerBound(xs, x0 + h, true);
  }
  return { lo, hi, h };
}

// ─── Mean (local constant) ───

export interface MeanTrendAttributes extends TrendlineAttributes {
  /** 0 to 1: 0 joins the points, 1 is their mean, and between them the line is smoother the larger it is. Default 0.5. */
  smoothness?: number;
  /** How a point's weight falls with its distance. Default 'tricube'. */
  kernel?: 'tricube' | 'gaussian';
}
/** Above this many points the weighted means are made on a grid, so that the cost does not grow with the points in each reach. */
const EXACT_UP_TO = 2000;
/** Grid positions across the data's span. */
const GRID = 4096;
/** The reach has to span this many grid steps for the grid to be used; a narrower one reads its few points directly. */
const GRID_MIN_REACH = 3;
/** The spread of each kernel as a fraction of its reach (its standard deviation). */
const SPREAD = { tricube: 0.3795, gaussian: 1 / 3 };

/**
 * A weighted moving average, centred on each position and reaching both ways: the value is the mean of the points near it,
 * nearer ones counting for more. That is the local-constant case of the regression `LoessTrend` makes, and it differs in the one
 * way that matters when the line must be safe: every weight is positive and they sum to one, so the line is always between the
 * lowest and highest value of the data and never overshoots, however smooth; and past the ends it holds the end value, rather than
 * continuing a slope. `smoothness` is the same control as a loess line's (the reach is `smoothness / (1 - smoothness)` times 0.3 of
 * the span): 0 joins the points, 1 is the mean of all of them. The price is bias at the ends and on sharp peaks, where the mean is
 * pulled toward the neighbours; a loess line follows those better. Over many points the means are made on a grid (the points are
 * shared out to it, smoothed there with three passes of a moving sum, and read back), so a very smooth line over millions of points
 * costs what a rough one does. It needs sorted points, which it makes itself. `fit.bandwidth` is the reach.
 */
export class MeanTrend extends Trendline<MeanTrendAttributes> {
  static override attrTypes = { ...Trendline.attrTypes, smoothness: NUMBER, kernel: STRING } satisfies AttrTypesFor<MeanTrendAttributes>;

  protected fitModel(xs: Float64Array, ys: Float64Array): TrendModel | null {
    const s = this.attrs.smoothness ?? 0.5,
      kernel = this.attrs.kernel ?? 'tricube';
    if (!(s >= 0 && s <= 1)) fail(`MeanTrend: smoothness is from 0 to 1 (got ${s})`);
    const weight = kernelWeight(kernel);
    const n = xs.length,
      first = xs[0]!,
      last = xs[n - 1]!,
      span = last - first;
    if (!(span > 0)) return null;
    if (s === 0) {
      const joined = interpolation(xs, ys);
      // The end segments are not continued past the points: the line holds the end value.
      return joined && { ...joined, at: (x) => joined.at(Math.min(last, Math.max(first, x))) };
    }
    if (s === 1) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += ys[i]!;
      const mean = sum / n;
      return { at: (x) => (Number.isFinite(x) ? mean : NaN), details: { bandwidth: Infinity } };
    }
    const h0 = (REACH_AT_HALF * span * s) / (1 - s);
    // The mean of the points within reach of x0, read straight from them.
    const direct = (x0: number): number => {
      const { lo, hi, h } = window(xs, x0, h0);
      let sw = 0,
        sy = 0;
      for (let j = lo; j < hi; j++) {
        const w = weight(Math.abs(xs[j]! - x0) / h);
        sw += w;
        sy += w * ys[j]!;
      }
      return sw > 0 ? sy / sw : NaN;
    };
    const step = span / (GRID - 1);
    if (n <= EXACT_UP_TO || h0 < GRID_MIN_REACH * step)
      return { at: (x) => (Number.isFinite(x) ? direct(Math.min(last, Math.max(first, x))) : NaN), details: { bandwidth: h0 } };

    // On a grid: share each point's weight between the two grid positions beside it, smooth the weights and the weighted values alike
    // (the same three passes, so their ratio is the weighted mean), and read between positions. Where nothing is near, read the points.
    let sw: Float64Array = new Float64Array(GRID),
      sy: Float64Array = new Float64Array(GRID);
    for (let i = 0; i < n; i++) {
      const f = (xs[i]! - first) / step,
        k = Math.min(GRID - 2, Math.floor(f)),
        t = f - k;
      sw[k]! += 1 - t;
      sw[k + 1]! += t;
      sy[k]! += (1 - t) * ys[i]!;
      sy[k + 1]! += t * ys[i]!;
    }
    // Three moving sums of width w have the variance of a kernel of the reach h0 when 3 (w^2 - 1) / 12 = (spread * h0 / step)^2.
    const sigma = (SPREAD[kernel] * h0) / step;
    const radius = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
    for (let pass = 0; pass < 3; pass++) {
      sw = movingSum(sw, radius);
      sy = movingSum(sy, radius);
    }
    const floor = (n / GRID) * 1e-6 * (2 * radius + 1) ** 3;
    const grid = new Float64Array(GRID);
    for (let k = 0; k < GRID; k++) grid[k] = sw[k]! > floor ? sy[k]! / sw[k]! : NaN;
    const at = (x: number): number => {
      if (!Number.isFinite(x)) return NaN;
      const f = (Math.min(last, Math.max(first, x)) - first) / step,
        k = Math.min(GRID - 2, Math.floor(f)),
        a = grid[k]!,
        b = grid[k + 1]!;
      return a === a && b === b ? a + (b - a) * (f - k) : direct(Math.min(last, Math.max(first, x)));
    };
    return { at, details: { bandwidth: h0 } };
  }
}

/** Each value replaced by the sum of those within `radius` of it, none being counted beyond the ends. */
function movingSum(a: Float64Array, radius: number): Float64Array {
  const n = a.length,
    out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < Math.min(n, radius); i++) acc += a[i]!;
  for (let i = 0; i < n; i++) {
    if (i + radius < n) acc += a[i + radius]!;
    if (i - radius - 1 >= 0) acc -= a[i - radius - 1]!;
    out[i] = acc;
  }
  return out;
}

/** The index of the first x not below `x` (or, with `after`, the first above it). */
function lowerBound(xs: Float64Array, x: number, after = false): number {
  let lo = 0,
    hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (after ? xs[mid]! <= x : xs[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The curve straight through the points (averaging the ones that share a position), continuing the end segments past them. */
function interpolation(xs: Float64Array, ys: Float64Array): TrendModel | null {
  const px: number[] = [],
    py: number[] = [];
  for (let i = 0; i < xs.length;) {
    let j = i,
      sum = 0;
    while (j < xs.length && xs[j] === xs[i]) sum += ys[j++]!;
    px.push(xs[i]!);
    py.push(sum / (j - i));
    i = j;
  }
  const m = px.length;
  if (m < 2) return null;
  const x = Float64Array.from(px);
  return {
    at: (v) => {
      if (!Number.isFinite(v)) return NaN;
      const k = Math.min(m - 1, Math.max(1, lowerBound(x, v)));
      const x0 = px[k - 1]!,
        x1 = px[k]!;
      return py[k - 1]! + ((py[k]! - py[k - 1]!) * (v - x0)) / (x1 - x0);
    },
    details: { bandwidth: 0 },
  };
}

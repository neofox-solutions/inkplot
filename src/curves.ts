/**
 * Smooth curves: the ways of joining points that SVG draws natively (Bézier curves and arcs), each a `Curve` to give a
 * `LinePath` or an `AreaPath` as its child: `new LinePath(new MonotoneCurve())`.
 *
 *  - `MonotoneCurve`: a smooth line that never overshoots the data, so it only turns where the data does. Safe for
 *    anything that cannot go beyond its points (a count, a price). Cubic Béziers.
 *  - `NaturalCurve`: a natural cubic spline, the smoothest line through the points (its curvature is continuous), at the
 *    cost of swinging past them.
 *  - `CardinalCurve` (`tension`, default 0 = Catmull-Rom with even knots) and `CatmullRomCurve` (`alpha`, default 0.5, the
 *    centripetal one that does not loop or cusp on uneven spacing): through every point.
 *  - `BasisCurve`: a B-spline pulled towards the points rather than through them, the smoothest of all.
 *  - `BumpCurve` (`along`): a level start and end for each segment, an S between the points, as in a flow.
 *  - `QuadraticCurve`: quadratic Béziers with each point as the control point, through the middles of the segments. One
 *    `Q` and then smooth `T` commands.
 *  - `ArcCurve` (`bend`): a circular arc between each pair of points, bulging by `bend` (the rise of the arc as a
 *    fraction of the chord, signed for the side; default 0.3). The elliptical-arc command `A`.
 *
 * Each is its own class, so a chart carries only the algorithms it uses. They share `StrokeCurve`, which turns a run of
 * points into pieces (`Piece`: the path text of one segment and how to sample it) and does the rest: the line, the area
 * (the top forward and the baseline backward), gaps, and the `Trace` that hits and readings are measured against. A curve
 * of your own is a `StrokeCurve` that says what its `pieces` are, using `lineTo`, `cubicTo`, `hermiteTo`, `quadTo`,
 * `smoothTo` and `arcTo`.
 *
 * A curve is drawn through the points as they are placed on the plane: a smooth line through the points of a polar
 * series, not an arc of constant radius (a `LinePath` there draws chords, too). A gap in the data starts a new curve unless
 * the series' `missing` is 'connect'. An area follows the curve forward and the baseline's backward, and a stack's layers each
 * have their own curve, which agree except near a gap. The curve's `trace` is what a 'line' or 'area' hit is measured to,
 * and a tooltip reading between points (`interpolate`) is a value on the curve, not on the straight line.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import type { PointBuffer } from './data.ts';
import { Curve, type CurveAttributes } from './curve.ts';
import { f2 } from './geometry.ts';
import type { Trace } from './renderer.ts';
import type { Series } from './series.ts';

const pt = (x: number, y: number) => f2(x) + ' ' + f2(y);

/** Receives the vertices of a sampled piece: where, and how far along the piece (0 to 1), which says which end owns it. */
export type Push = (x: number, y: number, t: number) => void;

/**
 * One segment of a curve: where it ends (`x`, `y`), the (run-local) indices of the two points it runs between (`a`, `b`), so
 * that a vertex on it can be given an owner, its path text beginning with the command letter, and a way to cut it into
 * vertices for tracing from where the pen was.
 */
export interface Piece {
  readonly cmd: string;
  readonly d: string;
  readonly x: number;
  readonly y: number;
  readonly a: number;
  readonly b: number;
  sample(x0: number, y0: number, push: Push): void;
}

/** Vertices a Bézier or an arc is cut into, for tracing: enough that a chord is within a fraction of a pixel on a plot. */
const SAMPLES = 16;

/** A straight line to (x, y). */
export function lineTo(x: number, y: number, a: number, b: number): Piece {
  return { cmd: 'L', d: 'L' + pt(x, y), x, y, a, b, sample: (_x0, _y0, push) => push(x, y, 1) };
}

/** A cubic Bézier with control points (x1, y1) and (x2, y2), ending at (x, y). */
export function cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number, a: number, b: number): Piece {
  return {
    cmd: 'C',
    d: 'C' + pt(x1, y1) + ' ' + pt(x2, y2) + ' ' + pt(x, y),
    x,
    y,
    a,
    b,
    sample(x0, y0, push) {
      for (let j = 1; j <= SAMPLES; j++) {
        const t = j / SAMPLES,
          u = 1 - t;
        push(
          u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
          u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
          t,
        );
      }
    },
  };
}

/**
 * One Hermite segment of a run as a cubic: from point `k` to `k + 1` of `p`, with the given tangents (derivatives with
 * respect to a parameter that spans `h` over the segment) at its two ends.
 */
export function hermiteTo(p: ArrayLike<number>, k: number, lx: number, ly: number, rx: number, ry: number, h: number): Piece {
  return cubicTo(
    p[2 * k]! + (lx * h) / 3,
    p[2 * k + 1]! + (ly * h) / 3,
    p[2 * k + 2]! - (rx * h) / 3,
    p[2 * k + 3]! - (ry * h) / 3,
    p[2 * k + 2]!,
    p[2 * k + 3]!,
    k,
    k + 1,
  );
}

function quadSample(qx: number, qy: number, x: number, y: number): Piece['sample'] {
  return (x0, y0, push) => {
    for (let j = 1; j <= SAMPLES; j++) {
      const t = j / SAMPLES,
        u = 1 - t;
      push(u * u * x0 + 2 * u * t * qx + t * t * x, u * u * y0 + 2 * u * t * qy + t * t * y, t);
    }
  };
}

/** A quadratic Bézier with control point (x1, y1), ending at (x, y). */
export function quadTo(x1: number, y1: number, x: number, y: number, a: number, b: number): Piece {
  return { cmd: 'Q', d: 'Q' + pt(x1, y1) + ' ' + pt(x, y), x, y, a, b, sample: quadSample(x1, y1, x, y) };
}

/** A smooth quadratic ending at (x, y), whose control point SVG reflects from the last piece; (cx, cy) is that reflected point, which tracing needs. */
export function smoothTo(cx: number, cy: number, x: number, y: number, a: number, b: number): Piece {
  return { cmd: 'T', d: 'T' + pt(x, y), x, y, a, b, sample: quadSample(cx, cy, x, y) };
}

/** A circular arc of radius `r` to (x, y), on the side and of the size the flags pick (as the SVG `A` command with equal radii). */
export function arcTo(r: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number, a: number, b: number): Piece {
  return {
    cmd: 'A',
    d: 'A' + f2(r) + ' ' + f2(r) + ' 0 ' + large + ' ' + sweep + ' ' + pt(x, y),
    x,
    y,
    a,
    b,
    sample(x0, y0, push) {
      // The circle of radius r through both ends, on the side the flags pick.
      const dx = x - x0,
        dy = y - y0,
        d = Math.hypot(dx, dy),
        h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
      let best: { cx: number; cy: number; t0: number; span: number } | null = null;
      for (const side of [1, -1]) {
        const cx = (x0 + x) / 2 - (side * h * dy) / d,
          cy = (y0 + y) / 2 + (side * h * dx) / d;
        const t0 = Math.atan2(y0 - cy, x0 - cx),
          t1 = Math.atan2(y - cy, x - cx);
        let span = t1 - t0;
        if (sweep === 1) {
          while (span <= 0) span += 2 * Math.PI;
        } else {
          while (span >= 0) span -= 2 * Math.PI;
        }
        if (Math.abs(span) > Math.PI === (large === 1) && !best) best = { cx, cy, t0, span };
      }
      const arc = best ?? {
        cx: (x0 + x) / 2,
        cy: (y0 + y) / 2,
        t0: Math.atan2(y0 - (y0 + y) / 2, x0 - (x0 + x) / 2),
        span: sweep === 1 ? Math.PI : -Math.PI,
      };
      const m = Math.max(SAMPLES, Math.ceil(Math.abs(arc.span) / 0.2));
      for (let j = 1; j <= m; j++) {
        const t = j / m,
          q = arc.t0 + arc.span * t;
        push(j === m ? x : arc.cx + r * Math.cos(q), j === m ? y : arc.cy + r * Math.sin(q), t);
      }
    },
  };
}

/** The tangents of a monotone cubic through the values (Fritsch–Carlson), per unit of the index. */
function monotone(v: ArrayLike<number>, n: number): Float64Array {
  const m = new Float64Array(n),
    s = new Float64Array(n - 1);
  for (let k = 0; k < n - 1; k++) s[k] = v[k + 1]! - v[k]!;
  m[0] = s[0]!;
  m[n - 1] = s[n - 2]!;
  for (let k = 1; k < n - 1; k++) m[k] = s[k - 1]! * s[k]! <= 0 ? 0 : (s[k - 1]! + s[k]!) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (s[k] === 0) {
      m[k] = m[k + 1] = 0;
      continue;
    }
    const a = m[k]! / s[k]!,
      b = m[k + 1]! / s[k]!,
      q = a * a + b * b;
    if (q > 9) {
      const tau = 3 / Math.sqrt(q);
      m[k] = tau * a * s[k]!;
      m[k + 1] = tau * b * s[k]!;
    }
  }
  return m;
}

/** The second derivatives of the natural cubic spline through the values at parameters with these spacings `h`. */
function natural(v: ArrayLike<number>, h: Float64Array, n: number): Float64Array {
  const M = new Float64Array(n);
  if (n < 3) return M;
  // Tridiagonal system for the interior second derivatives, by the Thomas algorithm.
  const diag = new Float64Array(n),
    rhs = new Float64Array(n);
  for (let k = 1; k < n - 1; k++) {
    diag[k] = 2 * (h[k - 1]! + h[k]!);
    rhs[k] = 6 * ((v[k + 1]! - v[k]!) / h[k]! - (v[k]! - v[k - 1]!) / h[k - 1]!);
  }
  for (let k = 2; k < n - 1; k++) {
    const w = h[k - 1]! / diag[k - 1]!;
    diag[k] = diag[k]! - w * h[k - 1]!;
    rhs[k] = rhs[k]! - w * rhs[k - 1]!;
  }
  for (let k = n - 2; k >= 1; k--) M[k] = (rhs[k]! - (k < n - 2 ? h[k]! * M[k + 1]! : 0)) / diag[k]!;
  return M;
}

/** The runs of points that are real: their pairs, and the index of each one's point in the series. One run per stretch between gaps, or all in one when connecting. */
function runsOf(points: Readonly<PointBuffer>, connect: boolean, also?: (i: number) => boolean): { pts: Float64Array; index: number[] }[] {
  const { data, count, stride } = points,
    out: { pts: Float64Array; index: number[] }[] = [];
  const ok = (i: number) => {
    const x = data[i * stride]!,
      y = data[i * stride + 1]!;
    return Number.isFinite(x) && Number.isFinite(y) && (!also || also(i));
  };
  let run: number[] = [],
    index: number[] = [];
  const end = () => {
    if (index.length) out.push({ pts: Float64Array.from(run), index });
    run = [];
    index = [];
  };
  for (let i = 0; i < count; i++) {
    if (ok(i)) {
      run.push(data[i * stride]!, data[i * stride + 1]!);
      index.push(i);
    } else if (!connect) end();
  }
  end();
  return out;
}

/** The vertices of a run of curves as one buffer, a NaN point after each run, and each vertex's owner. */
function gather(parts: { pts: number[]; owner: number[] }[]): { line: PointBuffer; owner: Int32Array } {
  let total = 0;
  for (const p of parts) total += p.owner.length + 1;
  const data = new Float64Array(2 * total),
    owner = new Int32Array(total);
  let k = 0;
  for (const p of parts) {
    for (let i = 0; i < p.owner.length; i++, k++) {
      data[2 * k] = p.pts[2 * i]!;
      data[2 * k + 1] = p.pts[2 * i + 1]!;
      owner[k] = p.owner[i]!;
    }
    data[2 * k] = data[2 * k + 1] = NaN;
    owner[k] = -1;
    k++;
  }
  return { line: { data, stride: 2, count: total }, owner };
}

/**
 * A curve made of pieces. It says what the pieces through a run of points are (`pieces`), and this does the rest: the path
 * text of a line and of an area, and the trace. Every run has at least two points; a single point draws nothing.
 */
export abstract class StrokeCurve<A extends CurveAttributes = CurveAttributes> extends Curve<A> {
  /** The pieces of the curve through `p` (x, y pairs, two or more points) after its first point. `series` is given when drawing, for a curve that depends on its axes. */
  protected abstract pieces(p: ArrayLike<number>, series?: Series): Piece[];

  /**
   * The path text through `p`, starting with `lead`: 'M' to begin a path at the first point, or 'L' to carry on from
   * wherever the pen is (for the way back round an area).
   */
  path(p: ArrayLike<number>, lead: 'M' | 'L', series?: Series): string {
    const n = p.length >> 1;
    if (n === 0) return '';
    let d = lead + pt(p[0]!, p[1]!),
      previous = '';
    if (n > 1) {
      for (const c of this.pieces(p, series)) {
        d += c.cmd === 'L' && previous === 'L' ? ' ' + c.d.slice(1) : c.d;
        previous = c.cmd;
      }
    }
    return d;
  }

  /** The curve through `p` as vertices, and for each the index (into `p`'s points) of the point it belongs to (the nearer end of the piece it is on). The same curve `path` writes. */
  polyline(p: ArrayLike<number>, series?: Series): { pts: number[]; owner: number[] } {
    const n = p.length >> 1,
      pts: number[] = [],
      owner: number[] = [];
    if (n === 0) return { pts, owner };
    pts.push(p[0]!, p[1]!);
    owner.push(0);
    if (n === 1) return { pts, owner };
    let x = p[0]!,
      y = p[1]!;
    for (const c of this.pieces(p, series)) {
      c.sample(x, y, (px, py, t) => {
        pts.push(px, py);
        owner.push(t < 0.5 ? c.a : c.b);
      });
      x = c.x;
      y = c.y;
    }
    return { pts, owner };
  }

  line(series: Series): string {
    let d = '';
    for (const run of runsOf(series.points, series.attrs.missing === 'connect')) d += this.path(run.pts, 'M', series);
    return d;
  }

  /** Each run of the shape: its top as pairs, the way back along its baseline (reversed), and the series' index of each point. */
  #runs(series: Series, baseline: number) {
    const base = series.baseline(baseline);
    const real = (i: number) => {
      const x = base.data[2 * i]!,
        y = base.data[2 * i + 1]!;
      return Number.isFinite(x) && Number.isFinite(y);
    };
    return runsOf(series.points, series.attrs.missing === 'connect', real).map((run) => {
      const foot = new Float64Array(run.pts.length);
      run.index.forEach((row, j) => {
        foot[run.pts.length - 2 - 2 * j] = base.data[2 * row]!;
        foot[run.pts.length - 1 - 2 * j] = base.data[2 * row + 1]!;
      });
      return { top: run.pts, back: foot, index: run.index };
    });
  }

  area(series: Series, baseline: number): string {
    let d = '';
    for (const r of this.#runs(series, baseline)) d += this.path(r.top, 'M', series) + this.path(r.back, 'L', series) + 'Z';
    return d;
  }

  #key = '';
  #value: Trace | null = null;
  override trace(series: Series, baseline: number | null): Trace | null {
    const key = `${series.projection}|${baseline}|${series.attrs.missing}|${JSON.stringify(this.attrs)}`;
    if (key === this.#key) return this.#value;
    this.#key = key;
    if (baseline === null) {
      const parts = runsOf(series.points, series.attrs.missing === 'connect').map((run) => {
        const { pts, owner } = this.polyline(run.pts, series);
        return { pts, owner: owner.map((i) => run.index[i]!) };
      });
      return (this.#value = { ...gather(parts), base: null });
    }
    const tops: { pts: number[]; owner: number[] }[] = [],
      feet: { pts: number[]; owner: number[] }[] = [];
    for (const r of this.#runs(series, baseline)) {
      const t = this.polyline(r.top, series),
        b = this.polyline(r.back, series);
      tops.push({ pts: t.pts, owner: t.owner.map((i) => r.index[i]!) });
      // The way back is drawn from the last point to the first; kept here in the direction of the line, so that a vertex lines up with the top's.
      const forward: number[] = [],
        m = b.pts.length >> 1;
      for (let i = m - 1; i >= 0; i--) forward.push(b.pts[2 * i]!, b.pts[2 * i + 1]!);
      feet.push({ pts: forward, owner: b.owner.map(() => 0) });
    }
    return (this.#value = { ...gather(tops), base: gather(feet).line });
  }
}

const xs = (p: ArrayLike<number>) => {
  const n = p.length >> 1,
    a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = p[2 * i]!;
  return a;
};
const ys = (p: ArrayLike<number>) => {
  const n = p.length >> 1,
    a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = p[2 * i + 1]!;
  return a;
};
/** Straight lines to every point after the first. */
const straight = (p: ArrayLike<number>) => {
  const out: Piece[] = [];
  for (let i = 1; i < p.length >> 1; i++) out.push(lineTo(p[2 * i]!, p[2 * i + 1]!, i - 1, i));
  return out;
};
/** The points of `p` extended past both ends by reflection, which leaves the end tangents along the first and last segment. */
const reflected = (p: ArrayLike<number>) => {
  const n = p.length >> 1;
  const at = (c: number) => (i: number) =>
    i < 0 ? 2 * p[c]! - p[2 + c]! : i >= n ? 2 * p[2 * n - 2 + c]! - p[2 * n - 4 + c]! : p[2 * i + c]!;
  return [at(0), at(1)] as const;
};

/** A smooth line that never overshoots the data: a monotone cubic (Fritsch–Carlson). */
export class MonotoneCurve extends StrokeCurve {
  protected pieces(p: ArrayLike<number>): Piece[] {
    const n = p.length >> 1;
    if (n === 2) return straight(p);
    const mx = monotone(xs(p), n),
      my = monotone(ys(p), n),
      out: Piece[] = [];
    for (let k = 0; k < n - 1; k++) out.push(hermiteTo(p, k, mx[k]!, my[k]!, mx[k + 1]!, my[k + 1]!, 1));
    return out;
  }
}

/** The natural cubic spline: the smoothest line through the points, which swings past them. */
export class NaturalCurve extends StrokeCurve {
  protected pieces(p: ArrayLike<number>): Piece[] {
    const n = p.length >> 1;
    if (n === 2) return straight(p);
    const h = new Float64Array(n - 1),
      X = xs(p),
      Y = ys(p),
      out: Piece[] = [];
    // Parameter by the length of the polyline, so that a path which doubles back is as smooth as a function.
    for (let k = 0; k < n - 1; k++) h[k] = Math.max(1e-6, Math.hypot(X[k + 1]! - X[k]!, Y[k + 1]! - Y[k]!));
    const Mx = natural(X, h, n),
      My = natural(Y, h, n);
    for (let k = 0; k < n - 1; k++) {
      const hk = h[k]!,
        dx = (X[k + 1]! - X[k]!) / hk,
        dy = (Y[k + 1]! - Y[k]!) / hk;
      out.push(
        hermiteTo(
          p,
          k,
          dx - (hk * (2 * Mx[k]! + Mx[k + 1]!)) / 6,
          dy - (hk * (2 * My[k]! + My[k + 1]!)) / 6,
          dx + (hk * (Mx[k]! + 2 * Mx[k + 1]!)) / 6,
          dy + (hk * (My[k]! + 2 * My[k + 1]!)) / 6,
          hk,
        ),
      );
    }
    return out;
  }
}

export interface CardinalCurveAttributes extends CurveAttributes {
  /** How far the curve is tightened towards straight lines, 0 (the Catmull-Rom spline) to 1. Default 0. */
  tension?: number;
}

/** A cardinal spline: through every point, with a tangent along the neighbours that `tension` shortens. */
export class CardinalCurve extends StrokeCurve<CardinalCurveAttributes> {
  protected pieces(p: ArrayLike<number>): Piece[] {
    const n = p.length >> 1,
      c = 1 - (this.attrs.tension ?? 0),
      [px, py] = reflected(p),
      out: Piece[] = [];
    for (let k = 0; k < n - 1; k++) {
      out.push(
        hermiteTo(
          p,
          k,
          (c * (px(k + 1) - px(k - 1))) / 2,
          (c * (py(k + 1) - py(k - 1))) / 2,
          (c * (px(k + 2) - px(k))) / 2,
          (c * (py(k + 2) - py(k))) / 2,
          1,
        ),
      );
    }
    return out;
  }
}

export interface CatmullRomCurveAttributes extends CurveAttributes {
  /** The spacing of the knots: 0 even, 0.5 centripetal, 1 chordal. Default 0.5. */
  alpha?: number;
}

/** The Catmull–Rom spline: through every point, centripetal by default so that it neither loops nor cusps when the spacing is uneven. */
export class CatmullRomCurve extends StrokeCurve<CatmullRomCurveAttributes> {
  protected pieces(p: ArrayLike<number>): Piece[] {
    const n = p.length >> 1,
      alpha = this.attrs.alpha ?? 0.5,
      [px, py] = reflected(p),
      out: Piece[] = [];
    const knot = (a: number, b: number) => Math.pow(Math.hypot(px(b) - px(a), py(b) - py(a)), alpha);
    for (let k = 0; k < n - 1; k++) {
      const t01 = knot(k - 1, k),
        t12 = knot(k, k + 1),
        t23 = knot(k + 1, k + 2);
      if (!(t12 > 1e-9) || !(t01 > 1e-9) || !(t23 > 1e-9)) {
        out.push(lineTo(p[2 * k + 2]!, p[2 * k + 3]!, k, k + 1));
        continue;
      }
      const tangent = (v: (i: number) => number) => {
        const q0 = v(k - 1),
          q1 = v(k),
          q2 = v(k + 1),
          q3 = v(k + 2);
        return [
          (q1 - q0) / t01 - (q2 - q0) / (t01 + t12) + (q2 - q1) / t12,
          (q2 - q1) / t12 - (q3 - q1) / (t12 + t23) + (q3 - q2) / t23,
        ] as const;
      };
      const [ax, bx] = tangent(px),
        [ay, by] = tangent(py);
      out.push(hermiteTo(p, k, ax, ay, bx, by, t12));
    }
    return out;
  }
}

/** A uniform cubic B-spline, pulled towards the points rather than through them, starting at the first and ending at the last. */
export class BasisCurve extends StrokeCurve {
  protected pieces(p: ArrayLike<number>): Piece[] {
    const n = p.length >> 1,
      out: Piece[] = [];
    const X = (i: number) => p[2 * Math.min(n - 1, Math.max(0, i))]!,
      Y = (i: number) => p[2 * Math.min(n - 1, Math.max(0, i)) + 1]!;
    out.push(lineTo((5 * X(0) + X(1)) / 6, (5 * Y(0) + Y(1)) / 6, 0, 0));
    for (let j = 0; j < n - 1; j++) {
      // The control points b, c, e of this piece; it runs from a sixth of the way (a + 4b + c) to the next such place.
      const bx = X(j),
        by = Y(j),
        cx = X(j + 1),
        cy = Y(j + 1),
        ex = X(j + 2),
        ey = Y(j + 2);
      out.push(
        cubicTo(
          (2 * bx + cx) / 3,
          (2 * by + cy) / 3,
          (bx + 2 * cx) / 3,
          (by + 2 * cy) / 3,
          (bx + 4 * cx + ex) / 6,
          (by + 4 * cy + ey) / 6,
          j,
          j + 1,
        ),
      );
    }
    out.push(lineTo(X(n - 1), Y(n - 1), n - 1, n - 1));
    return out;
  }
}

export interface BumpCurveAttributes extends CurveAttributes {
  /** Whether the level ends are along x (a line level at each point) or y. Default: along the series' first axis. */
  along?: 'x' | 'y';
}

/** A level start and end to each segment and an S between: the flow of a bump chart or a sankey. */
export class BumpCurve extends StrokeCurve<BumpCurveAttributes> {
  protected pieces(p: ArrayLike<number>, series?: Series): Piece[] {
    const n = p.length >> 1,
      out: Piece[] = [];
    const o = series?.firstAxis.orientation,
      alongX = (this.attrs.along ?? (o === 'left' || o === 'right' ? 'y' : 'x')) === 'x';
    for (let k = 0; k < n - 1; k++) {
      const x0 = p[2 * k]!,
        y0 = p[2 * k + 1]!,
        x1 = p[2 * k + 2]!,
        y1 = p[2 * k + 3]!;
      out.push(
        alongX
          ? cubicTo((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, x1, y1, k, k + 1)
          : cubicTo(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, x1, y1, k, k + 1),
      );
    }
    return out;
  }
}

/** Quadratic Béziers with each point as a control point, through the middles of the segments. */
export class QuadraticCurve extends StrokeCurve {
  protected pieces(p: ArrayLike<number>): Piece[] {
    const n = p.length >> 1;
    if (n === 2) return straight(p);
    const X = (i: number) => p[2 * i]!,
      Y = (i: number) => p[2 * i + 1]!,
      out: Piece[] = [];
    out.push(lineTo((X(0) + X(1)) / 2, (Y(0) + Y(1)) / 2, 0, 0));
    out.push(quadTo(X(1), Y(1), (X(1) + X(2)) / 2, (Y(1) + Y(2)) / 2, 1, 1));
    // A smooth quadratic reflects the last control point, which for midpoints is exactly the next data point.
    for (let k = 2; k < n - 1; k++) out.push(smoothTo(X(k), Y(k), (X(k) + X(k + 1)) / 2, (Y(k) + Y(k + 1)) / 2, k, k));
    out.push(lineTo(X(n - 1), Y(n - 1), n - 1, n - 1));
    return out;
  }
}

export interface ArcCurveAttributes extends CurveAttributes {
  /** The rise of each arc as a fraction of its chord, positive bulging to the left of the way along. Default 0.3. */
  bend?: number;
}

/** A circular arc between each pair of points. */
export class ArcCurve extends StrokeCurve<ArcCurveAttributes> {
  protected pieces(p: ArrayLike<number>): Piece[] {
    const n = p.length >> 1,
      b = this.attrs.bend ?? 0.3,
      rise = Math.abs(b),
      out: Piece[] = [];
    for (let k = 0; k < n - 1; k++) {
      const x = p[2 * k + 2]!,
        y = p[2 * k + 3]!,
        chord = Math.hypot(x - p[2 * k]!, y - p[2 * k + 1]!);
      out.push(
        !(chord > 1e-9) || rise < 1e-6
          ? lineTo(x, y, k, k + 1)
          : arcTo((chord * (0.25 + rise * rise)) / (2 * rise), rise > 0.5 ? 1 : 0, b > 0 ? 0 : 1, x, y, k, k + 1),
      );
    }
    return out;
  }
}

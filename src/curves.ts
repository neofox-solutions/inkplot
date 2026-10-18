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
 * points into pieces (drawn with a `Pen`, which writes the path text or cuts the piece for tracing) and does the rest: the line, the area
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

/** Vertices a Bézier or an arc is cut into, for tracing: enough that a chord is within a fraction of a pixel on a plot. */
const SAMPLES = 16;

/**
 * What a curve draws with: it says where the pen goes next, one segment at a time, and the pen writes the path text or cuts
 * the segment into vertices for tracing. A segment is drawn with no object made for it, so a curve of any length costs a fixed
 * number of allocations. `a` and `b` are the (run-local) indices of the two points a segment runs between, which give a vertex
 * on it its owner.
 */
export interface Pen {
  /** A straight line to (x, y). */
  lineTo(x: number, y: number, a: number, b: number): void;
  /** A cubic Bézier with control points (x1, y1) and (x2, y2), ending at (x, y). */
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number, a: number, b: number): void;
  /**
   * One Hermite segment of a run as a cubic: from point `k` to `k + 1` of `p`, with the given tangents (derivatives with
   * respect to a parameter that spans `h` over the segment) at its two ends.
   */
  hermiteTo(p: ArrayLike<number>, k: number, lx: number, ly: number, rx: number, ry: number, h: number): void;
  /** A quadratic Bézier with control point (x1, y1), ending at (x, y). */
  quadTo(x1: number, y1: number, x: number, y: number, a: number, b: number): void;
  /** A smooth quadratic ending at (x, y), whose control point SVG reflects from the last segment; (cx, cy) is that reflected point, which tracing needs. */
  smoothTo(cx: number, cy: number, x: number, y: number, a: number, b: number): void;
  /** A circular arc of radius `r` to (x, y), on the side and of the size the flags pick (as the SVG `A` command with equal radii). */
  arcTo(r: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number, a: number, b: number): void;
}

abstract class BasePen implements Pen {
  abstract lineTo(x: number, y: number, a: number, b: number): void;
  abstract cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number, a: number, b: number): void;
  abstract quadTo(x1: number, y1: number, x: number, y: number, a: number, b: number): void;
  abstract smoothTo(cx: number, cy: number, x: number, y: number, a: number, b: number): void;
  abstract arcTo(r: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number, a: number, b: number): void;
  hermiteTo(p: ArrayLike<number>, k: number, lx: number, ly: number, rx: number, ry: number, h: number): void {
    this.cubicTo(
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
}

/** Writes path text. Consecutive straight lines share one `L`, since for a large series the size of the text is the cost. */
class TextPen extends BasePen {
  d = '';
  #previous = '';
  /** Begin a run at (x, y) with `lead` ('M' to start a path, 'L' to carry on from where the pen is). */
  start(lead: 'M' | 'L', x: number, y: number): void {
    this.d += lead + pt(x, y);
    this.#previous = '';
  }
  lineTo(x: number, y: number): void {
    this.d += this.#previous === 'L' ? ' ' + pt(x, y) : 'L' + pt(x, y);
    this.#previous = 'L';
  }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.d += 'C' + pt(x1, y1) + ' ' + pt(x2, y2) + ' ' + pt(x, y);
    this.#previous = 'C';
  }
  quadTo(x1: number, y1: number, x: number, y: number): void {
    this.d += 'Q' + pt(x1, y1) + ' ' + pt(x, y);
    this.#previous = 'Q';
  }
  smoothTo(_cx: number, _cy: number, x: number, y: number): void {
    this.d += 'T' + pt(x, y);
    this.#previous = 'T';
  }
  arcTo(r: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number): void {
    this.d += 'A' + f2(r) + ' ' + f2(r) + ' 0 ' + large + ' ' + sweep + ' ' + pt(x, y);
    this.#previous = 'A';
  }
}

/** The vertices of the curves it is given as growing typed buffers, a NaN point after each run, and each vertex's owner. */
class TracePen extends BasePen {
  pts = new Float64Array(64);
  owner = new Int32Array(32);
  /** Vertices so far. */
  n = 0;
  #x = 0;
  #y = 0;
  #runStart = 0;
  #index: Int32Array | null = null;
  #offset = 0;
  #push(x: number, y: number, o: number): void {
    if (2 * this.n + 2 > this.pts.length) {
      const pts = new Float64Array(this.pts.length * 2),
        owner = new Int32Array(this.owner.length * 2);
      pts.set(this.pts);
      owner.set(this.owner);
      this.pts = pts;
      this.owner = owner;
    }
    this.pts[2 * this.n] = x;
    this.pts[2 * this.n + 1] = y;
    this.owner[this.n++] = o;
  }
  #own(local: number): number {
    return this.#index ? this.#index[this.#offset + local]! : local;
  }
  /** Begin a run at (x, y); its vertices belong to `index[offset + local]` (to their own local index without one). */
  start(x: number, y: number, index: Int32Array | null, offset: number): void {
    this.#index = index;
    this.#offset = offset;
    this.#runStart = this.n;
    this.#x = x;
    this.#y = y;
    this.#push(x, y, this.#own(0));
  }
  /** End the run: its vertices turned round if `reverse`, then the NaN that separates it from the next. */
  end(reverse: boolean): void {
    if (reverse)
      for (let i = this.#runStart, j = this.n - 1; i < j; i++, j--) {
        const x = this.pts[2 * i]!,
          y = this.pts[2 * i + 1]!;
        this.pts[2 * i] = this.pts[2 * j]!;
        this.pts[2 * i + 1] = this.pts[2 * j + 1]!;
        this.pts[2 * j] = x;
        this.pts[2 * j + 1] = y;
      }
    this.#push(NaN, NaN, -1);
  }
  /** The vertices as a buffer for hits, and their owners (both exactly sized). */
  result(): { line: PointBuffer; owner: Int32Array } {
    return { line: { data: this.pts.slice(0, 2 * this.n), stride: 2, count: this.n }, owner: this.owner.slice(0, this.n) };
  }
  #vertex(x: number, y: number, t: number, a: number, b: number): void {
    this.#push(x, y, this.#own(t < 0.5 ? a : b));
  }
  lineTo(x: number, y: number, a: number, b: number): void {
    this.#vertex(x, y, 1, a, b);
    this.#x = x;
    this.#y = y;
  }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number, a: number, b: number): void {
    const x0 = this.#x,
      y0 = this.#y;
    for (let j = 1; j <= SAMPLES; j++) {
      const t = j / SAMPLES,
        u = 1 - t;
      this.#vertex(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
        t,
        a,
        b,
      );
    }
    this.#x = x;
    this.#y = y;
  }
  quadTo(qx: number, qy: number, x: number, y: number, a: number, b: number): void {
    const x0 = this.#x,
      y0 = this.#y;
    for (let j = 1; j <= SAMPLES; j++) {
      const t = j / SAMPLES,
        u = 1 - t;
      this.#vertex(u * u * x0 + 2 * u * t * qx + t * t * x, u * u * y0 + 2 * u * t * qy + t * t * y, t, a, b);
    }
    this.#x = x;
    this.#y = y;
  }
  smoothTo(cx: number, cy: number, x: number, y: number, a: number, b: number): void {
    this.quadTo(cx, cy, x, y, a, b);
  }
  arcTo(r: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number, a: number, b: number): void {
    const x0 = this.#x,
      y0 = this.#y;
    // The circle of radius r through both ends, on the side the flags pick.
    const dx = x - x0,
      dy = y - y0,
      d = Math.hypot(dx, dy),
      h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
    let found = false,
      bx = 0,
      by = 0,
      bt0 = 0,
      bspan = 0;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1,
        cx = (x0 + x) / 2 - (side * h * dy) / d,
        cy = (y0 + y) / 2 + (side * h * dx) / d;
      const t0 = Math.atan2(y0 - cy, x0 - cx),
        t1 = Math.atan2(y - cy, x - cx);
      let span = t1 - t0;
      if (sweep === 1) {
        while (span <= 0) span += 2 * Math.PI;
      } else {
        while (span >= 0) span -= 2 * Math.PI;
      }
      if (Math.abs(span) > Math.PI === (large === 1) && !found) {
        found = true;
        bx = cx;
        by = cy;
        bt0 = t0;
        bspan = span;
      }
    }
    if (!found) {
      bx = (x0 + x) / 2;
      by = (y0 + y) / 2;
      bt0 = Math.atan2(y0 - by, x0 - bx);
      bspan = sweep === 1 ? Math.PI : -Math.PI;
    }
    const m = Math.max(SAMPLES, Math.ceil(Math.abs(bspan) / 0.2));
    for (let j = 1; j <= m; j++) {
      const t = j / m,
        q = bt0 + bspan * t;
      this.#vertex(j === m ? x : bx + r * Math.cos(q), j === m ? y : by + r * Math.sin(q), t, a, b);
    }
    this.#x = x;
    this.#y = y;
  }
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

/**
 * The runs of points that are real, in two buffers for all of them: the pairs, and the index of each one's point in the series.
 * One run per stretch between gaps, or all in one when connecting. `ends[r]` is where run `r` stops, in points.
 */
interface Runs {
  readonly pts: Float64Array;
  readonly index: Int32Array;
  readonly ends: number[];
}
function runsOf(points: Readonly<PointBuffer>, connect: boolean, also?: (i: number) => boolean): Runs {
  const { data, count, stride } = points,
    pts = new Float64Array(2 * count),
    index = new Int32Array(count),
    ends: number[] = [];
  let k = 0,
    open = false;
  for (let i = 0; i < count; i++) {
    const x = data[i * stride]!,
      y = data[i * stride + 1]!;
    if (Number.isFinite(x) && Number.isFinite(y) && (!also || also(i))) {
      pts[2 * k] = x;
      pts[2 * k + 1] = y;
      index[k++] = i;
      open = true;
    } else if (!connect && open) {
      ends.push(k);
      open = false;
    }
  }
  if (open) ends.push(k);
  return { pts, index, ends };
}
/** Run `r`'s pairs of `buffer` (a buffer laid out as `runs.pts`) and where its points start in `runs.index`. A run that is all of the buffer is the buffer. */
function runOf(runs: Runs, buffer: Float64Array, r: number): { pts: Float64Array; from: number; count: number } {
  const from = r === 0 ? 0 : runs.ends[r - 1]!,
    count = runs.ends[r]! - from;
  return { pts: from === 0 && 2 * count === buffer.length ? buffer : buffer.subarray(2 * from, 2 * (from + count)), from, count };
}

/**
 * A curve made of pieces. It says what the pieces through a run of points are (`pieces`), drawing them with a `Pen`, and this does
 * the rest: the path text of a line and of an area, and the trace. Every run has at least two points; a single point draws nothing.
 * Drawing makes no object for a piece, so a curve costs the same few allocations however long it is.
 */
export abstract class StrokeCurve<A extends CurveAttributes = CurveAttributes> extends Curve<A> {
  /** Draw the pieces of the curve through `p` (x, y pairs, two or more points) after its first point, with `pen`. `series` is given when drawing, for a curve that depends on its axes. */
  protected abstract pieces(p: ArrayLike<number>, pen: Pen, series?: Series): void;

  #write(pen: TextPen, p: ArrayLike<number>, lead: 'M' | 'L', series?: Series): void {
    const n = p.length >> 1;
    if (n === 0) return;
    pen.start(lead, p[0]!, p[1]!);
    if (n > 1) this.pieces(p, pen, series);
  }

  /**
   * The path text through `p`, starting with `lead`: 'M' to begin a path at the first point, or 'L' to carry on from
   * wherever the pen is (for the way back round an area).
   */
  path(p: ArrayLike<number>, lead: 'M' | 'L', series?: Series): string {
    const pen = new TextPen();
    this.#write(pen, p, lead, series);
    return pen.d;
  }

  /** The curve through `p` as vertices, and for each the index (into `p`'s points) of the point it belongs to (the nearer end of the piece it is on). The same curve `path` writes. */
  polyline(p: ArrayLike<number>, series?: Series): { pts: Float64Array; owner: Int32Array } {
    const pen = new TracePen();
    this.#trace(pen, p, null, 0, series);
    const { line, owner } = pen.result();
    return { pts: line.data.subarray(0, line.data.length - 2), owner: owner.subarray(0, owner.length - 1) };
  }
  #trace(pen: TracePen, p: ArrayLike<number>, index: Int32Array | null, offset: number, series?: Series, reverse = false): void {
    if (p.length === 0) return;
    pen.start(p[0]!, p[1]!, index, offset);
    if (p.length > 2) this.pieces(p, pen, series);
    pen.end(reverse);
  }

  line(series: Series): string {
    const runs = runsOf(series.points, series.attrs.missing === 'connect'),
      pen = new TextPen();
    for (let r = 0; r < runs.ends.length; r++) this.#write(pen, runOf(runs, runs.pts, r).pts, 'M', series);
    return pen.d;
  }

  /** Each run of the shape: its top as pairs, the way back along its baseline (reversed, in a buffer laid out as the top's). */
  #runs(series: Series, baseline: number): { runs: Runs; back: Float64Array } {
    const base = series.baseline(baseline);
    const real = (i: number) => {
      const x = base.data[2 * i]!,
        y = base.data[2 * i + 1]!;
      return Number.isFinite(x) && Number.isFinite(y);
    };
    const runs = runsOf(series.points, series.attrs.missing === 'connect', real),
      back = new Float64Array(runs.pts.length);
    for (let r = 0, from = 0; r < runs.ends.length; from = runs.ends[r++]!) {
      const end = runs.ends[r]!;
      for (let j = from; j < end; j++) {
        const row = runs.index[j]!,
          at = from + end - 1 - j;
        back[2 * at] = base.data[2 * row]!;
        back[2 * at + 1] = base.data[2 * row + 1]!;
      }
    }
    return { runs, back };
  }

  area(series: Series, baseline: number): string {
    const { runs, back } = this.#runs(series, baseline),
      pen = new TextPen();
    for (let r = 0; r < runs.ends.length; r++) {
      this.#write(pen, runOf(runs, runs.pts, r).pts, 'M', series);
      this.#write(pen, runOf(runs, back, r).pts, 'L', series);
      pen.d += 'Z';
    }
    return pen.d;
  }

  #key = '';
  #value: Trace | null = null;
  override trace(series: Series, baseline: number | null): Trace | null {
    const key = `${series.projection}|${baseline}|${series.attrs.missing}|${this.stamp}`;
    if (key === this.#key) return this.#value;
    this.#key = key;
    const tops = new TracePen();
    if (baseline === null) {
      const runs = runsOf(series.points, series.attrs.missing === 'connect');
      for (let r = 0; r < runs.ends.length; r++) {
        const run = runOf(runs, runs.pts, r);
        this.#trace(tops, run.pts, runs.index, run.from, series);
      }
      return (this.#value = { ...tops.result(), base: null });
    }
    const feet = new TracePen(),
      { runs, back } = this.#runs(series, baseline);
    for (let r = 0; r < runs.ends.length; r++) {
      const top = runOf(runs, runs.pts, r);
      this.#trace(tops, top.pts, runs.index, top.from, series);
      // The way back is traced from the last point to the first; kept here in the direction of the line, so that a vertex lines up with the top's.
      this.#trace(feet, runOf(runs, back, r).pts, null, 0, series, true);
    }
    return (this.#value = { ...tops.result(), base: feet.result().line });
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
const straight = (p: ArrayLike<number>, pen: Pen) => {
  for (let i = 1; i < p.length >> 1; i++) pen.lineTo(p[2 * i]!, p[2 * i + 1]!, i - 1, i);
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
  protected pieces(p: ArrayLike<number>, pen: Pen): void {
    const n = p.length >> 1;
    if (n === 2) return straight(p, pen);
    const mx = monotone(xs(p), n),
      my = monotone(ys(p), n);
    for (let k = 0; k < n - 1; k++) pen.hermiteTo(p, k, mx[k]!, my[k]!, mx[k + 1]!, my[k + 1]!, 1);
  }
}

/** The natural cubic spline: the smoothest line through the points, which swings past them. */
export class NaturalCurve extends StrokeCurve {
  protected pieces(p: ArrayLike<number>, pen: Pen): void {
    const n = p.length >> 1;
    if (n === 2) return straight(p, pen);
    const h = new Float64Array(n - 1),
      X = xs(p),
      Y = ys(p);
    // Parameter by the length of the polyline, so that a path which doubles back is as smooth as a function.
    for (let k = 0; k < n - 1; k++) h[k] = Math.max(1e-6, Math.hypot(X[k + 1]! - X[k]!, Y[k + 1]! - Y[k]!));
    const Mx = natural(X, h, n),
      My = natural(Y, h, n);
    for (let k = 0; k < n - 1; k++) {
      const hk = h[k]!,
        dx = (X[k + 1]! - X[k]!) / hk,
        dy = (Y[k + 1]! - Y[k]!) / hk;
      pen.hermiteTo(
        p,
        k,
        dx - (hk * (2 * Mx[k]! + Mx[k + 1]!)) / 6,
        dy - (hk * (2 * My[k]! + My[k + 1]!)) / 6,
        dx + (hk * (Mx[k]! + 2 * Mx[k + 1]!)) / 6,
        dy + (hk * (My[k]! + 2 * My[k + 1]!)) / 6,
        hk,
      );
    }
  }
}

export interface CardinalCurveAttributes extends CurveAttributes {
  /** How far the curve is tightened towards straight lines, 0 (the Catmull-Rom spline) to 1. Default 0. */
  tension?: number;
}

/** A cardinal spline: through every point, with a tangent along the neighbours that `tension` shortens. */
export class CardinalCurve extends StrokeCurve<CardinalCurveAttributes> {
  protected pieces(p: ArrayLike<number>, pen: Pen): void {
    const n = p.length >> 1,
      c = 1 - (this.attrs.tension ?? 0),
      [px, py] = reflected(p);
    for (let k = 0; k < n - 1; k++) {
      pen.hermiteTo(
        p,
        k,
        (c * (px(k + 1) - px(k - 1))) / 2,
        (c * (py(k + 1) - py(k - 1))) / 2,
        (c * (px(k + 2) - px(k))) / 2,
        (c * (py(k + 2) - py(k))) / 2,
        1,
      );
    }
  }
}

export interface CatmullRomCurveAttributes extends CurveAttributes {
  /** The spacing of the knots: 0 even, 0.5 centripetal, 1 chordal. Default 0.5. */
  alpha?: number;
}

/** The Catmull–Rom spline: through every point, centripetal by default so that it neither loops nor cusps when the spacing is uneven. */
export class CatmullRomCurve extends StrokeCurve<CatmullRomCurveAttributes> {
  protected pieces(p: ArrayLike<number>, pen: Pen): void {
    const n = p.length >> 1,
      alpha = this.attrs.alpha ?? 0.5,
      [px, py] = reflected(p);
    const knot = (a: number, b: number) => Math.pow(Math.hypot(px(b) - px(a), py(b) - py(a)), alpha);
    for (let k = 0; k < n - 1; k++) {
      const t01 = knot(k - 1, k),
        t12 = knot(k, k + 1),
        t23 = knot(k + 1, k + 2);
      if (!(t12 > 1e-9) || !(t01 > 1e-9) || !(t23 > 1e-9)) {
        pen.lineTo(p[2 * k + 2]!, p[2 * k + 3]!, k, k + 1);
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
      pen.hermiteTo(p, k, ax, ay, bx, by, t12);
    }
  }
}

/** A uniform cubic B-spline, pulled towards the points rather than through them, starting at the first and ending at the last. */
export class BasisCurve extends StrokeCurve {
  protected pieces(p: ArrayLike<number>, pen: Pen): void {
    const n = p.length >> 1;
    const X = (i: number) => p[2 * Math.min(n - 1, Math.max(0, i))]!,
      Y = (i: number) => p[2 * Math.min(n - 1, Math.max(0, i)) + 1]!;
    pen.lineTo((5 * X(0) + X(1)) / 6, (5 * Y(0) + Y(1)) / 6, 0, 0);
    for (let j = 0; j < n - 1; j++) {
      // The control points b, c, e of this piece; it runs from a sixth of the way (a + 4b + c) to the next such place.
      const bx = X(j),
        by = Y(j),
        cx = X(j + 1),
        cy = Y(j + 1),
        ex = X(j + 2),
        ey = Y(j + 2);
      pen.cubicTo(
        (2 * bx + cx) / 3,
        (2 * by + cy) / 3,
        (bx + 2 * cx) / 3,
        (by + 2 * cy) / 3,
        (bx + 4 * cx + ex) / 6,
        (by + 4 * cy + ey) / 6,
        j,
        j + 1,
      );
    }
    pen.lineTo(X(n - 1), Y(n - 1), n - 1, n - 1);
  }
}

export interface BumpCurveAttributes extends CurveAttributes {
  /** Whether the level ends are along x (a line level at each point) or y. Default: along the series' first axis. */
  along?: 'x' | 'y';
}

/** A level start and end to each segment and an S between: the flow of a bump chart or a sankey. */
export class BumpCurve extends StrokeCurve<BumpCurveAttributes> {
  protected pieces(p: ArrayLike<number>, pen: Pen, series?: Series): void {
    const n = p.length >> 1;
    const o = series?.firstAxis.orientation,
      alongX = (this.attrs.along ?? (o === 'left' || o === 'right' ? 'y' : 'x')) === 'x';
    for (let k = 0; k < n - 1; k++) {
      const x0 = p[2 * k]!,
        y0 = p[2 * k + 1]!,
        x1 = p[2 * k + 2]!,
        y1 = p[2 * k + 3]!;
      if (alongX) pen.cubicTo((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, x1, y1, k, k + 1);
      else pen.cubicTo(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, x1, y1, k, k + 1);
    }
  }
}

/** Quadratic Béziers with each point as a control point, through the middles of the segments. */
export class QuadraticCurve extends StrokeCurve {
  protected pieces(p: ArrayLike<number>, pen: Pen): void {
    const n = p.length >> 1;
    if (n === 2) return straight(p, pen);
    const X = (i: number) => p[2 * i]!,
      Y = (i: number) => p[2 * i + 1]!;
    pen.lineTo((X(0) + X(1)) / 2, (Y(0) + Y(1)) / 2, 0, 0);
    pen.quadTo(X(1), Y(1), (X(1) + X(2)) / 2, (Y(1) + Y(2)) / 2, 1, 1);
    // A smooth quadratic reflects the last control point, which for midpoints is exactly the next data point.
    for (let k = 2; k < n - 1; k++) pen.smoothTo(X(k), Y(k), (X(k) + X(k + 1)) / 2, (Y(k) + Y(k + 1)) / 2, k, k);
    pen.lineTo(X(n - 1), Y(n - 1), n - 1, n - 1);
  }
}

export interface ArcCurveAttributes extends CurveAttributes {
  /** The rise of each arc as a fraction of its chord, positive bulging to the left of the way along. Default 0.3. */
  bend?: number;
}

/** A circular arc between each pair of points. */
export class ArcCurve extends StrokeCurve<ArcCurveAttributes> {
  protected pieces(p: ArrayLike<number>, pen: Pen): void {
    const n = p.length >> 1,
      b = this.attrs.bend ?? 0.3,
      rise = Math.abs(b);
    for (let k = 0; k < n - 1; k++) {
      const x = p[2 * k + 2]!,
        y = p[2 * k + 3]!,
        chord = Math.hypot(x - p[2 * k]!, y - p[2 * k + 1]!);
      if (!(chord > 1e-9) || rise < 1e-6) pen.lineTo(x, y, k, k + 1);
      else pen.arcTo((chord * (0.25 + rise * rise)) / (2 * rise), rise > 0.5 ? 1 : 0, b > 0 ? 0 : 1, x, y, k, k + 1);
    }
  }
}

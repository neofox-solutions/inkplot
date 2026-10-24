/**
 * Steps: a value that holds until it changes, drawn as a line or a filled area by giving a `StepCurve` to a `LinePath` or `AreaPath`.
 *
 * Where it changes is `mode`, for a step between a point and the next:
 *  - `after` (default): the value holds from its point until the next one, then jumps there. A price, a setting.
 *  - `before`: it jumps at its own point, and holds back to the previous one. A count of what happened by then.
 *  - `center`: it changes halfway between the two.
 *
 * The step is worked out in the plane's own terms, never in pixels: the level part runs along the first axis at one value
 * and the jump along the second. The plane draws it (`alignedPath`), so on a rectangle the levels are horizontal and
 * the jumps vertical (or the other way round when the domain is on the vertical axis), on a polar plane a level is an
 * arc round the middle and a jump a spoke, and on a radar a level is a chord through the spokes it passes. What is drawn is
 * exact; the points of the trace, which hits are measured to, cut a level on a curved plane into pieces to follow it.
 *
 * The line passes through every point of the data, and a marker on the series sits on a corner. A gap in the data
 * breaks the steps in two, unless the series says its `missing` is 'connect'. The curve `trace`s what it draws, so a
 * 'line' or 'area' hit is measured to the steps on the screen and reports the point whose level it is on, and a tooltip
 * reading between points (`interpolate`) gives the level there, not a value on a straight line between the points.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import type { PointBuffer } from './data.ts';
import type { Series } from './series.ts';
import { Curve, type CurveAttributes } from './curve.ts';
import type { Trace } from './renderer.ts';

export type StepMode = 'after' | 'before' | 'center';

/** Pieces a level is cut into for a whole turn of a curved plane. */
const PIECES = 96;
/** Most pieces one level is cut into. */
const MOST = 64;

/**
 * The line of a series as steps, and the line it is filled from, as placed points: runs of them, each ended by a NaN
 * point. `owner` says, for each vertex, which of the series' own points the value there is (a level is its point's, and a
 * jump is shared by the two it joins), which is a `Trace`.
 */
export interface Stepped extends Trace {
  readonly top: PointBuffer;
  readonly base: PointBuffer | null;
  /**
   * The same steps as fractions of the two axes, `[first, second]` a vertex and each run ended by a NaN vertex, before the plane placed
   * them: what `Plane.alignedPath` draws from. `alignedBase` is the baseline's, vertex for vertex.
   */
  readonly aligned: Float64Array;
  readonly alignedBase: Float64Array | null;
}

/**
 * The steps of a series in plot pixels. `baseline` is the value a step area is filled from (null for a line, which needs
 * no second buffer); in a stack the baseline is the layer below, row by row, as everywhere else. Null before the first
 * projection. The two buffers have the same shape, so a point of one has its foot at the same place in the other.
 */
export function stepLines(series: Series, mode: StepMode, baseline: number | null): Stepped | null {
  const d = series.drawn;
  if (!d) return null;
  const plane = d.plane,
    first = series.firstAxis,
    second = series.secondAxis;
  const n = d.points.count,
    rs = d.stride,
    raw = d.raw,
    wantBase = baseline !== null;
  const zero = series.attrs.missing === 'zero' && !d.top,
    connect = series.attrs.missing === 'connect';
  const norm = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = raw[i * rs + d.firstColumn]!;
    let v = raw[i * rs + d.secondColumn]!;
    if (zero && !Number.isFinite(v) && Number.isFinite(x)) v = 0;
    const ok = Number.isFinite(v);
    norm[3 * i] = x;
    norm[3 * i + 1] = ok ? (d.top ? d.top[i]! : v) : NaN;
    norm[3 * i + 2] = ok ? (d.base ? d.base[i]! : (baseline ?? 0)) : NaN;
  }
  first.normalize(norm, n, 3, 0);
  second.normalize(norm, n, 3, 1);
  second.normalize(norm, n, 3, 2);
  // The foot stays on the axis, as `Series.baseline` keeps it.
  for (let i = 0; i < n; i++) {
    const b = norm[3 * i + 2]!;
    if (b < 0) norm[3 * i + 2] = 0;
    else if (b > 1) norm[3 * i + 2] = 1;
  }

  const real = (i: number) => {
    const x = norm[3 * i]!,
      t = norm[3 * i + 1]!,
      b = norm[3 * i + 2]!;
    return Number.isFinite(x) && Number.isFinite(t) && (!wantBase || Number.isFinite(b));
  };
  const corners = plane.curved ? plane.breaks(first) : [];

  let top = new Float64Array(Math.max(16, 4 * n)),
    foot = wantBase ? new Float64Array(top.length) : null,
    owner = new Int32Array(top.length / 2),
    k = 0;
  const put = (x: number, t: number, b: number, by: number) => {
    if (2 * k + 2 > top.length) {
      const bigger = new Float64Array(top.length * 2);
      bigger.set(top);
      top = bigger;
      const o2 = new Int32Array(top.length / 2);
      o2.set(owner);
      owner = o2;
      if (foot) {
        const f2 = new Float64Array(top.length);
        f2.set(foot);
        foot = f2;
      }
    }
    top[2 * k] = x;
    top[2 * k + 1] = t;
    owner[k] = by;
    if (foot) {
      foot[2 * k] = x;
      foot[2 * k + 1] = b;
    }
    k++;
  };
  /** A level from `a` to `b` along the first axis at one pair of values, all belonging to point `by`: the pieces between, then the end. */
  const level = (a: number, b: number, t: number, bs: number, by: number) => {
    if (plane.curved && a !== b) {
      const lo = Math.min(a, b),
        hi = Math.max(a, b),
        cuts: number[] = [];
      if (corners.length > 0) {
        for (const c of corners) if (c > lo + 1e-9 && c < hi - 1e-9) cuts.push(c);
      } else {
        const pieces = Math.min(MOST, Math.ceil((hi - lo) * PIECES));
        for (let j = 1; j < pieces; j++) cuts.push(lo + ((hi - lo) * j) / pieces);
      }
      if (a > b) cuts.reverse();
      for (const c of cuts) put(c, t, bs, by);
    }
    put(b, t, bs, by);
  };

  const run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    let p = run[0]!;
    put(norm[3 * p]!, norm[3 * p + 1]!, norm[3 * p + 2]!, p);
    for (let j = 1; j < run.length; j++) {
      const c = run[j]!,
        xp = norm[3 * p]!,
        xc = norm[3 * c]!,
        tp = norm[3 * p + 1]!,
        tc = norm[3 * c + 1]!,
        bp = norm[3 * p + 2]!,
        bc = norm[3 * c + 2]!;
      if (mode === 'after') {
        level(xp, xc, tp, bp, p);
        put(xc, tc, bc, c);
      } else if (mode === 'before') {
        put(xp, tc, bc, c);
        level(xp, xc, tc, bc, c);
      } else {
        const m = (xp + xc) / 2;
        level(xp, m, tp, bp, p);
        put(m, tc, bc, c);
        level(m, xc, tc, bc, c);
      }
      p = c;
    }
    put(NaN, NaN, NaN, -1);
    run.length = 0;
  };
  for (let i = 0; i < n; i++) {
    if (real(i)) run.push(i);
    else if (!connect) flush();
  }
  flush();

  const aligned = top.slice(0, 2 * k),
    alignedBase = foot ? foot.slice(0, 2 * k) : null;
  const out = (data: Float64Array): PointBuffer => {
    const buffer = { data: data.subarray(0, 2 * k), stride: 2, count: k };
    plane.place(buffer, first, second);
    return buffer;
  };
  const placedTop = out(top);
  return { top: placedTop, line: placedTop, base: foot ? out(foot) : null, owner: owner.subarray(0, k), aligned, alignedBase };
}

/**
 * The outlines of a step area as vertices for `Plane.alignedPath`: for each run of the line, the line forward and the baseline back, each run
 * ended by a NaN vertex. The foot of a vertex is at the same place along the first axis, so the move between the two is along the second.
 */
function areaRuns(top: Float64Array, foot: Float64Array): Float64Array {
  const rows = top.length / 2,
    out = new Float64Array(top.length * 2 + 2);
  let m = 0,
    start = 0;
  for (let i = 0; i <= rows; i++) {
    if (i < rows && Number.isFinite(top[2 * i]!)) continue;
    if (i > start) {
      for (let j = start; j < i; j++) {
        out[m++] = top[2 * j]!;
        out[m++] = top[2 * j + 1]!;
      }
      for (let j = i - 1; j >= start; j--) {
        out[m++] = foot[2 * j]!;
        out[m++] = foot[2 * j + 1]!;
      }
      out[m++] = NaN;
      out[m++] = NaN;
    }
    start = i + 1;
  }
  return out.subarray(0, m);
}

export interface StepCurveAttributes extends CurveAttributes {
  /** Where the value changes between one point and the next. Default 'after'. */
  mode?: StepMode;
}

/** A line, or the edge of an area, that holds its value and jumps. In a stack, the baseline steps too. */
export class StepCurve extends Curve<StepCurveAttributes> {
  #key = '';
  #value: Stepped | null = null;
  // The path data of the steps above, once asked for: they are the same until the key changes.
  #line: string | null = null;
  #area: string | null = null;
  /** The steps of a series, kept until it is projected again or they are asked for differently. */
  #steps(series: Series, baseline: number | null): Stepped | null {
    const mode = this.attrs.mode ?? 'after',
      key = `${series.projection}|${mode}|${baseline}|${series.attrs.missing}`;
    if (key !== this.#key) {
      this.#value = stepLines(series, mode, baseline);
      this.#key = key;
      this.#line = this.#area = null;
    }
    return this.#value;
  }
  line(series: Series): string {
    const steps = this.#steps(series, null);
    if (!steps) return '';
    return (this.#line ??= series.plane.alignedPath(steps.aligned, steps.aligned.length / 2, series.firstAxis, series.secondAxis));
  }
  area(series: Series, baseline: number): string {
    const steps = this.#steps(series, baseline);
    if (!steps?.alignedBase) return '';
    const runs = areaRuns(steps.aligned, steps.alignedBase);
    return (this.#area ??= series.plane.alignedPath(runs, runs.length / 2, series.firstAxis, series.secondAxis, true));
  }
  override trace(series: Series, baseline: number | null): Trace | null {
    return this.#steps(series, baseline);
  }
}

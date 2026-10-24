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
 * arc round the middle and a jump a spoke, and on a radar a level is a chord through the spokes it passes. Hits are measured
 * to the same pieces in the same terms, so they are exact on every plane.
 *
 * The line passes through every point of the data, and a marker on the series sits on a corner. A gap in the data
 * breaks the steps in two, unless the series says its `missing` is 'connect'. A
 * 'line' or 'area' hit is measured to the steps on the screen and reports the point whose level it is on, and a tooltip
 * reading between points (`interpolate`) gives the level there, not a value on a straight line between the points.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import type { Series } from './series.ts';
import { areaRuns } from './aligned.ts';
import { Curve, type CurveAttributes } from './curve.ts';
import type { HitShapes } from './renderer.ts';

export type StepMode = 'after' | 'before' | 'center';

/**
 * The line of a series as steps, and the line it is filled from, in the plane's own terms: `[first, second]` fractions of the two axes for each
 * vertex, runs of them each ended by a NaN vertex. `owner` says, for each vertex, which of the series' own points the value there is (a level is its
 * point's, and a jump is shared by the two it joins).
 */
export interface Stepped {
  /** The steps, as vertices for `Plane.alignedPath`. */
  readonly aligned: Float64Array;
  /** The baseline's steps, vertex for vertex with `aligned`, or null for a line. */
  readonly alignedBase: Float64Array | null;
  readonly owner: Int32Array;
}

/**
 * The steps of a series as fractions of its axes. `baseline` is the value a step area is filled from (null for a line, which needs
 * no second buffer); in a stack the baseline is the layer below, row by row, as everywhere else. Null before the first
 * projection. The two buffers have the same shape, so a vertex of one has its foot at the same place in the other.
 */
export function stepLines(series: Series, mode: StepMode, baseline: number | null): Stepped | null {
  const d = series.drawn;
  if (!d) return null;
  const first = series.firstAxis,
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

  // At most three vertices a point (a corner at each end of a level, and the centre mode's middle), and one to end each run.
  const room = 3 * n + n + 2;
  const top = new Float64Array(2 * room),
    foot = wantBase ? new Float64Array(2 * room) : null,
    owner = new Int32Array(room);
  let k = 0;
  const put = (x: number, t: number, b: number, by: number) => {
    top[2 * k] = x;
    top[2 * k + 1] = t;
    owner[k] = by;
    if (foot) {
      foot[2 * k] = x;
      foot[2 * k + 1] = b;
    }
    k++;
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
        put(xc, tp, bp, p);
        put(xc, tc, bc, c);
      } else if (mode === 'before') {
        put(xp, tc, bc, c);
        put(xc, tc, bc, c);
      } else {
        const m = (xp + xc) / 2;
        put(m, tp, bp, p);
        put(m, tc, bc, c);
        put(xc, tc, bc, c);
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

  return { aligned: top.slice(0, 2 * k), alignedBase: foot ? foot.slice(0, 2 * k) : null, owner: owner.slice(0, k) };
}

/**
 * The pieces of a stepped line as rectangles in the plane's own terms: a level is one (no height), a jump two halves, each belonging to the point
 * at its end. With a baseline also the `cells` under each level, down to its foot.
 */
function stepPieces(steps: Stepped): HitShapes {
  const { aligned: v, alignedBase: f, owner } = steps;
  const rows = v.length / 2;
  const segs: number[] = [],
    own: number[] = [],
    cells: number[] = [],
    cellOwn: number[] = [];
  for (let k = 0; k + 1 < rows; k++) {
    const a0 = v[2 * k]!,
      b0 = v[2 * k + 1]!,
      a1 = v[2 * k + 2]!,
      b1 = v[2 * k + 3]!;
    if (!(Number.isFinite(a0) && Number.isFinite(b0) && Number.isFinite(a1) && Number.isFinite(b1))) continue;
    if (a0 !== a1) {
      segs.push(a0, a1, b0, b1);
      own.push(owner[k + 1]!);
      if (f) {
        cells.push(a0, a1, f[2 * k + 1]!, b0);
        cellOwn.push(owner[k + 1]!);
      }
    } else {
      const m = (b0 + b1) / 2;
      segs.push(a0, a1, b0, m, a0, a1, m, b1);
      own.push(owner[k]!, owner[k + 1]!);
    }
  }
  return {
    segments: { data: Float64Array.from(segs), count: own.length, owner: Int32Array.from(own) },
    cells: f ? { data: Float64Array.from(cells), count: cellOwn.length, owner: Int32Array.from(cellOwn) } : null,
  };
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
  #pieces: HitShapes | null = null;
  #piecesOf: Stepped | null = null;
  override hitShapes(series: Series, baseline: number | null): HitShapes | null {
    const steps = this.#steps(series, baseline);
    if (!steps) return null;
    if (this.#piecesOf !== steps) {
      this.#pieces = stepPieces(steps);
      this.#piecesOf = steps;
    }
    return this.#pieces;
  }
}

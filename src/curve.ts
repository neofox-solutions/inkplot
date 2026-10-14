/**
 * Curves: how a line, or the edge of an area, joins the points of a series.
 *
 * A `Curve` is the one child of a `LinePath` or an `AreaPath`, and all it does is turn a series that has been projected
 * (its points in plot pixels, and through them the plane and the data) into path text: `line` for the stroke, `area` for
 * the shapes between the line and a baseline. So the renderers know nothing of how points are joined, and a new way of
 * joining them is one new class that nothing else has to know about, nor any bundle that does not use it carry.
 *
 * `LinearCurve` here is the plain one, straight lines, and the only one every chart needs. The others are in `curves.ts`
 * (splines, arcs, bumps) and `steps.ts` (levels and jumps worked out in the plane's own terms). To write one of your own,
 * extend `Curve` and give `line` and `area`, or extend `StrokeCurve` (curves.ts) and say only what pieces a run of points
 * is made of.
 *
 * A curve that draws something other than straight lines through the points also gives its path as a `Trace`, which is
 * what hits and tooltip readings are measured against, so that they land on what is on the screen.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import type { PointBuffer } from './data.ts';
import { type BaseAttributes, ChartElement } from './element.ts';
import { f2 } from './geometry.ts';
import type { AnySeriesRenderer, Trace } from './renderer.ts';
import type { Series } from './series.ts';

export interface CurveAttributes extends BaseAttributes {}

/** Joins the points of a series. The child of a line or an area renderer. */
export abstract class Curve<A extends CurveAttributes = CurveAttributes> extends ChartElement<AnySeriesRenderer, [], A> {
  /** The path of the series' line: each run of it (a stretch between gaps, or the whole of it when the series' `gaps` are 'connect') starts with an M. */
  abstract line(series: Series): string;
  /** The path of the shapes between the series' line and its baseline, `baseline` being a value (in a stack, the layer below is used instead). */
  abstract area(series: Series, baseline: number): string;
  /**
   * What `line` (with a null `baseline`) or `area` draws, as the vertices a pointer is measured against and the point each
   * belongs to, or null when it is straight lines through the points, which hits measure by themselves. Default null.
   */
  trace(_series: Series, _baseline: number | null): Trace | null {
    return null;
  }
}

/**
 * The path text through placed points, lifting the pen at each gap (or, with `connect`, going across it). Built as
 * compactly as SVG allows (an implicit lineto after the first pair) because for large series its size is the cost.
 */
export function polyline(points: Readonly<PointBuffer>, connect: boolean): string {
  const { data, count, stride } = points;
  // Pen state: 0 up, 1 just moved, 2 drawing (implicit lineto pairs). A gap puts the pen up.
  let d = '',
    pen = 0;
  for (let i = 0; i < count; i++) {
    const x = data[stride * i]!,
      y = data[stride * i + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (!connect) pen = 0;
      continue;
    }
    const xy = f2(x) + ' ' + f2(y);
    switch (pen) {
      case 0:
        d += 'M' + xy;
        pen = 1;
        break;
      case 1:
        d += 'L' + xy;
        pen = 2;
        break;
      default:
        d += ' ' + xy;
    }
  }
  return d;
}

/**
 * The closed shapes between a line and its baseline: the line forward and the baseline backward, one shape for each run
 * of rows where both are real (or, with `connect`, a single shape of all the real ones). Both buffers are placed points
 * in the same order, so row `i` of one is the foot of row `i` of the other.
 */
export function areaOutline(top: Readonly<PointBuffer>, base: Readonly<PointBuffer>, connect: boolean): string {
  const { data, count, stride } = top,
    b = base.data,
    bs = base.stride;
  const ok = (i: number) => {
    const x = data[i * stride]!,
      y = data[i * stride + 1]!,
      bx = b[bs * i]!,
      by = b[bs * i + 1]!;
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(bx) && Number.isFinite(by);
  };
  let d = '';
  for (let i = 0; i < count;) {
    if (!ok(i)) {
      i++;
      continue;
    }
    let end = i;
    if (connect) {
      for (let k = i + 1; k < count; k++) if (ok(k)) end = k;
    } else while (end + 1 < count && ok(end + 1)) end++;
    d += `M${f2(data[i * stride]!)} ${f2(data[i * stride + 1]!)}L`;
    let first = true;
    for (let k = i + 1; k <= end; k++) {
      if (connect && !ok(k)) continue;
      d += (first ? '' : ' ') + f2(data[k * stride]!) + ' ' + f2(data[k * stride + 1]!);
      first = false;
    }
    for (let k = end; k >= i; k--) if (!connect || ok(k)) d += ' ' + f2(b[bs * k]!) + ' ' + f2(b[bs * k + 1]!);
    d += 'Z';
    i = end + 1;
  }
  return d;
}

/** Straight lines from point to point: what a line chart is. A gap lifts the pen, or is crossed if the series says its `gaps` are 'connect'. */
export class LinearCurve extends Curve {
  line(series: Series): string {
    return polyline(series.points, series.attrs.gaps === 'connect');
  }
  area(series: Series, baseline: number): string {
    return areaOutline(series.points, series.baseline(baseline), series.attrs.gaps === 'connect');
  }
}

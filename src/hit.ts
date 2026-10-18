/**
 * Hit testing: which drawn point a pointer is near. It is all free-standing functions that read a series back through
 * `Series.drawn`, and nothing in the core imports it, so a chart that does not hit-test (no tooltip, no listener) does
 * not carry any of it. The geometry at the top works on plain buffers of placed points and needs no chart.
 *
 * What "near" means is the series' choice (its `hit` attribute), because only it knows what its renderers draw:
 *  - `point`: the distance to the nearest point. Right for markers and for a line that is only read at its points.
 *  - `line`: the distance to the nearest point *on the line* joining them, so the pointer can be anywhere along a segment.
 *  - `area`: zero anywhere inside the shape between the line and its baseline, else as `line`.
 *  - `shape`: zero anywhere inside a shape the series' renderer drew for the point (a bar), else the distance to its edge.
 *    Bars say this by themselves, so a bar series needs no `hit` setting.
 * In every mode the hit is one of the points, never a place between two: the one nearest to where the pointer is.
 *
 * Steps and curves are measured as they are drawn: their renderers `trace` the path they draw, and 'line' and 'area' follow
 * it (a point is still what is reported: the one whose level or stretch of curve the pointer is on). A renderer with no
 * trace is drawn with straight lines through its points, which is what is measured.
 *
 * Either coordinate of the pointer may be NaN, which says "ignore this one": the distance is then measured along the
 * other alone. That is how a crosshair finds the point at the pointer's x whatever its height, and with one coordinate
 * missing a line or an area can no longer be between anything, so every mode measures to the nearest point. Note that
 * these are plot pixels, not data axes: on a Cartesian plane x is the horizontal axis, on a polar plane it is just across.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import type { PointBuffer } from './data.ts';
import type { Hit } from './events.ts';
import type { Plane } from './plane.ts';
import type { PolygonSet, Trace } from './renderer.ts';
import type { Series } from './series.ts';

export type HitMode = 'point' | 'line' | 'area' | 'shape';

/** How a series takes pointer hits: set as its `hit` attribute. */
export interface HitOptions {
  /** What distance means: to the nearest point, to the line through them, or zero inside the area or shape. Default what the renderer says (bars: 'shape'), else 'point'. */
  mode?: HitMode;
  /** The farthest a pointer may be, in pixels, and still hit. Default 10. */
  radius?: number;
  /** For 'area': the value the shape is closed against, like the renderer's own baseline. Default 0. */
  baseline?: number;
}
const DEFAULT_RADIUS = 10;
/** The least a series' hit radius is while the last input was a finger: a fingertip is not a mouse pointer. */
const COARSE_RADIUS = 24;

/** The nearest point, and how far the pointer is from what the mode measures. */
export interface Nearest {
  readonly index: number;
  readonly distance: number;
}

/** Distance from (x, y) to a point, with a NaN coordinate of the pointer leaving that direction out. */
function between(px: number, py: number, x: number, y: number): number {
  const dx = x !== x ? 0 : px - x,
    dy = y !== y ? 0 : py - y;
  return Math.hypot(dx, dy);
}

/** The nearest drawn point; points that are gaps (NaN) are skipped. Null when there is none, or both coordinates are NaN. */
export function nearestPoint(points: PointBuffer, x: number, y: number): Nearest | null {
  if (x !== x && y !== y) return null;
  const { data, count, stride } = points;
  let best = -1,
    bestD = Infinity;
  for (let i = 0, k = 0; k < count; k++, i += stride) {
    const px = data[i]!,
      py = data[i + 1]!;
    if (px !== px || py !== py) continue;
    const d = between(px, py, x, y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best < 0 ? null : { index: best, distance: bestD };
}

/**
 * The distance to the nearest point of the polyline through the points (a gap breaks it), and the nearer end of that segment.
 * @internal
 */
export function nearestSegment(points: PointBuffer, x: number, y: number): Nearest | null {
  if (x !== x || y !== y) return nearestPoint(points, x, y);
  const { data, count, stride } = points;
  let best = -1,
    bestD = Infinity;
  for (let k = 0, i = 0; k < count; k++, i += stride) {
    const ax = data[i]!,
      ay = data[i + 1]!;
    if (ax !== ax || ay !== ay) continue;
    // A point on its own (or the end of a run) is still something to hit.
    const own = Math.hypot(ax - x, ay - y);
    if (own < bestD) {
      bestD = own;
      best = k;
    }
    if (k + 1 >= count) continue;
    const bx = data[i + stride]!,
      by = data[i + stride + 1]!;
    if (bx !== bx || by !== by) continue;
    const sx = bx - ax,
      sy = by - ay,
      len2 = sx * sx + sy * sy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * sx + (y - ay) * sy) / len2)) : 0;
    const d = Math.hypot(ax + t * sx - x, ay + t * sy - y);
    if (d < bestD) {
      bestD = d;
      best = t < 0.5 ? k : k + 1;
    }
  }
  return best < 0 ? null : { index: best, distance: bestD };
}

/**
 * Whether (x, y) is inside the shape that a run of points makes with its baseline (the same points, placed against the
 * baseline value, which `base` holds one row each for). Runs are the stretches between gaps, each its own shape. The
 * nearest point of that run is returned when it is, else null.
 * @internal
 */
export function insideArea(points: PointBuffer, base: PointBuffer, x: number, y: number): number | null {
  if (x !== x || y !== y) return null;
  const { data, count, stride } = points,
    b = base.data,
    bs = base.stride;
  const valid = (k: number) =>
    data[k * stride]! === data[k * stride]! && data[k * stride + 1]! === data[k * stride + 1]! && b[k * bs + 1]! === b[k * bs + 1]!;
  for (let from = 0; from < count;) {
    if (!valid(from)) {
      from++;
      continue;
    }
    let to = from;
    while (to + 1 < count && valid(to + 1)) to++;
    // Even-odd ray casting over the run forward and its baseline back.
    const n = to - from + 1;
    const vx = (j: number) => (j < n ? data[(from + j) * stride]! : b[(to - (j - n)) * bs]!);
    const vy = (j: number) => (j < n ? data[(from + j) * stride + 1]! : b[(to - (j - n)) * bs + 1]!);
    let inside = false;
    for (let j = 0, prev = 2 * n - 1; j < 2 * n; prev = j++) {
      const yj = vy(j),
        yp = vy(prev),
        xj = vx(j),
        xp = vx(prev);
      if (yj > y !== yp > y && x < ((xp - xj) * (y - yj)) / (yp - yj) + xj) inside = !inside;
    }
    if (inside) {
      let best = from,
        bestD = Infinity;
      for (let k = from; k <= to; k++) {
        const d = Math.hypot(data[k * stride]! - x, data[k * stride + 1]! - y);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      return best;
    }
    from = to + 1;
  }
  return null;
}

/**
 * The shape the pointer is inside (distance 0), else the one whose outline is nearest, by the shape's index. Shapes
 * made of NaN are left out. A NaN coordinate of the pointer means "ignore this direction", and the shapes' own points
 * then stand for them, as for any other mode.
 * @internal
 */
export function nearestShape(shapes: PolygonSet, points: PointBuffer, x: number, y: number): Nearest | null {
  if (x !== x || y !== y) return nearestPoint(points, x, y);
  const { data, perShape: m, count } = shapes;
  let best = -1,
    bestD = Infinity;
  for (let k = 0; k < count; k++) {
    const at = k * m * 2;
    if (data[at]! !== data[at]! || data[at + 1]! !== data[at + 1]!) continue;
    // Quick out: a shape whose bounding box is farther than the best so far cannot be nearer.
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (let j = 0; j < m; j++) {
      const px = data[at + 2 * j]!,
        py = data[at + 2 * j + 1]!;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
    if (Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) >= bestD) continue;
    let inside = false,
      edge = Infinity;
    for (let j = 0, prev = m - 1; j < m; prev = j++) {
      const ax = data[at + 2 * prev]!,
        ay = data[at + 2 * prev + 1]!,
        bx = data[at + 2 * j]!,
        by = data[at + 2 * j + 1]!;
      if (by > y !== ay > y && x < ((ax - bx) * (y - by)) / (ay - by) + bx) inside = !inside;
      const sx = bx - ax,
        sy = by - ay,
        len2 = sx * sx + sy * sy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * sx + (y - ay) * sy) / len2)) : 0;
      const d = Math.hypot(ax + t * sx - x, ay + t * sy - y);
      if (d < edge) edge = d;
    }
    const d = inside ? 0 : edge;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best < 0 ? null : { index: best, distance: bestD };
}

/** Where the runs of a path are: each stretch between NaN points, as the index of its first vertex and one past its last. */
function runsIn(path: PointBuffer): [number, number][] {
  const out: [number, number][] = [],
    { data, count, stride } = path;
  let from = -1;
  for (let k = 0; k <= count; k++) {
    const real = k < count && data[k * stride]! === data[k * stride]! && data[k * stride + 1]! === data[k * stride + 1]!;
    if (real && from < 0) from = k;
    else if (!real && from >= 0) {
      out.push([from, k]);
      from = -1;
    }
  }
  return out;
}

/**
 * Whether (x, y) is inside a shape a trace draws: each run of its line closed back along the same run of its baseline.
 * The point it belongs to is the one owning the nearest vertex of the line in that run, else null.
 * @internal
 */
export function insideTrace(trace: Trace, x: number, y: number): number | null {
  const base = trace.base;
  if (!base || x !== x || y !== y) return null;
  const tops = runsIn(trace.line),
    feet = runsIn(base),
    a = trace.line,
    b = base;
  for (let r = 0; r < tops.length && r < feet.length; r++) {
    const [t0, t1] = tops[r]!,
      [f0, f1] = feet[r]!,
      n = t1 - t0,
      m = f1 - f0,
      total = n + m;
    // The line forward, then the baseline back.
    const vx = (j: number) => (j < n ? a.data[(t0 + j) * a.stride]! : b.data[(f1 - 1 - (j - n)) * b.stride]!);
    const vy = (j: number) => (j < n ? a.data[(t0 + j) * a.stride + 1]! : b.data[(f1 - 1 - (j - n)) * b.stride + 1]!);
    let inside = false;
    for (let j = 0, prev = total - 1; j < total; prev = j++) {
      const yj = vy(j),
        yp = vy(prev),
        xj = vx(j),
        xp = vx(prev);
      if (yj > y !== yp > y && x < ((xp - xj) * (y - yj)) / (yp - yj) + xj) inside = !inside;
    }
    if (inside) {
      let best = t0,
        bestD = Infinity;
      for (let k = t0; k < t1; k++) {
        const d = Math.hypot(a.data[k * a.stride]! - x, a.data[k * a.stride + 1]! - y);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      return trace.owner[best]!;
    }
  }
  return null;
}

/**
 * The nearest point under `mode` ('line' or 'area') to a path a renderer traces, by the point each vertex belongs to.
 * @internal
 */
export function nearestTraced(trace: Trace, mode: HitMode, x: number, y: number): Nearest | null {
  if (mode === 'area') {
    const inside = insideTrace(trace, x, y);
    if (inside !== null) return { index: inside, distance: 0 };
  }
  const found = nearestSegment(trace.line, x, y);
  return found && { index: trace.owner[found.index]!, distance: found.distance };
}

/** The nearest point under `mode`; `base` is the baseline for an area (ignored otherwise). */
export function nearest(points: PointBuffer, mode: HitMode, base: (() => PointBuffer) | null, x: number, y: number): Nearest | null {
  if (mode === 'point') return nearestPoint(points, x, y);
  if (mode === 'area' && base) {
    const inside = insideArea(points, base(), x, y);
    if (inside !== null) return { index: inside, distance: 0 };
  }
  return nearestSegment(points, x, y);
}

// ─── Series and planes ───

/**
 * The hit for drawn point `index` of a series, with the pointer `distance` away.
 * @internal
 */
export function pointHit(series: Series, index: number, distance = 0): Hit | null {
  return hitAt(series, index, distance);
}
function hitAt(series: Series, index: number, distance: number): Hit | null {
  const d = series.drawn;
  if (!d) return null;
  const { raw, stride, points } = d,
    names = d.channels,
    bound = names.length,
    at = index * stride,
    channels: Record<string, number> = {};
  for (let k = 0; k < bound; k++) channels[names[k]!] = raw[at + stride - bound + k]!;
  const row = d.rowOf?.(index);
  // In a stack the point is drawn above its own value by the layers below it.
  const own = raw[at + d.secondColumn]!,
    lift = d.top && d.additive ? d.top[index]! - own : NaN;
  return {
    series,
    plane: d.plane,
    index,
    ...(row === undefined || row < 0 ? {} : { row }),
    ...(lift === lift ? { lift } : {}),
    first: raw[at + d.firstColumn]!,
    second: raw[at + d.secondColumn]!,
    channels,
    px: points.data[index * points.stride]!,
    py: points.data[index * points.stride + 1]!,
    distance,
  };
}

/**
 * The nearest drawn point of a series to a position in plot pixels, within `maxDistance` (default: its `hit` radius), as
 * its `hit` mode measures it. A NaN for `x` or `y` leaves that direction out, so `hitTest(series, x, NaN, Infinity)` is
 * the point nearest in x whatever its height. Null if nothing is near enough, or the series takes no hits.
 */
export function hitTest(series: Series, x: number, y: number, maxDistance?: number): Hit | null {
  const h = series.attrs.hit,
    d = series.drawn;
  if (h === false || !d || d.points.count === 0) return null;
  const o: HitOptions = typeof h === 'string' ? { mode: h } : (h ?? {});
  const mode = o.mode ?? series.hitHint ?? 'point';
  const tracedMode = mode === 'line' || mode === 'area' ? mode : null;
  // A path a renderer traces (steps, curves) is what is measured, but a pointer with a coordinate left out measures to points.
  const traced = tracedMode && x === x && y === y ? series.trace() : null;
  const found =
    mode === 'shape'
      ? (() => {
          const g = series.shapes();
          return g ? nearestShape(g, d.points, x, y) : nearestPoint(d.points, x, y);
        })()
      : traced && tracedMode
        ? nearestTraced(traced, tracedMode, x, y)
        : nearest(d.points, mode, mode === 'area' ? () => series.baseline(o.baseline ?? 0) : null, x, y);
  const radius =
    maxDistance ?? (series.chart?.input?.coarse ? Math.max(o.radius ?? DEFAULT_RADIUS, COARSE_RADIUS) : (o.radius ?? DEFAULT_RADIUS));
  if (!found || !(found.distance <= radius)) return null;
  return hitAt(series, found.index, found.distance);
}

/**
 * The nearest point of any series in the plane that takes hits, within each series' own radius, by that series' `hit`
 * mode. A tie goes to the series drawn last, which is the one on top.
 */
export function hitPlane(plane: Plane, x: number, y: number): Hit | null {
  const series = plane.series;
  let best: Hit | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    const h = hitTest(series[i]!, x, y);
    if (h && (!best || h.distance < best.distance)) best = h;
  }
  return best;
}

/**
 * The nearest point of every series that takes hits, topmost first. `radius` replaces each series' own, and is unlimited
 * by default, so `hitAll(plane, x, NaN)` is each series at the pointer's x: what a crosshair tooltip lists.
 */
export function hitAll(plane: Plane, x: number, y: number, radius = Infinity): Hit[] {
  const out: Hit[] = [];
  const series = plane.series;
  for (let i = series.length - 1; i >= 0; i--) {
    const h = hitTest(series[i]!, x, y, radius);
    if (h) out.push(h);
  }
  return out;
}

/**
 * The point of every series that is nearest the pointer *along the first axis*, whatever its distance across: what a
 * reading shared by all series, such as a crosshair tooltip, lists. It is measured in the axis' own terms and not in
 * pixels, so it is right wherever the plane puts that axis: across a Cartesian plane, up one whose domain is vertical, and
 * round a radial plane, where the nearest point is the one nearest in angle (and a full turn wraps, so a pointer just
 * before the start of the sweep finds the last points). Topmost series first. Series that take no hits are left out.
 */
export function hitAcross(plane: Plane, x: number, y: number): Hit[] {
  const out: Hit[] = [],
    series = plane.series;
  for (let i = series.length - 1; i >= 0; i--) {
    const s = series[i]!,
      d = s.drawn;
    if (s.attrs.hit === false || !d || d.points.count === 0) continue;
    const a = s.firstAxis,
      b = s.secondAxis,
      target = a.fractionOf(plane.unplace(x, y, a, b)[0]);
    if (target !== target) continue;
    const wraps = plane.cyclic(a),
      { raw, stride, firstColumn, secondColumn } = d;
    let best = -1,
      bestD = Infinity;
    for (let k = 0, at = 0; k < d.points.count; k++, at += stride) {
      const v = raw[at + firstColumn]!,
        w = raw[at + secondColumn]!;
      if (v !== v || w !== w) continue;
      let gap = Math.abs(a.fractionOf(v) - target);
      if (wraps) {
        gap -= Math.floor(gap);
        if (gap > 0.5) gap = 1 - gap;
      }
      if (gap < bestD) {
        bestD = gap;
        best = k;
      }
    }
    if (best < 0) continue;
    const px = d.points.data[best * d.points.stride]!,
      py = d.points.data[best * d.points.stride + 1]!;
    const h = hitAt(s, best, Math.hypot(px - x, py - y));
    if (h) out.push(h);
  }
  return out;
}

/**
 * Where a series' line is at position `first` of its first axis, read as a straight line between the two drawn points
 * either side of it, in data terms (so it is exact for a `LinePath` on a linear scale, and may sit off a curve or a line
 * drawn another way: see the tooltip's `interpolate`). Only a domain series has one; others, a series that takes no
 * hits, a position outside the data and one beside a gap give null. The hit is `interpolated`: its `index` and `row`
 * are the nearer of the two points, and `px`, `py` are where the line is.
 */
export function interpolate(series: Series, first: number): Hit | null {
  const d = series.drawn;
  if (!d || !d.alongDomain || series.attrs.hit === false) return null;
  const { raw, stride: rs, plane } = d,
    n = d.points.count;
  if (n < 2 || !(first >= raw[0]! && first <= raw[(n - 1) * rs]!)) return null;
  // The last point at or before `first`, found by halving: the domain ascends.
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (raw[mid * rs]! <= first) lo = mid;
    else hi = mid;
  }
  const d0 = raw[lo * rs]!,
    d1 = raw[hi * rs]!,
    v0 = raw[lo * rs + 1]!,
    v1 = raw[hi * rs + 1]!;
  // In a stack the line is drawn through the stacked values, though it reads as the series' own.
  const tops = d.top,
    p0 = tops ? tops[lo]! : v0,
    p1 = tops ? tops[hi]! : v1;
  // On a point exactly, that point is the answer, even at the end of a run with a gap after it.
  const onPoint = first === d0 && v0 === v0;
  if (!onPoint && (v0 !== v0 || v1 !== v1)) return null;
  const traced = onPoint ? null : series.trace();
  if (traced) return interpolateTraced(series, first, traced);
  const t = onPoint || !(d1 > d0) ? 0 : (first - d0) / (d1 - d0),
    value = onPoint ? v0 : v0 + t * (v1 - v0);
  const plotted = onPoint ? p0 : p0 + t * (p1 - p0);
  const buf = new Float64Array([first, plotted]),
    a = series.firstAxis,
    b = series.secondAxis;
  a.normalize(buf, 1, 2, 0);
  b.normalize(buf, 1, 2, 1);
  plane.place({ data: buf, stride: 2, count: 1 }, a, b);
  const near = hitAt(series, t < 0.5 ? lo : hi, 0);
  return near && { ...near, first, second: value, px: buf[0]!, py: buf[1]!, interpolated: true };
}

/**
 * A reading between two points of a series whose renderer draws something other than straight lines through them: where a
 * line across the plot at `first` (a spoke on a polar plane) crosses the traced path, read back into data. The value is the
 * path's own there, less what a stack lays under it, so a step reads as its level and a curve as the height it is drawn at.
 */
function interpolateTraced(series: Series, first: number, trace: Trace): Hit | null {
  const d = series.drawn;
  if (!d) return null;
  const { plane, raw, stride: rs } = d,
    a = series.firstAxis,
    b = series.secondAxis;
  // The line at `first` across the second axis, in pixels.
  const probe = new Float64Array([a.fractionOf(first), 0, a.fractionOf(first), 1]);
  plane.place({ data: probe, stride: 2, count: 2 }, a, b);
  const rx = probe[2]! - probe[0]!,
    ry = probe[3]! - probe[1]!;
  const { data, count, stride } = trace.line,
    eps = 1e-9;
  for (let k = 0; k + 1 < count; k++) {
    const ax = data[k * stride]!,
      ay = data[k * stride + 1]!,
      bx = data[(k + 1) * stride]!,
      by = data[(k + 1) * stride + 1]!;
    if (ax !== ax || ay !== ay || bx !== bx || by !== by) continue;
    const sx = bx - ax,
      sy = by - ay,
      cross = rx * sy - ry * sx;
    if (Math.abs(cross) < 1e-12) continue; // parallel to the probe: its ends are met by the pieces either side
    const qx = ax - probe[0]!,
      qy = ay - probe[1]!;
    const along = (qx * sy - qy * sx) / cross,
      u = (qx * ry - qy * rx) / cross; // along the probe, and along this piece
    if (along < -eps || along > 1 + eps || u < -eps || u > 1 + eps) continue;
    const px = ax + u * sx,
      py = ay + u * sy,
      oa = trace.owner[k]!,
      ob = trace.owner[k + 1]!;
    const plotted = plane.unplace(px, py, a, b)[1];
    const own = (i: number) => raw[i * rs + d.secondColumn]!;
    let value = plotted;
    if (d.top && oa >= 0 && ob >= 0) {
      // In a stack the path is drawn at the stacked value, which reads as the series' own: take off what is under it.
      if (d.additive) {
        const sa = d.top[oa]! - own(oa),
          sb = d.top[ob]! - own(ob);
        value = plotted - (sa + u * (sb - sa));
      } else value = own(oa) + u * (own(ob) - own(oa));
    }
    const near = hitAt(series, u < 0.5 ? oa : ob, 0);
    return near && { ...near, first, second: value, px, py, interpolated: true };
  }
  return null;
}

/**
 * Every series' line read at the pointer, topmost first: `interpolate` at the pointer's place along each series' first axis.
 * @internal
 */
export function interpolateAll(plane: Plane, x: number, y: number): Hit[] {
  const out: Hit[] = [];
  const series = plane.series;
  for (let i = series.length - 1; i >= 0; i--) {
    const s = series[i]!,
      h = interpolate(s, plane.unplace(x, y, s.firstAxis, s.secondAxis)[0]);
    if (h) out.push(h);
  }
  return out;
}

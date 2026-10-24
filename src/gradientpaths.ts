/**
 * Gradient paths: a line, or an area, whose colour changes along it with the data.
 *
 *     new GradientLinePath({ bind: { stroke: { axis: 'speed', channel: 'speed' } } }, new LinearCurve())
 *
 * A colour is bound to a channel exactly as a marker's is (`bind`, a `ColorAxis`, a channel of the data), and where a marker
 * takes the colour of its own point, here the colour runs smoothly from one point to the next. It is one SVG path with a
 * `linearGradient` for its paint, laid along the first axis of the series (the horizontal one, or the vertical one when the
 * domain runs up the plot), with a colour stop at the place of each point. That is cheap (one path and some stops, however
 * long the line), and it is the reason for two limits: the series has to run along a straight axis, so it is for a
 * rectangular plane and not a polar one; and a colour belongs to a place along the axis, so a path that doubles back (an
 * `XYSeries` that loops) takes the colour of its last pass. Where the line goes wild, between a few hundred points, the
 * stops are averages of the points they stand for.
 *
 * A stepped colour axis (`interpolation: 'step'`) gives hard bands: each point's colour holds halfway to its neighbours.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, NUMBER } from './attrs.ts';
import { isHorizontal } from './axis.ts';
import { fractionsOf, resolveBindings } from './bucket.ts';
import { Curve } from './curve.ts';
import type { PointBuffer } from './data.ts';
import { fail } from './element.ts';
import type { BoundDimension } from './mapped.ts';
import type { PlatformNode } from './platform.ts';
import { paintBox, type ResolvedBinding, SeriesRenderer, type SeriesRendererAttributes, type Trace } from './renderer.ts';
import type { Series } from './series.ts';
import type { Surface } from './surface.ts';

/** Module-level so ids stay unique across renderers and charts on one page. */
let gradientCounter = 0;

/** The most stops a gradient has unless told otherwise: enough for a colour every pixel or two on a wide plot, and not a node for every point of a long line. */
const DEFAULT_STOPS = 500;
/** Samples of a ramp in a legend sample. */
const SAMPLE_STOPS = 16;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The colours of a stepped ramp (a `ColorAxis` with `interpolation: 'step'`); null for anything that is blended between points. */
function bandsOf(axis: BoundDimension): readonly string[] | null {
  if (!('attrs' in axis) || typeof axis.attrs !== 'object' || axis.attrs === null) return null;
  if (!('interpolation' in axis.attrs) || axis.attrs.interpolation !== 'step') return null;
  return 'stops' in axis && Array.isArray(axis.stops) ? axis.stops.map(String) : null;
}

/** Where, along the axis, a colour is, and what it is. */
interface Stop {
  offset: number;
  color: string;
}

/**
 * Colour stops, along the series' first axis, for the colour a binding gives each point: null if no point can be placed, a
 * plain colour when every point is in the same place (there is no way along which to run a gradient).
 */
function stopsFor(
  binding: ResolvedBinding,
  series: Series,
  points: Readonly<PointBuffer>,
  maxStops: number,
): { from: number; to: number; stops: Stop[] } | string | null {
  const { data, count, stride } = points;
  const horizontal = isHorizontal(series.firstAxis.orientation);
  const along = horizontal ? 0 : 1;
  const f = fractionsOf(binding, data, 2 + series.channels.indexOf(binding.channel), stride, count);
  const place = new Float64Array(count),
    frac = new Float64Array(count);
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(data[i * stride]!) || !Number.isFinite(data[i * stride + 1]!)) continue;
    place[n] = data[i * stride + along]!;
    frac[n++] = f[i]!;
  }
  if (n === 0) return null;
  const color = (p: number) => String(binding.axis.valueAt(p));
  const from = place[0]!,
    to = place[n - 1]!;
  if (from === to) return color(frac[0]!);
  // More points than stops: each stop stands for a run of them, at their mean place and with their mean position along the ramp.
  let at = place,
    fr = frac,
    m = n;
  if (n > maxStops) {
    m = maxStops;
    at = new Float64Array(m);
    fr = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const lo = Math.floor((k * n) / m),
        hi = Math.max(lo + 1, Math.floor(((k + 1) * n) / m));
      let sp = 0,
        sf = 0,
        valid = 0;
      for (let i = lo; i < hi; i++) {
        sp += place[i]!;
        const p = frac[i]!;
        if (p >= -1e-9 && p <= 1 + 1e-9) {
          sf += p;
          valid++;
        }
      }
      at[k] = sp / (hi - lo);
      fr[k] = valid ? sf / valid : NaN;
    }
    // The ends of the line keep their own colour.
    at[0] = from;
    at[m - 1] = to;
  }
  const raw: Stop[] = [];
  const span = to - from;
  let last = 0;
  const push = (p: number, c: string) => {
    // A path that doubles back would put a stop behind the last one: it takes the place of the last instead.
    last = Math.min(1, Math.max(last, (p - from) / span));
    raw.push({ offset: last, color: c });
  };
  if (bandsOf(binding.axis)) {
    // Each colour holds from halfway back to halfway on.
    push(at[0]!, color(fr[0]!));
    for (let i = 0; i + 1 < m; i++) {
      const mid = (at[i]! + at[i + 1]!) / 2;
      push(mid, color(fr[i]!));
      push(mid, color(fr[i + 1]!));
    }
    push(at[m - 1]!, color(fr[m - 1]!));
  } else {
    for (let i = 0; i < m; i++) push(at[i]!, color(fr[i]!));
  }
  // A stop between two of its own colour adds nothing.
  const stops = raw.filter((s, i) => i === 0 || i === raw.length - 1 || s.color !== raw[i - 1]!.color || s.color !== raw[i + 1]!.color);
  return { from, to, stops };
}

/** One gradient of a renderer, and the stop nodes it has written: it is reused (and trimmed) on every paint. */
class GradientPaint {
  readonly id = `inkgrad${++gradientCounter}`;
  #stops = 0;

  /** Writes the gradient and returns what to paint with: `url(#id)`, a plain colour, or null when nothing can be placed. */
  paint(s: Surface, binding: ResolvedBinding, series: Series, points: Readonly<PointBuffer>, maxStops: number): string | null {
    if (!series.plane.rectilinear) fail(149);
    const g = stopsFor(binding, series, points, Math.max(2, Math.floor(maxStops)));
    if (g === null || typeof g === 'string') {
      this.#trim(s, 0);
      return g;
    }
    const horizontal = isHorizontal(series.firstAxis.orientation);
    const node = s.node(this.id, 'linearGradient', { parent: s.node('defs', 'defs') });
    s.set(node, 'id', this.id);
    s.set(node, 'gradientUnits', 'userSpaceOnUse');
    s.set(node, 'x1', horizontal ? r2(g.from) : 0);
    s.set(node, 'x2', horizontal ? r2(g.to) : 0);
    s.set(node, 'y1', horizontal ? 0 : r2(g.from));
    s.set(node, 'y2', horizontal ? 0 : r2(g.to));
    g.stops.forEach((stop, i) => {
      const n = s.node(`${this.id}/${i}`, 'stop', { parent: node });
      s.set(n, 'offset', r4(stop.offset));
      s.set(n, 'stop-color', stop.color);
    });
    this.#trim(s, g.stops.length);
    return `url(#${this.id})`;
  }
  #trim(s: Surface, keep: number): void {
    for (let i = keep; i < this.#stops; i++) s.remove(`${this.id}/${i}`);
    this.#stops = keep;
  }
  /** The gradient a legend sample is painted with: the ramp itself, low to high across `width`. */
  sample(s: Surface, parent: PlatformNode, key: string, binding: ResolvedBinding, width: number): string {
    const id = `${this.id}s`;
    const node = s.node(`${key}/gradient`, 'linearGradient', { parent: s.node(`${key}/defs`, 'defs', { parent }) });
    s.set(node, 'id', id);
    s.set(node, 'gradientUnits', 'userSpaceOnUse');
    s.set(node, 'x1', 0);
    s.set(node, 'x2', width);
    s.set(node, 'y1', 0);
    s.set(node, 'y2', 0);
    const bands = bandsOf(binding.axis);
    const list: Stop[] = [];
    if (bands) {
      const k = bands.length;
      for (let i = 0; i < k; i++) list.push({ offset: i / k, color: bands[i]! }, { offset: (i + 1) / k, color: bands[i]! });
    } else {
      for (let i = 0; i < SAMPLE_STOPS; i++)
        list.push({ offset: i / (SAMPLE_STOPS - 1), color: String(binding.axis.valueAt(i / (SAMPLE_STOPS - 1))) });
    }
    list.forEach((stop, i) => {
      const n = s.node(`${key}/stop${i}`, 'stop', { parent: node });
      s.set(n, 'offset', r4(stop.offset));
      s.set(n, 'stop-color', stop.color);
    });
    return `url(#${id})`;
  }
}

// ─── Line ───

export interface GradientLinePathBindable {
  stroke: string;
}

export interface GradientLinePathAttributes extends SeriesRendererAttributes<GradientLinePathBindable> {
  /** The most colour stops the gradient has: more points than this are averaged into stops. Default 500. */
  maxStops?: number;
}

/**
 * One path through the points, as a `LinePath` draws it, whose colour is bound to a channel and runs smoothly along it:
 * `bind: { stroke: { axis: 'speed', channel: 'speed' } }`. Without a `bind` it is a plain line. A `ColorKey` for the same
 * axis says what the colours mean. See the notes at the top of this file for what it needs.
 */
export class GradientLinePath extends SeriesRenderer<GradientLinePathAttributes, [curve: Curve]> {
  static override attrTypes = { ...SeriesRenderer.attrTypes, maxStops: NUMBER } satisfies AttrTypesFor<
    Omit<GradientLinePathAttributes, 'bind'>
  >;
  readonly #stroke = new GradientPaint();

  /** How the points are joined. */
  get curve(): Curve {
    return this.child(0, Curve);
  }
  override get bindings(): readonly ResolvedBinding[] {
    return resolveBindings(this.attrs.bind, this, () => false);
  }
  /** The colour the line has where nothing is bound to it. */
  protected look() {
    const a = this.attrs;
    return this.styleFor(
      ['seriesLine', 'line'],
      { color: a.stroke, width: a.strokeWidth, opacity: a.opacity },
      { color: this.requireParent().accentColor },
    );
  }
  override get swatch(): string | null {
    return this.bindings.length ? null : this.look().color;
  }
  override trace(): Trace | null {
    return this.curve.trace(this.requireParent(), null);
  }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const look = this.look(),
      binding = this.bindings[0],
      n = s.node(key, 'path', { parent });
    s.set(n, 'd', `M0 ${height / 2}H${width}`);
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', binding ? this.#stroke.sample(s, parent, `${key}~`, binding, width) : look.color);
    s.set(n, 'stroke-width', look.width);
    s.set(n, 'stroke-linecap', 'butt');
    s.set(n, 'opacity', look.opacity);
    s.set(n, 'stroke-dasharray', look.dash);
  }

  protected draw(points: Readonly<PointBuffer>): void {
    const counters = this.counters,
      s = this.surface,
      series = this.requireParent();
    const look = this.look();
    const binding = this.bindings[0];
    const paint = binding ? this.#stroke.paint(s, binding, series, points, this.attrs.maxStops ?? DEFAULT_STOPS) : null;
    const t0 = performance.now();
    const d = this.curve.lineText(series);
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += d.length;

    const n = s.node('line', 'path');
    s.set(n, 'd', d);
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', paint ?? look.color);
    s.set(n, 'stroke-width', look.width);
    s.set(n, 'stroke-linejoin', 'round');
    s.set(n, 'stroke-linecap', 'round');
    s.set(n, 'opacity', look.opacity);
    s.set(n, 'stroke-dasharray', look.dash);
  }
}

// ─── Area ───

export interface GradientAreaPathBindable {
  fill: string;
  stroke: string;
}

export interface GradientAreaPathAttributes extends SeriesRendererAttributes<GradientAreaPathBindable> {
  /** The value the area is filled from, kept inside the value axis' range. Default 0. */
  baseline?: number;
  /** The most colour stops each gradient has: more points than this are averaged into stops. Default 500. */
  maxStops?: number;
}

/**
 * The region between a line and a baseline, as an `AreaPath` draws it, whose fill (and outline, if given) is bound to a
 * channel and runs smoothly along it: `bind: { fill: { axis: 'speed', channel: 'speed' } }`. Without a `bind` it is a plain
 * area. See the notes at the top of this file for what it needs.
 */
export class GradientAreaPath extends SeriesRenderer<GradientAreaPathAttributes, [curve: Curve]> {
  static override attrTypes = {
    ...SeriesRenderer.attrTypes,
    maxStops: NUMBER,
    baseline: NUMBER,
  } satisfies AttrTypesFor<Omit<GradientAreaPathAttributes, 'bind'>>;
  readonly #fill = new GradientPaint();
  readonly #stroke = new GradientPaint();

  /** How the points are joined. */
  get curve(): Curve {
    return this.child(0, Curve);
  }
  override get bindings(): readonly ResolvedBinding[] {
    return resolveBindings(this.attrs.bind, this, () => false);
  }
  #bound(property: 'fill' | 'stroke'): ResolvedBinding | undefined {
    return this.bindings.find((b) => b.property === property);
  }
  protected look() {
    const a = this.attrs;
    return this.styleFor(
      ['seriesArea', 'shape'],
      { fill: a.fill, stroke: a.stroke, strokeWidth: a.strokeWidth, opacity: a.opacity },
      { fill: this.requireParent().accentColor },
    );
  }
  override get swatch(): string | null {
    return this.#bound('fill') ? null : this.look().fill;
  }
  override trace(): Trace | null {
    return this.curve.trace(this.requireParent(), this.attrs.baseline ?? 0);
  }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const look = this.look(),
      fill = this.#bound('fill'),
      stroke = this.#bound('stroke');
    paintBox(s, parent, key, width, height, {
      ...look,
      fill: fill ? this.#fill.sample(s, parent, `${key}~f`, fill, width) : look.fill,
      stroke: stroke ? this.#stroke.sample(s, parent, `${key}~s`, stroke, width) : look.stroke,
    });
  }

  protected draw(points: Readonly<PointBuffer>): void {
    const counters = this.counters,
      s = this.surface,
      a = this.attrs,
      series = this.requireParent();
    const look = this.look(),
      maxStops = a.maxStops ?? DEFAULT_STOPS;
    const fill = this.#bound('fill'),
      stroke = this.#bound('stroke');
    const fillPaint = fill ? this.#fill.paint(s, fill, series, points, maxStops) : null,
      strokePaint = stroke ? this.#stroke.paint(s, stroke, series, points, maxStops) : null;
    const t0 = performance.now();
    const d = this.curve.areaText(series, a.baseline ?? 0);
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += d.length;

    const n = s.node('area', 'path');
    s.set(n, 'd', d);
    s.set(n, 'fill', fillPaint ?? look.fill);
    s.set(n, 'fill-opacity', look.opacity);
    s.set(n, 'stroke', strokePaint ?? look.stroke);
    s.set(n, 'stroke-width', look.strokeWidth);
    s.set(n, 'stroke-linejoin', 'round');
  }
}

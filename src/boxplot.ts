/**
 * Box and whisker: the five numbers that summarise a spread, one box for each point of a series.
 *
 *   <DomainSeries>
 *     <ObjectDataSource source={rows} domain="group" value="median" channels={{ min: 'lo', q1: 'q1', q3: 'q3', max: 'hi' }} />
 *     <BoxPath />
 *   </DomainSeries>
 *
 * The box runs from the first to the third quartile with a line at the median, and whiskers go from it to the lowest and
 * highest values. The median is the series' own value (what a source's `value` names), and the other four come from **channels** of
 * the data called `min`, `q1`, `q3` and `max`, unless the `low`, `q1`, `q3` and `high` attributes name others (`median` can name a
 * channel too), so numbers worked out elsewhere can be drawn as they are.
 * `BoxStats` (stats.ts) is the other way to get them: a transform that works the five numbers out from the samples, with
 * the points outside the whiskers as a second output to plot as markers.
 *
 * It is drawn in the plane's own terms like bars, so the domain on the vertical axis gives horizontal boxes and a polar plane
 * gives wedges. A box is hit as a shape. The value axis reaches the whiskers; the width of a box is a band's own, else
 * `width` (default 0.8) of the gap between points, and boxes in a `Stack` in 'group' mode sit side by side.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import { type BarOptions, layoutBars } from './bars.ts';
import { f2 } from './geometry.ts';
import type { HitMode } from './hit.ts';
import type { PlatformNode } from './platform.ts';
import { type PolygonSet, SeriesRenderer, type SeriesRendererAttributes, type Spread, type SpreadView, paintBox } from './renderer.ts';
import type { Series } from './series.ts';
import type { Surface } from './surface.ts';

export interface BoxPathAttributes extends Omit<SeriesRendererAttributes, 'bind'>, Omit<BarOptions, 'baseline'> {
  /** The channel of the lower whisker's end. Default 'min'. */
  low?: string;
  /** The channel of the first quartile (the foot of the box). Default 'q1'. */
  q1?: string;
  /** The channel of the median. Default: the series' own value, which is what a data source's `value` names. */
  median?: string;
  /** The channel of the third quartile (the top of the box). Default 'q3'. */
  q3?: string;
  /** The channel of the upper whisker's end. Default 'max'. */
  high?: string;
  /** Width of the cap on each whisker, as a fraction of the box's width; 0 for none. Default 0.5. */
  capWidth?: number;
}

const REACH = 2;
const MAX_ARC = 16;
const clamp = (v: number) => (v < -REACH ? -REACH : v > 1 + REACH ? 1 + REACH : v);

/** What a draw and a hit both need: boxes as outlines, and the other marks, all in plot pixels. */
interface Geometry {
  readonly projection: number;
  readonly n: number;
  readonly per: number;
  readonly steps: number;
  /** Box outlines (`per` points each), then median lines (`steps + 1` points each), whiskers (4: two lines) and caps (4: two lines). */
  readonly data: Float64Array;
}

export class BoxPath extends SeriesRenderer<BoxPathAttributes> {
  static override attrTypes = { ...SeriesRenderer.attrTypes, low: STRING, q1: STRING, median: STRING, q3: STRING, high: STRING, capWidth: NUMBER, width: NUMBER } satisfies AttrTypesFor<BoxPathAttributes>;
  #geometry: Geometry | null = null;

  private get names() {
    const a = this.attrs;
    return { low: a.low ?? 'min', q1: a.q1 ?? 'q1', median: a.median, q3: a.q3 ?? 'q3', high: a.high ?? 'max' };
  }
  override get channelNames(): readonly string[] { const n = this.names; return [...new Set([n.low, n.q1, ...(n.median ? [n.median] : []), n.q3, n.high])]; }
  /** Half the width of a box, in the gaps between points, which the domain axis leaves room for. */
  override get spans(): number { return (this.attrs.width ?? 0.8) / 2; }
  override get hitMode(): HitMode { return 'shape'; }

  override spread(view: SpreadView): Spread | null {
    const n = this.names, lo = view.channelColumn(n.low), hi = view.channelColumn(n.high);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < view.count; i++) {
      const a = view.raw[i * view.stride + lo]!, b = view.raw[i * view.stride + hi]!;
      if (Number.isFinite(a) && a < min) min = a;
      if (Number.isFinite(b) && b > max) max = b;
    }
    return min <= max ? { second: { min, max } } : null;
  }
  override limit(series: Series): Spread | null {
    const n = this.names, lo = series.data.channelExtent(n.low), hi = series.data.channelExtent(n.high);
    return lo && hi ? { second: { min: Math.min(lo.min, hi.min), max: Math.max(lo.max, hi.max) } } : null;
  }

  private box() {
    const a = this.attrs;
    return this.styleFor(['seriesBox', 'shape'], { fill: a.fill, stroke: a.stroke, strokeWidth: a.strokeWidth, opacity: a.opacity }, { fill: this.requireParent().accentColor, stroke: this.requireParent().accentColor });
  }
  private line() {
    const a = this.attrs;
    return this.styleFor(['boxLine', 'line'], { color: a.stroke, width: a.strokeWidth }, { color: this.requireParent().accentColor });
  }
  override get swatch(): string { return this.box().fill; }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    paintBox(s, parent, key, width, height, this.box());
    const look = this.line(), m = s.node(`${key}/median`, 'path', { parent });
    s.set(m, 'd', `M0 ${height / 2}H${width}`);
    s.set(m, 'fill', 'none');
    s.set(m, 'stroke', look.color);
    s.set(m, 'stroke-width', look.width * 1.5);
  }

  /** Where everything goes, in plot pixels; made again only when the series has been projected again. */
  private geometry(): Geometry | null {
    const series = this.requireParent(), d = series.drawn, plane = d?.plane;
    if (!d || !plane) return null;
    if (this.#geometry && this.#geometry.projection === series.projection) return this.#geometry;
    const lay = layoutBars(series, this.attrs);
    if (!lay) return null;
    const names = this.names, n = lay.n, rs = d.stride, base = rs - d.channels.length;
    const col = (name: string) => base + d.channels.indexOf(name);
    const cols = [col(names.low), col(names.q1), names.median ? col(names.median) : d.secondColumn, col(names.q3), col(names.high)];
    // The five values of each row on the value axis, as fractions.
    const v = new Float64Array(n * 5);
    for (let i = 0; i < n; i++) for (let k = 0; k < 5; k++) v[i * 5 + k] = d.raw[i * rs + cols[k]!]!;
    series.secondAxis.normalize(v, n * 5, 1, 0);
    const steps = plane.curved ? Math.min(MAX_ARC, Math.max(2, Math.ceil(lay.slot * 64))) : 1, per = 2 * (steps + 1), median = steps + 1;
    const cap = Math.max(0, this.attrs.capWidth ?? 0.5);
    const total = n * (per + median + 8), out = new Float64Array(total * 2);
    const boxAt = 0, medianAt = n * per, whiskerAt = medianAt + n * median, capAt = whiskerAt + n * 4;
    for (let i = 0; i < n; i++) {
      const x = lay.norm[3 * i]! + lay.shift, x0 = x - lay.slot / 2;
      const lo = v[i * 5]!, q1 = v[i * 5 + 1]!, med = v[i * 5 + 2]!, q3 = v[i * 5 + 3]!, hi = v[i * 5 + 4]!;
      const bad = !Number.isFinite(x) || !Number.isFinite(lo) || !Number.isFinite(q1) || !Number.isFinite(med) || !Number.isFinite(q3) || !Number.isFinite(hi);
      const put = (at: number, f: number, s: number) => { out[2 * at] = f; out[2 * at + 1] = bad ? NaN : Number.isFinite(f) ? clamp(s) : NaN; };
      let k = boxAt + i * per;
      for (let j = 0; j <= steps; j++) put(k++, x0 + (lay.slot * j) / steps, q1);
      for (let j = steps; j >= 0; j--) put(k++, x0 + (lay.slot * j) / steps, q3);
      k = medianAt + i * median;
      for (let j = 0; j <= steps; j++) put(k++, x0 + (lay.slot * j) / steps, med);
      k = whiskerAt + i * 4;
      put(k++, x, q3); put(k++, x, hi); put(k++, x, q1); put(k, x, lo);
      k = capAt + i * 4;
      const c = (lay.slot * cap) / 2;
      put(k++, x - c, hi); put(k++, x + c, hi); put(k++, x - c, lo); put(k, x + c, lo);
    }
    // `put` clamps the value but the domain half of an outline is exact; NaN is already in the second coordinate of a bad row, so mirror it.
    for (let i = 0; i < total; i++) if (!Number.isFinite(out[2 * i + 1]!)) out[2 * i] = NaN;
    plane.place({ data: out, stride: 2, count: total }, series.firstAxis, series.secondAxis);
    return (this.#geometry = { projection: series.projection, n, per, steps, data: out });
  }

  override shapes(): PolygonSet | null {
    const g = this.geometry();
    return g ? { data: g.data.subarray(0, g.n * g.per * 2), perShape: g.per, count: g.n } : null;
  }

  protected draw(): void {
    const s = this.surface, g = this.geometry(), box = this.box(), line = this.line();
    let boxes = '', medians = '', whiskers = '';
    if (g) {
      const path = (from: number, count: number, close: boolean) => {
        let d = '';
        for (let j = 0; j < count; j++) {
          const x = g.data[2 * (from + j)]!, y = g.data[2 * (from + j) + 1]!;
          if (!(Number.isFinite(x) && Number.isFinite(y))) return '';
          d += `${j === 0 ? 'M' : 'L'}${f2(x)} ${f2(y)}`;
        }
        return d + (close ? 'Z' : '');
      };
      const { n, per, steps } = g, median = steps + 1, medianAt = n * per, whiskerAt = medianAt + n * median, capAt = whiskerAt + n * 4;
      for (let i = 0; i < n; i++) {
        const b = path(i * per, per, true);
        if (!b) continue;
        boxes += b;
        medians += path(medianAt + i * median, median, false);
        whiskers += path(whiskerAt + i * 4, 2, false) + path(whiskerAt + i * 4 + 2, 2, false);
        if ((this.attrs.capWidth ?? 0.5) > 0) whiskers += path(capAt + i * 4, 2, false) + path(capAt + i * 4 + 2, 2, false);
      }
    }
    const whisker = s.node('whiskers', 'path');
    s.set(whisker, 'd', whiskers);
    s.set(whisker, 'fill', 'none');
    s.set(whisker, 'stroke', line.color);
    s.set(whisker, 'stroke-width', line.width);
    s.set(whisker, 'opacity', line.opacity);
    const b = s.node('boxes', 'path');
    s.set(b, 'd', boxes);
    s.set(b, 'fill', box.fill);
    s.set(b, 'fill-opacity', box.opacity);
    s.set(b, 'stroke', box.stroke);
    s.set(b, 'stroke-width', box.strokeWidth);
    s.set(b, 'stroke-linejoin', 'round');
    const m = s.node('medians', 'path');
    s.set(m, 'd', medians);
    s.set(m, 'fill', 'none');
    s.set(m, 'stroke', line.color);
    s.set(m, 'stroke-width', line.width * 1.5);
    s.set(m, 'opacity', line.opacity);
  }
}

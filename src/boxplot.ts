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
import { type BarLayout, type BarOptions, layoutBars } from './bars.ts';
import type { HitMode } from './hit.ts';
import type { PlatformNode } from './platform.ts';
import { type ShapeSet, SeriesRenderer, type SeriesRendererAttributes, type Spread, type SpreadView, paintBox } from './renderer.ts';
import type { Series } from './series.ts';
import type { Surface } from './surface.ts';

export interface BoxPathAttributes extends Omit<SeriesRendererAttributes, 'bind'>, Omit<BarOptions, 'baseline' | 'from'> {
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
  capFraction?: number;
}

const REACH = 2;
const clamp = (v: number) => (v < -REACH ? -REACH : v > 1 + REACH ? 1 + REACH : v);

export class BoxPath extends SeriesRenderer<BoxPathAttributes> {
  static override attrTypes = {
    ...SeriesRenderer.attrTypes,
    low: STRING,
    q1: STRING,
    median: STRING,
    q3: STRING,
    high: STRING,
    capFraction: NUMBER,
    width: NUMBER,
  } satisfies AttrTypesFor<BoxPathAttributes>;
  private get names() {
    const a = this.attrs;
    return { low: a.low ?? 'min', q1: a.q1 ?? 'q1', median: a.median, q3: a.q3 ?? 'q3', high: a.high ?? 'max' };
  }
  override get channelNames(): readonly string[] {
    const n = this.names;
    return [...new Set([n.low, n.q1, ...(n.median ? [n.median] : []), n.q3, n.high])];
  }
  /** Half the width of a box, in the gaps between points, which the domain axis leaves room for. */
  override get spans(): number {
    return (this.attrs.width ?? 0.8) / 2;
  }
  override get hitMode(): HitMode {
    return 'shape';
  }

  override spread(view: SpreadView): Spread | null {
    const n = this.names,
      lo = view.channelColumn(n.low),
      hi = view.channelColumn(n.high);
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < view.count; i++) {
      const a = view.raw[i * view.stride + lo]!,
        b = view.raw[i * view.stride + hi]!;
      if (Number.isFinite(a) && a < min) min = a;
      if (Number.isFinite(b) && b > max) max = b;
    }
    return min <= max ? { second: { min, max } } : null;
  }
  override limit(series: Series): Spread | null {
    const n = this.names,
      lo = series.data.channelExtent(n.low),
      hi = series.data.channelExtent(n.high);
    return lo && hi ? { second: { min: Math.min(lo.min, hi.min), max: Math.max(lo.max, hi.max) } } : null;
  }

  private box() {
    const a = this.attrs;
    return this.styleFor(
      ['seriesBox', 'shape'],
      { fill: a.fill, stroke: a.stroke, strokeWidth: a.strokeWidth, opacity: a.opacity },
      { fill: this.requireParent().accentColor, stroke: this.requireParent().accentColor },
    );
  }
  private line() {
    const a = this.attrs;
    return this.styleFor(['boxLine', 'line'], { color: a.stroke, width: a.strokeWidth }, { color: this.requireParent().accentColor });
  }
  override get swatch(): string {
    return this.box().fill;
  }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    paintBox(s, parent, key, width, height, this.box());
    const look = this.line(),
      m = s.node(`${key}/median`, 'path', { parent });
    s.set(m, 'd', `M0 ${height / 2}H${width}`);
    s.set(m, 'fill', 'none');
    s.set(m, 'stroke', look.color);
    s.set(m, 'stroke-width', look.width * 1.5);
  }

  #fractions: { projection: number; lay: BarLayout; v: Float64Array } | null = null;
  /** The bars' layout and the five values of each row (low, q1, median, q3, high) on the value axis, as fractions; made again only when the series has been projected again. */
  private fractions(): { projection: number; lay: BarLayout; v: Float64Array } | null {
    const series = this.requireParent(),
      d = series.drawn;
    if (!d) return null;
    if (this.#fractions && this.#fractions.projection === series.projection) return this.#fractions;
    const lay = layoutBars(series, this.attrs);
    if (!lay) return null;
    const names = this.names,
      n = lay.n,
      rs = d.stride;
    const col = (name: string) => d.columnOf(name);
    const cols = [col(names.low), col(names.q1), names.median ? col(names.median) : d.secondColumn, col(names.q3), col(names.high)];
    const v = new Float64Array(n * 5);
    for (let i = 0; i < n; i++) for (let k = 0; k < 5; k++) v[i * 5 + k] = d.raw[i * rs + cols[k]!]!;
    series.secondAxis.normalize(v, n * 5, 1, 0);
    return (this.#fractions = { projection: series.projection, lay, v });
  }

  #shapes: { projection: number; set: ShapeSet } | null = null;
  /** The boxes as rectangles in the plane's own terms (a hit is inside the box, or its distance is to it); made again only when the series has been projected again. */
  override shapes(): ShapeSet | null {
    const series = this.requireParent(),
      f = this.fractions();
    if (!f) return null;
    if (this.#shapes && this.#shapes.projection === series.projection) return this.#shapes.set;
    const { lay, v } = f,
      out = new Float64Array(lay.n * 4);
    for (let i = 0; i < lay.n; i++) {
      const x = lay.norm[3 * i]! + lay.shift,
        q1 = v[i * 5 + 1]!,
        q3 = v[i * 5 + 3]!;
      const bad = ![x, v[i * 5]!, q1, v[i * 5 + 2]!, q3, v[i * 5 + 4]!].every(Number.isFinite);
      out[4 * i] = bad ? NaN : x - lay.slot / 2;
      out[4 * i + 1] = bad ? NaN : x + lay.slot / 2;
      out[4 * i + 2] = bad ? NaN : clamp(q1);
      out[4 * i + 3] = bad ? NaN : clamp(q3);
    }
    const set = { data: out, count: lay.n };
    this.#shapes = { projection: series.projection, set };
    return set;
  }

  protected draw(): void {
    const s = this.surface,
      box = this.box(),
      line = this.line();
    let boxes = '',
      medians = '',
      whiskers = '';
    const f = this.fractions(),
      series = this.requireParent(),
      plane = series.drawn?.plane;
    if (f && plane) {
      // Every part is a run of moves along one axis, so the plane draws them: straight edges on a rectangle, arcs and spokes on a polar plane.
      const { lay, v } = f,
        cap = Math.max(0, this.attrs.capFraction ?? 0.5);
      const box: number[] = [],
        med: number[] = [],
        whisk: number[] = [];
      const gap = (a: number[]) => a.push(NaN, NaN);
      for (let i = 0; i < lay.n; i++) {
        const x = lay.norm[3 * i]! + lay.shift,
          x0 = x - lay.slot / 2,
          x1 = x0 + lay.slot;
        const lo = v[i * 5]!,
          q1 = v[i * 5 + 1]!,
          md = v[i * 5 + 2]!,
          q3 = v[i * 5 + 3]!,
          hi = v[i * 5 + 4]!;
        if (![x, lo, q1, md, q3, hi].every(Number.isFinite)) continue;
        box.push(x0, clamp(q1), x1, clamp(q1), x1, clamp(q3), x0, clamp(q3));
        gap(box);
        med.push(x0, clamp(md), x1, clamp(md));
        gap(med);
        whisk.push(x, clamp(q3), x, clamp(hi));
        gap(whisk);
        whisk.push(x, clamp(q1), x, clamp(lo));
        gap(whisk);
        if (cap > 0) {
          const c = (lay.slot * cap) / 2;
          whisk.push(x - c, clamp(hi), x + c, clamp(hi));
          gap(whisk);
          whisk.push(x - c, clamp(lo), x + c, clamp(lo));
          gap(whisk);
        }
      }
      const draw = (a: number[], closed: boolean) => plane.alignedPath(a, a.length / 2, series.firstAxis, series.secondAxis, closed);
      boxes = draw(box, true);
      medians = draw(med, false);
      whiskers = draw(whisk, false);
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

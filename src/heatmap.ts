/**
 * Heat maps: a rectangle for each point, coloured by a channel.
 *
 *   <XYSeries x="domain" y="value">
 *     <Density width={[5, 5]} by={['domain', 'value']}><ObjectDataSource source={rows} domain="x" value="y" /></Density>
 *     <HeatMap bind={{ fill: { axis: heat, channel: 'count' } }} />
 *   </XYSeries>
 *
 * Each point is the centre of a cell. The cell's size is `cellWidth` and `cellHeight` in data units, or else the
 * channels `width` and `height` (which is what `Density` gives each bin, so the pair work together); one of the two
 * attributes alone makes a square. A cell is drawn from its four corners, each placed by the plane: on a rectangle
 * that is a rectangle, on a polar plane a wedge with straight edges. Cells that look alike (the same step of the bound
 * colour) share a path, so the nodes drawn are bounded by `maxNodes` however many cells there are. A gap in a coordinate
 * or a size leaves out its cell. Cells are hit as shapes.
 *
 * Bind `fill` (a `ColorAxis` over a channel) to colour by data, and `opacity` to fade by it. Without a binding every cell
 * takes the series' colour.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import { fractionsOf, lookKey, lookValues, resolveBindings, stepsFor } from './bucket.ts';
import { f2 } from './geometry.ts';
import type { HitMode } from './hit.ts';
import {
  type PolygonSet,
  type ResolvedBinding,
  SeriesRenderer,
  type SeriesRendererAttributes,
  type Spread,
  type SpreadView,
  paintBox,
} from './renderer.ts';
import { EVENT_ATTACH, type ChartEvent } from './events.ts';
import type { Series } from './series.ts';
import type { PlatformNode } from './platform.ts';
import type { Surface } from './surface.ts';

export interface HeatMapBindable {
  fill: string;
  opacity: number;
}
export interface HeatMapAttributes extends SeriesRendererAttributes<HeatMapBindable> {
  /** The size of a cell along the first axis, in data units. Default: the `widthChannel`. */
  cellWidth?: number;
  /** The size along the second axis. Default: the `heightChannel`, or `cellWidth` when only that is given (square cells). */
  cellHeight?: number;
  /** The channel with each cell's width. Default 'width'. Not read when `cellWidth` is set. */
  widthChannel?: string;
  /** The channel with each cell's height. Default 'height'. Not read when a cell size attribute is set. */
  heightChannel?: string;
}

/** How far the normalised position may stray outside the axis before it is held there. */
const REACH = 2;
const clamp = (v: number) => (v < -REACH ? -REACH : v > 1 + REACH ? 1 + REACH : v);

interface Geometry {
  projection: number;
  n: number;
  data: Float64Array;
}

/** A grid of rectangles, one path for each colour step. */
export class HeatMap extends SeriesRenderer<HeatMapAttributes> {
  static override attrTypes = {
    ...SeriesRenderer.attrTypes,
    cellWidth: NUMBER,
    cellHeight: NUMBER,
    widthChannel: STRING,
    heightChannel: STRING,
  } satisfies AttrTypesFor<Omit<HeatMapAttributes, 'bind'>>;
  #keys = new Set<number>();
  #geometry: Geometry | null = null;

  /** Which channels give the cell size; null for a dimension that has a constant. */
  private get sizeChannels(): { w: string | null; h: string | null } {
    const a = this.attrs;
    const w = a.cellWidth === undefined ? (a.widthChannel ?? 'width') : null;
    const h = a.cellHeight !== undefined ? null : a.cellWidth !== undefined ? null : (a.heightChannel ?? 'height');
    return { w, h };
  }
  override get channelNames(): readonly string[] {
    const { w, h } = this.sizeChannels;
    return [...(w ? [w] : []), ...(h ? [h] : [])];
  }
  override get bindings(): readonly ResolvedBinding[] {
    return resolveBindings(this.attrs.bind, this, () => false);
  }
  override get stepsPerBinding(): number {
    return stepsFor(this.bindings, this.attrs.maxNodes ?? 1000);
  }
  /** The extents the cells reach: the axes leave room for the half of a cell that sticks out past its centre. */
  override spread(view: SpreadView): Spread | null {
    const a = this.attrs,
      { w: wc, h: hc } = this.sizeChannels;
    const wCol = wc ? view.channelColumn(wc) : -1,
      hCol = hc ? view.channelColumn(hc) : -1;
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (let i = 0; i < view.count; i++) {
      const row = i * view.stride,
        x = view.raw[row + view.firstColumn]!,
        y = view.raw[row + view.secondColumn]!;
      const w = wCol >= 0 ? view.raw[row + wCol]! : (a.cellWidth ?? NaN),
        h = hCol >= 0 ? view.raw[row + hCol]! : (a.cellHeight ?? a.cellWidth ?? NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
      if (x - w / 2 < x0) x0 = x - w / 2;
      if (x + w / 2 > x1) x1 = x + w / 2;
      if (y - h / 2 < y0) y0 = y - h / 2;
      if (y + h / 2 > y1) y1 = y + h / 2;
    }
    return x0 > x1 ? null : { first: { min: x0, max: x1 }, second: { min: y0, max: y1 } };
  }
  override limit(series: Series): Spread | null {
    const a = this.attrs,
      { w: wc, h: hc } = this.sizeChannels;
    const first = series.ownExtent('first'),
      second = series.ownExtent('second');
    const most = (name: string | null, fixed: number | undefined) => {
      if (!name) return fixed ?? NaN;
      const e = series.data.channelExtent(name);
      return e ? Math.max(Math.abs(e.min), Math.abs(e.max)) : NaN;
    };
    const w = most(wc, a.cellWidth),
      h = a.cellHeight === undefined && !hc ? w : most(hc, a.cellHeight);
    if (!first || !second || !Number.isFinite(w) || !Number.isFinite(h)) return null;
    return { first: { min: first.min - w / 2, max: first.max + w / 2 }, second: { min: second.min - h / 2, max: second.max + h / 2 } };
  }
  override get hitMode(): HitMode {
    return 'shape';
  }

  override onEvent(ev: ChartEvent): void {
    if (ev.type === EVENT_ATTACH) void this.stepsPerBinding;
    super.onEvent(ev);
  }

  private look() {
    const a = this.attrs;
    return this.styleFor(
      ['heatCell', 'shape'],
      { fill: a.fill, stroke: a.stroke, strokeWidth: a.strokeWidth, opacity: a.opacity },
      { fill: this.requireParent().accentColor },
    );
  }
  override get swatch(): string | null {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the `bind` attribute, typed here as the shape this element reads
    const bind = this.attrs.bind as Record<string, unknown> | undefined;
    return bind?.fill ? null : this.look().fill;
  }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const look = { ...this.look() };
    // oxlint-disable-next-line typescript/consistent-type-assertions -- bound properties are written by name
    for (const b of this.bindings) (look as Record<string, unknown>)[b.property] = b.axis.valueAt(0.5);
    paintBox(s, parent, key, width, height, look);
  }

  /** The four corners of every cell in plot pixels (clockwise from the low corner), NaN for a gap; made again only after a new projection. */
  private geometry(): Geometry | null {
    const series = this.requireParent(),
      d = series.drawn,
      plane = d?.plane;
    if (!d || !plane) return null;
    if (this.#geometry && this.#geometry.projection === series.projection) return this.#geometry;
    const n = d.points.count,
      rs = d.stride,
      base = rs - d.channels.length,
      a = this.attrs;
    const { w: wc, h: hc } = this.sizeChannels;
    const colOf = (name: string) => base + d.channels.indexOf(name);
    const wCol = wc ? colOf(wc) : -1,
      hCol = hc ? colOf(hc) : -1;
    const xs = new Float64Array(n * 2),
      ys = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = d.raw[i * rs + d.firstColumn]!,
        y = d.raw[i * rs + d.secondColumn]!;
      const w = wCol >= 0 ? d.raw[i * rs + wCol]! : (a.cellWidth ?? NaN);
      const h = hCol >= 0 ? d.raw[i * rs + hCol]! : (a.cellHeight ?? a.cellWidth ?? NaN);
      xs[2 * i] = x - w / 2;
      xs[2 * i + 1] = x + w / 2;
      ys[2 * i] = y - h / 2;
      ys[2 * i + 1] = y + h / 2;
    }
    series.firstAxis.normalize(xs, n * 2, 1, 0);
    series.secondAxis.normalize(ys, n * 2, 1, 0);
    const out = new Float64Array(n * 8);
    for (let i = 0; i < n; i++) {
      const x0 = xs[2 * i]!,
        x1 = xs[2 * i + 1]!,
        y0 = ys[2 * i]!,
        y1 = ys[2 * i + 1]!;
      const bad = !Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1);
      const k = i * 8;
      const put = (j: number, x: number, y: number) => {
        out[k + 2 * j] = bad ? NaN : clamp(x);
        out[k + 2 * j + 1] = bad ? NaN : clamp(y);
      };
      put(0, x0, y0);
      put(1, x1, y0);
      put(2, x1, y1);
      put(3, x0, y1);
    }
    plane.place({ data: out, stride: 2, count: n * 4 }, series.firstAxis, series.secondAxis);
    return (this.#geometry = { projection: series.projection, n, data: out });
  }

  override shapes(): PolygonSet | null {
    const g = this.geometry();
    return g ? { data: g.data, perShape: 4, count: g.n } : null;
  }

  protected draw(): void {
    const series = this.requireParent(),
      plane = series.plane,
      s = this.surface,
      counters = this.counters;
    const g = this.geometry(),
      d = series.drawn;
    const look = this.look();
    const t0 = performance.now();
    const w = plane.rect.width,
      h = plane.rect.height;
    const bindings = this.bindings,
      steps = this.stepsPerBinding;
    const styled =
      g && d
        ? bindings.map((b) => ({
            b,
            f: fractionsOf(b, d.raw, d.stride - d.channels.length + d.channels.indexOf(b.channel), d.stride, g.n),
          }))
        : [];
    const paths = new Map<number, string>();
    let bytes = 0;
    if (g) {
      const p = g.data;
      for (let i = 0; i < g.n; i++) {
        const k = i * 8;
        let lo = Infinity,
          hi = -Infinity,
          left = Infinity,
          right = -Infinity,
          ok = true;
        for (let j = 0; j < 4; j++) {
          const x = p[k + 2 * j]!,
            y = p[k + 2 * j + 1]!;
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            ok = false;
            break;
          }
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
        if (!ok || right < 0 || left > w || hi < 0 || lo > h) continue;
        const c = (j: number) => `${f2(p[k + 2 * j]!)} ${f2(p[k + 2 * j + 1]!)}`;
        const path = `M${c(0)}L${c(1)}L${c(2)}L${c(3)}Z`;
        bytes += path.length;
        const key = steps ? lookKey(styled, i, steps) : 0;
        paths.set(key, (paths.get(key) ?? '') + path);
      }
    }
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += bytes;

    for (const key of this.#keys) if (!paths.has(key)) s.remove(`c${key}`);
    this.#keys = new Set(paths.keys());
    const v: Record<string, string | number> = { fill: look.fill, opacity: look.opacity };
    for (const [key, path] of paths) {
      v.fill = look.fill;
      v.opacity = look.opacity;
      if (steps)
        lookValues(key, styled, steps, (property, value) => {
          v[property] = value;
        });
      const node = s.node(`c${key}`, 'path');
      s.set(node, 'd', path);
      s.set(node, 'fill', v.fill);
      s.set(node, 'fill-opacity', Math.round(v.opacity * 1000) / 1000);
      s.set(node, 'stroke', look.stroke);
      s.set(node, 'stroke-width', look.strokeWidth);
      if (!plane.curved) s.set(node, 'shape-rendering', 'crispEdges');
    }
  }
}

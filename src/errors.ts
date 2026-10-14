/**
 * Error bars and bands: how far each value may be from what was measured.
 *
 *   <DomainSeries>
 *     <ObjectDataSource source={rows} domain="t" value="mean" channels={{ sd: 'sd' }} />
 *     <LinePath><LinearCurve /></LinePath>
 *     <ErrorBars error="sd" />
 *   </DomainSeries>
 *
 * Both are renderers that take a **channel** of the data beside each point: `error` is how far above the value, and
 * `negativeError` how far below (left out, it is the same distance, so one channel gives a symmetric bar). `mode` says what
 * the number means: 'absolute' (the default: in the unit of the value) or 'relative' (a fraction of the value, so 0.1 is
 * plus or minus 10%). A gap in the value or in either error leaves that point without a bar.
 *
 * `ErrorBars` draws a whisker with a cap at each end; `ErrorBand` fills the region between the lower and upper ends, with
 * straight edges, which suits a dense series. They work on any plane (the whisker is a spoke on a polar one), sit on top of a
 * stack's layers (an error in the stack's unit; not with a 'normalize' stack, which has no unit) and on bars in a group,
 * and the axes leave room for them, so the range shows every bar. Neither is hit, and neither can be on a series with a
 * `Decimator` (channels cannot go through one).
 *
 * `along` is which way the error runs: 'value' (the default), or 'domain', which on an `XYSeries` is horizontal error
 * (the axis for x is fitted to it; on a `DomainSeries` the domain is settled first, so give that axis a range).
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import { barShift } from './bars.ts';
import type { Extent } from './geometry.ts';
import { f2 } from './geometry.ts';
import { SeriesRenderer, type SeriesRendererAttributes, type Spread, type SpreadView } from './renderer.ts';
import type { Series } from './series.ts';
import type { Surface } from './surface.ts';
import type { PlatformNode } from './platform.ts';

export interface ErrorAttributes extends Omit<SeriesRendererAttributes, 'bind'> {
  /** The channel with how far above the value each point may be. Required. */
  error: string;
  /** The channel with how far below. Default: the same as `error`. */
  negativeError?: string;
  /** What the numbers mean: units of the value (default), or a fraction of it. */
  mode?: 'absolute' | 'relative';
  /** Which way the error runs. Default 'value'. */
  along?: 'value' | 'domain';
}
export interface ErrorBarsAttributes extends ErrorAttributes {
  /** Width in pixels of the cap at each end of a whisker; 0 for none. Default 8. */
  capWidth?: number;
}
export interface ErrorBandAttributes extends ErrorAttributes {}

/** How far the normalised position may stray outside the axis before it is held there: only to keep the numbers sane, the clip does the rest. */
const REACH = 2;
/** The step along the cap's direction, as a fraction of its axis, used to find which way that is on the plane. */
const TANGENT = 1e-4;

/** The error of one row: above and below, as non-negative distances, or NaN where either is missing. */
function distances(view: SpreadView, i: number, error: string, negative: string, relative: boolean, value: number): [number, number] {
  const row = i * view.stride,
    up = view.raw[row + view.channelColumn(error)]!,
    down = view.raw[row + view.channelColumn(negative)]!;
  const k = relative ? Math.abs(value) : 1;
  return [Math.abs(up) * k, Math.abs(down) * k];
}

/** What error renderers share: the channels, the rows' spread, and the placed ends. */
abstract class ErrorRenderer<A extends ErrorAttributes> extends SeriesRenderer<A> {
  override get channelNames(): readonly string[] {
    const a = this.attrs;
    return a.negativeError && a.negativeError !== a.error ? [a.error, a.negativeError] : [a.error];
  }
  private get negative(): string {
    return this.attrs.negativeError ?? this.attrs.error;
  }

  override spread(view: SpreadView): Spread | null {
    const a = this.attrs,
      relative = a.mode === 'relative';
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < view.count; i++) {
      const row = i * view.stride,
        own = view.raw[row + (a.along === 'domain' ? view.firstColumn : view.secondColumn)]!;
      const at = view.top && a.along !== 'domain' ? view.top[i]! : own;
      const [up, down] = distances(view, i, a.error, this.negative, relative, view.raw[row + view.secondColumn]!);
      if (!Number.isFinite(at) || !Number.isFinite(up) || !Number.isFinite(down)) continue;
      if (at - down < lo) lo = at - down;
      if (at + up > hi) hi = at + up;
    }
    if (lo > hi) return null;
    return a.along === 'domain' ? { first: { min: lo, max: hi } } : { second: { min: lo, max: hi } };
  }

  override limit(series: Series): Spread | null {
    const a = this.attrs,
      relative = a.mode === 'relative',
      domain = a.along === 'domain';
    const own = series.ownExtent(domain ? 'first' : 'second'),
      up = series.data.channelExtent(a.error),
      down = series.data.channelExtent(this.negative);
    const values = series.ownExtent('second');
    if (!own || !up || !down || !values) return null;
    const most = Math.max(Math.abs(values.min), Math.abs(values.max)),
      k = relative ? most : 1;
    const e: Extent = {
      min: own.min - Math.max(Math.abs(down.min), Math.abs(down.max)) * k,
      max: own.max + Math.max(Math.abs(up.min), Math.abs(up.max)) * k,
    };
    return domain ? { first: e } : { second: e };
  }

  /**
   * The places in plot pixels of the lower end, the upper end, and a point a little further along the cap's direction from
   * each (which says which way the cap runs on this plane), for every row: `[lo, hi, loAlong, hiAlong]` of one row after another,
   * NaN for a row with no bar.
   */
  protected ends(series: Series): { n: number; pts: Float64Array } | null {
    const d = series.drawn;
    if (!d) return null;
    const a = this.attrs,
      relative = a.mode === 'relative',
      domain = a.along === 'domain',
      first = series.firstAxis,
      second = series.secondAxis;
    const n = d.points.count,
      rs = d.stride,
      bound = d.channels.length,
      base = rs - bound;
    const colError = base + d.channels.indexOf(a.error),
      colNeg = base + d.channels.indexOf(this.negative);
    const pts = new Float64Array(n * 8),
      held = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const row = i * rs,
        x = d.raw[row + d.firstColumn]!,
        own = d.raw[row + d.secondColumn]!;
      const centre = domain ? x : d.top ? d.top[i]! : own;
      const k = relative ? Math.abs(own) : 1,
        up = Math.abs(d.raw[row + colError]!) * k,
        down = Math.abs(d.raw[row + colNeg]!) * k;
      const bad =
        !Number.isFinite(centre) ||
        !Number.isFinite(up) ||
        !Number.isFinite(down) ||
        (domain ? !Number.isFinite(own) : !Number.isFinite(x));
      const lo = bad ? NaN : centre - down,
        hi = bad ? NaN : centre + up,
        k8 = i * 8;
      // A lower end at or below zero has no place on a log axis: it is held at the edge (below).
      if (!bad && lo <= 0 && centre > 0) held[i] = 1;
      // Four points, each as first coordinate then second.
      const put = (slot: number, f: number, sc: number) => {
        pts[k8 + slot * 2] = f;
        pts[k8 + slot * 2 + 1] = sc;
      };
      if (domain) {
        put(0, lo, own);
        put(1, hi, own);
        put(2, lo, own);
        put(3, hi, own);
      } else {
        put(0, x, lo);
        put(1, x, hi);
        put(2, x, lo);
        put(3, x, hi);
      }
    }
    first.normalize(pts, n * 4, 2, 0);
    second.normalize(pts, n * 4, 2, 1);
    const shift = domain ? 0 : barShift(series);
    const clamp = (v: number) => (v < -REACH ? -REACH : v > 1 + REACH ? 1 + REACH : v);
    for (let i = 0; i < n; i++) {
      for (const slot of [0, 2]) {
        const k = i * 8 + slot * 2 + (domain ? 0 : 1);
        if (held[i] && !Number.isFinite(pts[k]!)) pts[k] = -REACH;
      }
      for (let slot = 0; slot < 4; slot++) {
        const k = i * 8 + slot * 2;
        pts[k] = clamp(pts[k]!);
        pts[k + 1] = clamp(pts[k + 1]!);
        if (!domain) pts[k] = pts[k] + shift;
      }
      // The two along points step the cap's way: along the domain for a value error, along the value for a domain one.
      for (const slot of [2, 3]) {
        const k = i * 8 + slot * 2;
        if (domain) pts[k + 1] = pts[k + 1]! + TANGENT;
        else pts[k] = pts[k]! + TANGENT;
      }
    }
    d.plane.place({ data: pts, stride: 2, count: n * 4 }, first, second);
    return { n, pts };
  }
}

/** A whisker from the lower end to the upper, with a cap across each, as one path. */
export class ErrorBars extends ErrorRenderer<ErrorBarsAttributes> {
  static override attrTypes = {
    ...SeriesRenderer.attrTypes,
    error: STRING,
    negativeError: STRING,
    capWidth: NUMBER,
    mode: STRING,
    along: STRING,
  } satisfies AttrTypesFor<ErrorBarsAttributes>;

  /** Neutral by default (the theme's line colour), so that it can be seen on the bars it goes with. */
  private look() {
    const a = this.attrs;
    return this.styleFor(['errorBar', 'line'], { color: a.stroke, width: a.strokeWidth, opacity: a.opacity });
  }
  override get reach(): number {
    return (this.attrs.capWidth ?? 8) / 2;
  }

  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const look = this.look(),
      n = s.node(key, 'path', { parent }),
      x = width / 2,
      cap = Math.min(width, this.attrs.capWidth ?? 8) / 2;
    s.set(n, 'd', `M${x} 1V${height - 1}M${x - cap} 1H${x + cap}M${x - cap} ${height - 1}H${x + cap}`);
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', look.color);
    s.set(n, 'stroke-width', look.width);
    s.set(n, 'opacity', look.opacity);
  }

  protected draw(): void {
    const s = this.surface,
      series = this.requireParent(),
      look = this.look(),
      cap = (this.attrs.capWidth ?? 8) / 2;
    const e = this.ends(series);
    let d = '';
    if (e) {
      const p = e.pts;
      for (let i = 0; i < e.n; i++) {
        const k = i * 8,
          lx = p[k]!,
          ly = p[k + 1]!,
          hx = p[k + 2]!,
          hy = p[k + 3]!;
        if (!(Number.isFinite(lx) && Number.isFinite(ly) && Number.isFinite(hx) && Number.isFinite(hy))) continue;
        d += `M${f2(lx)} ${f2(ly)}L${f2(hx)} ${f2(hy)}`;
        if (cap > 0) {
          for (const [x, y, ax, ay] of [
            [lx, ly, p[k + 4]!, p[k + 5]!],
            [hx, hy, p[k + 6]!, p[k + 7]!],
          ] as const) {
            const tx = ax - x,
              ty = ay - y,
              len = Math.hypot(tx, ty);
            if (!(len > 0)) continue;
            const ux = (tx / len) * cap,
              uy = (ty / len) * cap;
            d += `M${f2(x - ux)} ${f2(y - uy)}L${f2(x + ux)} ${f2(y + uy)}`;
          }
        }
      }
    }
    const n = s.node('bars', 'path');
    s.set(n, 'd', d);
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', look.color);
    s.set(n, 'stroke-width', look.width);
    s.set(n, 'stroke-linecap', 'butt');
    s.set(n, 'opacity', look.opacity);
  }
}

/** The region between the lower and the upper ends, as one path; a gap splits it. */
export class ErrorBand extends ErrorRenderer<ErrorBandAttributes> {
  static override attrTypes = {
    ...SeriesRenderer.attrTypes,
    error: STRING,
    negativeError: STRING,
    mode: STRING,
    along: STRING,
  } satisfies AttrTypesFor<ErrorBandAttributes>;

  private look() {
    const a = this.attrs;
    return this.styleFor(
      ['errorBand', 'shape'],
      { fill: a.fill, stroke: a.stroke, strokeWidth: a.strokeWidth, opacity: a.opacity },
      { fill: this.requireParent().accentColor },
    );
  }
  override get swatch(): string {
    return this.look().fill;
  }
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const look = this.look(),
      n = s.node(key, 'path', { parent });
    s.set(n, 'd', `M0 ${height * 0.2}H${width}V${height * 0.8}H0Z`);
    s.set(n, 'fill', look.fill);
    s.set(n, 'fill-opacity', look.opacity);
    s.set(n, 'stroke', look.stroke);
    s.set(n, 'stroke-width', look.strokeWidth);
  }

  protected draw(): void {
    const s = this.surface,
      series = this.requireParent(),
      look = this.look();
    const e = this.ends(series);
    let d = '';
    if (e) {
      const p = e.pts,
        ok = (i: number) => {
          const k = i * 8;
          return Number.isFinite(p[k]!) && Number.isFinite(p[k + 1]!) && Number.isFinite(p[k + 2]!) && Number.isFinite(p[k + 3]!);
        };
      for (let i = 0; i < e.n;) {
        if (!ok(i)) {
          i++;
          continue;
        }
        let j = i;
        while (j < e.n && ok(j)) j++;
        // The run i..j-1: forward along the upper ends, back along the lower.
        d += `M${f2(p[i * 8 + 2]!)} ${f2(p[i * 8 + 3]!)}`;
        for (let r = i + 1; r < j; r++) d += `L${f2(p[r * 8 + 2]!)} ${f2(p[r * 8 + 3]!)}`;
        for (let r = j - 1; r >= i; r--) d += `L${f2(p[r * 8]!)} ${f2(p[r * 8 + 1]!)}`;
        d += 'Z';
        i = j;
      }
    }
    const n = s.node('band', 'path');
    s.set(n, 'd', d);
    s.set(n, 'fill', look.fill);
    s.set(n, 'fill-opacity', look.opacity);
    s.set(n, 'stroke', look.stroke);
    s.set(n, 'stroke-width', look.strokeWidth);
    s.set(n, 'stroke-linejoin', 'round');
  }
}

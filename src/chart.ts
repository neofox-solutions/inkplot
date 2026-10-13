/**
 * The chart: the root element. Owns the platform, schedules flushes and routes input to planes.
 *
 * One flush, in order (the layout pass the rest of the library is built around):
 *   1. Furniture (keys, titles: anything that is not a plane) is measured; those that name a `side` take a strip there.
 *   2. Planes are arranged into what is left. Arranging a plane is where it fits its axes and series, negotiates the
 *      plot rectangle with its axes' sizes, and projects the data (see Plane.fit and CartesianPlane).
 *   3. Furniture is arranged into its strip, now that the planes (and the mapped scales they fed) are settled.
 *   4. PAINT is broadcast and every element draws through its Surface.
 * Each flush re-runs all of it; Surface's write cache and the series' fill cache are what make that cheap.
 * Mapped dimensions (ColorAxis/SizeAxis) are children of the chart rather than a plane, so they use `flushCount` to
 * recognise a new pass and reset what they gathered from the planes.
 */
import { type AttrTypesFor, AUTO, STRING } from './attrs.ts';
import { writeAria } from './aria.ts';
import { type AnyElement, type BaseAttributes, ChartElement, fail } from './element.ts';
import { type ChartEvent, type ChartEventInit, EVENT_PAINT } from './events.ts';
import type { InputHost } from './input.ts';
import type { ChartTitle } from './furniture.ts';
import type { Cursor } from './cursor.ts';
import { type Insets, type LayoutRequest, type Rect, type Side } from './geometry.ts';
import type { ColorAxis, SizeAxis } from './mapped.ts';
import type { ColorKey, SizeKey } from './key.ts';
import type { Legend } from './legend.ts';
import type { ChartSummary } from './summary.ts';
import { Plane } from './plane.ts';
import type { BaseTheme } from './theme.ts';
import { type Platform, StringPlatform, type TextMeasurer, type Unsubscribe, estimateTextWidth } from './platform.ts';
import { type Counters, type StageName, newCounters } from './surface.ts';

/** Space between the plots and the furniture at their edges. */
const FURNITURE_GAP = 8;
/** Space between stacked bands, such as a title and its subtitle. */
const BAND_GAP = 2;

/** What one flush did and cost: the numbers the playground shows, and what tests assert caching against. */
export interface FlushStats {
  readonly total: number;
  readonly stages: Readonly<Record<StageName, number>>;
  readonly filled: number;
  readonly fillsCached: number;
  readonly projected: number;
  readonly attributeWrites: number;
  readonly attributeWritesSkipped: number;
  readonly attributesWritten: readonly string[];
  readonly pointsIn: number;
  readonly pointsDrawn: number;
  readonly pathBytes: number;
}

/**
 * A chart child that words what the chart shows, for a screen reader. The words are its own (so the core has none, and a
 * chart in another language supplies its own), and the chart uses them when `meta.description` says nothing.
 */
export interface Describer {
  describe(): { description: string; roleDescription?: string };
}
// oxlint-disable-next-line typescript/consistent-type-assertions -- a type guard: probing an element for an optional `describe`
const isDescriber = (e: AnyElement): e is AnyElement & Describer => typeof (e as Partial<Describer>).describe === 'function';

export interface ChartAttributes extends BaseAttributes {
  /** Every default look: required, so a chart bundles exactly the theme it names (`lightTheme`, `darkTheme`, or your own). */
  theme: BaseTheme;
  /** Width of the drawing. Default: whatever the platform reports, followed as it changes. */
  width?: number;
  /** Height of the drawing. Default: whatever the platform reports. When set on the chart it beats the size a platform reports, including the one given to `toSvgString`. */
  height?: number;
  /** Margin around everything, in pixels: one number for all sides, or any subset of the four. Default 10. */
  padding?: number | Partial<Insets>;
  /** Replaces the platform's text measurement, e.g. to match a font the platform cannot see. */
  measureText?: TextMeasurer;
  /**
   * A BCP 47 tag (`'de'`, `'fr-CA'`) for how numbers and dates are written: digit grouping, the decimal mark, month names.
   * Axes and time scales that have no `locale` of their own use it. Default: numbers as plain digits with a point, and the
   * runtime's own locale for dates. The words the library says (a summary, a tooltip's labels) are not translated by this; those
   * come from the components that say them, which take your words.
   */
  locale?: string;
  /** Called after every flush with its statistics. */
  onFlush?: (stats: FlushStats) => void;
}

/** Open for augmentation, like PlaneChildMap. */
export interface ChartChildMap {
  plane: Plane;
  title: ChartTitle;
  cursor: Cursor;
  colorAxis: ColorAxis;
  sizeAxis: SizeAxis;
  colorKey: ColorKey;
  sizeKey: SizeKey;
  legend: Legend;
  summary: ChartSummary;
}
export type ChartChildren = ChartChildMap[keyof ChartChildMap][];

/** The root: the only element that knows about the platform lifecycle (attach, flush, detach). */
export class Chart extends ChartElement<null, ChartChildren, ChartAttributes> {
  static override attrTypes = { ...ChartElement.attrTypes, measureText: AUTO, onFlush: AUTO, locale: STRING } satisfies AttrTypesFor<ChartAttributes>;
  override get chart(): Chart { return this; }
  #platform: Platform | null = null;
  #lastFlush: FlushStats | null = null;
  #needsFlush = false;
  #flushCount = 0;
  private readonly counts: Counters = newCounters();
  private unschedule: Unsubscribe | null = null;
  private readonly subscriptions: Unsubscribe[] = [];
  /** The input host, once something in the chart has asked for it (see `inputOf`): null on a chart nothing listens to. */
  input: InputHost | null = null;

  get platform(): Platform | null { return this.#platform; }
  get lastFlush(): FlushStats | null { return this.#lastFlush; }
  /** How many flushes have begun. Elements that belong to the chart rather than a plane use it to tell a new pass from the same one. */
  get flushCount(): number { return this.#flushCount; }
  /** True from any invalidation until the next flush. */
  get needsFlush(): boolean { return this.#needsFlush; }

  /** Construction has no side effects; this makes the chart live. */
  attach(platform: Platform): this {
    if (this.platform) fail('chart is already attached');
    this.#platform = platform;
    this.mount({ platform, counters: this.counts });
    const resize = platform.onResize?.(() => this.invalidate());
    if (resize) this.subscriptions.push(resize);
    this.invalidate();
    return this;
  }
  /** Undo `attach`: unsubscribe, take the nodes out of the platform. The tree is kept, so the chart can be attached again. */
  detach(): this {
    if (!this.platform) return this;
    this.unschedule?.();
    this.unschedule = null;
    for (const u of this.subscriptions.splice(0)) u();
    this.input?.stop();
    this.input = null;
    this.unmount(true);
    this.#platform = null;
    this.#needsFlush = false;
    return this;
  }

  /** The request has reached the root: note it, and on a scheduling platform arrange a flush. */
  override invalidate(): void {
    super.invalidate();
    const p = this.platform;
    if (!p) return;
    this.#needsFlush = true;
    if (p.schedule && !this.unschedule) {
      this.unschedule = p.schedule(() => { this.unschedule = null; this.flush(); });
    }
  }

  /** Put every axis of every plane back to the range its data asks for. */
  resetViews(): void { for (const c of this) if (c instanceof Plane) c.resetViews(); }

  /** Send an event through the tree from `root` (default the chart). For the input host, which lives outside this class. */
  deliver(init: ChartEventInit, root: AnyElement = this): ChartEvent { return this.broadcast(init, root); }

  /** Preference order: the chart's own, the platform's (real fonts), then a deliberately wide estimate. */
  get measureText(): TextMeasurer {
    return this.attrs.measureText ?? this.platform?.measureText ?? estimateTextWidth;
  }

  /** Run layout and paint now. The only way to render on a platform with no `schedule`. */
  flush(): FlushStats {
    const platform = this.platform;
    if (!platform) fail('chart is not attached');
    const t0 = performance.now();
    this.#flushCount++;
    const c = this.counts;
    // Reset in place: every Surface holds this object, so replacing it would orphan them.
    c.writes = c.skipped = c.filled = c.cached = c.projected = c.pointsIn = c.pointsDrawn = c.pathBytes = 0;
    c.names.clear();
    // oxlint-disable-next-line typescript/consistent-type-assertions -- `Object.keys` is `string[]`; these are the keys of `stages`
    for (const k of Object.keys(c.stages) as StageName[]) c.stages[k] = 0;

    const a = this.attrs, surface = this.surface;
    const size = platform.size();
    const width = a.width ?? size.width, height = a.height ?? size.height;
    const root = platform.root;
    surface.set(root, 'width', width);
    surface.set(root, 'height', height);
    surface.set(root, 'viewBox', `0 0 ${width} ${height}`);
    surface.set(root, 'font-family', this.styleFor(['text']).family);
    // The background is optional, so it is not a root: nearest `style` first, then the theme.
    const background = a.style?.chart?.background ?? a.theme.chart?.background;
    if (background) {
      const bg = surface.node('background', 'rect');
      surface.set(bg, 'width', width);
      surface.set(bg, 'height', height);
      surface.set(bg, 'fill', background);
    } else surface.remove('background');
    // Content area: the drawing minus the margin. Never below 1px so downstream divisions stay finite.
    const pad = typeof a.padding === 'number'
      ? { top: a.padding, right: a.padding, bottom: a.padding, left: a.padding }
      : { top: 10, right: 10, bottom: 10, left: 10, ...a.padding };
    const content: Rect = {
      x: pad.left, y: pad.top,
      width: Math.max(1, width - pad.left - pad.right),
      height: Math.max(1, height - pad.top - pad.bottom),
    };

    // Everything that is not a plane and asks for a side takes room along that edge, sized by what it asked for, and the
    // planes get what is left. Bands (titles, captions) span the edge and stack outwards from it, and come first; the
    // rest (keys) take a strip inside the bands, where several on one side stack along it.
    const furniture: { child: AnyElement; request: LayoutRequest; side: Side }[] = [];
    const bands: { child: AnyElement; request: LayoutRequest; side: Side }[] = [];
    const bandSize: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 };
    const strip: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const child of this) {
      if (child instanceof Plane || child.attrs.visible === false) continue;
      const request = this.measureChild(child, { width: content.width, height: content.height });
      const side = request.side;
      if (!side) continue;
      if (request.band) {
        bands.push({ child, request, side });
        bandSize[side] += request.min.height + (bandSize[side] ? BAND_GAP : 0);
        continue;
      }
      furniture.push({ child, request, side });
      const across = side === 'left' || side === 'right' ? request.min.width : request.min.height;
      strip[side] = Math.max(strip[side], across);
    }
    // What the bands leave. Everything below is laid out inside it.
    const bandGap = (side: Side) => (bandSize[side] ? FURNITURE_GAP : 0);
    const inner: Rect = {
      x: content.x,
      y: content.y + bandSize.top + bandGap('top'),
      width: content.width,
      height: Math.max(1, content.height - bandSize.top - bandSize.bottom - bandGap('top') - bandGap('bottom')),
    };
    const gap = (side: Side) => (strip[side] ? FURNITURE_GAP : 0);
    const plotArea: Rect = {
      x: inner.x + strip.left + gap('left'),
      y: inner.y + strip.top + gap('top'),
      width: Math.max(1, inner.width - strip.left - strip.right - gap('left') - gap('right')),
      height: Math.max(1, inner.height - strip.top - strip.bottom - gap('top') - gap('bottom')),
    };
    const edge: Record<'top' | 'bottom', number> = { top: content.y, bottom: content.y + content.height };
    for (const { child, request, side } of bands) {
      const height = request.min.height;
      if (side === 'top') { this.arrangeChild(child, { x: content.x, y: edge.top, width: content.width, height }); edge.top += height + BAND_GAP; }
      else { edge.bottom -= height; this.arrangeChild(child, { x: content.x, y: edge.bottom, width: content.width, height }); edge.bottom -= BAND_GAP; }
    }
    for (const child of this) if (child instanceof Plane) this.arrangeChild(child, plotArea);
    const along: Record<Side, number> = { top: inner.x, bottom: inner.x, left: inner.y, right: inner.y };
    for (const { child, request, side } of furniture) {
      const { width, height } = request.min;
      const vertical = side === 'left' || side === 'right';
      const rect: Rect = vertical
        ? { x: side === 'left' ? inner.x : inner.x + inner.width - strip.right, y: along[side], width: strip[side], height }
        : { x: along[side], y: side === 'top' ? inner.y : inner.y + inner.height - strip.bottom, width, height: strip[side] };
      this.arrangeChild(child, rect);
      along[side] += (vertical ? height : width) + FURNITURE_GAP;
    }
    // What a screen reader is told of the chart as a whole: `meta` first, then what a describer child makes of it, which needs the layout to have settled.
    let said: ReturnType<Describer['describe']> | undefined;
    for (const child of this) if (isDescriber(child) && child.attrs.visible !== false) { said = child.describe(); break; }
    writeAria(surface, root, a.meta, { role: 'group', ...(said && { description: said.description }) });
    if (said?.roleDescription !== undefined && !a.meta?.aria?.['aria-roledescription'] && !a.meta?.aria?.['roledescription']) {
      surface.set(root, 'aria-roledescription', said.roleDescription);
    }

    this.broadcast({ type: EVENT_PAINT });
    this.#needsFlush = false;

    const stats: FlushStats = {
      total: performance.now() - t0,
      stages: { ...c.stages },
      filled: c.filled,
      fillsCached: c.cached,
      projected: c.projected,
      attributeWrites: c.writes,
      attributeWritesSkipped: c.skipped,
      attributesWritten: [...c.names],
      pointsIn: c.pointsIn,
      pointsDrawn: c.pointsDrawn,
      pathBytes: c.pathBytes,
    };
    this.#lastFlush = stats;
    a.onFlush?.(stats);
    return stats;
  }
}

/** What `toSvgString` takes: a size for what the chart's own `width` and `height` leave open (else 640 x 400), and how to name the ids inside the picture. */
export interface SvgOptions {
  width?: number;
  height?: number;
  /**
   * Starts every `id` in the SVG (clip paths, gradients) and every `url(#…)` that points at one. Default: `ink` and eight hex digits of a
   * hash of the picture itself, so two different charts never share an id (a page that holds several SVGs has one namespace for ids) while the
   * same chart always gives the same text.
   */
  idPrefix?: string;
}

/** FNV-1a over the UTF-16 units of a string, as eight hex digits. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Rename every id in an SVG to `${prefix}-${n}`, n by first appearance, so the text does not depend on how many charts were drawn before. */
function scopeIds(svg: string, prefix: string | undefined): string {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
  const ids = [...new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!))];
  if (ids.length === 0) return svg;
  const number = new Map(ids.map((id, i) => [id, i + 1]));
  const swap = (text: string, head: string) => text.replace(/(\sid="|url\(#)([^")]+)/g, (whole, lead: string, id: string) => number.has(id) ? `${lead}${head}${number.get(id)}` : whole);
  return swap(svg, `${prefix ?? `ink${fnv(swap(svg, ''))}`}-`);
}

/** One-shot export: attach a StringPlatform, flush, detach. */
export function toSvgString(chart: Chart, options?: SvgOptions): string {
  const a = chart.attrs;
  const platform = new StringPlatform({ width: options?.width ?? a.width ?? 640, height: options?.height ?? a.height ?? 400 });
  // The chart's own width and height attributes beat the platform's size (see `layout`), so a size given here only matters for what they leave out.
  chart.attach(platform).flush();
  const svg = platform.toString();
  chart.detach();
  return scopeIds(svg, options?.idPrefix);
}

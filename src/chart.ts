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
 * Mapped dimensions (ColorAxis/ScalarAxis) are children of the chart rather than a plane, so they use `flushCount` to
 * recognise a new pass and reset what they gathered from the planes.
 */
import { type AttrTypesFor, AUTO, BOOLEAN, NUMBER, STRING } from './attrs.ts';
import { writeAria } from './aria.ts';
import { type AnyElement, type BaseAttributes, ChartElement, fail } from './element.ts';
import { type ChartEvent, type ChartEventInit, EVENT_PAINT } from './events.ts';
import type { InputHost } from './input.ts';
import type { ChartTitle } from './furniture.ts';
import type { Cursor } from './cursor.ts';
import { type Insets, type Rect } from './geometry.ts';
import type { ColorAxis, ScalarAxis } from './mapped.ts';
import type { ColorKey, SizeKey } from './key.ts';
import type { DataNode } from './data.ts';
import type { Pattern } from './pattern.ts';
import type { Legend } from './legend.ts';
import type { ChartSummary } from './summary.ts';
import type { Entrance } from './entrance.ts';
import type { ChartGroup } from './chartgroup.ts';
import { Container, isBody } from './container.ts';
import { Plane } from './plane.ts';
import type { BaseTheme } from './theme.ts';
import { type Platform, StringPlatform, type TextMeasurer, type Unsubscribe, estimateTextWidth } from './platform.ts';
import { type Counters, type StageName, newCounters } from './surface.ts';

/** What one flush did and cost: the numbers the playground shows, and what tests assert caching against. */
export interface FlushStats {
  /** The whole flush, in milliseconds. */
  readonly total: number;
  /** Milliseconds spent in each stage of the flush. */
  readonly stages: Readonly<Record<StageName, number>>;
  /** Series whose rows were read from their data afresh, a count. */
  readonly filled: number;
  /** Series whose rows from the last flush were still good and read again for nothing, a count. */
  readonly fillsCached: number;
  /** Series projected to plot positions afresh, a count. */
  readonly projected: number;
  /** Attributes written to the platform's nodes. */
  readonly attributeWrites: number;
  /** Attribute writes skipped because the node already had that value. */
  readonly attributeWritesSkipped: number;
  /** The names of the attributes written (`d`, `fill`, ...), one entry for each write. */
  readonly attributesWritten: readonly string[];
  /** Points in the data of the series that were read afresh (the source's own count, before any decimation). */
  readonly pointsIn: number;
  /** Points in the series that were projected afresh (after any decimation). */
  readonly pointsDrawn: number;
  /** Characters in the path data written, a measure of the weight of the drawing. */
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
  /**
   * 'rtl' lays the chart out for a right-to-left script: the first vertical axis is on the right, a horizontal axis runs from the
   * right, a legend or key is on the left and a title starts at the right. Text is drawn as it is (a label in Arabic or Hebrew is
   * set right to left by the browser whatever this says). Anything you place yourself (`orientation`, `inverted`, `side`) stays where
   * you put it. Default 'ltr'.
   */
  direction?: 'ltr' | 'rtl';
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
  /**
   * Ease the chart to a new drawing when its **data** changes, in the browser: colours, sizes and (in browsers that can morph a path,
   * Chrome and Firefox) the shapes of lines, areas and bars move over `duration` milliseconds (default 250) with a CSS `easing`
   * (default `'ease-out'`). Off by default. Only a change to the data eases: panning, zooming, resizing and the cursor are
   * immediate, and an interaction during a transition ends it. A shape morphs only if it keeps its structure, so a different
   * number of points or bars snaps. Switched off by `prefers-reduced-motion`. Nothing in an exported SVG changes.
   *
   * It also eases the changes of view that jump on purpose (a box zoom, a double-click that puts an axis back, `PanZoom.reset()`, and
   * `moveView`), over the same time and easing, unless `views` is false. A drag, wheel turn or pinch follows the hand and never eases.
   *
   * What plays when the chart is first drawn is not this option but the `Entrance` element: add one as a child of the chart.
   */
  transition?: { duration?: number; easing?: string; views?: boolean };
  /** Called after every flush with its statistics. */
  onFlush?: (stats: FlushStats) => void;
}

/** Open for augmentation, like PlaneChildMap. */
export interface ChartChildMap {
  plane: Plane;
  title: ChartTitle;
  cursor: Cursor;
  colorAxis: ColorAxis;
  scalarAxis: ScalarAxis;
  colorKey: ColorKey;
  sizeKey: SizeKey;
  legend: Legend;
  summary: ChartSummary;
  entrance: Entrance;
  pattern: Pattern;
  /** Data for the stages of the plot to link to (`LinkedData`): nothing draws it. */
  data: DataNode;
  group: ChartGroup;
}
export type ChartChildren = ChartChildMap[keyof ChartChildMap][];

/** The root: the only element that knows about the platform lifecycle (attach, flush, detach). */
export class Chart extends Container<null, ChartChildren, ChartAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    measureText: AUTO,
    onFlush: AUTO,
    transition: { duration: NUMBER, easing: STRING, views: BOOLEAN },
    locale: STRING,
    direction: STRING,
  } satisfies AttrTypesFor<ChartAttributes>;
  override get chart(): Chart {
    return this;
  }
  /** Whether the chart is laid out right to left (`direction`). */
  get rtl(): boolean {
    return this.attrs.direction === 'rtl';
  }
  #platform: Platform | null = null;
  #lastFlush: FlushStats | null = null;
  #needsFlush = false;
  #dataChanged = false;
  #flushCount = 0;
  #holds = 0;
  readonly #watched = new Set<() => boolean>();
  readonly #idlers: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  private readonly counts: Counters = newCounters();
  private unschedule: Unsubscribe | null = null;
  private readonly subscriptions: Unsubscribe[] = [];
  /** The input host, once something in the chart has asked for it (see `inputOf`): null on a chart nothing listens to. */
  input: InputHost | null = null;

  get platform(): Platform | null {
    return this.#platform;
  }
  get lastFlush(): FlushStats | null {
    return this.#lastFlush;
  }
  /** How many flushes have begun. Elements that belong to the chart rather than a plane use it to tell a new pass from the same one. */
  get flushCount(): number {
    return this.#flushCount;
  }
  /** True from any invalidation until the next flush. */
  get needsFlush(): boolean {
    return this.#needsFlush;
  }

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
    // Whoever is waiting for the chart to be idle looks again once the change that caused this has finished.
    if (this.#idlers.length) void Promise.resolve().then(() => this.#settle());
    if (p.schedule && !this.unschedule) {
      this.unschedule = p.schedule(() => {
        this.unschedule = null;
        this.flush();
      });
    }
  }

  /**
   * Data that has not arrived yet (a worker's) says so, so the entrance waits for it and plays when there is something to enter.
   * Returns the function that says it has arrived; calling it again does nothing.
   */
  holdEntrance(): () => void {
    this.#holds++;
    let held = true;
    return () => {
      if (held) this.#holds--;
      held = false;
    };
  }
  /** True while data that was promised has not arrived (see `holdEntrance`). */
  get awaitingData(): boolean {
    return this.#holds > 0;
  }

  /**
   * Say that data is on its way: `pending()` is true while something has been asked for and has not come back (a worker's
   * answer). `idle()` waits on the ones it is told of. Returns the function that stops telling.
   */
  watchData(pending: () => boolean): () => void {
    this.#watched.add(pending);
    return () => void this.#watched.delete(pending);
  }
  /**
   * Resolves when the chart has nothing more to draw and nothing on its way: it flushes what is waiting, and waits for the
   * data stages that run elsewhere (see `WorkerBoundary`) to answer and for the flush that follows each answer. For tests,
   * and for exporting a chart whose data is computed in a worker. Rejects if a flush throws.
   */
  idle(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#idlers.push({ resolve, reject });
      this.#settle();
    });
  }
  #settle(): void {
    if (this.#idlers.length === 0) return;
    try {
      if (this.platform && this.#needsFlush) this.flush();
      for (const pending of this.#watched) if (pending()) return;
    } catch (e) {
      for (const i of this.#idlers.splice(0)) i.reject(e);
      return;
    }
    if (this.platform && this.#needsFlush) return;
    for (const i of this.#idlers.splice(0)) i.resolve();
  }

  /** A data node changed: the next flush is the kind that may ease (see `transition`). Called by the data stages, not by apps. */
  noteDataChange(): void {
    this.#dataChanged = true;
  }

  /** Put every axis of every plane back to the range its data asks for. */
  resetViews(): void {
    for (const p of this.planes) p.resetViews();
  }

  /** Send an event through the tree from `root` (default the chart). For the input host, which lives outside this class. */
  deliver(init: ChartEventInit, root: AnyElement = this): ChartEvent {
    return this.broadcast(init, root);
  }

  /** Preference order: the chart's own, the platform's (real fonts), then a deliberately wide estimate. */
  get measureText(): TextMeasurer {
    return this.attrs.measureText ?? this.platform?.measureText ?? estimateTextWidth;
  }

  /** Run layout and paint now. The only way to render on a platform with no `schedule`. */
  flush(): FlushStats {
    const platform = this.platform;
    if (!platform) fail('chart is not attached');
    // A flush asked for by hand (in an animation frame of the app's own, say) makes the one that was waiting for the next frame pointless.
    this.unschedule?.();
    this.unschedule = null;
    const t0 = performance.now();
    this.#flushCount++;
    const c = this.counts;
    // Reset in place: every Surface holds this object, so replacing it would orphan them.
    c.writes = c.skipped = c.filled = c.cached = c.projected = c.pointsIn = c.pointsDrawn = c.pathBytes = 0;
    c.names.clear();
    // oxlint-disable-next-line typescript/consistent-type-assertions -- `Object.keys` is `string[]`; these are the keys of `stages`
    for (const k of Object.keys(c.stages) as StageName[]) c.stages[k] = 0;

    const a = this.attrs,
      surface = this.surface;
    // Only a flush that follows a change to the data eases, and not the first (nothing is there to move from).
    const eased = a.transition && this.#dataChanged && this.#flushCount > 1;
    this.#dataChanged = false;
    const spec = { duration: a.transition?.duration ?? 250, easing: a.transition?.easing ?? 'ease-out' };
    platform.setTransition?.(eased ? spec : null);
    const size = platform.size();
    const width = a.width ?? size.width,
      height = a.height ?? size.height;
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
    const pad =
      typeof a.padding === 'number'
        ? { top: a.padding, right: a.padding, bottom: a.padding, left: a.padding }
        : { top: 10, right: 10, bottom: 10, left: 10, ...a.padding };
    const content: Rect = {
      x: pad.left,
      y: pad.top,
      width: Math.max(1, width - pad.left - pad.right),
      height: Math.max(1, height - pad.top - pad.bottom),
    };

    let bodies = 0;
    for (let c = this.firstChild; c; c = c.nextSibling) if (isBody(c)) bodies++;
    if (bodies > 1) fail('a chart has one plane or group: put several in a ChartGroup');
    this.layOutFurniture(content, (area) => {
      for (let child = this.firstChild; child; child = child.nextSibling) if (isBody(child)) this.arrangeChild(child, area);
    });
    // What a screen reader is told of the chart as a whole: `meta` first, then what a describer child makes of it, which needs the layout to have settled.
    let said: ReturnType<Describer['describe']> | undefined;
    for (let child = this.firstChild; child; child = child.nextSibling)
      if (isDescriber(child) && child.attrs.visible !== false) {
        said = child.describe();
        break;
      }
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
  const swap = (text: string, head: string) =>
    text.replace(/(\sid="|url\(#)([^")]+)/g, (whole, lead: string, id: string) =>
      number.has(id) ? `${lead}${head}${number.get(id)}` : whole,
    );
  return swap(svg, `${prefix ?? `ink${fnv(swap(svg, ''))}`}-`);
}

/** One-shot export: attach a StringPlatform, flush, detach. */
export function toSvgString(chart: Chart, options?: SvgOptions): string {
  const a = chart.attrs;
  const platform = new StringPlatform({ width: options?.width ?? a.width ?? 640, height: options?.height ?? a.height ?? 400 });
  // The chart's own width and height attributes beat the platform's size (see `layout`), so a size given here only matters for what they leave out.
  chart.attach(platform);
  let svg: string;
  try {
    chart.flush();
    svg = platform.toString();
  } finally {
    // Whatever the flush did, leave the chart as it was found: left attached, the next call would fail with "already attached"
    // and hide the error that was the real problem.
    chart.detach();
  }
  return scopeIds(svg, options?.idPrefix);
}

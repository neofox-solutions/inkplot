
/* oxlint-disable typescript/consistent-type-assertions -- theme bags are open maps merged by key at runtime; the result is typed as the schema it was checked against */
/**
 * Themes: every default look in one place, and the rule for choosing between them.
 *
 * Why a stylesheet and not flat options: a chart has dozens of things that can be styled (tick labels, titles, gridlines,
 * markers…) and new elements add more. A theme maps *selectors* (names for kinds of thing) to bags of style properties,
 * so a new element needs a new name and no change here, and a user can restyle a whole family at once (`text`) or one
 * member (`tickLabel`).
 *
 * How a look is decided
 * ─────────────────────
 * An element asks for its look with a *chain* of selectors, most specific first, ending in a *root*:
 *
 *     this.styleFor(['tickLabel', 'axis', 'text'])        // → every text property, all defined
 *
 * Each property is found independently, by the first of these that defines it:
 *   1. The element's own attributes (`local`): the common ones, such as `stroke` or `fill`, which are exactly the
 *      style properties of the same name.
 *   2. The `style` blocks of the element and then each ancestor up to the chart: nearest first. Inside one block the
 *      chain is tried in order, so `tickLabel` beats `axis` beats `text`.
 *   3. The chart's base theme, the same way, except that the element's *accent* (the colour its series was given from the
 *      palette) is tried just before the root. So the palette is the default colour, and anything that names the colour
 *      beats it.
 *
 * Nearest-first means a block you write close to an element wins over the whole of the base theme, however specific the
 * base theme's selector was: `plane.style = { text: { color: 'red' } }` really does make that plane's text red. The
 * price is that to override one specific selector against a nearer general one, set the specific one at that level too.
 *
 * Why the types hold together: the base theme must define every property of every root (`Roots`), and a chain must end
 * in a root, so there is always a value to find and `styleFor` can be typed as returning all of them. Both interfaces
 * below can be augmented, which is how a custom element joins in:
 *
 *     declare module 'inkplot' { interface Selectors { boxLabel: TextProps } }
 *     // in the element:  this.styleFor(['boxLabel', 'text'])
 */

/**
 * The look of text. `halo` is a colour drawn round the glyphs to keep them legible over data, `haloWidth` its total width.
 * `align` is where text sits in the room it has: a title along its band, the lines of a callout in its box, a line
 * annotation's label along its line. Text that is placed at a point by its own geometry (tick labels) ignores it.
 */
export interface TextProps { size: number; color: string; family: string; weight: number | string; halo: string; haloWidth: number; align: 'start' | 'middle' | 'end' }
/** The look of a stroked line. `dash` is an SVG dash pattern, or 'none'. */
export interface LineProps { color: string; width: number; dash: string; opacity: number }
/** The look of a filled shape. `stroke` may be 'none'. */
export interface ShapeProps { fill: string; stroke: string; strokeWidth: number; opacity: number }
/** Room an axis takes, in pixels: tick length, gap between ticks and labels, and padding round the title and after the axis. */
export interface AxisMetrics { tickLength: number; labelGap: number; spacing: number }
/** Half the width of a marker in pixels. */
export interface MarkerMetrics { size: number }
/**
 * What a callout is made of, besides how it looks. `outline` is which of the box's edges are drawn: 'box' all four,
 * 'edge' only the one the arm meets, 'none' none (the fill, if any, stays). `offset` is how far an automatically placed
 * box sits from its point, `padding` the room round the text inside it, and `pointer` the radius of the dot on the point.
 */
export interface CalloutMetrics { padding: number; outline: 'box' | 'edge' | 'none'; offset: number; pointer: number }

/**
 * The selectors, and the properties each can set. `axis` and `key` carry a colour that flows to both their text and
 * their lines, so one setting colours a whole axis. Augment to add your own.
 */
export interface Selectors {
  // Roots: complete in the base theme.
  text: TextProps;
  line: LineProps;
  shape: ShapeProps;
  axis: Partial<AxisMetrics & TextProps & LineProps>;
  marker: Partial<MarkerMetrics & ShapeProps>;
  callout: Partial<CalloutMetrics>;
  /** The chart itself. `background` is a colour for a rect filling the whole drawing; unset (the default) paints nothing. */
  chart: { background?: string };
  /** A tooltip's metrics: what it leaves unsaid it takes from `callout`. */
  tooltip: Partial<CalloutMetrics>;
  // Text
  tickLabel: TextProps;
  axisTitle: TextProps;
  chartTitle: TextProps;
  chartSubtitle: TextProps;
  chartCaption: TextProps;
  annotationLabel: TextProps;
  calloutText: TextProps;
  tooltipText: TextProps;
  key: Partial<TextProps & LineProps>;
  keyTitle: TextProps;
  keyLabel: TextProps;
  legend: Partial<TextProps>;
  legendTitle: TextProps;
  legendLabel: TextProps;
  // Lines
  axisLine: LineProps;
  gridline: LineProps;
  frame: LineProps;
  /** The guide lines of a crosshair. */
  crosshair: LineProps;
  /** The outline round what has keyboard focus. */
  focusRing: LineProps;
  keyLine: LineProps;
  seriesLine: LineProps;
  annotationLine: LineProps;
  /** The whiskers and caps of an `ErrorBars`. */
  errorBar: LineProps;
  /** The median, whiskers and caps of a `BoxPath`. */
  boxLine: LineProps;
  calloutArm: LineProps;
  // Shapes
  /** The box a `BoxZoom` drags out, and the one a `Brush` leaves. */
  selection: ShapeProps;
  seriesArea: ShapeProps;
  /** The region of an `ErrorBand`. */
  errorBand: ShapeProps;
  /** The box of a `BoxPath`. */
  seriesBox: ShapeProps;
  seriesBar: ShapeProps;
  /** The cells of a `HeatMap`. */
  heatCell: ShapeProps;
  calloutBox: ShapeProps;
  tooltipBox: ShapeProps;
  dotMarker: Partial<MarkerMetrics & ShapeProps>;
  lineMarker: Partial<MarkerMetrics & ShapeProps>;
  shapeMarker: Partial<MarkerMetrics & ShapeProps>;
}
/** The selectors every chain ends in. The base theme defines all of their properties. Augment together with `Selectors`. */
export interface Roots {
  text: TextProps;
  line: LineProps;
  shape: ShapeProps;
  axis: AxisMetrics;
  marker: MarkerMetrics;
  callout: CalloutMetrics;
}

export type SelectorName = keyof Selectors;
/** Selectors to style, each with only the properties it wants to change. */
export type Theme = { [S in keyof Selectors]?: Partial<Selectors[S]> };
/** A complete theme: every root fully defined, and the colours series take in turn. */
export type BaseTheme = Theme & { [R in keyof Roots]: Roots[R] } & { palette: readonly string[] };

/**
 * Finds each property of the chain's root. `scopes` run from the nearest `style` block outwards; `base` is last.
 * Pure, so it can be tested without a chart.
 */
export function resolveStyle<R extends keyof Roots>(
  chain: readonly [...SelectorName[], R],
  scopes: readonly (Theme | undefined)[],
  base: BaseTheme,
  local?: Partial<Roots[R]>,
  accent?: Partial<Roots[R]>,
): Roots[R] {
  type Bags = Record<string, Record<string, unknown> | undefined>;
  // The chain's names and the theme's blocks are typed by selector; here they are looked up by string.
  const root = chain[chain.length - 1] as string, names = chain as readonly string[], blocks = base as unknown as Bags;
  const out: Record<string, unknown> = {};
  const loc = local as Record<string, unknown> | undefined, acc = accent as Record<string, unknown> | undefined;
  // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
  for (const key of Object.keys(blocks[root]!)) {
    let v = loc?.[key];
    for (let s = 0; v === undefined && s < scopes.length; s++) {
      const scope = scopes[s] as Bags | undefined;
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      if (scope) for (let c = 0; v === undefined && c < names.length; c++) v = scope[names[c]!]?.[key];
    }
    for (let c = 0; v === undefined && c < names.length; c++) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      const sel = names[c]!;
      if (sel === root) v = acc?.[key];
      v ??= blocks[sel]?.[key];
    }
    out[key] = v;
  }
  return out as unknown as Roots[R];
}

/** A theme derived from another: each selector in `patch` is merged over the same one in `base`, property by property. */
export function extendTheme<B extends BaseTheme>(base: B, patch: Theme & { palette?: readonly string[] }): B {
  const out: Record<string, unknown> = { ...base };
  for (const [selector, props] of Object.entries(patch)) {
    out[selector] = selector === 'palette' ? props : { ...(base as Record<string, object | undefined>)[selector], ...props };
  }
  return out as B;
}

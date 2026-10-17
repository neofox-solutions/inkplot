/**
 * A dimension: a scale plus the range it covers, the view into it, and how it fits data.
 *
 * How a range gets decided (the "fit protocol"), because several elements take part:
 *   1. The plane calls `begin()` on each dimension to forget last layout's data.
 *   2. Each series `contribute()`s the extent it will draw (for the value axis, only the part inside the view).
 *   3. The plane calls `resolve()`, which fixes the range once: a pan/zoom `view` wins, otherwise `fit()` applies the
 *      attributes (`min`/`max`/`include`/`padding`/`nice`) to what was contributed.
 * After `resolve()` further contributions are ignored, which is what lets a series' domain window depend on the domain
 * dimension's resolved range while still being allowed to contribute to the value dimension afterwards.
 */
import { type AttrTypesFor, AUTO, NUMBER, STRING } from './attrs.ts';
import { type AnyElement, type BaseAttributes, ChartElement, fail } from './element.ts';
import type { Extent } from './geometry.ts';
import { Scale } from './scale.ts';

/** One mark on an axis: where (`value`), what it says, and whether it is a labelled tick or a minor one. */
export interface Tick {
  value: number;
  label: string;
  major: boolean;
}

export interface DimensionAttributes extends BaseAttributes {
  /** Fix an end of the range. Beats everything else, including `nice`. */
  min?: number;
  /** Fix the top end of the range. Beats everything else, including `nice`. */
  max?: number;
  /** Values the range must cover, e.g. `[0]` to anchor a bar-like axis at zero. */
  include?: readonly number[];
  /** Extra room at both ends as a fraction of the data's span. */
  padding?: number;
  /** Round the ends outwards to tidy tick values. Recommended with a RadarPlane, whose spokes come from the ticks. */
  nice?: boolean;
  /** Run from max to min along the axis. */
  inverted?: boolean;
  /** The axis title (or, on a `ColorAxis` or `ScalarAxis`, the default title of its key). Default: none. */
  title?: string;
  /** Ask for about this many ticks, whatever the length. */
  tickCount?: number;
  /** Put ticks exactly here (those inside the range are drawn), or at whatever a function of the range returns. Beats `tickStep` and `tickCount`. */
  ticks?: readonly number[] | ((range: Readonly<Extent>) => readonly number[]);
  /** Put ticks at every multiple of this step. Beats `tickCount`. */
  tickStep?: number;
  /** Turns a tick's number into its label, e.g. (v) => `${v}%`. Default: plain digits, grouped by `locale` if one is set. */
  format?: (value: number) => string;
  /** A BCP 47 tag for how this writes its numbers (grouping and decimal mark). Default: the chart's `locale`, else plain digits. A `format` beats it. */
  locale?: string;
  /** Called when the view (what pan, zoom or a reset has set) changes: the new range, or null when it is back to the natural one. */
  onViewChange?: (view: Readonly<Extent> | null) => void;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
/** A cached `Intl.NumberFormat`: tick labels are made often, and building one is the slow part. */
function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(options);
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, f);
  }
  return f;
}

/** Anything that turns a data range into 0..1. Its one child is the scale that does the turning. */
export abstract class Dimension<
  Parent extends AnyElement = AnyElement,
  A extends DimensionAttributes = DimensionAttributes,
  Kids extends AnyElement[] = [scale: Scale],
> extends ChartElement<Parent, Kids, A> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    title: STRING,
    tickCount: NUMBER,
    tickStep: NUMBER,
    locale: STRING,
    onViewChange: AUTO,
  } satisfies AttrTypesFor<DimensionAttributes>;

  #range: Extent = { min: 0, max: 1 };
  private lo = Infinity;
  private hi = -Infinity;
  private resolved = false;
  private view: Extent | null = null;
  // The most room in pixels any series asks beyond the ends of its data (a marker's radius), and the axis' length to turn it into data.
  private reachLo = 0;
  private reachHi = 0;
  protected lengthPx = 0;
  /** Scratch for `fractionOf`, so a single-value lookup (called per tick) allocates nothing. */
  private readonly tmp = new Float64Array(1);

  /** The resolved range after the last layout: the view if one is set, otherwise the natural range. */
  get range(): Readonly<Extent> {
    return this.#range;
  }
  /** True while a view range overrides the natural one. */
  get isZoomed(): boolean {
    return this.view !== null;
  }
  /** The range pan/zoom has set, which takes effect at the next layout (`range` still holds the last one until then). */
  get viewRange(): Readonly<Extent> | null {
    return this.view;
  }

  get scale(): Scale {
    const first = this.firstChild;
    if (first instanceof Scale) return first;
    return fail(
      first
        ? `${this.constructor.name}: child 0 should be Scale, but is ${first.constructor.name}`
        : `${this.constructor.name}: has no child 0 (it needs Scale)`,
    );
  }

  // ─── Engine protocol: a plane and its series negotiate the range through these. ───

  /**
   * Start a layout pass: forget last pass's contributions. `lengthInPixels` is how long the dimension is expected to be
   * drawn, which is what turns a reach in pixels into data; 0 (the default) where that is not meaningful.
   */
  begin(lengthInPixels = 0): void {
    this.lo = Infinity;
    this.hi = -Infinity;
    this.resolved = false;
    this.reachLo = this.reachHi = 0;
    this.lengthPx = lengthInPixels;
  }
  /** A series asks for room of `pixels` past the ends of its data, so that marks centred on them are not cut by the plot. Ignored once resolved. */
  reach(pixels: number, ends: 'both' | 'lo' | 'hi' = 'both'): void {
    if (this.resolved) return;
    if (ends !== 'hi' && pixels > this.reachLo) this.reachLo = pixels;
    if (ends !== 'lo' && pixels > this.reachHi) this.reachHi = pixels;
  }
  /** A series reports the extent it will draw. Ignored once the range is resolved. */
  contribute(min: number, max: number): void {
    if (this.resolved) return;
    if (min < this.lo) this.lo = min;
    if (max > this.hi) this.hi = max;
  }
  /** Fix the range for this pass. Does nothing if it is already fixed. */
  resolve(): void {
    if (this.resolved) return;
    this.resolved = true;
    this.#range = this.view ?? this.fit(this.lo, this.hi);
  }

  /**
   * The range these data extents ask for once the attributes have had their say: `include`, `padding`, fixed
   * `min` and `max`, what the scale can represent, and tidy ends. With nothing to fit it is 0 to 1.
   */
  fit(lo: number, hi: number): Extent {
    const a = this.attrs,
      scale = this.scale;
    for (const v of a.include ?? []) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // Nothing contributed (no data yet): a unit range keeps every downstream division finite.
    if (!(lo <= hi)) {
      lo = 0;
      hi = 1;
    }
    const span = hi - lo;
    if (a.padding && span > 0) {
      lo -= span * a.padding;
      hi += span * a.padding;
    }
    let r: Extent = { min: a.min ?? lo, max: a.max ?? hi };
    // A flat line has zero span; open it up so the scale has something to divide by.
    if (r.min === r.max) {
      const d = r.min === 0 ? 1 : Math.abs(r.min) * 0.1;
      r = { min: r.min - d, max: r.max + d };
    }
    r = scale.constrain(r);
    // Room for what reaches past the ends of the data: the same number of pixels at each end, in the scale's own terms.
    // An end the attributes fixed is left where it was put.
    const mLo = this.reachLo,
      mHi = this.reachHi,
      L = this.lengthPx;
    if (mLo + mHi > 0 && L > mLo + mHi + 1 && (a.min === undefined || a.max === undefined)) {
      const room = L - mLo - mHi,
        lo2 = scale.denormalize(-mLo / room, r),
        hi2 = scale.denormalize(1 + mHi / room, r);
      r = scale.constrain({ min: a.min ?? (Number.isFinite(lo2) ? lo2 : r.min), max: a.max ?? (Number.isFinite(hi2) ? hi2 : r.max) });
    }
    if (a.nice) {
      const n = scale.nice(r);
      r = { min: a.min ?? n.min, max: a.max ?? n.max };
    }
    return r;
  }

  /** Temporary range override (pan/zoom). `null` returns to the attribute-driven range. */
  setViewRange(range: Extent | null): void {
    const old = this.view;
    if (old === range || (old && range && old.min === range.min && old.max === range.max)) return;
    this.view = range;
    this.invalidate();
    this.attrs.onViewChange?.(range);
  }

  /** Whether the axis runs the other way because the chart reads right to left (set by an axis the plane has put on a horizontal side). */
  protected mirrored = false;
  /** Whether the axis runs from its high end: `inverted` if it says, else the way the chart reads. */
  get flipped(): boolean {
    return this.attrs.inverted ?? this.mirrored;
  }
  /** In place over an interleaved buffer (the hot path), applying `inverted` after the scale. */
  normalize(buffer: Float64Array, count: number, stride: number, offset: number): void {
    this.scale.normalize(buffer, count, stride, offset, this.range);
    if (this.flipped) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      for (let k = 0, i = offset; k < count; k++, i += stride) buffer[i] = 1 - buffer[i]!;
    }
  }
  denormalize(fraction: number): number {
    return this.scale.denormalize(this.flipped ? 1 - fraction : fraction, this.range);
  }
  /** Position of one value along the dimension, 0..1. */
  fractionOf(value: number): number {
    this.tmp[0] = value;
    this.normalize(this.tmp, 1, 1, 0);
    return this.tmp[0];
  }
  /**
   * One value as text, the way this dimension would label a tick but with the precision a reading needs: its `format`,
   * else its scale's own labelling (a band's category name), else the number to five significant figures.
   */
  formatValue(value: number): string {
    const a = this.attrs;
    if (a.format) return a.format(value);
    const label = this.scale.label?.(value);
    if (label !== undefined) return label;
    const locale = a.locale ?? this.chart?.attrs.locale;
    if (locale)
      return numberFormat(locale, Math.abs(value) >= 1e5 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 5 }).format(value);
    return Math.abs(value) >= 1e5 ? value.toFixed(0) : String(+value.toPrecision(5));
  }
  /** A tick's number as plain text, or in the locale's way if there is one. */
  #plain(value: number, decimals: number): string {
    const locale = this.attrs.locale ?? this.chart?.attrs.locale;
    return locale
      ? numberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)
      : value.toFixed(decimals);
  }
  /** Where the ticks are: the attributes' say if they have one, else the scale's choice of about `count`. Always inside the range. */
  private tickValues(count: number): readonly number[] {
    const a = this.attrs,
      r = this.range,
      lo = Math.min(r.min, r.max),
      hi = Math.max(r.min, r.max);
    const eps = (hi - lo) * 1e-9;
    // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unnecessary-type-assertion -- the attribute type with its default filled in; the type is generic here, and without the assertion it is not narrowed
    const explicit = a.ticks as DimensionAttributes['ticks'];
    if (explicit) {
      const given = typeof explicit === 'function' ? explicit(r) : explicit;
      return given.filter((v) => v >= lo - eps && v <= hi + eps);
    }
    if (a.tickStep && a.tickStep > 0) {
      const out: number[] = [],
        step = a.tickStep;
      for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + eps && out.length < 1000; k++)
        out.push(Number((k * step).toPrecision(12)));
      return out;
    }
    return this.scale.ticks(r, count);
  }
  /** Overridden by dimensions that know their length matters (an axis wants more ticks when longer). */
  protected tickCountFor(_lengthInPixels: number): number {
    return 5;
  }
  /** The ticks for a dimension drawn `lengthInPixels` long. `tickCount` wins; else `count`; else a number that suits the length. */
  getTicks(lengthInPixels: number, count?: number): readonly Tick[] {
    const a = this.attrs;
    count = a.tickCount ?? count ?? this.tickCountFor(lengthInPixels);
    const values = this.tickValues(count);
    let step = values.length > 1 ? Infinity : Math.abs(this.range.max - this.range.min) || 1;
    for (let i = 1; i < values.length; i++) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      const d = Math.abs(values[i]! - values[i - 1]!);
      if (d > 0 && d < step) step = d;
    }
    // Enough decimals to tell neighbouring ticks apart, and the same for all so the labels line up.
    const decimals = Math.min(10, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
    const set = !a.format ? this.scale.labels?.(values, this.range) : undefined;
    return values.map((value, i) => {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      let label = a.format ? a.format(value) : set ? set[i]! : (this.scale.label?.(value) ?? this.#plain(value, decimals));
      if (label === '-0') label = '0'; // toFixed keeps the sign of a tiny negative
      return { value, label, major: true };
    });
  }
}

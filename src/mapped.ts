/**
 * Mapped dimensions: data to colour, size and so on, and the bindings that feed them to renderers.
 *
 * How a binding reaches the screen (an interdependent chain worth knowing):
 *   renderer `bind: { fill: { axis, channel } }` → the series reads `renderer.bindings` and asks its source for that
 *   channel → the series `contribute`s the channel's extent to the MappedDimension → the dimension fits a range from
 *   every series that bound it → at paint time the renderer normalises the channel through the dimension (0..1) and calls
 *   `valueAt` to get the colour/size. Keys read the same dimension, so legend and marks cannot disagree.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, STRING } from './attrs.ts';
import type { Chart } from './chart.ts';
import { Dimension, type DimensionAttributes } from './dimension.ts';
import { type ElementRef, fail } from './element.ts';
import type { Extent } from './geometry.ts';

/** No options of its own beyond a dimension's (range, padding, scale…). */
export interface MappedDimensionAttributes extends DimensionAttributes {}

/**
 * A dimension whose output is not a position but a value: a colour, a size. It takes its range from every series
 * that binds to it. Put it in the chart, beside the planes, and bind renderers to it; to show what it means, add a key
 * (`ColorKey`, `SizeKey`) that refers to it.
 *
 * No one drives it: a plane's axes are started and fixed by their plane, but this belongs to the chart, so it notices
 * for itself when a new flush has begun. The first contribution of a flush starts it over, and the first read of the
 * range, which is when something draws, fixes it.
 */
export abstract class MappedDimension<Out, A extends MappedDimensionAttributes = MappedDimensionAttributes> extends Dimension<Chart, A> {
  /** The output for a position 0..1 along the dimension. */
  abstract valueAt(fraction: number): Out;
  /** What data outside the range, or NaN, maps to. */
  abstract get missing(): Out;

  // The flush this dimension last started afresh for. A chart-level dimension is not driven by a plane's `begin()`, so
  // it compares the chart's flush counter with its own to know when contributions from the previous pass are stale.
  #flush = -1;
  #sync(): void {
    const flush = this.chart?.flushCount ?? 0;
    if (flush !== this.#flush) {
      this.#flush = flush;
      this.begin();
    }
  }
  override contribute(min: number, max: number): void {
    this.#sync();
    super.contribute(min, max);
  }
  override get range(): Readonly<Extent> {
    this.#sync();
    this.resolve();
    return super.range;
  }
}

// ─── Colour ───

export type ColorRampName = 'viridis' | 'magma' | 'turbo' | 'blues' | 'greys' | 'diverging';

const RAMPS: Readonly<Record<ColorRampName, readonly string[]>> = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  magma: ['#000004', '#180f3e', '#451077', '#721f81', '#9f2f7f', '#cd4071', '#f1605d', '#fd9567', '#fec98d', '#fcfdbf'],
  turbo: ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c7ef34', '#faba39', '#f66b19', '#cb2a04', '#7a0403'],
  blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
  greys: ['#ffffff', '#f0f0f0', '#d9d9d9', '#bdbdbd', '#969696', '#737373', '#525252', '#252525', '#000000'],
  diverging: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
};

/** A ramp's stops as flat r, g, b numbers, parsed once per list (keyed by the array, so the cache follows the ramp's lifetime). */
const rgbOf = new WeakMap<readonly string[], Float64Array>();
function stopsToRgb(stops: readonly string[]): Float64Array {
  const cached = rgbOf.get(stops);
  if (cached) return cached;
  const rgb = new Float64Array(stops.length * 3);
  stops.forEach((c, i) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c) ?? fail(`a linear colour ramp takes #rgb or #rrggbb stops, not "${c}"`);
    const h = m[1]!.length === 3 ? m[1]!.replace(/./g, '$&$&') : m[1]!;
    for (let k = 0; k < 3; k++) rgb[3 * i + k] = parseInt(h.slice(2 * k, 2 * k + 2), 16);
  });
  rgbOf.set(stops, rgb);
  return rgb;
}
/** Two hex digits for a 0..255 channel. */
const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, '0');

export interface ColorAxisAttributes extends MappedDimensionAttributes {
  /**
   * A named ramp, or a list of colours spread evenly. Linear interpolation needs `#rgb` or `#rrggbb` colours;
   * a stepped ramp takes any CSS colour. Default 'viridis'.
   */
  ramp?: ColorRampName | readonly string[];
  /** Blend between the stops or pick the nearest band. Default 'linear'. */
  interpolation?: 'linear' | 'step';
  /** Colour for data with no value or outside the range. Default '#bbb'. */
  missing?: string;
}

/** Data to colour: `new ColorAxis({ title: 'Pressure' }, new LinearScale())`. */
export class ColorAxis extends MappedDimension<string, ColorAxisAttributes> {
  static override attrTypes = { ...MappedDimension.attrTypes, missing: STRING } satisfies AttrTypesFor<ColorAxisAttributes>;
  /** The ramp's colours, low to high. */
  get stops(): readonly string[] {
    const r = this.attrs.ramp ?? 'viridis';
    return typeof r === 'string' ? RAMPS[r] : r;
  }

  valueAt(fraction: number): string {
    if (!(fraction >= -1e-9 && fraction <= 1 + 1e-9)) return this.missing;
    const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
    const stops = this.stops,
      n = stops.length;
    if (this.attrs.interpolation === 'step') return stops[Math.min(n - 1, Math.floor(f * n))]!;
    const rgb = stopsToRgb(stops),
      pos = f * (n - 1),
      i = Math.min(n - 2, Math.floor(pos));
    if (n === 1) return stops[0]!;
    const t = pos - i;
    return (
      '#' +
      hex2(rgb[3 * i]! + t * (rgb[3 * i + 3]! - rgb[3 * i]!)) +
      hex2(rgb[3 * i + 1]! + t * (rgb[3 * i + 4]! - rgb[3 * i + 1]!)) +
      hex2(rgb[3 * i + 2]! + t * (rgb[3 * i + 5]! - rgb[3 * i + 2]!))
    );
  }
  get missing(): string {
    return this.attrs.missing ?? '#bbb';
  }
}

// ─── Size ───

export interface SizeAxisAttributes extends MappedDimensionAttributes {
  /** The output range. Pixels for a size, so [2, 12] by default; it is also how to map to opacity ([0.2, 1]) or a width. */
  output?: readonly [min: number, max: number];
  /** Output for data with no value or outside the range. Default: the low end of `output`. */
  missing?: number;
}

/** Data to a number: a marker size, a stroke width, an opacity. `new SizeAxis({ output: [3, 14] }, new LinearScale())`. */
export class SizeAxis extends MappedDimension<number, SizeAxisAttributes> {
  /** The output range. */
  get output(): readonly [number, number] {
    return this.attrs.output ?? [2, 12];
  }

  valueAt(fraction: number): number {
    if (!(fraction >= -1e-9 && fraction <= 1 + 1e-9)) return this.missing;
    const [lo, hi] = this.output;
    return lo + (fraction < 0 ? 0 : fraction > 1 ? 1 : fraction) * (hi - lo);
  }
  get missing(): number {
    return this.attrs.missing ?? this.output[0];
  }
}

/** What a renderer needs of whatever turns a channel into a look: a `MappedDimension`, or the stand-in for a function (`ValueMap`, in bucket.ts). */
export interface BoundDimension<Out = unknown> {
  contribute(min: number, max: number): void;
  normalize(buffer: Float64Array, count: number, stride: number, offset: number): void;
  valueAt(fraction: number): Out;
  readonly missing: Out;
}

/** One attribute fed from one channel of the data through a mapped dimension, or through a function of the channel's values. */
export type Binding<Out> =
  | { axis: ElementRef<MappedDimension<Out>>; channel: string; map?: undefined }
  | { map: (value: number) => Out; channel: string; axis?: undefined };
/** The bindings a renderer may declare: only the attributes in `Bindable`, each with a dimension of the matching output type. */
export type Bindings<Bindable extends object> = { [K in keyof Bindable]?: Binding<Bindable[K]> };

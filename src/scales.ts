/** The scales: linear, logarithmic, square-root and category. The base class is in scale.ts. */
import type { Extent } from './geometry.ts';
import { fail } from './element.ts';
import { Scale, type ScaleAttributes, clean, niceStep } from './scale.ts';

/** Evenly spaced values: the default, and the only scale implemented so far. */
export class LinearScale<A extends ScaleAttributes = ScaleAttributes> extends Scale<A> {
  override get isLinear(): boolean {
    return true;
  }
  normalize(buf: Float64Array, count: number, stride: number, offset: number, range: Extent): void {
    const span = range.max - range.min;
    // A zero span maps everything to 0 rather than dividing by zero.
    const inv = span > 0 ? 1 / span : 0;
    const min = range.min;
    // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
    for (let k = 0, i = offset; k < count; k++, i += stride) buf[i] = (buf[i]! - min) * inv;
  }
  denormalize(f: number, r: Extent): number {
    return r.min + f * (r.max - r.min);
  }
  constrain(r: Extent): Extent {
    return r;
  }
  nice(r: Extent): Extent {
    // Aim for about five divisions; the 1e-9 keeps an already tidy end from stepping out a whole tick on rounding error.
    const step = niceStep((r.max - r.min) / 5);
    return { min: clean(Math.floor(r.min / step + 1e-9) * step), max: clean(Math.ceil(r.max / step - 1e-9) * step) };
  }
  ticks(r: Extent, count: number): readonly number[] {
    const step = niceStep((r.max - r.min) / Math.max(1, count));
    const first = Math.ceil(r.min / step - 1e-9),
      last = Math.floor(r.max / step + 1e-9);
    const out: number[] = [];
    // The cap is a guard against a huge range with a tiny tick step, not a real limit.
    for (let k = first; k <= last && out.length < 1000; k++) out.push(clean(k * step));
    return out;
  }
}

/**
 * Powers of a base: equal ratios take equal distances, which is what spans of many orders of magnitude need.
 * Values that are not positive have no place on it and come out NaN (a gap), and the range is kept positive.
 */
export interface LogScaleAttributes extends ScaleAttributes {
  /** The logarithm's base: each power of it is one step along the axis. Above 0 and not 1. Default 10. */
  base?: number;
}
export class LogScale extends Scale<LogScaleAttributes> {
  private get base(): number {
    const b = this.attrs.base ?? 10;
    if (!(b > 0) || b === 1) fail(178, b);
    return b;
  }

  normalize(buf: Float64Array, count: number, stride: number, offset: number, range: Extent): void {
    const lo = Math.log(range.min),
      span = Math.log(range.max) - lo;
    const inv = span > 0 ? 1 / span : 0;
    for (let k = 0, i = offset; k < count; k++, i += stride) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      const v = buf[i]!;
      buf[i] = v > 0 ? (Math.log(v) - lo) * inv : NaN;
    }
  }
  denormalize(f: number, r: Extent): number {
    const lo = Math.log(r.min);
    return Math.exp(lo + f * (Math.log(r.max) - lo));
  }
  override canPlace(value: number): boolean {
    return value > 0;
  }
  /**
   * A range reaching zero or below cannot be drawn. Pull the low end up to three orders of magnitude under the high end
   * (or the high end up from it, if both are bad): a choice, since there is no right answer, but a readable one.
   */
  constrain(r: Extent): Extent {
    const b = this.base;
    if (r.max <= 0) return { min: 1, max: b };
    if (r.min <= 0) return { min: r.max / b ** 3, max: r.max };
    return r;
  }
  nice(r: Extent): Extent {
    const b = this.base,
      lg = (v: number) => Math.log(v) / Math.log(b);
    // The epsilons stop an exact power from stepping out a whole decade on rounding error.
    return { min: clean(b ** Math.floor(lg(r.min) + 1e-9)), max: clean(b ** Math.ceil(lg(r.max) - 1e-9)) };
  }
  /** The powers of the base in range, thinned to about `count`; with only a few decades, 2 and 5 times each as well. */
  ticks(r: Extent, count: number): readonly number[] {
    const b = this.base,
      lg = (v: number) => Math.log(v) / Math.log(b);
    const first = Math.ceil(lg(r.min) - 1e-9),
      last = Math.floor(lg(r.max) + 1e-9);
    const out: number[] = [];
    const decades = last - first + 1;
    if (decades < count && b === 10) {
      for (let e = first - 1; e <= last; e++)
        for (const m of [1, 2, 5]) {
          const v = clean(m * 10 ** e);
          if (v >= r.min && v <= r.max) out.push(v);
        }
      // Under a decade, with no 1, 2 or 5 times a power of ten inside (6 to 9): ordinary tidy numbers, which at that scale are
      // close enough to evenly spaced to read.
      return out.length >= 2 ? out : new LinearScale().ticks(r, count);
    }
    const stride = Math.max(1, Math.ceil(decades / Math.max(1, count)));
    for (let e = first; e <= last && out.length < 1000; e += stride) out.push(clean(b ** e));
    return out;
  }
}

/**
 * Square root: gives zero a place (unlike a log) while giving small values more room than a linear scale does, as for
 * counts or areas. Negative values come out NaN.
 */
export class SqrtScale extends Scale {
  #linear = new LinearScale(); // tidy ends and ticks are chosen in data space, where people read them

  normalize(buf: Float64Array, count: number, stride: number, offset: number, range: Extent): void {
    const lo = Math.sqrt(range.min),
      span = Math.sqrt(range.max) - lo;
    const inv = span > 0 ? 1 / span : 0;
    for (let k = 0, i = offset; k < count; k++, i += stride) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      const v = buf[i]!;
      buf[i] = v >= 0 ? (Math.sqrt(v) - lo) * inv : NaN;
    }
  }
  denormalize(f: number, r: Extent): number {
    const lo = Math.sqrt(r.min),
      u = lo + f * (Math.sqrt(r.max) - lo);
    return u * u;
  }
  /** The low end cannot go below zero. */
  constrain(r: Extent): Extent {
    return r.min < 0 ? { min: 0, max: Math.max(r.max, 0) } : r;
  }
  nice(r: Extent): Extent {
    return this.constrain(this.#linear.nice(r));
  }
  ticks(r: Extent, count: number): readonly number[] {
    return this.#linear.ticks(r, count);
  }
}

export interface BandScaleAttributes extends ScaleAttributes {
  /** Category labels in order; the domain values are indexes into this list. */
  categories: readonly string[];
  /** Fraction of each band left empty between neighbours, 0..1. Default 0.2. */
  bandGap?: number;
}
/**
 * Categories: the domain values 0, 1, 2… are positions of equal bands, one per category, and a value is drawn at the
 * middle of its band. The range is fixed by the categories (data cannot change it), the ticks are the categories, and
 * every label is the category's name. Labels are never thinned, so give a long list room or a short name.
 */
export class BandScale extends Scale<BandScaleAttributes> {
  private get n(): number {
    return Math.max(1, this.attrs.categories.length);
  }

  /** Width of the drawn part of one band as a fraction of the range, for a renderer that draws bars. */
  get bandwidth(): number {
    return (1 - (this.attrs.bandGap ?? 0.2)) / this.n;
  }

  normalize(buf: Float64Array, count: number, stride: number, offset: number, range: Extent): void {
    const span = range.max - range.min,
      inv = span > 0 ? 1 / span : 0;
    // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
    for (let k = 0, i = offset; k < count; k++, i += stride) buf[i] = (buf[i]! - range.min) * inv;
  }
  denormalize(f: number, r: Extent): number {
    return r.min + f * (r.max - r.min);
  }
  /** Half a band either side of the first and last category, whatever the data or attributes asked. */
  constrain(): Extent {
    return { min: -0.5, max: this.n - 0.5 };
  }
  nice(r: Extent): Extent {
    return r;
  }
  ticks(r: Extent): readonly number[] {
    const out: number[] = [];
    for (let k = Math.max(0, Math.ceil(r.min)); k <= Math.min(this.n - 1, Math.floor(r.max)); k++) out.push(k);
    return out;
  }
  override label(value: number): string | undefined {
    return this.attrs.categories[Math.round(value)];
  }
}

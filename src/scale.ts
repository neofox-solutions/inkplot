/** The base of scales, which map a data range to 0..1 and back, and choose tick values. The scales themselves are in scales.ts. */
import type { Dimension } from './dimension.ts';
import { type BaseAttributes, ChartElement } from './element.ts';
import type { Extent } from './geometry.ts';

/** Shared with scales.ts. Trims binary noise (0.1 + 0.2) so tick values and labels come out as the decimals a person expects. */
export const clean = (v: number) => Number(v.toPrecision(12));
/** Rounds a raw step up to 1, 2, 5 or 10 times a power of ten: the steps people read easily. The cut-offs favour fewer, rounder ticks. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * 10 ** exp;
}

/** No options of its own; subclasses add their parameters (a log base). */
export interface ScaleAttributes extends BaseAttributes {}

/**
 * The maths of a dimension, as an element: the first (and only) child of an axis. Parameters are attributes,
 * so a scale serializes like anything else, and a new transform is a new class with no change to axes.
 */
export abstract class Scale<A extends ScaleAttributes = ScaleAttributes> extends ChartElement<Dimension, [], A> {
  /** Value to 0..1, in place over an interleaved buffer. Invalid input (log of a non-positive) becomes NaN. */
  abstract normalize(buffer: Float64Array, count: number, stride: number, offset: number, range: Extent): void;
  /** The inverse of `normalize` for one value: how pointer positions become data values. */
  abstract denormalize(fraction: number, range: Extent): number;
  /**
   * Whether the scale can place this value at all (false for 0 on a log scale). Bars use it to start at the edge of the axis
   * rather than at a baseline that cannot be drawn. Default: every number.
   */
  canPlace(_value: number): boolean {
    return true;
  }
  /** Replaces ends the scale cannot represent (a log range reaching zero). */
  abstract constrain(range: Extent): Extent;
  /** Pull a raw range out to tidy ends. */
  abstract nice(range: Extent): Extent;
  /** Tick values inside the range, about `count` of them. */
  abstract ticks(range: Extent, count: number): readonly number[];
  /** True when equal steps in the data are equal steps along the axis, so a straight line in data is straight on the page. */
  get isLinear(): boolean {
    return false;
  }
  /**
   * When the scale divides its range into equal slots for the values (a band scale), the room one slot gives: the `width` of its drawn part and
   * the `pitch` from one slot to the next, both as fractions of the range. Bars fill it. Null when values are just points on a continuum (default).
   */
  get slots(): { readonly width: number; readonly pitch: number } | null {
    return null;
  }
  /** The text for a tick, when the scale knows better than a number does (a category name). Default: the axis formats the number. */
  label?(value: number): string | undefined;
  /**
   * The labels for a whole set of ticks, when what a tick should say depends on the others (a time scale writes a new day
   * as "Jun 11" and the minutes in it as "22:10"). Gets the values the axis chose, whoever chose them, in order. Beats `label` for ticks; an
   * axis's own `format` beats both.
   */
  labels?(values: readonly number[], range: Extent): readonly string[];
}

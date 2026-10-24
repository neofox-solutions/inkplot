// How much of a function to sample, and where, for a plot of a given size. A made-up line (a `SyntheticDataSource`, a trendline) has no stored
// points, so it takes as many as the screen can show: one for each pixel across the part of the domain in view, so zooming in stays smooth and zooming
// out never draws more than there is room for. A fixed `count` ignores the view and spreads that many over the whole span. Kept in one place so every
// sampler (and a plane that has to follow a curve) agrees on it.
import type { Extent } from './geometry.ts';

/** Samples when nothing says how many: the plot's size is not known when a source is only asked for its extent. */
export const DEFAULT_SAMPLES = 512;

/** Where sampling starts and ends, and how many samples there are, evenly spaced and including both ends. */
export interface SampleSpan {
  readonly lo: number;
  readonly hi: number;
  /** 0 when nothing of the span is in view. */
  readonly n: number;
}

/**
 * The samples for `whole`, the span a function is defined over, when `view` is the part of it on show and there are `pixels` of room across the
 * view (0 or less: not known). With a `count`, always that many across the whole span; otherwise one for each pixel (at least 2) across the part
 * in view, or `DEFAULT_SAMPLES` where the room is not known. `perPixel` is how many to take for each pixel of room: 1 for a line drawn point to
 * point, fewer where a few pixels between samples is straight enough (a curve drawn as short chords).
 */
export function sampleSpan(whole: Extent, view: Extent, pixels: number, count?: number, perPixel = 1): SampleSpan {
  if (count !== undefined) return { lo: whole.min, hi: whole.max, n: count };
  const lo = Math.max(whole.min, view.min),
    hi = Math.min(whole.max, view.max);
  if (!(lo <= hi)) return { lo, hi, n: 0 };
  return { lo, hi, n: pixels > 0 ? Math.max(2, Math.ceil(pixels * perPixel)) : DEFAULT_SAMPLES };
}

/** Where sample `i` of `span` is. The last is exactly `hi`, so the end of the span is not lost to rounding. */
export function sampleAt(span: SampleSpan, i: number): number {
  const { lo, hi, n } = span;
  return n === 1 ? lo : i === n - 1 ? hi : lo + ((hi - lo) * i) / (n - 1);
}

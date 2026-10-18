/**
 * Moving a view range by easing instead of snapping, for the changes that jump on purpose: a box zoom, a double-click that puts an
 * axis back, a reset. The chart's `transition` says how long and how (the same `easing` as the CSS transitions); without it, or in a
 * browser that asks for less motion, the view is set at once. Nothing here eases a drag, a wheel turn or a pinch: those follow the hand.
 *
 * Each frame sets the axis' view range to a point between where it was and where it is going, measured in the *scale's* terms (a log
 * axis zooms evenly), and the chart redraws as it always does. The range that was set is the one the next frame reads back, so a change
 * made from elsewhere (a drag during the move) ends it.
 */
import type { Axis } from './axis.ts';
import type { Extent } from './geometry.ts';

/** `(t) => progress`, both from 0 to 1, for a CSS timing function: a keyword or `cubic-bezier(x1, y1, x2, y2)`. Anything else is `ease-out`. */
export function parseEasing(spec: string): (t: number) => number {
  const named: Record<string, readonly number[]> = {
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  const text = spec.trim().toLowerCase();
  if (text === 'linear') return (t) => t;
  const given = /^cubic-bezier\(([^)]*)\)$/.exec(text)?.[1]?.split(',').map(Number);
  const p = given?.length === 4 && given.every(Number.isFinite) ? given : (named[text] ?? named['ease-out']);
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = p ?? [];
  // The curve is (x(s), y(s)) for s in 0..1; find the s whose x is `t`, then read y there.
  const at = (a: number, b: number, s: number) => 3 * a * (1 - s) * (1 - s) * s + 3 * b * (1 - s) * s * s + s * s * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

/** The range all the data on `axis` asks for, whatever view is set: what 'put it back' goes to, and what a zoom is limited by. */
export function naturalRange(axis: Axis): Extent {
  return axis.naturalRange();
}

export interface MoveViewOptions {
  /** The clock, in milliseconds. Default `performance.now`. For a test that steps the frames itself. */
  now?: () => number;
}

const moving = new WeakMap<Axis, () => void>();

/**
 * Set `axis`' view range to `range` (null: back to what the data asks for), easing there if the chart has a `transition` (and its
 * `views` is not false), the platform can schedule frames and the visitor has not asked for reduced motion; otherwise at once.
 */
export function moveView(axis: Axis, range: Extent | null, options: MoveViewOptions = {}): void {
  moving.get(axis)?.();
  moving.delete(axis);
  const chart = axis.chart,
    transition = chart?.attrs.transition,
    platform = chart?.platform;
  const duration = transition?.duration ?? 250;
  if (!chart || !transition || transition.views === false || !platform?.schedule || !(duration > 0) || reducedMotion()) {
    axis.setViewRange(range);
    return;
  }
  const from = { ...(axis.viewRange ?? axis.range) },
    to = range ?? naturalRange(axis);
  const scale = axis.scale;
  // Where `to` is, in the scale's fractions measured against `from`: 0 is its start, 1 its end.
  const place = (v: number) => {
    const b = new Float64Array([v]);
    scale.normalize(b, 1, 1, 0, from);
    return b[0] ?? Number.NaN;
  };
  const f0 = place(to.min),
    f1 = place(to.max);
  if (!Number.isFinite(f0) || !Number.isFinite(f1)) {
    axis.setViewRange(range);
    return;
  }
  if (Math.abs(f0) < 1e-9 && Math.abs(f1 - 1) < 1e-9) {
    // Already there: no tween to run (and no frames to schedule).
    axis.setViewRange(range);
    return;
  }
  const ease = parseEasing(transition.easing ?? 'ease-out'),
    now = options.now ?? (() => performance.now()),
    start = now();
  let last: Extent | null = axis.viewRange,
    cancel: (() => void) | null = null,
    live = true;
  const stop = () => {
    live = false;
    cancel?.();
    cancel = null;
  };
  moving.set(axis, stop);
  const frame = () => {
    cancel = null;
    if (!live) return;
    // Something else moved the view since our last frame (a drag, a wheel turn): it has taken over.
    if (axis.viewRange !== last) return void moving.delete(axis);
    const t = Math.min(1, (now() - start) / duration);
    if (t >= 1) {
      moving.delete(axis);
      axis.setViewRange(range);
      return;
    }
    const e = ease(t);
    const next = { min: scale.denormalize(e * f0, from), max: scale.denormalize(1 + e * (f1 - 1), from) };
    axis.setViewRange(next);
    last = axis.viewRange;
    cancel = platform.schedule?.(frame) ?? null;
  };
  cancel = platform.schedule(frame);
}

/** The visitor has asked their system for less motion. False where there is no way to ask (a server, a test). */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

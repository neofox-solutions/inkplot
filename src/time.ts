/**
 * Time: an axis scale whose ticks fall on the calendar (midnights, the hour, the first of the month) instead of on powers of ten.
 *
 * The data is JavaScript timestamps: milliseconds since the epoch, as `Date.now()`, `Date.parse(iso)` and
 * `Temporal.Instant#epochMilliseconds` give. (A Unix timestamp in seconds needs `* 1000`.) Nothing else about time
 * reaches the library: it is numbers all the way down, so panning, zooming, stacking, decimating and hit-testing work as they do for any
 * linear axis, and what is added here is where the ticks go and what they say.
 *
 * `TimeScale` is the part that does not depend on a date library: the choice of interval, the walk along the calendar, `nice`, and the
 * rule for labels. What does depend on one is four small methods, which a subclass gives:
 *  - `startOf(t, unit)`: the start of the unit that holds `t`, in the scale's time zone.
 *  - `add(t, unit, n)`: `n` units later, by the calendar (a day is 23 or 25 hours when the clocks change).
 *  - `field(t, unit)`: which one the unit is within the next one up (the hour of the day, the month of the year).
 *  - `format(t, rank, spec)`: the text for a tick of this rank.
 * `IntlTimeScale` (time-intl.ts) does it with `Date` and `Intl`, and `TemporalTimeScale` (time-temporal.ts) with
 * `Temporal`. A scale over date-fns, Luxon or moment is one more subclass.
 *
 * The time zone is the `timeZone` attribute: an IANA name, 'UTC' (the default, so that a chart renders the same wherever it
 * is rendered) or 'local' for the one the runtime is in.
 *
 * Labels follow the tick, not the axis: a tick that begins a day says the date ("Jun 11"), however finely the axis is divided, and
 * one that does not says the time at the precision of the whole set ("22:10"). `formats` replaces any of the default
 * formats, whose type is the adapter's own (`Intl.DateTimeFormatOptions` for the two built in, a format string for moment).
 */
import { type AttrTypes, type AttrTypesFor, AUTO, STRING, NUMBER } from './attrs.ts';
import type { Extent } from './geometry.ts';
import { niceStep, type ScaleAttributes } from './scale.ts';
import { LinearScale } from './scales.ts';

/** The units a calendar walks in. */
export type TimeUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';
/** What a label is for: the largest unit a tick begins, else the precision of the ticks around it. `full` is the reading of a single instant (a tooltip). */
export type TimeRank = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond' | 'full';

/** The text-only and capitalised parts of `Intl.DateTimeFormatOptions`, for the `formats` attribute of both Intl-based time scales. */
const INTL_FORMAT_TYPES = {
  localeMatcher: STRING, timeZone: STRING, hourCycle: STRING, formatMatcher: STRING, dateStyle: STRING, timeStyle: STRING,
  dayPeriod: STRING, fractionalSecondDigits: AUTO, calendar: STRING, numberingSystem: STRING, weekday: STRING, era: STRING,
  year: STRING, month: STRING, day: STRING, hour: STRING, minute: STRING, second: STRING, timeZoneName: STRING,
} satisfies AttrTypes;
/** `formats` for the time scales (Intl options per rank; a format of another kind lists its own parts). */
export const TIME_FORMATS_TYPES = {
  year: INTL_FORMAT_TYPES, month: INTL_FORMAT_TYPES, day: INTL_FORMAT_TYPES, hour: INTL_FORMAT_TYPES,
  minute: INTL_FORMAT_TYPES, second: INTL_FORMAT_TYPES, millisecond: INTL_FORMAT_TYPES, full: INTL_FORMAT_TYPES,
} satisfies AttrTypes;

export interface TimeScaleAttributes<Format = unknown> extends ScaleAttributes {
  /** An IANA time zone name, 'UTC' or 'local' (the runtime's). Default 'UTC'. */
  timeZone?: string;
  /** The first day of a week, 0 for Sunday to 6. Default 1, Monday. */
  weekStart?: number;
  /** Replaces the default format of a rank. */
  formats?: Partial<Record<TimeRank, Format>>;
}

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR, YEAR = 365.2425 * DAY;
/** The intervals a tick set is chosen from, with the length each is taken to have when comparing. Years beyond the first are the nice numbers of years. */
const LADDER: readonly (readonly [TimeUnit, number, number])[] = [
  ['second', 1, SECOND], ['second', 5, 5 * SECOND], ['second', 15, 15 * SECOND], ['second', 30, 30 * SECOND],
  ['minute', 1, MINUTE], ['minute', 5, 5 * MINUTE], ['minute', 15, 15 * MINUTE], ['minute', 30, 30 * MINUTE],
  ['hour', 1, HOUR], ['hour', 3, 3 * HOUR], ['hour', 6, 6 * HOUR], ['hour', 12, 12 * HOUR],
  ['day', 1, DAY], ['day', 2, 2 * DAY], ['week', 1, 7 * DAY],
  ['month', 1, YEAR / 12], ['month', 3, YEAR / 4], ['month', 6, YEAR / 2], ['year', 1, YEAR],
];
/** An interval: whole milliseconds (`unit` null), or `step` of a calendar unit. */
interface Interval { unit: TimeUnit | null; step: number; ms: number }

/** The interval for ticks about `target` milliseconds apart. */
function intervalFor(target: number): Interval {
  if (!(target > 0) || !isFinite(target)) return { unit: null, step: 1, ms: 1 };
  if (target < 0.75 * SECOND) { const step = niceStep(target); return { unit: null, step, ms: step }; }
  if (target > 1.4 * YEAR) { const step = Math.max(1, niceStep(target / YEAR)); return { unit: 'year', step, ms: step * YEAR }; }
  // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
  let best = LADDER[0]!, off = Infinity;
  for (const e of LADDER) { const d = Math.abs(Math.log(e[2] / target)); if (d < off) { off = d; best = e; } }
  return { unit: best[0], step: best[1], ms: best[2] };
}

/** The most ticks made for a range, a guard against a huge range with a tiny interval. */
const MOST = 2000;

export abstract class TimeScale<Format = unknown, A extends TimeScaleAttributes<Format> = TimeScaleAttributes<Format>> extends LinearScale<A> {
  static override attrTypes = { ...LinearScale.attrTypes, timeZone: STRING, weekStart: NUMBER } satisfies AttrTypesFor<TimeScaleAttributes>;
  /** The start of the `unit` that holds `t`, in the time zone. */
  protected abstract startOf(t: number, unit: TimeUnit): number;
  /** `n` (whole, maybe negative) units after `t`, by the calendar. */
  protected abstract add(t: number, unit: TimeUnit, n: number): number;
  /** Which one `t` is of its unit within the next unit up: the year; the month 0 to 11; the day of the month from 1; the hour, minute and second from 0. */
  protected abstract field(t: number, unit: Exclude<TimeUnit, 'week'>): number;
  /** The text for `t` as a tick or reading of this rank. */
  protected abstract format(t: number, rank: TimeRank, spec: Format): string;
  /** The format for each rank when `formats` does not say. */
  protected abstract get defaultFormats(): Record<TimeRank, Format>;

  /** The day weeks start on, 0 to 6 from Sunday. */
  protected get weekStart(): number { return this.attrs.weekStart ?? 1; }

  #spec(rank: TimeRank): Format { return this.attrs.formats?.[rank] ?? this.defaultFormats[rank]; }

  /** The ticks of an interval inside [lo, hi], in order. */
  #walk(lo: number, hi: number, iv: Interval): number[] {
    const out: number[] = [];
    if (iv.unit === null) {
      for (let k = Math.ceil(lo / iv.step - 1e-9), v = k * iv.step; v <= hi + 1e-9 && out.length < MOST; v = ++k * iv.step) out.push(v);
      return out;
    }
    const unit = iv.unit, step = iv.step;
    if (unit === 'week') {
      for (let t = this.startOf(lo, 'week'); t <= hi && out.length < MOST; t = this.add(t, 'week', 1)) if (t >= lo) out.push(t);
      return out;
    }
    if (unit === 'year') {
      // Years can be many and far apart: go straight to the first aligned one and then by whole steps.
      const base = this.startOf(lo, 'year'), y = this.field(base, 'year'), first = Math.ceil(y / step) * step;
      for (let t = this.add(base, 'year', first - y); t <= hi && out.length < MOST; t = this.add(t, 'year', step)) if (t >= lo) out.push(t);
      return out;
    }
    const aligned = (t: number) => { const f = this.field(t, unit); return unit === 'day' ? (f - 1) % step === 0 : f % step === 0; };
    let guard = 0;
    for (let t = this.startOf(lo, unit); t <= hi && guard++ < 20 * MOST;) {
      if (t >= lo && aligned(t)) { out.push(t); if (out.length >= MOST) break; }
      let next = this.add(t, unit, 1);
      // Stepping by whole hours (minutes, seconds) leaves the clock's grid when its offset changes by a part of one (Lord Howe's half hour): back onto it.
      if (this.startOf(next, unit) !== next) next = Math.max(this.startOf(this.add(next, unit, 1), unit), t + 1);
      t = next;
    }
    return out;
  }

  override ticks(r: Extent, count: number): readonly number[] {
    if (!(r.max > r.min) || !isFinite(r.min) || !isFinite(r.max)) return [];
    return this.#walk(r.min, r.max, intervalFor((r.max - r.min) / Math.max(1, count)));
  }

  override nice(r: Extent): Extent {
    if (!(r.max > r.min) || !isFinite(r.min) || !isFinite(r.max)) return r;
    const iv = intervalFor((r.max - r.min) / 5), pad = 2 * iv.ms;
    const all = this.#walk(r.min - pad, r.max + pad, iv);
    let min = r.min, max = r.max;
    for (const t of all) { if (t <= r.min) min = t; if (t >= r.max) { max = t; break; } }
    return { min, max };
  }

  /** The reading of one instant: the `full` format. */
  override label(value: number): string | undefined { return this.format(value, 'full', this.#spec('full')); }

  override labels(values: readonly number[]): readonly string[] {
    // How finely the ticks that begin no day are divided: the largest unit that every tick begins.
    let fine: TimeRank = 'hour';
    if (values.some((t) => this.startOf(t, 'hour') !== t)) fine = 'minute';
    if (fine === 'minute' && values.some((t) => this.startOf(t, 'minute') !== t)) fine = 'second';
    if (fine === 'second' && values.some((t) => this.startOf(t, 'second') !== t)) fine = 'millisecond';
    return values.map((t) => {
      const rank: TimeRank = this.startOf(t, 'year') === t ? 'year' : this.startOf(t, 'month') === t ? 'month' : this.startOf(t, 'day') === t ? 'day' : fine;
      return this.format(t, rank, this.#spec(rank));
    });
  }
}

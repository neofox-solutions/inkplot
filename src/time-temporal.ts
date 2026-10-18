/**
 * `TemporalTimeScale`: a time scale over `Temporal`, which does the calendar and the time zones itself. Daylight saving, skipped
 * and repeated hours and non-hour offsets are `Temporal`'s own.
 *
 * Uses the runtime's `Temporal`, or the one given as the `temporal` attribute (the namespace of a polyfill: a reference to a
 * live object, not text, so a chart loaded from JSON takes it from its references like any other). `formats` are
 * `Intl.DateTimeFormatOptions` for `toLocaleString`, without a `timeZone` (the instant brings its own), and `locale` a BCP 47 tag.
 */
import { type AttrTypesFor, type Opaque, STRING } from './attrs.ts';
import { TimeScale, TIME_FORMATS_TYPES, type TimeRank, type TimeScaleAttributes, type TimeUnit } from './time.ts';

/** The part of a `Temporal.ZonedDateTime` that this uses. */
export interface ZonedLike {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly dayOfWeek: number;
  readonly epochMilliseconds: number;
  with(fields: Record<string, number>): ZonedLike;
  add(duration: Record<string, number>): ZonedLike;
  subtract(duration: Record<string, number>): ZonedLike;
  round(options: { smallestUnit: string; roundingMode: string }): ZonedLike;
  startOfDay(): ZonedLike;
  toLocaleString(locale?: string, options?: Intl.DateTimeFormatOptions): string;
}
/** The part of the `Temporal` namespace that this uses. */
export interface TemporalLike {
  Instant: { fromEpochMilliseconds(ms: number): { toZonedDateTimeISO(zone: string): ZonedLike } };
  Now: { timeZoneId(): string };
}

export interface TemporalTimeScaleAttributes extends TimeScaleAttributes<Intl.DateTimeFormatOptions> {
  /** The language the labels are written in (a BCP 47 tag). Default: the runtime's. */
  locale?: string;
  /** Where `Temporal` comes from, when the runtime has none. */
  temporal?: Opaque<TemporalLike>;
}

const clock: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const DEFAULTS: Record<TimeRank, Intl.DateTimeFormatOptions> = {
  year: { year: 'numeric' },
  month: { month: 'short' },
  day: { month: 'short', day: 'numeric' },
  hour: clock,
  minute: clock,
  second: { ...clock, second: '2-digit' },
  millisecond: { ...clock, second: '2-digit', fractionalSecondDigits: 3 },
  full: { year: 'numeric', month: 'short', day: 'numeric', ...clock, second: '2-digit', timeZoneName: 'short' },
};

export class TemporalTimeScale extends TimeScale<Intl.DateTimeFormatOptions, TemporalTimeScaleAttributes> {
  static override attrTypes = {
    ...TimeScale.attrTypes,
    locale: STRING,
    formats: TIME_FORMATS_TYPES,
  } satisfies AttrTypesFor<TemporalTimeScaleAttributes>;
  protected get defaultFormats(): Record<TimeRank, Intl.DateTimeFormatOptions> {
    return DEFAULTS;
  }

  get #temporal(): TemporalLike {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- `Temporal` is not in every runtime's global types
    const T = this.attrs.temporal ?? (globalThis as { Temporal?: TemporalLike }).Temporal;
    if (!T) throw new Error('TemporalTimeScale: this runtime has no Temporal; pass one as the `temporal` attribute, or use IntlTimeScale');
    return T;
  }
  #at(t: number): ZonedLike {
    const T = this.#temporal,
      z = this.attrs.timeZone ?? 'UTC';
    return T.Instant.fromEpochMilliseconds(Math.floor(t)).toZonedDateTimeISO(z === 'local' ? T.Now.timeZoneId() : z);
  }

  protected startOf(t: number, unit: TimeUnit): number {
    const z = this.#at(t);
    switch (unit) {
      case 'second':
      case 'minute':
      case 'hour':
        return z.round({ smallestUnit: unit, roundingMode: 'floor' }).epochMilliseconds;
      case 'day':
        return z.startOfDay().epochMilliseconds;
      case 'week':
        return z.subtract({ days: ((z.dayOfWeek % 7) - this.weekStart + 7) % 7 }).startOfDay().epochMilliseconds;
      case 'month':
        return z.with({ day: 1 }).startOfDay().epochMilliseconds;
      default:
        return z.with({ month: 1, day: 1 }).startOfDay().epochMilliseconds;
    }
  }
  protected add(t: number, unit: TimeUnit, n: number): number {
    return this.#at(t).add(unit === 'week' ? { weeks: n } : { [unit + 's']: n }).epochMilliseconds;
  }
  protected field(t: number, unit: Exclude<TimeUnit, 'week'>): number {
    const z = this.#at(t);
    return unit === 'month' ? z.month - 1 : z[unit];
  }
  protected format(t: number, _rank: TimeRank, spec: Intl.DateTimeFormatOptions): string {
    return this.#at(t).toLocaleString(this.attrs.locale ?? this.chart?.dateLocale, spec);
  }
}

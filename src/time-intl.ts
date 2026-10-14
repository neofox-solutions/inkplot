/**
 * `IntlTimeScale`: a time scale over `Date` and `Intl`, with nothing to install. The time zone, whatever it is, is worked out
 * with `Intl.DateTimeFormat` (the wall-clock time of an instant, and so the offset from UTC at it), so any IANA zone works
 * and daylight saving is followed. Where a wall-clock time does not exist (the hour the clocks skip) or occurs twice, the
 * instant nearest to it is used.
 *
 * `formats` are `Intl.DateTimeFormatOptions`, and `locale` a BCP 47 tag (default: the runtime's).
 */
import { type AttrTypesFor, STRING } from './attrs.ts';
import { TimeScale, TIME_FORMATS_TYPES, type TimeRank, type TimeScaleAttributes, type TimeUnit } from './time.ts';

export interface IntlTimeScaleAttributes extends TimeScaleAttributes<Intl.DateTimeFormatOptions> {
  /** The language the labels are written in (a BCP 47 tag). Default: the runtime's. */
  locale?: string;
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

/** A wall-clock reading: the date and time on a clock in some zone. */
interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

let local: string | undefined;
const zones = new Map<string, Intl.DateTimeFormat>();
function clockIn(zone: string): Intl.DateTimeFormat {
  let f = zones.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    zones.set(zone, f);
  }
  return f;
}
const utc = (w: Wall) => {
  const d = new Date(0);
  d.setUTCFullYear(w.y, w.mo - 1, w.d);
  d.setUTCHours(w.h, w.mi, w.s, 0);
  return d.getTime();
};

export class IntlTimeScale extends TimeScale<Intl.DateTimeFormatOptions, IntlTimeScaleAttributes> {
  static override attrTypes = {
    ...TimeScale.attrTypes,
    locale: STRING,
    formats: TIME_FORMATS_TYPES,
  } satisfies AttrTypesFor<IntlTimeScaleAttributes>;
  protected get defaultFormats(): Record<TimeRank, Intl.DateTimeFormatOptions> {
    return DEFAULTS;
  }

  get #zone(): string {
    const z = this.attrs.timeZone ?? 'UTC';
    return z === 'local' ? (local ??= new Intl.DateTimeFormat().resolvedOptions().timeZone) : z;
  }

  /** The wall-clock time at `t` in the zone. */
  #wall(t: number): Wall {
    if (this.#zone === 'UTC') {
      const d = new Date(t);
      return {
        y: d.getUTCFullYear(),
        mo: d.getUTCMonth() + 1,
        d: d.getUTCDate(),
        h: d.getUTCHours(),
        mi: d.getUTCMinutes(),
        s: d.getUTCSeconds(),
      };
    }
    const w: Wall = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 };
    for (const p of clockIn(this.#zone).formatToParts(t)) {
      switch (p.type) {
        case 'year':
          w.y = +p.value;
          break;
        case 'month':
          w.mo = +p.value;
          break;
        case 'day':
          w.d = +p.value;
          break;
        case 'hour':
          w.h = +p.value;
          break;
        case 'minute':
          w.mi = +p.value;
          break;
        case 'second':
          w.s = +p.value;
          break;
      }
    }
    return w;
  }
  /** The zone's offset from UTC at `t`, in milliseconds. */
  #offset(t: number): number {
    return utc(this.#wall(t)) - Math.floor(t / 1000) * 1000;
  }
  /** The instant a wall-clock time shows (days, months and so on beyond their range carry over). */
  #at(w: Wall): number {
    const wall = utc(w);
    if (this.#zone === 'UTC') return wall;
    let t = wall - this.#offset(wall);
    const o = this.#offset(t);
    if (wall - t !== o) t = wall - o;
    return t;
  }

  protected startOf(t: number, unit: TimeUnit): number {
    const ms = ((t % 1000) + 1000) % 1000;
    switch (unit) {
      case 'second':
        return t - ms;
      case 'minute': {
        const w = this.#wall(t);
        return t - ms - w.s * 1000;
      }
      case 'hour': {
        const w = this.#wall(t);
        return t - ms - w.s * 1000 - w.mi * 60000;
      }
    }
    const w = this.#wall(t);
    switch (unit) {
      case 'day':
        return this.#at({ ...w, h: 0, mi: 0, s: 0 });
      case 'week': {
        const dow = new Date(utc({ ...w, h: 0, mi: 0, s: 0 })).getUTCDay(); // the weekday of the date, read as if it were UTC
        return this.#at({ ...w, d: w.d - ((dow - this.weekStart + 7) % 7), h: 0, mi: 0, s: 0 });
      }
      case 'month':
        return this.#at({ ...w, d: 1, h: 0, mi: 0, s: 0 });
      default:
        return this.#at({ ...w, mo: 1, d: 1, h: 0, mi: 0, s: 0 });
    }
  }

  protected add(t: number, unit: TimeUnit, n: number): number {
    switch (unit) {
      case 'second':
        return t + n * 1000;
      case 'minute':
        return t + n * 60000;
      case 'hour':
        return t + n * 3600000;
    }
    const w = this.#wall(t);
    switch (unit) {
      case 'day':
        return this.#at({ ...w, d: w.d + n });
      case 'week':
        return this.#at({ ...w, d: w.d + 7 * n });
      case 'month':
        return this.#at({ ...w, mo: w.mo + n });
      default:
        return this.#at({ ...w, y: w.y + n });
    }
  }

  protected field(t: number, unit: Exclude<TimeUnit, 'week'>): number {
    const w = this.#wall(t);
    switch (unit) {
      case 'year':
        return w.y;
      case 'month':
        return w.mo - 1;
      case 'day':
        return w.d;
      case 'hour':
        return w.h;
      case 'minute':
        return w.mi;
      default:
        return w.s;
    }
  }

  #formats = new Map<string, Intl.DateTimeFormat>();
  protected format(t: number, _rank: TimeRank, spec: Intl.DateTimeFormatOptions): string {
    const locale = this.attrs.locale ?? this.chart?.attrs.locale;
    const key = `${locale}|${this.#zone}|${JSON.stringify(spec)}`;
    let f = this.#formats.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat(locale, { ...spec, timeZone: this.#zone });
      this.#formats.set(key, f);
    }
    return f.format(t);
  }
}

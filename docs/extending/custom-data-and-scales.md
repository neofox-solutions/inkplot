# Custom data and scales

Two of the contracts you are most likely to meet when your data or axes are unusual: a **data source** (where points come from) and a **scale** (how values become positions and ticks). Both are elements, and both are small. See [Custom elements](custom-elements.md) for the element basics.

## The data contract

A point is a row of numbers, one for each column a series asks for by name (`context.columns`): usually `[domain, value, ...channels]`. Every stage that delivers points delivers them **ascending in the domain**, because everything downstream (windowing to the visible range, decimating, building paths) wants that. How a source achieves it is its own business:

- Already ascending (`isSorted`, a regular domain, generated data): the data is read where it is stored, with no copy.
- Otherwise: copied once per change into a buffer the source owns, with NaN domains dropped and rows sorted.

`DataSource` is the base class for all of that. A concrete source supplies three things and inherits ordering, the managed copy, wrapping, extents and caching:

| You implement | Does |
|---|---|
| `pointCount` | How many points are stored. |
| `fill(out, context)` | Writes every point into `out` (storage order, one number for each of `context.columns`, in that order: the names `domain` and `x` are the domain and `value` and `y` the value, unless you have a channel of that name) and returns the `count` and an **extent for every column**, NaN skipped. This is the hot loop; write it against your own storage. It also takes `from` and `to`: write only rows `from` up to `to` (use `rowRange(n, from, to)`), from the start of `out`, with the extents of those rows. A `Slice` over your source then reads only its window, so a long source costs what its window costs. |
| `scanDomain()` | The extent of the domain of an *ordered* source: only its two ends matter. |
| `orderedView()` *(optional)* | Offers the storage for zero-copy reading, when it is ordered and flat. |
| `channelNames` *(optional)* | The channels this source can deliver, in storage order. Default none. |
| `ordered` *(optional)* | Override to `true` for a source that generates ascending points. |

Inherited: `version` (increases on every change and keys all caches), `domain()`, `valueExtent()`, `channelExtent(name)`, `plan(context)`, `invalidate()`.

A source that **generates** its points, rather than reading stored ones, has no rows to edit, so it leaves out `rowOf`.

```tsx live title="A source of your own: a seeded random walk" height=260
import { Axis, CartesianPlane, Chart, DataSource, DomainSeries, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';
import type { BaseAttributes, DataSourceAttributes, Extent, FillResult, PlanContext } from 'inkplot';

interface WalkAttributes extends DataSourceAttributes, BaseAttributes {
  /** How many steps. */
  steps: number;
  /** The same seed always gives the same walk. */
  seed?: number;
}

class RandomWalk extends DataSource<WalkAttributes> {
  /** It generates ascending points, so nothing has to be arranged or copied. */
  protected override get ordered(): boolean { return true; }
  get pointCount(): number { return this.attrs.steps; }
  protected scanDomain(): Extent | null { return this.attrs.steps > 0 ? { min: 0, max: this.attrs.steps - 1 } : null; }

  protected fill(out: Float64Array, _context: PlanContext): FillResult {
    let seed = this.attrs.seed ?? 1, y = 0, min = Infinity, max = -Infinity;
    const n = this.attrs.steps;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;          // a small deterministic generator
      y += (seed / 2 ** 32) - 0.5;
      out[2 * i] = i;
      out[2 * i + 1] = y;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    return { count: n, extents: [{ min: 0, max: n - 1 }, n > 0 ? { min, max } : { min: Infinity, max: -Infinity }] };
  }
}

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Walk">
        <RandomWalk steps={200} seed={7} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

Because it is a `DataSource`, it works with everything: put a `Decimator` round it, bind channels, zoom in. To edit data in place, call `invalidate()` after changing what `fill` reads; the version rises and everything refills.

### A transform

A stage that takes another stage as input (a decimator, a filter, a resampler) extends **`DataTransform`**. It has no storage, so it implements the stage interface directly: `version`, `pointCount`, `domain()`, `valueExtent()`, `channelExtent(name)` and `plan(context)`, which returns `{ capacity, fill(out) }`, and it takes its source as the first child. A plan may also say how many `rows` it has, and then `fill(out, from, to)` writes just those rows, with their extents and `rowOf`; a transform needs not, and a `Slice` above one fills every row and keeps its window. Slice as close to the source as you can, since a window of a decimated stage is a window of the decimated rows. Read `decimation.ts` for the full example; a transform is placed between the series and its source, as `Decimator` is.

## Scales

A `Scale` is the maths of an axis, and the one child of it. It maps a data range to 0..1 and back, and chooses ticks. Parameters are attributes, so a scale serializes like anything else, and a new transform is a new class with no change to axes.

| You implement | Does |
|---|---|
| `normalize(buffer, count, stride, offset, range)` | Value to 0..1, **in place** over an interleaved buffer. Invalid input (log of a non-positive) becomes `NaN`. |
| `denormalize(fraction, range)` | The inverse for one value: how a pointer position becomes data. |
| `constrain(range)` | Replace ends the scale cannot represent (a log range reaching zero). |
| `nice(range)` | Pull a raw range out to tidy ends. |
| `ticks(range, count)` | Tick values inside the range, about `count` of them. |
| `isLinear` *(getter)* | True when equal steps in the data are equal steps on the page: a straight line in data is straight on the screen. |
| `label(value)`, `labels(values, range)` *(optional)* | The text for a tick, when the scale knows better than a number does. |

The helpers `niceStep(raw)` and `clean(value)` (in `scale.ts`) choose steps of 1, 2, 5, 10 × a power of ten and trim binary noise.

```tsx live title="A symmetric log scale, for values that cross zero" height=280
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, Scale, lightTheme } from 'inkplot';
import type { Extent } from 'inkplot';

const f = (v: number) => Math.sign(v) * Math.log10(1 + Math.abs(v));
const g = (u: number) => Math.sign(u) * (10 ** Math.abs(u) - 1);

/** Linear near zero, logarithmic far from it: a log scale that can take negatives and zero. */
class SymlogScale extends Scale {
  normalize(buffer: Float64Array, count: number, stride: number, offset: number, range: Extent): void {
    const lo = f(range.min), span = f(range.max) - lo, inv = span > 0 ? 1 / span : 0;
    for (let k = 0, i = offset; k < count; k++, i += stride) buffer[i] = (f(buffer[i]!) - lo) * inv;
  }
  denormalize(fraction: number, range: Extent): number {
    const lo = f(range.min);
    return g(lo + fraction * (f(range.max) - lo));
  }
  constrain(range: Extent): Extent { return range; }
  nice(range: Extent): Extent { return range; }
  ticks(range: Extent): readonly number[] {
    const out: number[] = [];
    for (let e = 1; 10 ** e <= Math.max(Math.abs(range.min), Math.abs(range.max)); e++) {
      const v = 10 ** e;
      if (v <= range.max) out.push(v);
      if (-v >= range.min) out.push(-v);
    }
    if (range.min <= 0 && range.max >= 0) out.push(0);
    return out.sort((a, b) => a - b);
  }
}

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><SymlogScale /></Axis>
      <DomainSeries name="Change">
        <FlatDataSource data={[-800, -120, -4, 0, 3, 90, 600, 4000]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

Things that matter:

- **`normalize` must not allocate** and works in place: it is called for every point of every redraw. Stride and offset let it touch only its own column of an interleaved buffer.
- Return `NaN` for what the scale cannot place; the gap then flows through to the line.
- Say `isLinear` honestly. A line annotation drawn diagonally between two data points is straight only when both scales are linear; otherwise it is traced as a curve.
- Compose by delegating: `SqrtScale` keeps a private `LinearScale` and asks it for `nice` and `ticks`, choosing them in data space, where people read them.
- A category scale (`BandScale`) fixes its own range from its categories and gives `label(value)` the category's name.

## Time scales

`TimeScale` does everything that does not depend on a date library: choosing the interval, walking the calendar, `nice`, and the rule for labels (a tick that begins a day says the date, one that does not says the time). What does depend on a library is **four methods and a table** that a subclass gives:

| Member | Is |
|---|---|
| `startOf(t, unit)` | The start of the unit that holds `t`, in the scale's time zone. |
| `add(t, unit, n)` | `n` units later, by the calendar. A day is 23 or 25 hours when the clocks change. |
| `field(t, unit)` | Which one the unit is within the next one up: the hour of the day (0 to 23), the month of the year (0 to 11), the day of the month (1 to 31), the year itself. |
| `format(t, rank, spec)` | The text for a tick of this rank. |
| `defaultFormats` | A `spec` for each rank (`year`, `month`, `day`, `hour`, `minute`, `second`, `millisecond`, `full`). `spec`'s type is the adapter's own: `Intl.DateTimeFormatOptions` for the two built in, a format string for moment. |

The data is timestamps in milliseconds since the epoch; nothing else about time reaches the library. A scale over date-fns, Luxon or moment is one more subclass. Here is the whole of a small one, for a clock with a fixed offset from UTC, with formats as simple templates:

```tsx live title="A time scale with a fixed offset and template formats" height=260
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, TimeScale, lightTheme } from 'inkplot';
import { NUMBER, STRING } from 'inkplot';
import type { AttrTypesFor, TimeRank, TimeScaleAttributes, TimeUnit } from 'inkplot';

interface OffsetAttributes extends TimeScaleAttributes<string> {
  /** Minutes east of UTC. */
  offsetMinutes?: number;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => (n < 10 ? '0' : '') + n;
const RANKS: TimeRank[] = ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond', 'full'];

class OffsetTimeScale extends TimeScale<string, OffsetAttributes> {
  static override attrTypes = {
    ...TimeScale.attrTypes,
    offsetMinutes: NUMBER,
    formats: Object.fromEntries(RANKS.map((r) => [r, STRING])) as Record<TimeRank, typeof STRING>,
  } satisfies AttrTypesFor<OffsetAttributes>;

  get #offset(): number { return (this.attrs.offsetMinutes ?? 0) * 60000; }
  /** Wall-clock time as if it were UTC: shift in, work, shift out. */
  #wall(t: number): Date { return new Date(t + this.#offset); }

  protected startOf(t: number, unit: TimeUnit): number {
    const d = this.#wall(t), y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate();
    let wall: number;
    switch (unit) {
      case 'year': wall = Date.UTC(y, 0, 1); break;
      case 'month': wall = Date.UTC(y, mo, 1); break;
      case 'week': wall = Date.UTC(y, mo, day - ((d.getUTCDay() - this.weekStart + 7) % 7)); break;
      case 'day': wall = Date.UTC(y, mo, day); break;
      case 'hour': wall = Date.UTC(y, mo, day, d.getUTCHours()); break;
      case 'minute': wall = Date.UTC(y, mo, day, d.getUTCHours(), d.getUTCMinutes()); break;
      default: wall = Math.floor((t + this.#offset) / 1000) * 1000;
    }
    return wall - this.#offset;
  }

  protected add(t: number, unit: TimeUnit, n: number): number {
    const d = this.#wall(t);
    switch (unit) {
      case 'year': d.setUTCFullYear(d.getUTCFullYear() + n); break;
      case 'month': d.setUTCMonth(d.getUTCMonth() + n); break;
      case 'week': d.setUTCDate(d.getUTCDate() + 7 * n); break;
      case 'day': d.setUTCDate(d.getUTCDate() + n); break;
      case 'hour': d.setTime(d.getTime() + n * 3600000); break;
      case 'minute': d.setTime(d.getTime() + n * 60000); break;
      default: d.setTime(d.getTime() + n * 1000);
    }
    return d.getTime() - this.#offset;
  }

  protected field(t: number, unit: Exclude<TimeUnit, 'week'>): number {
    const d = this.#wall(t);
    switch (unit) {
      case 'year': return d.getUTCFullYear();
      case 'month': return d.getUTCMonth();
      case 'day': return d.getUTCDate();
      case 'hour': return d.getUTCHours();
      case 'minute': return d.getUTCMinutes();
      default: return d.getUTCSeconds();
    }
  }

  protected get defaultFormats(): Record<TimeRank, string> {
    return { year: 'yyyy', month: 'MMM', day: 'MMM d', hour: 'HH:mm', minute: 'HH:mm', second: 'HH:mm:ss', millisecond: 'HH:mm:ss', full: 'yyyy MMM d HH:mm:ss' };
  }
  protected format(t: number, _rank: TimeRank, spec: string): string {
    const d = this.#wall(t);
    return spec.replace(/yyyy|MMM|HH|mm|ss|d/g, (token) => {
      switch (token) {
        case 'yyyy': return String(d.getUTCFullYear());
        case 'MMM': return MONTHS[d.getUTCMonth()]!;
        case 'HH': return pad(d.getUTCHours());
        case 'mm': return pad(d.getUTCMinutes());
        case 'ss': return pad(d.getUTCSeconds());
        default: return String(d.getUTCDate());
      }
    });
  }
}

const start = Date.UTC(2026, 5, 10, 22);       // 22:00 UTC
const hour = 3600000;

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><OffsetTimeScale offsetMinutes={330} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Load">
        <FlatDataSource data={[3, 5, 4, 8, 6, 7, 5]} regularDomain-start={start} regularDomain-step={hour * 2} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

The formats are the adapter's to define, so they are user-written strings here and `formats={{ day: 'd MMM' }}` replaces one. For the library's own two, see `time-intl.ts` and `time-temporal.ts`: each is a page of code, most of it the clock arithmetic of its library.

Dependencies stay one way: a time scale imports the shared `time.ts`, never another adapter, so a bundle holds only the date library you import.

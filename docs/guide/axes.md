# Axes and scales

An **axis** draws a dimension of a plane (its line, ticks, labels and title) and decides what range of values it shows. Its one child is a **scale**, which does the maths: how a value becomes a position from 0 to 1, where the ticks go, and what they say.

```tsx
<Axis orientation="left" title="Revenue" include={[0]} nice><LinearScale /></Axis>
```

## Choosing the range

You rarely set a range. An axis fits itself to the series drawn against it and rounds nothing unless you ask. These attributes adjust what it chooses; the order here is the order of precedence, strongest first.

| Attribute | Meaning |
|---|---|
| `min`, `max` | Fix an end. Beats everything else, including `nice`. |
| `include` | Values the range must cover: `[0]` to anchor at zero. |
| `rangePadding` | Extra room at both ends, as a fraction of the data's span. |
| `nice` | Round the ends outwards to tidy tick values. |
| `inverted` | Run from max to min along the axis. |

```tsx live title="An inverted axis and a range that starts at zero" height=300
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane frame>
      <Axis orientation="bottom" title="Rank (1 is best)" tickStep={1} inverted><LinearScale /></Axis>
      <Axis orientation="left" title="Score" nice include={[0]}><LinearScale /></Axis>
      <DomainSeries name="Score">
        <FlatDataSource data={[91, 84, 80, 66, 61, 52]} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

Zooming (`PanZoom`) sets a temporary *view range* that overrides all of the above, and putting it back returns to them. `axis.range` is the range in force after the last flush, and `axis.isZoomed` says whether a view is set.

## Ticks and labels

| Attribute | Meaning |
|---|---|
| `ticks` | Ticks exactly here: an array, or a function of the range that returns one. Those outside the range are not drawn. Beats `tickStep` and `tickCount`. |
| `tickStep` | A tick at every multiple of this step. Beats `tickCount`. |
| `tickCount` | About this many ticks, whatever the length. Without it, the number depends on how long the axis is on screen. |
| `format` | A function from a value to its label. |
| `locale` | A BCP 47 tag for how the axis writes its numbers; default the chart's `locale`. A `format` beats it. |
| `title` | The axis title. |

A scale picks "nice" tick values (1, 2, 5, 10 times a power of ten) when you give none, and thins them to fit the length.

```tsx live title="Chosen ticks and formatted labels" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const hours = (v: number) => `${String(Math.floor(v)).padStart(2, '0')}:00`;

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" ticks={[0, 6, 12, 18, 24]} format={hours} title="Time of day"><LinearScale /></Axis>
      <Axis orientation="left" tickStep={25} format={(v: number) => `${v}%`}><LinearScale /></Axis>
      <DomainSeries name="Load">
        <FlatDataSource data={[10, 8, 25, 60, 85, 70, 40, 20, 12]} regularDomain-start={0} regularDomain-step={3} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

## Where an axis goes

| Attribute | Meaning |
|---|---|
| `orientation` | `bottom`, `top`, `left`, `right` on a Cartesian plane; `angle`, `radius` on a polar one. Default: `bottom`, then `left`, `top`, `right` for the first, second… axis. |
| `titlePosition` | The edge of the plot the title sits at (`top`, `bottom`, `left`, `right`). Past the labels for an axis fixed to that side; otherwise at the middle of the edge. |
| `titleDirection` | `horizontal` or `vertical`. Default: along the edge it is at. |
| `crossesAt`, `crossAxis` | Float across the plot at a value of the other axis. See [Planes](planes.md#floating-axes). |
| `visible` | `false` hides the axis and its title but keeps it in the tree, so series still use its range. |

Axes on one side stack outwards from the plot in child order, each taking the room it needs. To use an axis for only some series, give it an `id` and name it from the series with `domainAxis` or `valueAxis` ([recipe](../start/recipes.md#show-a-series-on-a-second-axis)).

`axis.ruler` is the curve the axis is drawn along: a straight edge, a floating line, a ring or a spoke. It is the one thing an axis draws against, which is why an axis needs no per-shape code.

## Scales

| Scale | Maps | Ticks | Attributes |
|---|---|---|---|
| `LinearScale` | Equal steps in the data are equal distances. | 1, 2, 5, 10 × a power of ten. | |
| `LogScale` | Equal *ratios* take equal distances. Values that are not positive have no place and are drawn as gaps. | Powers of the base; with only a few decades, 2 and 5 times each as well. | `base` (default 10) |
| `SqrtScale` | Square root: gives zero a place while spreading small values out, as for counts or areas. Negative values are gaps. | Like linear. | |
| `BandScale` | Categories: the values 0, 1, 2… are the positions of equal bands. | One per category, labelled with its name. Labels are never thinned. | `categories` (required), `bandGap` (fraction of each band left empty, default 0.2) |
| `IntlTimeScale`, `TemporalTimeScale` | Timestamps, on the calendar. | Midnights, the hour, the first of the month… | `timeZone`, `weekStart`, `locale`, `formats` |

A scale is a child of its axis, and replaceable on a live chart: `axis.setChild(0, new LogScale())`. Switching a chart between linear and log is one call.

### Band scales

The domain values of a band scale are indexes into `categories`. A series with a `regularDomain` of `start: 0, step: 1` puts its first value on the first category, and so on. The value is drawn at the middle of its band, and bars fill the band less the `gap`. The range is fixed by the categories (data cannot change it).

```tsx live title="Category axis with a wide gap" height=240
import { Axis, BandScale, BarPath, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']} bandGap={0.5} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Tickets">
        <FlatDataSource data={[14, 22, 9, 31, 18]} regularDomain-start={0} regularDomain-step={1} />
        <BarPath />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

For horizontal bars, put the band axis on the left and the value axis at the bottom.

### Time scales

The data is JavaScript timestamps: milliseconds since 1970, as `Date.now()`, `Date.parse(iso)` and `Temporal.Instant#epochMilliseconds` give. (A Unix timestamp in seconds needs `* 1000`.) Nothing else about time reaches the library: it is numbers all the way down, so panning, zooming, stacking, decimating and hit-testing work as on any linear axis. What the time scale adds is where the ticks go and what they say.

Ticks fall on the calendar: a day is 23 or 25 hours when the clocks change, and a month has the days it has. The scale picks the interval (seconds to years) that gives about the right number of ticks. Labels follow the tick, not the axis: a tick that begins a day says the date ("Jun 11"), however finely the axis is divided, and one that does not says the time at the precision of the ticks around it ("22:10").

| Attribute | Meaning |
|---|---|
| `timeZone` | An IANA name (`'Europe/London'`), `'UTC'` (the default, so a chart renders the same wherever it is rendered) or `'local'` (the runtime's). |
| `weekStart` | First day of the week, 0 for Sunday to 6. Default 1, Monday. |
| `locale` | The language labels are written in: a BCP 47 tag. Default: the chart's `locale`, else the platform's: the browser's language in the DOM, `en-US` for a `StringPlatform` (so exports and server rendering are the same everywhere). |
| `formats` | Replaces the format of a rank (`year`, `month`, `day`, `hour`, `minute`, `second`, `millisecond`, and `full`, the reading of one instant, as in a tooltip). For the two built in, each is `Intl.DateTimeFormatOptions`. |

```tsx live title="A time axis in another time zone, language and format" height=260
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, IntlTimeScale, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const hour = 60 * 60 * 1000;
const start = Date.UTC(2024, 2, 30, 12);
const power = Array.from({ length: 72 }, (_, i) => 40 + 25 * Math.sin((i / 24) * 2 * Math.PI));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" title="Clocks change on 31 March">
        <IntlTimeScale timeZone="Europe/Paris" locale="fr" formats={{ day: { weekday: 'short', day: 'numeric' } }} />
      </Axis>
      <Axis orientation="left" title="MW"><LinearScale /></Axis>
      <DomainSeries name="Demand">
        <FlatDataSource data={power} regularDomain-start={start} regularDomain-step={hour} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

`TemporalTimeScale` does the same with the runtime's `Temporal` (or one given as the `temporal` attribute, from a polyfill; that attribute is set from code, not markup). A scale over date-fns, Luxon or moment is one more subclass: see [Custom data and scales](../extending/custom-data-and-scales.md#time-scales).

> **Note.** `IntlTimeScale` and `TemporalTimeScale` each carry their own small adapter code, and the generic part is shared. Import only the one you use.

## Reading an axis

An axis can also be asked things, after a flush:

| | |
|---|---|
| `axis.range` | The range in force. |
| `axis.fractionOf(value)` | Where a value is along it, 0 to 1. |
| `axis.denormalize(fraction)` | The value at a fraction. |
| `axis.formatValue(value)` | A value as text the way a tooltip says it: `format`, else the scale's labelling, else five significant figures. |
| `axis.getTicks(length)` | The ticks (`{ value, label, major }`) for an axis drawn that long. |
| `axis.scale` | The scale element. |

## Locale

The whole picture, with right to left and an i18n-framework recipe, is in [Locales and languages](i18n.md).

Set `locale` on the chart and every axis writes its numbers that language's way, and every time scale its dates; the tooltip's readings follow, since they come from the same axes. `locale` on an axis or a time scale beats the chart's, and a `format` function beats both.

```tsx live title="One locale for the whole chart" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme} locale="de">
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Umsatz">
        <FlatDataSource data={[12000, 15500, 14200, 18900, 21000]} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

The words the library says itself (a chart summary, a tooltip's "channel: value" lines, the screen-reader texts) are not translated by `locale`: they come from components that take your words (`ChartSummary`'s `text`, a tooltip's `format`), so nothing English is built into the core. Numbers inside a tooltip's channel lines use plain digits; give the tooltip a `format` for those.


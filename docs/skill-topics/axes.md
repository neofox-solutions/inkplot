# inkplot topic: axes and scales

For: dates and times, categories, log and sqrt scales, tick labels and formats, axis limits, a second or reversed axis, number and date language.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Dates on x


```tsx check title="Time series from objects"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, DomainSeries, IntlTimeScale, Legend, LinePath, LinearCurve, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const rows = [
  { date: '2024-01-01', views: 120, signups: 12 },
  { date: '2024-01-02', views: 150, signups: 18 },
  { date: '2024-01-03', views: 140, signups: 15 },
];
const line = (name: string, field: 'views' | 'signups') => (
  <DomainSeries name={name}>
    <ObjectDataSource source={rows} domain={(row) => Date.parse(row.date)} value={field} />
    <LinePath><LinearCurve /></LinePath>
  </DomainSeries>
);

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><IntlTimeScale timeZone="UTC" /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {line('Views', 'views')}
      {line('Signups', 'signups')}
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
) as Chart;
```

## Notes

- Time values are milliseconds since 1970 (`Date.UTC(…)`, `Date.parse(…)`). Daily values from 1 March 2024 in a `FlatDataSource`: `regularDomain-start={Date.UTC(2024, 2, 1)} regularDomain-step={86400000}`; any start works (`regularDomain-start={5}` starts x at 5).
- `orientation` of an `Axis`: `'bottom'`, `'top'`, `'left'`, `'right'` for `CartesianPlane`; `'angle'`, `'radius'` for polar and radar.

| To… | Use |
|---|---|
| Set exact axis limits | `<Axis min={0} max={100}>`; keep zero in range: `include={[0]}`; headroom: `rangePadding` |
| Label ticks yourself | ``format={(v) => `${v}%`}``, `ticks={[0, 50, 100]}`, `tickStep={1}`, `tickCount={5}` |
| Reverse an axis | `inverted` |
| Second y axis | `<Axis id="b" orientation="right">` and `<DomainSeries valueAxis="b">` |
| Numbers and dates in a language | `<Chart locale="de">` (an axis or time scale can set its own); `format` beats it; the library's own words come from components that take yours |

`BandScale` puts categories at 0, 1, 2…: the data's domain is the category's index.

## Attributes of this topic's elements

An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`.

<!-- api:start -->
### LogScale

Logarithmic.

**In** an axis · **Holds** none

| Attribute | Type | |
|---|---|---|
| `base` | `number` | The logarithm's base: each power of it is one step along the axis. Default 10. |

### SqrtScale

Square root: gives zero a place.

**In** an axis · **Holds** none

No attributes of its own.

### BandScale

Categories in equal bands.

**In** an axis · **Holds** none

| Attribute | Type | |
|---|---|---|
| `categories` (required) | `readonly string[]` | Category labels in order; the domain values are indexes into this list. |
| `bandGap` | `number` | Fraction of each band left empty between neighbours, 0..1. Default 0.2. |

### IntlTimeScale

Timestamps on the calendar, with Date and Intl.

**In** an axis · **Holds** none

| Attribute | Type | |
|---|---|---|
| `locale` | `string` | The language the labels are written in (a BCP 47 tag). Default: the runtime's. |
| `timeZone` | `string` | An IANA time zone name, 'UTC' or 'local' (the runtime's). Default 'UTC'. |
| `weekStart` | `number` | The first day of a week, 0 for Sunday to 6. Default 1, Monday. |
| `formats` | `Partial<Record<TimeRank, Format>>` | Replaces the default format of a rank. |

### TemporalTimeScale

Timestamps on the calendar, with Temporal.

**In** an axis · **Holds** none

| Attribute | Type | |
|---|---|---|
| `locale` | `string` | The language the labels are written in (a BCP 47 tag). Default: the runtime's. |
| `temporal` | `Opaque<TemporalLike>` | Where `Temporal` comes from, when the runtime has none. |
| `timeZone` | `string` | An IANA time zone name, 'UTC' or 'local' (the runtime's). Default 'UTC'. |
| `weekStart` | `number` | The first day of a week, 0 for Sunday to 6. Default 1, Monday. |
| `formats` | `Partial<Record<TimeRank, Format>>` | Replaces the default format of a rank. |
<!-- api:end -->

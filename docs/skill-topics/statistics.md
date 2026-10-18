# inkplot topic: statistics

For: histograms, heat maps, density, box plots, trendlines (linear, polynomial, sinusoidal, loess), error bars and bands.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Examples


A transform sits between the series and its source and replaces the points. Each of these is one structure: source inside transform inside series, then renderers.

```tsx check title="Histogram"
/** @jsxImportSource inkplot */
import { Axis, BarPath, CartesianPlane, Chart, Density, DomainSeries, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const rows = Array.from({ length: 300 }, (_, i) => ({ v: 50 + 12 * Math.sin(i * 12.9898) }));

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" title="Value"><LinearScale /></Axis>
      <Axis orientation="left" title="Count" include={[0]}><LinearScale /></Axis>
      <DomainSeries name="Count">
        <Density width={4}>
          <ObjectDataSource source={rows} domain="v" value="v" />
        </Density>
        <BarPath width={0.95} />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
) as Chart;
```

A histogram's value axis is fitted to the bin centres, so the bottom axis starts a little inside the first bin: set `min={0}` on it to start at 0 (or at any value you want). The count axis ends at the tallest bar; add `nice` to it for some headroom.

To colour some bins differently (say, those above a threshold), bind the bar's fill to the bin's `domain` channel with a function: `<BarPath bind={{ fill: { channel: 'domain', map: (x) => (x > 15 ? '#d1495b' : '#4c78a8') } }} />`. JSX spreads (`<Density {...bins}>`) are fine. `BarPath width={0.95}` is the fraction of each bin a bar fills (the rest is the gap); `include={[0]}` keeps zero on the count axis (axes otherwise fit the data). `Density` (one dimension, `by` defaults to `['domain']`) outputs one point per bin: domain is the bin centre, value is `count`. `width` is the bin size in data units; `bins={n}` fixes the count instead. Empty bins are kept as zeros. The source's `domain` and `value` can name the same column; only `domain` is counted. For each bin's share of the total use `stat="fraction"` (0 to 1; the other values are `'count'`, `'sum'`, `'mean'`, `'density'`), and show it as a percent with `<Axis format={(v) => `${Math.round(v * 100)}%`}>`.

```tsx check title="Heat map from raw points"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, ColorAxis, ColorKey, Density, HeatMap, LinearScale, ObjectDataSource, XYSeries, lightTheme } from 'inkplot';

const pts = Array.from({ length: 2000 }, (_, i) => ({ x: Math.sin(i * 12.9898) * 3, y: Math.cos(i * 78.233) * 2 }));

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" title="x"><LinearScale /></Axis>
      <Axis orientation="left" title="y"><LinearScale /></Axis>
      <XYSeries name="Points" x="domain" y="value">
        <Density by={['domain', 'value']} width={0.5}>
          <ObjectDataSource source={pts} domain="x" value="y" />
        </Density>
        <HeatMap cellWidth={0.5} bind={{ fill: { axis: 'heat', channel: 'count' } }} />
      </XYSeries>
    </CartesianPlane>
    <ColorAxis id="heat" ramp="viridis" title="Points"><LinearScale /></ColorAxis>
    <ColorKey dimension="heat" side="right" />
  </Chart>
) as Chart;
```

Two dimensions: `by={['domain', 'value']}` (domain is x, value is y, or any channel name). The output has `domain` (x of the cell centre), `value` (y), `count`, `sum`, `mean`, `fraction`, `density`, `width` and `height`. `x="domain" y="value"` is what lets an `XYSeries` use the `Density` output. Colour by `bind={{ fill: { axis: 'heat', channel: 'count' } }}` (the channel is any output name below: `count`, `sum`, `mean`, `fraction`, `density`); the ramp names (`'viridis'`, `'magma'`, `'turbo'`, `'blues'`, `'greys'`, `'diverging'`) are set on the `ColorAxis` (see `markers-color`). The axes reach the outer edges of the outer cells. `cellWidth` alone draws square cells; set `cellHeight` too for rectangles. They must match the bin `width` (a number for both, or `[w, h]` such as `width={[2, 1]}` with `cellWidth={2} cellHeight={1}`). Cells with no points are left out in two dimensions (`empty="omit"` is the default there; one-dimensional bins keep zeros).

```tsx check title="Box plot from samples, with outliers"
/** @jsxImportSource inkplot */
import { Axis, BandScale, BoxPath, BoxStats, CartesianPlane, Chart, DomainSeries, DotMarker, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const samples = Array.from({ length: 120 }, (_, i) => ({ g: i % 3, v: 10 + (i % 3) * 3 + 4 * Math.sin(i * 12.9898) + (i === 7 ? 25 : 0) }));
const source = () => <ObjectDataSource source={samples} domain="g" value="v" />;

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['A', 'B', 'C']} /></Axis>
      <Axis orientation="left" title="Measurement"><LinearScale /></Axis>
      <DomainSeries name="Spread">
        <BoxStats>{source()}</BoxStats>
        <BoxPath />
      </DomainSeries>
      <DomainSeries name="Outliers">
        <BoxStats output="outliers">{source()}</BoxStats>
        <DotMarker size={3} />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
) as Chart;
```


The shared source is a function because one element has one parent (rule 14). `BoxStats` takes raw samples (any order) and groups them by `domain` (0, 1, 2… on a `BandScale`). Its output channels are `min q1 median q3 max mean sd sem n`; the point's value is the median. `BoxPath` reads `min q1 q3 max` by those names, and the median is the point's value. Its attributes `low q1 median q3 high` only matter to rename channels, for example when you already have the numbers: `<ObjectDataSource source={rows} domain="g" value="med" channels={{ min: 'lo', q1: 'q1', q3: 'q3', max: 'hi' }} />` then `<BoxPath />` with no `BoxStats`.

From numbers you already have (no samples), give the median as `value` (it must be the median column) and the other four as channels, then `BoxPath` alone. Always declare `min`, `q1`, `q3` and `max` in `channels` (even when the columns are already called that), or the chart throws `the data has no channel "min"`:

```tsx check title="Box plot from numbers you already have"
/** @jsxImportSource inkplot */
import { Axis, BandScale, BoxPath, CartesianPlane, Chart, DomainSeries, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const rows = [
  { i: 0, min: 12, q1: 20, median: 26, q3: 34, max: 61 },
  { i: 1, min: 18, q1: 30, median: 41, q3: 55, max: 90 },
];

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['API', 'Web']} /></Axis>
      <Axis orientation="left" title="Response (ms)"><LinearScale /></Axis>
      <DomainSeries name="Latency">
        <ObjectDataSource source={rows} domain="i" value="median" channels={{ min: 'min', q1: 'q1', q3: 'q3', max: 'max' }} />
        <BoxPath />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
) as Chart;
```


```tsx check title="Scatter with a trendline"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, CircleMarker, DomainSeries, LinearCurve, LinearScale, LinePath, LinearTrend, Legend, ObjectDataSource, XYSeries, lightTheme } from 'inkplot';

const rows = Array.from({ length: 80 }, (_, i) => ({ x: i / 4, y: 3 + 0.8 * (i / 4) + 2 * Math.sin(i * 12.9898) }));

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries name="Data">
        <ObjectDataSource source={rows} domain="x" channels={{ x: 'x', y: 'y' }} />
        <CircleMarker size={4} />
      </XYSeries>
      <DomainSeries name="Trend">
        <LinearTrend extend={0.05}>
          <ObjectDataSource source={rows} domain="x" value="y" isSorted />
        </LinearTrend>
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
) as Chart;
```

A trendline is its own `DomainSeries` (a line over the same data) beside the scatter; its source needs `domain` and `value` and `isSorted` if sorted. It outputs a smooth line, one point per pixel, with `extend` 0 (the line stops at the data) unless you set it. Choose its colour with `stroke` on the `LinePath`. Other fits: `PolynomialTrend degree`, `SinusoidalTrend period?`, `LoessTrend smoothness` (0 joins the points, 1 is the straight line), `MeanTrend smoothness` (the same, but a weighted average that never leaves the range of the data and stays flat past the ends: the stable choice; 1 is the mean). `extend={0.1}` runs the line 10% of the span past each end.


| To… | Use |
|---|---|
| Error bars / a band | A channel of the data (`channels={{ sd: 'sd' }}`) and `<ErrorBars error="sd" />` or `<ErrorBand error="hi" negativeError="lo" />` in the series; `mode="relative"` for fractions |
| Chart data as a table | `readTable(node)` (a source, transform, trendline or `series.data`): typed-array columns and `rows()` |

## Attributes of this topic's elements

An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`.

<!-- api:start -->
### BoxPath

Box and whisker from min, q1, median, q3, max channels.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `low` | `string` | The channel of the lower whisker's end. Default 'min'. |
| `q1` | `string` | The channel of the first quartile (the foot of the box). Default 'q1'. |
| `median` | `string` | The channel of the median. Default: the series' own value, which is what a data source's `value` names. |
| `q3` | `string` | The channel of the third quartile (the top of the box). Default 'q3'. |
| `high` | `string` | The channel of the upper whisker's end. Default 'max'. |
| `capFraction` | `number` | Width of the cap on each whisker, as a fraction of the box's width; 0 for none. Default 0.5. |

### BoxStats

Samples in; per group min q1 median q3 max mean sd sem n out (or the outliers).

**In** a series · **Holds** 1 data

| Attribute | Type | |
|---|---|---|
| `output` | `'summary' \| 'outliers'` | 'summary' (the default): a point for each group. 'outliers': a point for each sample beyond the whiskers. |
| `fence` | `number \| 'minmax'` | How far the whiskers may reach past the box, in interquartile ranges (default 1.5), or 'minmax' for the whole range. |
| `method` | `'inclusive' \| 'exclusive'` | How a quartile is found between samples. Default 'inclusive'. |
| `value` | `'median' \| 'mean'` | Which statistic is the point's value: 'median' (the default; what a box is drawn round) or 'mean' (what error bars from `sd` or `sem` are drawn round). |

### Density

Bins points over any number of dimensions: count, sum, mean, fraction, density per bin (a histogram with BarPath).

**In** a series · **Holds** 1 data

| Attribute | Type | |
|---|---|---|
| `by` | `readonly string[]` | The dimensions to bin: 'domain', 'value' or channel names. Default ['domain']. |
| `weight` | `string` | What each point counts for: a channel name or 'value'. Default: 1 for each point. |
| `halfLife` | `number` | Points count for less the further they are before the last one the source delivers (in the domain's order): one `halfLife` points back counts half. Default: all alike. |
| `stat` | `Stat` | The value of a one-dimensional output: 'count', 'sum', 'mean', 'fraction' (the share of the total, 0 to 1) or 'density'. Default 'count', or 'sum' with a `weight`. |
| `width` | `number \| readonly number[]` | Bin size in each dimension's units: one number for all, or one for each dimension. |
| `bins` | `number \| readonly number[]` | Number of bins in each dimension, spread evenly over its extent (by default the data's own range). |
| `origin` | `number \| readonly number[]` | Where a bin edge falls when `width` is used, in each dimension: edges are at `origin` plus whole widths. Default 0. |
| `extent` | `Extent \| readonly (Extent \| null)[]` | The span to bin over in each dimension, as `{ min, max }` (one for all, or an array with one for each); points outside are left out. Default: the data's extent. |
| `maxBins` | `number` | Most bins along a dimension when the size is chosen by the rule. Default 200. |
| `empty` | `'keep' \| 'omit'` | 'keep' bins with no points as zeros, 'omit' leaves them out. Default 'keep' for one dimension, 'omit' for more. |

### HeatMap

A rectangle at each point, coloured by a channel; with `Density`, a heat map.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `cellWidth` | `number` | The size of a cell along the first axis, in data units. Default: the `widthChannel`, or `cellHeight` when only that is given (square cells). |
| `cellHeight` | `number` | The size along the second axis. Default: the `heightChannel`, or `cellWidth` when only that is given (square cells). |
| `widthChannel` | `string` | The channel with each cell's width. Default 'width'. |
| `heightChannel` | `string` | The channel with each cell's height. Default 'height'. |
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |

### LinearTrend

The least-squares line through its source, sampled across the domain.

**In** a series · **Holds** 1 data

| Attribute | Type | |
|---|---|---|
| `x` | `string` | A channel of the source to fit against instead of its domain. |
| `extend` | `number \| readonly [number, number]` | How far past the data the line goes at each end, as a fraction of the data's span: one number, or `[before, after]`. Default 0. |
| `count` | `number` | Samples, evenly spaced over the whole span, always. |

### PolynomialTrend

A polynomial fitted to its source (`degree`).

**In** a series · **Holds** 1 data

| Attribute | Type | |
|---|---|---|
| `degree` | `number` | The highest power, 1 to 12. Default 2. |
| `x` | `string` | A channel of the source to fit against instead of its domain. |
| `extend` | `number \| readonly [number, number]` | How far past the data the line goes at each end, as a fraction of the data's span: one number, or `[before, after]`. Default 0. |
| `count` | `number` | Samples, evenly spaced over the whole span, always. |

### SinusoidalTrend

A constant plus a sine wave fitted to its source, of a given `period` or the best one.

**In** a series · **Holds** 1 data

| Attribute | Type | |
|---|---|---|
| `period` | `number` | The period in the domain's units. |
| `x` | `string` | A channel of the source to fit against instead of its domain. |
| `extend` | `number \| readonly [number, number]` | How far past the data the line goes at each end, as a fraction of the data's span: one number, or `[before, after]`. Default 0. |
| `count` | `number` | Samples, evenly spaced over the whole span, always. |

### LoessTrend

Local linear regression: `smoothness` 0 joins the points, 1 is the line.

**In** a series · **Holds** 1 data

| Attribute | Type | |
|---|---|---|
| `smoothness` | `number` | 0 to 1: 0 joins the points, 1 is the least-squares line, and between them the line is smoother the larger it is. Default 0.5. |
| `kernel` | `'tricube' \| 'gaussian'` | How a point's weight falls with its distance. Default 'tricube'. |
| `x` | `string` | A channel of the source to fit against instead of its domain. |
| `extend` | `number \| readonly [number, number]` | How far past the data the line goes at each end, as a fraction of the data's span: one number, or `[before, after]`. Default 0. |
| `count` | `number` | Samples, evenly spaced over the whole span, always. |

### MeanTrend

A weighted moving average: never leaves the data's range, flat past the ends. `smoothness` 0 joins the points, 1 is the mean.

**In** a series · **Holds** 1 data

| Attribute | Type | |
|---|---|---|
| `smoothness` | `number` | 0 to 1: 0 joins the points, 1 is their mean, and between them the line is smoother the larger it is. Default 0.5. |
| `kernel` | `'tricube' \| 'gaussian'` | How a point's weight falls with its distance. Default 'tricube'. |
| `x` | `string` | A channel of the source to fit against instead of its domain. |
| `extend` | `number \| readonly [number, number]` | How far past the data the line goes at each end, as a fraction of the data's span: one number, or `[before, after]`. Default 0. |
| `count` | `number` | Samples, evenly spaced over the whole span, always. |

### ErrorBars

Whiskers with caps from an error channel (error, optional negativeError; absolute or relative).

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `capWidth` | `number` | Width in pixels of the cap at each end of a whisker; 0 for none. Default 8. |
| `error` (required) | `string` | The channel with how far above the value each point may be. |
| `negativeError` | `string` | The channel with how far below. Default: the same as `error`. |
| `mode` | `'absolute' \| 'relative'` | What the numbers mean: units of the value (default), or a fraction of it. |
| `along` | `'value' \| 'domain'` | Which way the error runs. Default 'value'. |

### ErrorBand

The region between value minus and plus an error channel.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `error` (required) | `string` | The channel with how far above the value each point may be. |
| `negativeError` | `string` | The channel with how far below. Default: the same as `error`. |
| `mode` | `'absolute' \| 'relative'` | What the numbers mean: units of the value (default), or a fraction of it. |
| `along` | `'value' \| 'domain'` | Which way the error runs. Default 'value'. |
<!-- api:end -->

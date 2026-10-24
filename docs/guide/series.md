# Series and renderers

A **series** is one thing drawn on a plane: one data source and any number of **renderers** that draw it. The series finds its data's extents and reports them to its axes, reads the part of the data in view, and places the points in pixels. The renderers only draw those points. Keeping the two apart is why one source can be a line, an area, bars and markers at once, and why any renderer works on any plane.

```tsx
<DomainSeries name="Revenue">          {/* 1. the data */}
  <FlatDataSource … />
  <AreaPath opacity={0.2}><LinearCurve /></AreaPath>   {/* 2. renderers, drawn in order */}
  <LinePath><LinearCurve /></LinePath>
</DomainSeries>
```

## Series

| Class | Points | Use |
|---|---|---|
| `DomainSeries` | A value at each position along a domain, drawn against two axes (domain on the first, value on the second). | Lines, areas, bars, anything over a domain, on any plane. |
| `XYSeries` | Two values per point, one on each axis, joined in the order the source holds them. | Scatter plots, trajectories, loops. |

Both take these attributes:

| Attribute | Meaning |
|---|---|
| `name` | What the series is called: its legend entry and its tooltip heading. A series without a name is not listed in a legend. |
| `visible` | `false` takes it out of the drawing, the axes' ranges and the pointer's reach, and keeps it in the tree. |
| `hit` | How pointer hits find it: `'point'`, `'line'`, `'area'`, `'shape'`, an options object, or `false` for never ([Interaction](interaction.md#hit-testing)). |
| `missing` | What a missing value means ([below](#gaps)). |
| `id`, `meta`, `style` | As on every element. |

`DomainSeries` adds `domainAxis` and `valueAxis` (an axis or its id) to say which axes it is drawn against; the default is the plane's first axis on each side. `XYSeries` has `xAxis`, `yAxis`, and `x` and `y`, the names of the channels that are x and y (default `'x'` and `'y'`).

**The series colour.** A series takes a colour from the theme's palette, by its position among the plane's series (round again when there are more series than colours). It is only a default: a renderer's own `stroke` or `fill`, or any `style`, beats it. Hidden series keep their place, so toggling one never changes the others' colours.

### `DomainSeries`

The source delivers ascending in the domain and only the visible part is read, so a view that zooms in refills from the full data, and the value axis fits what is in view. On a polar plane the domain is the angle and the value the radius.

### `XYSeries`

x and y are **channels** of the source, named by the `x` and `y` attributes (default `'x'` and `'y'`, so a source that calls its columns that needs no attributes at all). The points are drawn in the order the source stores them, whatever x is: a path wanders, and nothing sorts it (leave `domain` out and the order is the row's index). The source's own columns are always there too, as the channels `'domain'` and `'value'`: that is how a transform's output (a `Density`, a trendline) is read. Name the domain as x (`x="domain"`) and the points are asked for ascending along it instead, as a `DomainSeries` asks, which is what you want when the x values are the domain and should be sorted. Because the order is all there is to go by:

- every point is always read, whatever the view: there is nothing to window by;
- a `Decimator` refuses it (it needs `domain` and `value` first, ascending: the `DomainSeries` kind);
- an axis fits *all* the data, and zooming one axis does not refit the other to the points in view.

```tsx live title="A trajectory: an XY series joined in order" height=300
import { Axis, CartesianPlane, Chart, LinePath, LinearCurve, LinearScale, ObjectDataSource, PanZoom, XYSeries, lightTheme } from 'inkplot';

// A Lissajous curve. No domain: a row's place in the order is its index. `wrap` joins the end to the start.
const n = 400;
const path = Array.from({ length: n }, (_, i) => ({ x: Math.sin(3 * ((i / n) * 2 * Math.PI)), y: Math.sin(2 * ((i / n) * 2 * Math.PI) + 0.5) }));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane frame>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries name="Path">
        <ObjectDataSource source={path} channels={{ x: 'x', y: 'y' }} wrap={n} />
        <LinePath strokeWidth={1.5}><LinearCurve /></LinePath>
      </XYSeries>
      <PanZoom />
    </CartesianPlane>
  </Chart>
);
```

## Gaps

A `NaN` value is a gap. `missing` says what that means:

| `missing` | Meaning |
|---|---|
| `'break'` (default) | Nothing is there: a line stops and starts again, an area splits. |
| `'connect'` | The line goes straight across to the next value there is. |
| `'zero'` | The value is 0, and the axis reaches it. |

Markers and bars draw nothing at a gap whichever it is; a tooltip and a drag read the data's own values. In a [stack](#stacks), `'zero'` is not applied: a gap leaves its layer out.

```tsx live title="The three kinds of gap" height=280
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const data = [3, 5, NaN, NaN, 6, 4];
const series = (gaps: 'break' | 'connect' | 'zero', offset: number) => (
  <DomainSeries name={gaps} missing={gaps}>
    <FlatDataSource data={data.map((v) => v + offset)} regularDomain-start={0} regularDomain-step={1} />
    <LinePath><LinearCurve /></LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left" include={[0]}><LinearScale /></Axis>
      {series('break', 6)}
      {series('connect', 3)}
      {series('zero', 0)}
    </CartesianPlane>
    <Legend />
  </Chart>
);
```

## Renderers

Every renderer shares these attributes:

| Attribute | Meaning |
|---|---|
| `stroke`, `strokeWidth`, `fill`, `opacity` | The look. Each is a [style](styling.md) property set directly; it beats the theme and any `style` block. Default: the theme's look, with the series' palette colour. |
| `bind` | Attributes fed from data instead of fixed (markers, bars, the heat map and the gradient paths; see [Mapped dimensions](mapped.md)). |
| `maxNodes` | Most paths this renderer may create when styles are bound (default 1000). |

| Renderer | Draws | Children | Notes |
|---|---|---|---|
| `LinePath` | One path through the points. | a curve | A gap lifts the pen. |
| `AreaPath` | The region between the line and a baseline. | a curve | `baseline` (default 0). No outline unless you give `stroke`. |
| `GradientLinePath`, `GradientAreaPath` | A line, or an area, coloured along its length by a channel. | a curve | `bind` a `stroke` (line) or `fill` and `stroke` (area); `maxStops`. See [Gradient lines and areas](mapped.md#gradient-lines-and-areas). |
| `BarPath` | One path holding every bar. | | `width`, `baseline`, `from`. The cost of a bar chart is its path text, not a node per bar. |
| `StemPath` | Bars as stems: a stroked line from the foot to the value. | | `cap` (`butt`, `round`, `square`), `width`, `baseline`, `from`. The stem's width is the stroke's, so it stays the same however many bars there are: the answer for dense data. With a marker, a lollipop. |
| Markers | One small shape per point. | | See [Markers](#markers). |

A series may have any number of renderers. They are drawn in order, so put an `AreaPath` before the `LinePath` that outlines it.

### Bars

Bars sit on a [`BandScale`](axes.md#band-scales) (categories) or any numeric domain; they grow from `baseline` (default 0), and the value axis always reaches the baseline. `width` is the fraction of the room each bar fills (default: a band's own width, else 0.8). Bars say their hit mode is `'shape'` themselves, so a bar series needs no `hit` setting. `from` names a channel of the data that holds each bar's start, so bars can **float**: a [waterfall](../start/recipes.md#draw-a-waterfall-chart)'s steps, a [candlestick](../start/recipes.md#draw-a-candlestick-chart)'s body and wick (the value is where the bar ends, and the axis reaches both). It replaces the baseline for that renderer; a stack's own starts still win. On a polar plane a bar is a wedge.

```tsx live title="Bars as stems, and a lollipop" height=260
import { Axis, StemPath, CartesianPlane, Chart, CircleMarker, DomainSeries, FlatDataSource, LinearScale, lightTheme } from 'inkplot';

const values = [4, 9, 6, 11, 5, 8, 10, 3];

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Lollipops">
        <FlatDataSource data={values} regularDomain-start={0} regularDomain-step={1} />
        <StemPath strokeWidth={2} />
        <CircleMarker size={5} />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

### Markers

A marker draws one shape per point, and a million points need not be a million nodes: markers that look alike are drawn as **one path**, so the cost is the number of different *looks*, not points.

| Marker | Shape | Its `size` | Bindable |
|---|---|---|---|
| `DotMarker` | A zero-length stroke, round or square capped (`cap`) | A stroke width. The cheapest, and the one a dense scatter wants. | `stroke`, `size`, `opacity` (all styles) |
| `CircleMarker` | A filled circle. A bubble chart is this with `size` bound. | Radius in pixels, in the path data: free to vary per point. | `stroke`, `strokeWidth`, `fill`, `opacity`, `size` |
| `SquareMarker` | A filled square | Half the side | as `CircleMarker` |
| `CrossMarker`, `PlusMarker` | × and +, stroked | Half the width | `stroke`, `strokeWidth`, `opacity`, `size` |

Marker attributes: `size` (default 3), `merge` (default `true`: draw all the markers that look alike as one path. The catch is that markers in one path do not blend where they overlap, so `opacity` darkens nothing. With `false` every marker is a node of its own and they blend, at the cost of a node per point).

A series with markers *and* a `LinePath` draws both: that is how you mark the points of a line.

## Curves

How a `LinePath` or `AreaPath` joins its points is its child, the **curve**.

| Curve | Joins with | Attributes |
|---|---|---|
| `LinearCurve` | Straight segments. | |
| `MonotoneCurve` | A smooth line that never overshoots the data (monotone cubic). | |
| `NaturalCurve` | The natural cubic spline: the smoothest line through the points, which swings past them. | |
| `CardinalCurve` | A cardinal spline through every point. | `tension`, 0 (Catmull-Rom) to 1 (straight lines) |
| `CatmullRomCurve` | Catmull–Rom through every point; centripetal by default so it neither loops nor cusps on uneven spacing. | `alpha`: 0 even, 0.5 centripetal, 1 chordal |
| `BasisCurve` | A B-spline, pulled towards the points rather than through them. | |
| `BumpCurve` | A level start and end to each segment and an S between: the flow of a bump chart. | `along` (`'x'` or `'y'`) |
| `QuadraticCurve` | Quadratic Béziers with each point as a control point. | |
| `ArcCurve` | A circular arc between each pair of points. | `bend`, the rise of each arc as a fraction of its chord |
| `PlaneCurve` | Straight lines in the plane's own terms: the same as `LinearCurve` on a rectangle, a true spiral between two points on a polar plane, a line that bends at each spoke on a radar. Exact, and more work than `LinearCurve` off a rectangle. | |
| `StepCurve` | A value that holds until it changes. | `mode`: `'after'` (default; holds from its point until the next), `'before'` (jumps at its own point), `'center'` (changes halfway) |

There are three kinds. `LinearCurve` and the smooth curves above join the points *as placed on the page* (with the straight, spline or arc that gives), which is fast and looks right on a rectangle; on a polar or radar plane the line between two points is then a chord or spline in pixels, not the path the plane's own geometry would give. `StepCurve` and `PlaneCurve` work in the plane's own terms and ask the plane to draw them, so they are exact everywhere: a step on a polar plane is an arc round the middle and a jump along a spoke, and `PlaneCurve` is the true line between points. Choose between exactness and speed (and between the shapes) by choosing the curve. `StepCurve` also *traces* what it draws, so a hit or a tooltip reading between points follows the line on screen, not a straight line between the points.

```tsx live title="Smooth curves through the same points" height=280
import { type AnyElement, Axis, CardinalCurve, CartesianPlane, CatmullRomCurve, Chart, CircleMarker, DomainSeries, FlatDataSource, Legend, LinePath, LinearScale, NaturalCurve, lightTheme } from 'inkplot';

const data = [2, 8, 3, 9, 4, 7, 2];
const smooth = (name: string, curve: AnyElement) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <LinePath>{curve}</LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {smooth('Natural', <NaturalCurve />)}
      {smooth('Cardinal', <CardinalCurve tension={0.5} />)}
      {smooth('Catmull–Rom', <CatmullRomCurve />)}
      <DomainSeries name="Data" hit="point">
        <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
        <CircleMarker size={3} stroke="#333" />
      </DomainSeries>
    </CartesianPlane>
    <Legend />
  </Chart>
);
```

## Stacks

A `Stack` is a group of series, a child of the plane, that share one domain and one value axis. Its members are ordinary series, each with its own source, renderers, `name` and `hit`. All the stack adds is *where each series' rows sit*: for every row a base (where it starts) and a top (where it is plotted), which the series reads in place of its own value. A line or marker is drawn at the tops; an area or bars fill from the base. A tooltip or an edit still sees the series' own value.

| `mode` | Layout |
|---|---|
| `'stack'` (default) | Each row's values laid one on another in member order, the first at the bottom. Positive values stack up from zero and negative ones down, so mixed signs do not cancel. |
| `'normalize'` | Like `stack`, each row scaled to total 1. The value axis then runs 0 to 1: give it a `format`. |
| `'center'` | A streamgraph: each row's stack centred on zero. |
| `'group'` | Nothing is laid on anything. Every series is drawn from the baseline, and a bar renderer places the series side by side. |

A gap leaves its own layer out and adds nothing to the others in that row.

**Aligning rows.** The members' rows must line up. Normally they do (the same categories, the same table's columns) and the default `align: 'strict'` checks it. Otherwise `align` merges their domains into the union of all of them, a row at every position any member has:

| `align` | A member with no value at a position |
|---|---|
| `'strict'` (default) | Is an error. |
| `'gaps'` | Has a gap there. Right for bars. |
| `'interpolate'` | Has the straight line between its neighbours' values, and a gap beyond its own first and last position. Right for areas and lines, which then add up exactly. Rows made up this way belong to no source row, so they cannot be edited. |

```tsx live title="A normalised stacked area" height=340
import { AreaPath, Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, Legend, LinearScale, MonotoneCurve, Stack, lightTheme } from 'inkplot';

const layer = (name: string, data: number[]) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={2018} regularDomain-step={1} />
    <AreaPath opacity={0.85}><MonotoneCurve /></AreaPath>
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1} format={(v: number) => String(v)}><LinearScale /></Axis>
      <Axis orientation="left" format={(v: number) => `${Math.round(v * 100)}%`}><LinearScale /></Axis>
      <Stack mode="normalize">
        {layer('Mobile', [20, 30, 45, 55, 62, 68])}
        {layer('Desktop', [70, 60, 45, 35, 28, 22])}
        {layer('Other', [10, 10, 10, 10, 10, 10])}
      </Stack>
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
);
```

Decimating a stack's data is done to each source *before* the stack ([Data](data.md#decimation)).

## Series groups

A `SeriesGroup` makes one series for each value of a channel of the data: a line for each region of a table that has all the regions' rows together. It is a child of the plane. Inside it is a *template*: one data source (or transforms over one, such as a `Decimator`, `BoxStats` or `Density`) and the renderers each series is drawn with.

```tsx live title="A line for each group of rows" height=340
import { Axis, CartesianPlane, Chart, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, SeriesGroup, lightTheme } from 'inkplot';

// Rows of (year, value, region), as a table gives them: the regions mixed, in order of year.
const regions = ['North', 'South', 'East'];
const rows: number[] = [];
for (let year = 2018; year <= 2024; year++)
  regions.forEach((_, r) => rows.push(year, 10 + r * 6 + (year - 2018) * (r + 1) * 0.8 + ((year * (r + 3)) % 5), r));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1} format={(v: number) => String(v)}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <SeriesGroup channel="region" name={(r: number) => regions[r] ?? ''}>
        <FlatDataSource data={Float64Array.from(rows)} stride={3} channels={{ region: 2 }} isSorted />
        <LinePath><LinearCurve /></LinePath>
      </SeriesGroup>
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
);
```

The series are real ones: each has a name, a palette colour, a legend entry and hits, and takes part in the axes' ranges as any series does. A key is a number (every channel is), and `name` turns it into the series' name; the default is the number as text. `order` sets the order, and so the palette colours: `'first'` (the default, the order the keys first appear along the domain), `'sorted'`, or a comparison function. `maxGroups` (default 100) bounds the series made; `omitted` says how many keys were left out. `x` or `y` makes the series `XYSeries` (a path or scatter for each key, a heat map) in place of `DomainSeries`, with `xAxis` and `yAxis` for `domainAxis` and `valueAxis`.

The rows are split first and the template's transforms run on each series' own rows: a `Decimator` thins each series to the width of the plot, and `BoxStats` summarises each series' samples. The group channel is used up by the split: a renderer in the group cannot bind it.

The group does not copy the rows out by key. It reads the key of each row once to count the rows of each series, and the stages of the template (`Decimator`, `Slice`, `BoxStats`, `Density`, `Trendline`: each extends `KeyedTransform`) then work on the rows of one key when a series asks for them. A `Decimator` directly over the source reduces every series in one pass over the data. Splitting a million rows into eight series takes about 20 ms instead of 125, and ten million about 170 ms instead of 880; the first thinning of all eight takes about as long again, and a pan or zoom after that costs what thinning eight separate series did. A `Slice` windows the rows of each key (`last={300}` is 300 rows of every series); set `keyed={false}` to window the rows of the data as a whole before they are split (`last={300}` is the last 300 rows, shared out among the series), which needs the `Slice` to sit directly on the source. A transform of your own in a group has to extend `KeyedTransform`; one that does not is an error.

**What the copies are.** Each series draws copies of the template's renderers, made from their classes and attributes (their `id` gets the key added: `ring` is `ring/7`). Change the template and every series follows at the next flush: set an attribute of a renderer, a curve or a transform, or `applyJSON` a saved tree, which only ever holds the template. The copies are not for editing: a renderer reached through `plane.series` is put back to match the template, and so are the series' `name`, axes and `gaps`, which the group sets from its own attributes. The one thing a series keeps for itself is `visible`: the group never sets it (it is not among the attributes it sends to a series), so the legend can hide a series and neither a change of data nor a refresh brings it back. To make the series differ, use `bind`. The series are also left out of saved JSON and of lookups by `id`, which find the template. Notes (`PointAnnotations`) cannot anchor to a renderer of a group yet, and say so.

**In a stack.** A group can be a child of a `Stack`, and stands there for its series: the same as writing them out one after another, in the order of the group's keys, and mixed with plain `DomainSeries` before or after. This is the way to stack tidy data, a table with a row for each region and year. The group has to be of `DomainSeries` (no `x`), and the stack's `align` says how rows are matched if the regions' years differ.

```tsx live title="A stacked area from tidy rows" height=320
import { AreaPath, Axis, CartesianPlane, Chart, FlatDataSource, Legend, LinearCurve, LinearScale, SeriesGroup, Stack, lightTheme } from 'inkplot';

const regions = ['North', 'South', 'East'];
const rows: number[] = [];
for (let year = 2018; year <= 2024; year++) regions.forEach((_, r) => rows.push(year, 5 + r * 3 + ((year * (r + 2)) % 4), r));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1} format={(v: number) => String(v)}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <Stack>
        <SeriesGroup channel="region" name={(r: number) => regions[r] ?? ''}>
          <FlatDataSource data={Float64Array.from(rows)} stride={3} channels={{ region: 2 }} isSorted />
          <AreaPath><LinearCurve /></AreaPath>
        </SeriesGroup>
      </Stack>
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
);
```

**Binding the look to the key.** `bind` gives an attribute of every series' renderers a value worked out from its key, once for the series and not once for each point. It has the two forms a renderer's own bindings have:

| Form | The attribute is |
|---|---|
| `{ axis, value? }` | The axis (a `ColorAxis` or `ScalarAxis`) read at the key, or at `value(key)`: a series coloured by something about it, such as its mean. The axis' range is fitted to these values, as to any binding. |
| `{ map }` | Whatever `map(key)` returns, a colour or a number. |

Both are read at every paint, so what they read from outside (a playback year, a selection) takes effect when the group is invalidated, with `group.invalidate()`. Nothing is refilled: the data is cached, and only the attributes that changed are written to the page. Because they bind attributes and not channels, a group gives a line or an area a colour for each series, which a renderer's own `bind` does not yet do for those.

## Error bars and bands

How far each value may be from what was measured is another **channel** of the data, drawn by a renderer that sits beside the others. `ErrorBars` draws a whisker with a cap at each end; `ErrorBand` fills the region between the ends.

| Attribute | Default | Meaning |
|---|---|---|
| `error` | required | The channel with how far **above** the value each point may be. |
| `negativeError` | the same as `error` | The channel with how far **below**. Left out, the bars are symmetric. |
| `mode` | `'absolute'` | `'absolute'`: the unit of the value. `'relative'`: a fraction of it (`0.1` is plus or minus 10%). |
| `along` | `'value'` | The way the error runs. `'domain'` is for an `XYSeries`, where it is horizontal error; the x axis fits it. |
| `capWidth` | `8` | `ErrorBars` only: pixels across each cap; `0` for none. |

```tsx live title="Error bars on a line" height=300
import { Axis, CartesianPlane, Chart, DomainSeries, ErrorBars, LinePath, LinearCurve, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const rows = [
  { month: 0, mean: 12, sd: 2 }, { month: 1, mean: 18, sd: 3 }, { month: 2, mean: 15, sd: 1.5 },
  { month: 3, mean: 24, sd: 4 }, { month: 4, mean: 21, sd: 2.5 },
];
const source = () => <ObjectDataSource source={rows} domain="month" value="mean" isSorted channels={{ sd: 'sd' }} />;

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Mean ± sd">
        {source()}
        <LinePath><LinearCurve /></LinePath>
        <ErrorBars error="sd" />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

The axes leave room for the bars, and zooming out never goes past them. A gap in the value or the error leaves that point without a bar. On bars the whisker sits on the bar's top (on the layer's top in a `Stack`, and on its own bar in a group); give it a different colour from the bars with `stroke`, or through the `errorBar` selector. Neither renderer is hit, and through a `Decimator` they are drawn on the points it keeps. An error in a `'normalize'` stack has no unit and is not meaningful.

On bars, the whisker sits on the bar's top:

```tsx live title="Error bars on bars" height=260
import { Axis, BandScale, BarPath, CartesianPlane, Chart, DomainSeries, ErrorBars, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const rows = [{ t: 0, v: 42, e: 5 }, { t: 1, v: 58, e: 8 }, { t: 2, v: 51, e: 4 }, { t: 3, v: 73, e: 9 }];

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['Q1', 'Q2', 'Q3', 'Q4']} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Revenue">
        <ObjectDataSource source={rows} domain="t" value="v" isSorted channels={{ e: 'e' }} />
        <BarPath />
        <ErrorBars error="e" />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

An asymmetric error, from two channels, drawn as a band:

```tsx live title="An asymmetric band" height=280
import { Axis, CartesianPlane, Chart, DomainSeries, ErrorBand, LinePath, LinearCurve, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const rows = Array.from({ length: 40 }, (_, i) => {
  const v = 20 + 8 * Math.sin(i / 5);
  return { t: i, v, high: 3 + Math.abs(Math.cos(i / 7)) * 4, low: 2 };
});

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Forecast">
        <ObjectDataSource source={rows} domain="t" value="v" isSorted channels={{ high: 'high', low: 'low' }} />
        <ErrorBand error="high" negativeError="low" />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

The band has straight edges (use enough points for a smooth look), and a gap splits it into separate shapes. Renderers are drawn in order, so the band goes **before** the line to sit under it.

## Box and whisker

A box shows the five numbers that summarise a spread: the box runs from the first to the third quartile with a line at the median, and whiskers reach the lowest and highest values. `BoxPath` draws one box for each point of a series, taking the median from the series' own value and the other four from **channels** called `min`, `q1`, `q3` and `max` (the `low`, `q1`, `q3`, `high` and `median` attributes name other channels). Use it with numbers worked out elsewhere:

```tsx live title="Boxes from five numbers" height=280
import { Axis, BandScale, BoxPath, CartesianPlane, Chart, DomainSeries, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const rows = [
  { g: 0, lo: 2, a: 5, m: 7, b: 10, hi: 14 },
  { g: 1, lo: 4, a: 7, m: 9, b: 11, hi: 13 },
  { g: 2, lo: 1, a: 3, m: 6, b: 12, hi: 20 },
];

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['Control', 'Dose A', 'Dose B']} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Response">
        <ObjectDataSource source={rows} domain="g" value="m" isSorted channels={{ min: 'lo', q1: 'a', q3: 'b', max: 'hi' }} />
        <BoxPath />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

| Attribute | Default | Meaning |
|---|---|---|
| `low`, `q1`, `median`, `q3`, `high` | `'min'`, `'q1'`, the series' value, `'q3'`, `'max'` | The channel for each number. |
| `capFraction` | `0.5` | Width of the cap on each whisker as a fraction of the box; `0` for none. |
| `width` | `0.8` | Width of a box as a fraction of the gap between points (a band's own width wins). |

A row with any of the five missing has no box. A box is hit as a shape, boxes in a `Stack` in `'group'` mode sit side by side, the domain on the vertical axis gives horizontal boxes (name the axes with `domainAxis` and `valueAxis`, as for bars), and a polar plane gives wedges. Style them through the `seriesBox` and `boxLine` selectors.

### From the samples: `BoxStats`

`BoxStats` is a data transform: put it round a source of raw samples (many rows for each domain value, **sorted by domain**) and it works out the five numbers for each group, so the same source can feed other charts untouched.

```tsx live title="Boxes and outliers from samples" height=300
import { Axis, BandScale, BoxPath, BoxStats, CartesianPlane, Chart, DomainSeries, DotMarker, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const samples = [0, 1, 2].flatMap((g) =>
  Array.from({ length: 40 }, (_, i) => ({ g, x: 10 + g * 3 + Math.sin(i * 12.9898 + g) * 4 + (i === 7 ? 25 : 0) })),
);
const source = () => <ObjectDataSource source={samples} domain="g" value="x" isSorted />;

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['A', 'B', 'C']} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Spread"><BoxStats>{source()}</BoxStats><BoxPath /></DomainSeries>
      <DomainSeries name="Outliers"><BoxStats output="outliers">{source()}</BoxStats><DotMarker /></DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

| Attribute | Default | Meaning |
|---|---|---|
| `output` | `'summary'` | `'summary'`: a point for each group. `'outliers'`: a point for each sample beyond the whiskers, to plot as markers. |
| `fence` | `1.5` | Whiskers stop at the furthest sample within this many interquartile ranges of the box. `'minmax'` takes them to the extremes (and there are no outliers). |
| `method` | `'inclusive'` | The quartile rule: `'inclusive'` or `'exclusive'`. |
| `value` | `'median'` | What the series' value is: `'median'` or `'mean'`. |

Besides `min`, `q1`, `median`, `q3` and `max` the summary has the channels `mean`, `sd`, `sem` and `n`, so `BoxStats` with `value="mean"` and `<ErrorBars error="sd" />` gives a mean with its spread from the raw samples. Number the quartiles with `quantile(values, p, method)`, which is exported for use elsewhere.

## Histograms and binning

`Density` is a data transform that **bins** points and gives one point for each bin: at the bin's centre, with a count (or a sum, or a mean) as the value. A histogram is a `Density` and a `BarPath`; nothing about it lives in the renderer.

```tsx live title="A histogram" height=280
import { Axis, BarPath, CartesianPlane, Chart, Density, DomainSeries, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

// 400 heights, roughly normal (a deterministic stand-in for real measurements).
const people = Array.from({ length: 400 }, (_, i) => {
  const u = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, v = Math.abs(Math.sin(i * 78.233) * 12345.6789) % 1;
  return { height: 170 + 8 * Math.sqrt(-2 * Math.log(u + 1e-9)) * Math.cos(2 * Math.PI * v) };
});

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" title="Height (cm)"><LinearScale /></Axis>
      <Axis orientation="left" title="People"><LinearScale /></Axis>
      <DomainSeries name="Heights">
        <Density width={4}>
          <ObjectDataSource source={people} domain="height" value="height" />
        </Density>
        <BarPath width={0.95} />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

`width` on the bars is a fraction of the gap to the next bin: `0.95` leaves a thin line between bars, `1` has them touch. The data is read through `domain`, so the source needs its `domain` (and `value`, which is required) to name the column to bin.

| Attribute | Default | Meaning |
|---|---|---|
| `by` | `['domain']` | The dimensions to bin, any number: `'domain'`, `'value'`, or a channel name. |
| `weight` | none | What each point counts for (a channel name or `'value'`). Without it a point counts as 1. |
| `stat` | `'count'` (`'sum'` with a `weight`) | The value of a one-dimensional output: `count`, `sum`, `mean`, `fraction` or `density`. |
| `width`, `bins`, `origin`, `extent` | the rule | Bin size, **set for each dimension**: a number for all, or an array with one for each. `width`: the size of a bin, edges at `origin` plus whole widths. `bins`: how many, over the extent. `extent`: the span, `{ min, max }`, instead of the data's. |
| `maxBins` | `200` | Most bins along a dimension when the size is chosen by the rule. |
| `empty` | `'keep'` for one dimension, `'omit'` for more | Whether bins with no points are kept as zeros. |

With neither `width` nor `bins`, the Freedman–Diaconis rule picks a width from the spread of the points. A bin is closed on the left and open on the right, except the last, which holds the top edge. Points with a gap (`NaN`) in any dimension or in the weight are left out.

The output also has channels, whatever the dimensions: `count`, `sum`, `mean`, `fraction` (the bin's share of the total), `density` (the share per unit of bin size, so a histogram of it has area 1), and `width` and `height` (the bin's size along the first and second dimension). `halfLife` makes points count for less the further they are before the last one the source delivers (one `halfLife` back counts half), which over a window moved along by a `Slice` is a trail that fades behind the newest point: a phosphor screen is a two-dimensional `Density` with a `halfLife` and a `HeatMap`, and each cell's `sum` is its brightness. With two or more dimensions the first is the domain and the second is the value (both bin centres), and each further one is a channel of its own name, so a **two-dimensional** binning is the input to a [heat map](#heat-maps). The first two dimensions are also the source's own `domain` and `value` columns, which is what an `XYSeries` reads (`x="domain" y="value"`). To get the bins as a table, `readTable(density)` ([the recipe](../start/recipes.md#export-the-chart-as-a-table)).

## Heat maps

`HeatMap` draws a **rectangle for each point**, coloured by a channel. It is a renderer for an `XYSeries`, and with a two-dimensional `Density` in front it turns scattered points into a picture of where they are: a heat map is a `Density`, a `HeatMap` and a `ColorAxis`.

```tsx live title="A heat map of a scatter" height=360
import { Axis, CartesianPlane, Chart, ColorAxis, ColorKey, Density, HeatMap, LinearScale, ObjectDataSource, XYSeries, lightTheme } from 'inkplot';

// 3000 correlated points (a deterministic stand-in for real measurements).
const points = Array.from({ length: 3000 }, (_, i) => {
  const u = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, v = Math.abs(Math.sin(i * 78.233) * 12345.6789) % 1;
  const r = Math.sqrt(-2 * Math.log(u + 1e-9)), x = r * Math.cos(2 * Math.PI * v), z = r * Math.sin(2 * Math.PI * v);
  return { x, y: 0.6 * x + 0.8 * z };
});

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries x="domain" y="value">
        <Density by={['domain', 'value']} width={0.4}>
          <ObjectDataSource source={points} domain="x" value="y" />
        </Density>
        <HeatMap bind={{ fill: { axis: 'heat', channel: 'count' } }} />
      </XYSeries>
    </CartesianPlane>
    <ColorAxis id="heat" title="Points" ramp="viridis"><LinearScale /></ColorAxis>
    <ColorKey dimension="heat" side="right" />
  </Chart>
);
```

`Density` gives each bin as a point at its centre with the channels `count`, `width`, `height` and the rest ([above](#histograms-and-binning)); `x="domain" y="value"` take the first dimension's centre as x and the second's as y, and `HeatMap` reads each cell's size from `width` and `height`. Without `Density`, any point can be a cell: give the sizes yourself.

| Attribute | Default | Meaning |
|---|---|---|
| `cellWidth`, `cellHeight` | none | The cell's size in data units. With only `cellWidth` the cells are square. |
| `widthChannel`, `heightChannel` | `'width'`, `'height'` | The channels that hold each cell's size, when it is not a constant. |
| `bind` | none | `fill` (a `ColorAxis`) and `opacity` can follow a channel. |
| `maxNodes` | `1000` | Most paths drawn. Cells with the same colour step share one path, so a grid of any size draws a bounded number of nodes. |

A cell is drawn from its four corners, each placed by the plane. On a Cartesian plane that is a rectangle, with `crispEdges` so that neighbours leave no hairline; on a polar plane the same corners give a wedge with **straight edges**. The axes leave room for the half of a cell that sticks out past its centre, and a cell is hit as a shape. A point with a gap in either coordinate or size has no cell.

## Trendlines

A trendline is a data transform that **fits a curve** to its source and gives samples of it, like a `SyntheticDataSource`: the fit is made once for each change of the source, and the points are made when drawn, one for each pixel across what is in view. So a trendline is smooth at any zoom, it can be read anywhere (`evaluate`), and it can be extended past the data.

| Class | Fits | Attributes |
|---|---|---|
| `LinearTrend` | the least-squares line | |
| `PolynomialTrend` | a polynomial (fitted on positions scaled to -1..1, so a high degree stays stable) | `degree` 1 to 12, default 2 |
| `SinusoidalTrend` | a constant plus a sine wave | `period`; left out, the best period is found (a periodogram that copes with uneven spacing, refined on every point) |
| `LoessTrend` | local linear regression, centred on each place | `smoothness` 0 to 1, default 0.5; `kernel` `'tricube'` (default) or `'gaussian'` |
| `MeanTrend` | a weighted moving average, centred on each place: the **stable** line | the same `smoothness` and `kernel` |

`smoothness` on a `LoessTrend` is the one control (**use 0.2 or more** for points that are unevenly spaced or noisy: below that the line follows individual points, and where a few lie close together the curve can swing between them; past the ends of the data it continues in the direction of the broader trend, which is a guess that grows worse the further out you look): **0 joins the points** (straight between neighbours), **1 is exactly the least-squares line**, and between them the curve is smoother the larger it is. Where the points are sparse the reach widens so that at least three are in it.

**Which one?** A loess line follows peaks, ends and bends best, but a local line can overshoot: past the data it continues a slope, and next to a step or a cluster of outliers it can swing beyond the values the data has. A `MeanTrend` is the same idea with a local *mean* in place of a local line, so each point of it is an average of the data with positive weights: it is **never above the highest value or below the lowest**, at any `smoothness`, and past the ends it holds the end value flat. That makes it the safe choice for a line you will extend, for data with steps, or when the number it shows must be believable (a stock level, a rate). The price is that a mean is pulled toward its neighbours, so it flattens peaks and sags a little at the ends of a slope. `smoothness` means the same for both, except that 1 is the mean of all the points rather than the line, so you can switch one for the other and keep the setting. Over many points a `MeanTrend` is calculated on a grid, so a very smooth line over millions of rows costs what a rough one does.

```tsx live title="Four trendlines" height=320
import { Axis, CartesianPlane, Chart, DomainSeries, DotMarker, LinePath, LinearCurve, LinearScale, LinearTrend, LoessTrend, ObjectDataSource, PolynomialTrend, lightTheme } from 'inkplot';

// A trend with a bend, and noise.
const rows = Array.from({ length: 80 }, (_, i) => {
  const t = i / 4, noise = Math.sin(i * 12.9898) * 2 + Math.sin(i * 78.233);
  return { t, v: 4 + 0.6 * t + 3 * Math.sin(t / 2.5) + noise };
});
const data = () => <ObjectDataSource source={rows} domain="t" value="v" isSorted />;

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Data">{data()}<DotMarker size={2.5} opacity={0.5} /></DomainSeries>
      <DomainSeries name="Linear"><LinearTrend extend={0.15}>{data()}</LinearTrend><LinePath><LinearCurve /></LinePath></DomainSeries>
      <DomainSeries name="Cubic"><PolynomialTrend degree={3}>{data()}</PolynomialTrend><LinePath><LinearCurve /></LinePath></DomainSeries>
      <DomainSeries name="Loess 0.3"><LoessTrend smoothness={0.3}>{data()}</LoessTrend><LinePath><LinearCurve /></LinePath></DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

`extend` lets the line run past the data at each end, as a fraction of the data's span (a number, or `[before, after]`): that is how a trendline is **extrapolated**. A polynomial or a sinusoid extrapolates by its formula, a loess line by its local line at the end of the data, continued with a slope taken over a wide reach.

On a scatter (an `XYSeries`) the points are fitted against a channel: `x` names it, and the trendline's own points are read with `x="domain" y="value"`.

```tsx
<XYSeries x="domain" y="value">
  <LinearTrend x="height">
    <ObjectDataSource source={people} value="weight" channels={{ height: 'height' }} />
  </LinearTrend>
  <LinePath><LinearCurve /></LinePath>
</XYSeries>
```

### Reading a fit

Outside any chart, a trendline is a function and a few numbers:

```ts check title="Reading a trendline"
import { LinearTrend, ObjectDataSource, SinusoidalTrend } from 'inkplot';

const rows = [{ t: 0, v: 1 }, { t: 1, v: 3.1 }, { t: 2, v: 4.9 }, { t: 3, v: 7.2 }];
const trend = new LinearTrend({}, new ObjectDataSource({ source: rows, domain: 't', value: 'v' }));

trend.evaluate(10);             // the fitted value at 10 (extrapolating): about 21
trend.evaluate([0, 0.5, 1]);    // a Float64Array, one for each
const fit = trend.fit;          // null when there are too few points
console.log(fit?.n, fit?.r2, fit?.rmse, fit?.coefficients);   // [intercept, slope]

const wave = new SinusoidalTrend({}, new ObjectDataSource({ source: rows, domain: 't', value: 'v' }));
console.log(wave.fit?.period, wave.fit?.amplitude);
```

`fit` has `n` (the points used), `r2` (the share of the variance explained), `rmse`, and what the kind knows: `coefficients` (a line's `[intercept, slope]`; a polynomial's, lowest power first, in the scaled position `u = (x - center) / scale`; a sinusoid's `[offset, a, b]`), `period`, `amplitude`, or a loess line's `bandwidth`. Points with a gap are left out of the fit. To get the line as a table, see [the recipe](../start/recipes.md#export-the-chart-as-a-table). The channels `lower` and `upper` for a confidence band are not there yet; the fit leaves room for them.

## Chart shortcuts

For the most common charts there is one call that builds the whole `Chart` for you: `lineChart`, `barChart` and (for [pies](../start/recipes.md#the-piechart-shortcut)) `pieChart`. Each takes the series and the options, and **the options are the `Chart`'s own attributes** (`theme` is required, as for a `Chart`) **plus a few of its own**:

```ts check title="The lineChart shortcut"
import { CircleMarker, ChartTitle, FlatDataSource, Legend, MinMaxKernel, MonotoneCurve, darkTheme, lineChart } from 'inkplot';

const data = (n: number) => new FlatDataSource({ data: new Float64Array(n), regularDomain: { start: 0, step: 1 } });
export const chart = lineChart(
  [
    { name: 'Sensor A', source: data(10000) },
    { name: 'Sensor B', source: data(10000), color: '#d4492e' },
  ],
  {
    theme: darkTheme,
    height: 320,
    strokeWidth: 2,
    curve: new MonotoneCurve(),
    marker: CircleMarker,        // the class, not an instance
    decimate: MinMaxKernel,      // likewise
    domainAxis: { title: 'Time' },
    valueAxis: { title: 'Level' },
    extras: [new Legend({}), new ChartTitle({ text: 'Sensors' })],
  },
);
```

A series is a data source, or `{ source, name, color }` (the name is what a legend shows). A list is several series on one plane. `extras` holds the chart's other children (a legend, a title, a cursor), given as elements so that the shortcut refers only to what you use. A source belongs to one chart, so build a fresh one for each.

`barChart` is the same for bars. Give it the `categories` (one label per row of the data), and say how several series sit together with `stack` (`'group'` side by side, the default; `'stack'`; `'normalize'` to 100%; `'center'`), and `horizontal: true` to run the bars sideways:

```ts check title="The barChart shortcut"
import { FlatDataSource, Legend, barChart, lightTheme } from 'inkplot';

const rows = (data: number[]) => new FlatDataSource({ data, regularDomain: { start: 0, step: 1 } });
export const chart = barChart(
  [
    { name: 'Online', source: rows([4, 7, 5, 9]) },
    { name: 'In store', source: rows([6, 3, 6, 4]) },
  ],
  { theme: lightTheme, categories: ['Q1', 'Q2', 'Q3', 'Q4'], stack: 'stack', horizontal: true, extras: [new Legend({})] },
);
```

They are **a convenience, not a capability**. They compose only public classes (a plane, two axes, series, a renderer, a stack, optionally a decimator and a marker), so everything they do can be done, and tuned, with the elements themselves, and a bundle that never calls one carries none of it. Markers and kernels are passed as **classes** for the same reason. `lineChart` also takes `domainScale` and `valueScale` (a time axis is `domainScale: new IntlTimeScale()`), and `barChart` a band `gap`. Because they return a `Chart`, they go straight into `ChartView` in React ([Frameworks](frameworks.md#react)), or onto a page with `chart.attach(...)`.

## What a series can be asked

After a flush a series knows its drawing: `series.points` (the last projected points in plot pixels, `[first, second, …bound channels]` per row), `series.color` (the colour that stands for it: its first renderer's line, fill or marker, else the palette colour), `series.channels`, `series.plane`, `series.data`. These are what tooltips, legends and [custom elements](../extending/custom-elements.md) read.

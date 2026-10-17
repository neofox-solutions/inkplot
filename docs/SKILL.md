---
name: inkplot
description: Write charts with the inkplot JavaScript/TypeScript chart library (a tree of elements drawn to SVG: Chart, CartesianPlane, Axis, DomainSeries, LinePath, BarPath…). Use when asked to make, change or debug an inkplot chart, in JSX, with `new`, in React, or as HTML tags.
---

# inkplot: how to write charts

inkplot draws a chart from a **tree of elements**. You build the tree, attach it to a page (or turn it into an SVG string), and change attributes to update it. There is no `render()` call and no options object: everything is an element with attributes and children.

**How to use this skill.** Read this file (it is short). It is enough for a plain line chart. For anything else, find the topic in **Topics** and read that topic file: it has worked examples and the attributes of its elements, and nothing else you need to open. Usually that is one or two files. Do not read topic files the chart does not need. Run the **Checklist** before you answer.

## Rules

<!-- jsx -->
1. **Write JSX with the inkplot runtime**: `/** @jsxImportSource inkplot */` at the top of the file (or `jsxImportSource: "inkplot"` in the tsconfig). A JSX expression *is* the element, not a description. In a React project, use this only in files that do not render React.
<!-- /jsx -->
<!-- ts -->
1. **Write plain TypeScript: `new Element(attributes, ...children)`.** The attributes are one object, first; then the children, in order. Leave the attributes out only for an element with neither attributes nor children (`new LinearScale()`); with children and no attributes write `{}`. The expression *is* the element. Build the whole tree as one expression, inside out.
<!-- /ts -->
2. **Import every element you use by name** from `'inkplot'`: `import { Chart, CartesianPlane, … } from 'inkplot'`. Never `import *`.
3. **`Chart` needs a `theme`**: `theme={lightTheme}` (or `darkTheme` for a dark chart; see the `styling-output` topic). Import it.
4. **A chart is `Chart` > plane > (`Axis` ×2, series)**. The plane is `CartesianPlane` (x and y), `PolarPlane` or `RadarPlane`. Every plane needs both axes.
<!-- jsx -->
5. **Child order matters and is not type-checked.** `Axis`: one scale (`<LinearScale />`, `<BandScale categories={[…]} />`, `<IntlTimeScale />`, `<LogScale />`). `DomainSeries`: the **data first**, then renderers. `LinePath`/`AreaPath`: one curve (`<LinearCurve />`). `BarPath` and the markers: no children.
<!-- /jsx -->
<!-- ts -->
5. **Child order matters, and `tsc` checks it.** `new Axis(attrs, scale)`: one scale (`new LinearScale()`, `new BandScale({ categories: […] })`, `new IntlTimeScale()`, `new LogScale()`). `new DomainSeries(attrs, data, ...renderers)`: the **data first**, then renderers. `new LinePath(attrs, curve)` and `new AreaPath(attrs, curve)`: one curve (`new LinearCurve()`). `new BarPath(attrs)` and the markers: no children.
<!-- /ts -->
6. **Data goes in a source, never in the series.** `FlatDataSource` (numbers), `ObjectDataSource` (rows), `CompositeDataSource` (columns), `SyntheticDataSource` (a function).
<!-- jsx -->
7. **Hyphens nest attributes**: `regularDomain-start={0}` is `regularDomain={{ start: 0 }}`; `meta-title="x"`; `style-tickLabel-size={12}`. Plain object props work too.
<!-- /jsx -->
<!-- ts -->
7. **Nested attributes are nested objects**: `{ regularDomain: { start: 0 } }`, `{ meta: { title: 'x' } }`, `{ style: { tickLabel: { size: 12 } } }`.
<!-- /ts -->
<!-- jsx -->
8. **No text children.** `<ChartTitle text="Sales" />`, never `<ChartTitle>Sales</ChartTitle>`. A drawn title or a legend is in the `furniture` topic; `meta-title` on the `Chart` is only its accessible name and is **not drawn**.
<!-- /jsx -->
<!-- ts -->
8. **A drawn title is an element with a `text` attribute**: `new ChartTitle({ text: 'Sales' })`. A drawn title or a legend is in the `furniture` topic; `meta: { title }` on the `Chart` is only its accessible name and is **not drawn**.
<!-- /ts -->
9. **Style through attributes, `style` and the theme, never CSS.** The output is SVG with presentation attributes. `style={{ selector: { property: value } }}`, e.g. `style={{ gridline: { color: '#eee' } }}`. Fill the page behind a chart with `style={{ chart: { background: "#fff" } }}` (none by default).
10. **Names make things appear.** A series with no `name` is not in the legend or the tooltip. Give every series a `name`.
11. **Charts need a size.** In a browser, give the container a height. For SVG text: `toSvgString(chart, { width, height })`.
12. **Update by setting attributes**: `source.setAttribute('data', next)`; `axis.setAttribute('max', 10)`. If you edit an array in place, call `source.invalidate()`. Setting `undefined` removes an attribute.
13. **Elements refer to each other by `id`**: `<ColorAxis id="heat">` and `bind={{ fill: { axis: 'heat', channel: 'temp' } }}`; `<Axis id="rain">` and `<DomainSeries valueAxis="rain">`.
14. **One element has one parent.** Do not put the same element object in two places; to use a source twice, make a function that returns a new one each time (`const source = () => <ObjectDataSource … />`).
15. **Do not invent API.** If an element or attribute is not in this file or in a topic file, it probably does not exist. See **Not in inkplot**.

## Template

Start from this and change it. It is a complete line chart.

```tsx check title="Template: a line chart"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export const chart = ((
  <Chart theme={lightTheme} meta-title="Load over time">
    <CartesianPlane>
      <Axis orientation="bottom" title="Hour" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left" title="Load"><LinearScale /></Axis>
      <DomainSeries name="Load">
        <FlatDataSource data={[3, 5, 4, 8, 6, 9]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
) as Chart);
```

<!-- jsx -->
A JSX expression is typed `AnyElement` (every tag is), not `Chart`: write `as Chart` on the chart you hand to `toSvgString` or `attach`, as above. `AnyElement` is exported from `'inkplot'` for helper functions that take any element.
<!-- /jsx -->
<!-- ts -->
Each `new Element(…)` has its own type, so `tsc` checks every element's arguments: attribute names and types (nested ones too), which children it takes, and in what order. `new Chart(…)` is a `Chart`, so nothing needs a cast. `AnyElement` is exported from `'inkplot'` for helper functions that take any element.
<!-- /ts -->

Show it (browser) or draw it (anywhere):

```ts check title="Attach to a page, or draw to a string"
import { DOMPlatform, toSvgString } from 'inkplot';
import type { Chart } from 'inkplot';

export function show(chart: Chart, container: HTMLElement): void {
  chart.attach(new DOMPlatform(container));      // the container needs a height
}
export const svg = (chart: Chart): string => toSvgString(chart, { width: 640, height: 360 });
```

To run a file as a program that prints the SVG (a script, a build step, a server), put both in one file:

```tsx check title="A whole program: print an SVG"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme, toSvgString } from 'inkplot';

const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Load">
        <FlatDataSource data={[3, 5, 4, 8]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
) as Chart;

console.log(toSvgString(chart, { width: 640, height: 360 }));
```

<!-- jsx -->
Without JSX the same tree is `new Chart({ theme }, new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), …))`: `new Element(attributes?, ...children)`.
<!-- /jsx -->
<!-- ts -->
<!-- /ts -->

## Elements used above

Attributes of the elements in the Template. An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`. Child order is in the Rules: `Axis` holds one scale, a series holds its data first and then its renderers.

<!-- api:start -->
### Chart

The root: a theme, a size, and what is drawn on it.

**In** none (the root) · **Holds** a plane or a ChartGroup, ChartTitle, Legend, Cursor, ColorAxis, ScalarAxis, ColorKey, SizeKey, ChartSummary, Entrance, LinePattern, HatchPattern, DotPattern

| Attribute | Type | |
|---|---|---|
| `theme` (required) | `BaseTheme` | Every default look: required, so a chart bundles exactly the theme it names (`lightTheme`, `darkTheme`, or your own). |
| `width` | `number` | Width of the drawing. Default: whatever the platform reports, followed as it changes. |
| `height` | `number` | Height of the drawing. Default: whatever the platform reports. |
| `direction` | `'ltr' \| 'rtl'` | 'rtl' lays the chart out for a right-to-left script: the first vertical axis is on the right, a horizontal axis runs from the right, a legend or key is on the left and a title starts at the right. Default 'ltr'. |
| `padding` | `number \| Partial<Insets>` | Margin around everything, in pixels: one number for all sides, or any subset of the four. Default 10. |
| `measureText` | `TextMeasurer` | Replaces the platform's text measurement, e.g. to match a font the platform cannot see. |
| `locale` | `string` | A BCP 47 tag (`'de'`, `'fr-CA'`) for how numbers and dates are written: digit grouping, the decimal mark, month names. Default: numbers as plain digits with a point, and the runtime's own locale for dates. |
| `transition` | `{ duration?: number; easing?: string; views?: boolean }` | Ease the chart to a new drawing when its **data** changes, in the browser: colours, sizes and (in browsers that can morph a path, Chrome and Firefox) the shapes of lines, areas and bars move over `duration` milliseconds (default 250) with a CSS `easing` (default `'ease-out'`). Default false. |
| `onFlush` | `(stats: FlushStats) => void` | Called after every flush with its statistics. |

### CartesianPlane

A rectangular plot (x and y).

**In** Chart · **Holds** Axis, series, Stack, SeriesGroup, LineAnnotation, CalloutAnnotation, PointAnnotations, PanZoom, BoxZoom, Brush, PointerListener

| Attribute | Type | |
|---|---|---|
| `gridlines` | `boolean` | Lines at the first horizontal and first vertical axis' ticks. Default true. |
| `frame` | `boolean` | Draw a border round the plot area, above the series. |
| `clip` | `boolean` | Clip series to the plot area. Default true. |
| `insets` | `Partial<Insets>` | Fixed margins round the plot (room for axes). |

### Axis

Positions data along one side of a plane, with ticks and labels.

**In** a plane · **Holds** 1 scale (required)

| Attribute | Type | |
|---|---|---|
| `orientation` | `AxisOrientation` | The side of the plot the axis sits on. Default: 'bottom' for the first axis in a plane, then 'left', 'top', 'right'. |
| `titlePosition` | `Side` | The edge of the plot the title sits at: past the axis' labels for an axis fixed to that side, otherwise at the middle of the edge, outside any axes there, which then take the room it needs. Default: the axis' own side. |
| `titleDirection` | `'horizontal' \| 'vertical'` | Whether the title runs along the horizontal or the vertical. Default: horizontal at the top and bottom, vertical at the left and right. |
| `crossesAt` | `number` | Float across the plot at this value of the crossing axis (the other one, or `crossAxis`), instead of sitting on a side. |
| `crossAxis` | `ElementRef<Axis>` | The axis `crossesAt` is a value of. Default: the plane's first axis on the other orientation. |
| `sharedRef` | `ElementRef<SharedRange>` | For a `SharedAxis`: the `SharedRange` it draws. |
| `edgeOnly` | `boolean` | For a `SharedAxis`: draw only where its chart is at the edge of the group it faces, and take no room elsewhere. |
| `min` | `number` | Fix an end of the range. |
| `max` | `number` | Fix the top end of the range. |
| `include` | `readonly number[]` | Values the range must cover, e.g. `[0]` to anchor a bar-like axis at zero. |
| `padding` | `number` | Extra room at both ends as a fraction of the data's span. |
| `nice` | `boolean` | Round the ends outwards to tidy tick values. |
| `inverted` | `boolean` | Run from max to min along the axis. |
| `title` | `string` | The axis title (or, on a `ColorAxis` or `ScalarAxis`, the default title of its key). Default: none. |
| `tickCount` | `number` | Ask for about this many ticks, whatever the length. |
| `ticks` | `readonly number[] \| ((range: Readonly<Extent>) => readonly …` | Put ticks exactly here (those inside the range are drawn), or at whatever a function of the range returns. |
| `tickStep` | `number` | Put ticks at every multiple of this step. |
| `format` | `(value: number) => string` | Turns a tick's number into its label, e.g. (v) => `${v}%`. Default: plain digits, grouped by `locale` if one is set. |
| `locale` | `string` | A BCP 47 tag for how this writes its numbers (grouping and decimal mark). Default: the chart's `locale`, else plain digits. |
| `onViewChange` | `(view: Readonly<Extent> \| null) => void` | Called when the view (what pan, zoom or a reset has set) changes: the new range, or null when it is back to the natural one. |

### LinearScale

Equal steps in the data are equal steps on the page.

**In** an axis · **Holds** none

No attributes of its own.

### DomainSeries

A value at each position along a domain.

**In** a plane or Stack · **Holds** 1 data (source or Decimator), then any renderers

| Attribute | Type | |
|---|---|---|
| `domainAxis` | `ElementRef<Axis>` | Default: the plane's first axis (a Cartesian plane's horizontal one, a polar plane's angle). |
| `valueAxis` | `ElementRef<Axis>` | Default: the plane's second axis (the vertical one, the radius). |
| `name` | `string` | What the series is called where it is named: a tooltip's heading. |
| `hit` | `false \| HitMode \| HitOptions` | How pointer hits find this series: a mode name, options, or `false` for a series that should never be hit (a selection overlay, a reference line). |
| `gaps` | `'break' \| 'connect' \| 'zero'` | What a missing value (NaN, or infinite) means. 'break' (default): nothing is there, so a line stops and starts again and an area splits. 'connect': the line goes straight across to the next value there is. 'zero': the value is 0 (and the axis reaches it). |

### FlatDataSource

Numbers in an array or typed array, read in place.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `data` (required) | `ArrayLike<number>` | Float64Array, Float32Array, or any numeric array. |
| `stride` | `number` | Numbers per point. Default 2 (x, y pairs), or 1 when `regularDomain` is set. |
| `domainOffset` | `number` | Where the domain and the value sit within a point's `stride` numbers. Default 0 and 1 (0 when there is no stored domain). |
| `valueOffset` | `number` | Where the value sits within a point's `stride` numbers. Default 1 (0 when there is no stored domain). |
| `count` | `number` | Number of points. Default: `data.length / stride`. |
| `regularDomain` | `{ start: number; step: number }` | Evenly spaced domain with no stored x values: a y-only array. |
| `channels` | `Readonly<Record<Channel, number>>` | Extra columns that bindings can address by name, as offsets within a point's `stride` numbers. |
| `isSorted` | `boolean` | The stored points already ascend in the domain. Default false. |
| `wrap` | `number` | The domain repeats with this period, and the source delivers one more point: the first, again, one period on. |

### ObjectDataSource

Rows as objects, read by property name.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `source` (required) | `readonly Row[]` |  |
| `domain` | `Field<Row>` | Where each row is along the domain. |
| `value` | `Field<Row>` | The number a domain series plots. |
| `channels` | `Readonly<Record<Channel, Field<Row>>>` | Extra columns that bindings can address by name: a size, a colour, a category, the x and y of an XY plot. |
| `isSorted` | `boolean` | The stored points already ascend in the domain. Default false. |
| `wrap` | `number` | The domain repeats with this period, and the source delivers one more point: the first, again, one period on. |

### LinePath

A line through the points.

**In** a series · **Holds** 1 curve (required)

| Attribute | Type | |
|---|---|---|
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |

### LinearCurve

Straight lines.

**In** LinePath or AreaPath · **Holds** none

No attributes of its own.
<!-- api:end -->

Notes:

- `hit` on a series: `'point'`, `'line'`, `'area'`, `'shape'` or `false`. `gaps`: `'break'` (default), `'connect'`, `'zero'`.
- `ObjectDataSource`'s `domain` and `value` are a property name (`"x"`) or a function (`(row) => row.x`).
- Size: a `width` or `height` attribute on the `Chart` always wins. `toSvgString(chart, { width, height })` supplies what the chart leaves out; with neither it is 640 x 400. A chart attached to a page follows its container.
- Axes fit the data and tidy the ends, so a value axis does not start at 0 unless a bar needs it: use `include={[0]}`, or `min`/`max`.
- A series may have more than one renderer (a line *and* markers). Every element used must be imported.

## Topics

Read the topic that matches the chart; each has examples and the attributes of the elements listed.

<!-- index:start -->
- **axes** (`topics/axes.md`): dates and times, categories, log and sqrt scales, tick labels and formats, axis limits, a second or reversed axis, number and date language. Elements: LogScale, SqrtScale, BandScale, IntlTimeScale, TemporalTimeScale.
- **lines-bars** (`topics/lines-bars.md`): bars (grouped, stacked), areas, smooth and stepped lines, curves, gaps in the data, several series sharing a plane. Elements: Stack, SeriesGroup, AreaPath, MonotoneCurve, NaturalCurve, CardinalCurve, CatmullRomCurve, BasisCurve, BumpCurve, QuadraticCurve, ArcCurve, StepCurve, BarPath, StemPath.
- **markers-color** (`topics/markers-color.md`): scatter and bubble charts, dots and crosses, colour or size taken from the data, colour and size keys. Elements: XYSeries, DotMarker, CrossMarker, PlusMarker, CircleMarker, SquareMarker, ColorAxis, ScalarAxis, ColorKey, SizeKey.
- **statistics** (`topics/statistics.md`): histograms (a histogram is `Density` + `BarPath`), heat maps, density, box plots, trendlines (linear, polynomial, sinusoidal, loess), error bars and bands. Elements: BoxPath, BoxStats, Density, HeatMap, LinearTrend, PolynomialTrend, SinusoidalTrend, LoessTrend, MeanTrend, ErrorBars, ErrorBand.
- **furniture** (`topics/furniture.md`): a chart title or caption, a legend, reference lines and callouts, notes on chosen points, an accessible name and summary. Elements: ChartTitle, Legend, ChartSummary, LineAnnotation, CalloutAnnotation, PointAnnotations.
- **interaction** (`topics/interaction.md`): tooltips, a crosshair, pan and zoom, drag-to-zoom, brushing a range, clicks and hovers, touch, an entrance animation. Elements: ChartTooltip, Cursor, Crosshair, PanZoom, BoxZoom, Brush, PointerListener, Entrance.
- **grid** (`topics/grid.md`): a dashboard: several charts in one picture, in a grid. Elements: ChartGroup, ChartGroupItem, SharedRange, SharedAxis.
- **planes** (`topics/planes.md`): polar and radar charts. Elements: PolarPlane, RadarPlane.
- **data** (`topics/data.md`): a million points (decimation), data as columns or from a function, updating live data, reading a chart's data back as a table. Elements: CompositeDataSource, SyntheticDataSource, Decimator, Slice, WorkerBoundary, MinMaxKernel, M4Kernel, LttbKernel, StrideKernel.
- **styling-output** (`topics/styling-output.md`): dark, accessible and custom themes, pattern fills (hatching, dots), styling parts, React, a PNG, chart as JSON, your own element types. Elements: LinePattern, HatchPattern, DotPattern.
- **troubleshooting** (`topics/troubleshooting.md`): an error message or a chart that draws nothing or draws wrongly.
<!-- index:end -->

Also: `reference/exports.md` lists every function and type exported from `'inkplot'` (read it only to find a name you do not have).

## Checklist

Before you answer, check each line against your code:

<!-- jsx -->
- [ ] `/** @jsxImportSource inkplot */` is the first line (or `new` is used throughout).
<!-- /jsx -->
<!-- ts -->
- [ ] Every element is made with `new Element(attributes, ...children)`, attributes first, and `tsc` reports no errors.
<!-- /ts -->
- [ ] Every element used is imported by name from `'inkplot'` (and `toSvgString`, when the file prints the SVG); none is imported and unused.
- [ ] `<Chart theme={…}>` has a theme.
- [ ] Every plane has two axes with an `orientation`; every `Axis` has exactly one scale child.
- [ ] Every series has a `name`, **data first** (a source or `Decimator`), then renderers; every `LinePath` and `AreaPath` has a curve.
- [ ] Data is in a source with the right attributes: `FlatDataSource` has `data` and (for y-only arrays, and for evenly spaced x including dates) `regularDomain-start` and `regularDomain-step`; `ObjectDataSource` has `source` and `value`; an `XYSeries` has `x` naming a channel.
- [ ] Bound channels are declared in the source's `channels` and the dimension has the `id` the `bind` names.
- [ ] `Cursor`, `Legend`, titles, `ColorAxis` and keys are children of the **chart**; axes, series, `PanZoom`, annotations and `PointerListener` are children of the **plane**.
- [ ] Dates are milliseconds; categories are `BandScale categories={[…]}` with domain 0, 1, 2…
<!-- jsx -->
- [ ] Hyphenated attributes are spelled exactly (`regularDomain-start`, `meta-title`); text is an attribute, not a child.
<!-- /jsx -->
<!-- ts -->
- [ ] Nested attributes are objects (`regularDomain: { start, step }`, `meta: { title }`), spelled exactly; text is an attribute, not a child.
<!-- /ts -->
- [ ] A container height is set (browser) or a size is given (`toSvgString`).
- [ ] No element object is used in two places (make a function for a source you need twice).
- [ ] No invented names: every element and attribute is in this file or a topic file.

## Not in inkplot

These do **not** exist. Do not write them.

- `chart.render()`, `chart.update(options)`, `chart.destroy()`, `new Chart(container, options)`. Use `chart.attach(platform)`, `setAttribute`, `chart.detach()`.
- `series.data = …`, `chart.data`. Data lives in a source element.
<!-- jsx -->
- `<ChartTitle>Text</ChartTitle>`, `<Axis label="…">` (use `title`), `<Legend position="…">` (use `side`).
<!-- /jsx -->
<!-- ts -->
- `new ChartTitle({}, 'Text')`, `new Axis({ label: '…' })` (use `title`), `new Legend({ position: '…' })` (use `side`).
<!-- /ts -->
- CSS classes or stylesheets for chart parts, or `d3`/`canvas` calls. Use `style`, attributes and themes.
- `LineSeries`, `BarSeries`, `ScatterSeries`: series are `DomainSeries` and `XYSeries`; the look comes from renderers (`LinePath`, `BarPath`, markers).
- `bind` on lines, areas and bars.
- A PNG export in the core or on a server. In the browser use `toPng`/`svgToPng`; on a server use `toSvgString` and a WASM rasterizer.
- Animation.

## More

`topics/*.md` (the topics above), `reference/exports.md`. The project's guide pages go deeper; they are not part of this skill and you do not need them for the charts described here.

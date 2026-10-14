# Recipes

"How do I…?" Each recipe is a complete, working example with a pointer to where the details are. They use the vanilla JSX style described in the [quick start](quick-start.md); every one of them is a module whose default export returns a `Chart`.

- [Plot numbers from an array](#plot-numbers-from-an-array)
- [Plot x/y pairs](#plot-xy-pairs)
- [Plot an array of objects](#plot-an-array-of-objects)
- [Draw bars for categories](#draw-bars-for-categories)
- [Group or stack bars and areas](#group-or-stack-bars-and-areas)
- [Fill under a line](#fill-under-a-line)
- [Smooth a line, or draw steps](#smooth-a-line-or-draw-steps)
- [Draw a scatter plot](#draw-a-scatter-plot)
- [Make a bubble chart or colour points by a value](#make-a-bubble-chart-or-colour-points-by-a-value)
- [Put dates on an axis](#put-dates-on-an-axis)
- [Use a log scale](#use-a-log-scale)
- [Plot a function](#plot-a-function)
- [Show a series on a second axis](#show-a-series-on-a-second-axis)
- [Add a target line or a note](#add-a-target-line-or-a-note)
- [Show a tooltip](#show-a-tooltip)
- [Show error bars or a band](#show-error-bars-or-a-band)
- [Let people pan and zoom](#let-people-pan-and-zoom)
- [Zoom to a box](#zoom-to-a-box)
- [Add a reset zoom button](#add-a-reset-zoom-button)
- [React to clicks and drags](#react-to-clicks-and-drags)
- [Draw a million points](#draw-a-million-points)
- [Use a polar or radar chart](#use-a-polar-or-radar-chart)
- [Use a dark theme](#use-a-dark-theme)
- [Change how a number is written](#change-how-a-number-is-written)
- [Update a chart that is on screen](#update-a-chart-that-is-on-screen)
- [Hide and show a series](#hide-and-show-a-series)
- [Make it accessible](#make-it-accessible)
- [Get an SVG string](#get-an-svg-string)
- [Save a chart as a PNG in the browser](#save-a-chart-as-a-png-in-the-browser)
- [Make a PNG on a server](#make-a-png-on-a-server)
- [Export the chart as a table](#export-the-chart-as-a-table)
- [Use it from React or plain HTML](#use-it-from-react-or-plain-html)

## Plot numbers from an array

A `FlatDataSource` with a `regularDomain` takes y values that are evenly spaced along x. This is the quick start's chart, and the fastest data to read: the array is used where it is, with no copy. A typed array (`Float64Array`) is better still for large data.

```tsx live title="Y values at regular intervals" height=220
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Load">
        <FlatDataSource data={[3, 5, 4, 8, 6, 9, 7]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

More: [Data](../guide/data.md).

## Plot x/y pairs

Without `regularDomain`, `data` holds pairs: x then y, x then y. Points are drawn in order of x whatever order you give them.

```tsx live title="Interleaved x and y values" height=220
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const pairs = [0, 1, 1.5, 3, 4, 2, 5, 6, 9, 5];

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Readings">
        <FlatDataSource data={pairs} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

## Plot an array of objects

`ObjectDataSource` reads rows by property name (or by function). Leave out `domain` and the row's index is x.

```tsx live title="Rows as objects" height=220
import { Axis, CartesianPlane, Chart, DomainSeries, LinePath, LinearCurve, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const rows = [
  { year: 2019, sales: 120 }, { year: 2020, sales: 90 }, { year: 2021, sales: 150 },
  { year: 2022, sales: 210 }, { year: 2023, sales: 240 },
];

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1} format={(v: number) => String(v)}><LinearScale /></Axis>
      <Axis orientation="left" include={[0]}><LinearScale /></Axis>
      <DomainSeries name="Sales">
        <ObjectDataSource source={rows} domain="year" value="sales" />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

A function works for either field: `value={(row) => row.sales / 1000}`. Columns kept in separate arrays have `CompositeDataSource`; a mathematical function has `SyntheticDataSource`. See [Data](../guide/data.md).

## Draw bars for categories

Bars sit on a **band scale**: the domain values 0, 1, 2… are the categories, in order, and the axis labels them with their names. The renderer is `BarPath`.

```tsx live title="A bar chart" height=240
import { Axis, BandScale, BarPath, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['Q1', 'Q2', 'Q3', 'Q4']} /></Axis>
      <Axis orientation="left" title="Revenue (k)"><LinearScale /></Axis>
      <DomainSeries name="2024">
        <FlatDataSource data={[42, 58, 51, 73]} regularDomain-start={0} regularDomain-step={1} />
        <BarPath />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

Bars grow from zero, and the value axis always reaches it. For horizontal bars, put the band axis on the left and the value axis at the bottom: the plane places a series' first value on whichever axis is horizontal, so swapping sides turns the chart.

## Group or stack bars and areas

A `Stack` holds series that share a domain and a value axis. Its `mode` says how they are laid out: `stack` (one on another, the default), `group` (side by side, for bars), `normalize` (stacked to 100%) or `center` (a streamgraph).

```tsx live title="Stacked and grouped bars" height=300
import { Axis, BandScale, BarPath, CartesianPlane, Chart, DomainSeries, FlatDataSource, Legend, LinearScale, Stack, lightTheme } from 'inkplot';

const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
const series = (name: string, data: number[]) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <BarPath />
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={quarters} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <Stack mode="stack">
        {series('Product', [30, 38, 35, 50])}
        {series('Services', [12, 20, 16, 23])}
        {series('Support', [6, 8, 9, 11])}
      </Stack>
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
);
```

Change `mode="stack"` to `mode="group"` and the same three series stand side by side. Members must have the same categories; if they do not, `align` says how to merge them (`gaps` for bars, `interpolate` for areas and lines). See [Series and renderers](../guide/series.md#stacks).

## Fill under a line

Give the series an `AreaPath` instead of (or as well as) a `LinePath`.

```tsx live title="An area with its outline" height=220
import { Axis, AreaPath, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left" include={[0]}><LinearScale /></Axis>
      <DomainSeries name="Visitors">
        <FlatDataSource data={[20, 35, 30, 55, 48, 70, 62]} regularDomain-start={0} regularDomain-step={1} />
        <AreaPath opacity={0.25}><LinearCurve /></AreaPath>
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

A series can have any number of renderers, drawn in order. Both here take their colour from the series' palette colour, so they match.

## Smooth a line, or draw steps

How points are joined is the renderer's one child, its **curve**. `LinearCurve` is straight segments; `MonotoneCurve` is smooth and never overshoots the data; `StepCurve` holds a value until the next point. There are others (`CatmullRomCurve`, `CardinalCurve`, `NaturalCurve`, `BasisCurve`, `BumpCurve`, `ArcCurve`, `QuadraticCurve`).

```tsx live title="Linear, monotone and step curves" height=280
import { Axis, CartesianPlane, Chart, type AnyElement, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, MonotoneCurve, StepCurve, lightTheme } from 'inkplot';

const data = [4, 7, 5, 9, 6, 8, 3, 6];
const line = (name: string, curve: AnyElement) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <LinePath>{curve}</LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {line('Linear', <LinearCurve />)}
      {line('Monotone', <MonotoneCurve />)}
      {line('Step', <StepCurve mode="after" />)}
    </CartesianPlane>
    <Legend />
  </Chart>
);
```

More: [Series and renderers](../guide/series.md#curves).

## Draw a scatter plot

A scatter has two values per point and no order, so it uses an `XYSeries`: the source's `value` is y, and x is a named **channel** of the source. Markers draw the points.

```tsx live title="A scatter plot" height=280
import { Axis, CartesianPlane, Chart, CircleMarker, LinearScale, ObjectDataSource, XYSeries, lightTheme } from 'inkplot';

// A fixed pseudo-random generator, so the example always looks the same.
const random = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const next = random(7);
const points = Array.from({ length: 120 }, () => {
  const x = next() * 10;
  return { x, y: 2 + 0.8 * x + (next() - 0.5) * 4 };
});

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane frame>
      <Axis orientation="bottom" title="Dose"><LinearScale /></Axis>
      <Axis orientation="left" title="Response"><LinearScale /></Axis>
      <XYSeries name="Samples" x="x">
        <ObjectDataSource source={points} value="y" channels={{ x: 'x' }} />
        <CircleMarker size={3} opacity={0.7} />
      </XYSeries>
    </CartesianPlane>
  </Chart>
);
```

`DotMarker`, `SquareMarker`, `CrossMarker` and `PlusMarker` are the other markers. A series with a marker *and* a `LinePath` draws both, which is how you mark the points of a line.

## Make a bubble chart or colour points by a value

Any numeric property of a renderer (a marker's `size`, `fill`, `stroke`, `opacity`) can come from the data instead of being fixed. You **bind** it to a data channel through a **mapped axis**: a `SizeAxis` turns numbers into sizes, a `ColorAxis` into colours. A key beside the chart shows what the colours or sizes mean. Mapped axes belong to the `Chart`, next to the plane.

```tsx live title="Colour and size from data" height=420
import { Axis, CartesianPlane, Chart, CircleMarker, ColorAxis, ColorKey, LinearScale, ObjectDataSource, SizeAxis, SizeKey, XYSeries, lightTheme } from 'inkplot';

const random = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const next = random(11);
const rows = Array.from({ length: 40 }, () => {
  const x = next() * 100, y = next() * 100;
  return { x, y, temperature: 10 + (x + y) / 8 + next() * 4, mass: 1 + next() * 9 };
});

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane frame>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries x="x">
        <ObjectDataSource source={rows} value="y" channels={{ x: 'x', temperature: 'temperature', mass: 'mass' }} />
        <CircleMarker opacity={0.85} bind={{ fill: { axis: 'heat', channel: 'temperature' }, size: { axis: 'weight', channel: 'mass' } }} />
      </XYSeries>
    </CartesianPlane>
    <ColorAxis id="heat" title="Temp (°C)" ramp="viridis"><LinearScale /></ColorAxis>
    <SizeAxis id="weight" title="Mass (kg)" output={[3, 14]}><LinearScale /></SizeAxis>
    <ColorKey dimension="heat" side="right" />
    <SizeKey dimension="weight" side="right" />
  </Chart>
);
```

The mapped axes fit themselves to the data bound to them, so they need no `min` or `max`. See [Mapped dimensions and keys](../guide/mapped.md).

## Put dates on an axis

A time scale takes timestamps (milliseconds since 1970, as `Date.getTime()`) and labels the axis in calendar terms, choosing days, months or years to suit the span. `IntlTimeScale` uses the browser's `Intl` and any IANA time zone; `TemporalTimeScale` uses `Temporal`.

```tsx live title="A time axis" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, IntlTimeScale, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const day = 24 * 60 * 60 * 1000;
const start = Date.UTC(2024, 0, 1);
const downloads = Array.from({ length: 90 }, (_, i) => 200 + 60 * Math.sin(i / 9) + i * 3);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><IntlTimeScale timeZone="UTC" /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Downloads">
        <FlatDataSource data={downloads} regularDomain-start={start} regularDomain-step={day} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

If your dates are strings or `Date` objects, give an `ObjectDataSource` a function: `domain={(row) => Date.parse(row.date)}`. More: [Axes and scales](../guide/axes.md#time-scales).

## Use a log scale

Replace the axis' scale. Values that are not positive have no place on a log axis and are drawn as gaps.

```tsx live title="A logarithmic axis" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, LogScale, lightTheme } from 'inkplot';

const growth = Array.from({ length: 12 }, (_, i) => 3 * Math.pow(2.2, i));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LogScale /></Axis>
      <DomainSeries name="Users">
        <FlatDataSource data={growth} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

`SqrtScale` is the other: it keeps zero on the axis while giving small values more room.

## Plot a function

A `SyntheticDataSource` samples a function over a domain, as finely as the plot is wide, so it stays smooth when zoomed. Return `NaN` where the function is undefined and the line breaks there.

```tsx live title="A function of x" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, LinePath, LinearCurve, LinearScale, PanZoom, SyntheticDataSource, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="sin(x) / x">
        <SyntheticDataSource fn={(x: number) => (x === 0 ? 1 : Math.sin(x) / x)} domain={{ min: -20, max: 20 }} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
      <PanZoom />
    </CartesianPlane>
  </Chart>
);
```

## Show a series on a second axis

Add a second value axis on the other side, give it an `id`, and tell the series to use it with `valueAxis`.

```tsx live title="Two value axes" height=280
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left" title="Temperature (°C)"><LinearScale /></Axis>
      <Axis id="rain" orientation="right" title="Rainfall (mm)" include={[0]}><LinearScale /></Axis>
      <DomainSeries name="Temperature">
        <FlatDataSource data={[8, 10, 14, 18, 22, 25, 24]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
      <DomainSeries name="Rainfall" valueAxis="rain">
        <FlatDataSource data={[80, 60, 55, 40, 30, 20, 25]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
);
```

Series without `valueAxis` use the plane's second axis, the first one you added on the vertical.

## Add a target line or a note

A `LineAnnotation` is a reference line at a value (`value`), at a position along the domain (`domain`), or between two points (`from` and `to`). A `CalloutAnnotation` is a note on a data point, placed where it covers least.

```tsx live title="A target line and a callout" height=260
import { Axis, CalloutAnnotation, CartesianPlane, Chart, DomainSeries, FlatDataSource, LineAnnotation, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Score">
        <FlatDataSource data={[52, 58, 61, 57, 66, 74, 71, 78]} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
      <LineAnnotation value={70} label="Target" stroke="#2a8f4a" />
      <CalloutAnnotation domain={6} value={74} text={'Launch\nweek'} />
    </CartesianPlane>
  </Chart>
);
```

## Show a tooltip

A `Cursor` finds what the pointer is near; a `ChartTooltip` inside it shows it, and a `Crosshair` draws guide lines. `mode="shared"` reads every series at the pointer's position, which suits several lines over one domain.

```tsx live title="A shared tooltip with a crosshair" height=280
import { Axis, CartesianPlane, Chart, ChartTooltip, Crosshair, Cursor, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const line = (name: string, data: number[]) => (
  <DomainSeries name={name} hit="line">
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <LinePath><LinearCurve /></LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {line('Alpha', [4, 6, 5, 9, 7, 10])}
      {line('Beta', [8, 7, 9, 4, 5, 3])}
    </CartesianPlane>
    <Cursor mode="shared">
      <Crosshair lines="first" dots />
      <ChartTooltip swatch />
    </Cursor>
  </Chart>
);
```

The cursor also works from the keyboard (arrow keys), and the tooltip's text is announced to screen readers. Change what the tooltip says with `format`. More: [Interaction](../guide/interaction.md).

## Show error bars or a band

Put the error in a channel of the data, and add `ErrorBars` (or `ErrorBand`) to the series with the channel's name. `negativeError` is a second channel for an asymmetric error; `mode="relative"` reads the numbers as fractions of the value. The axes leave room for them. The examples are in [Series](../guide/series.md#error-bars-and-bands).

```tsx check title="Error bars from a column of the data"
import { Axis, CartesianPlane, Chart, DomainSeries, ErrorBars, LinePath, LinearCurve, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries>
        <ObjectDataSource source={[{ t: 0, v: 5, sd: 1 }, { t: 1, v: 7, sd: 2 }]} domain="t" value="v" isSorted channels={{ sd: 'sd' }} />
        <LinePath><LinearCurve /></LinePath>
        <ErrorBars error="sd" />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

## Let people pan and zoom

Add `PanZoom` to the plane: drag to pan, wheel to zoom about the pointer, double-click to reset, and arrow and `+`/`-` keys once the plot has focus. The axes fit the data in view.

```tsx live title="Pan and zoom" height=260
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, PanZoom, lightTheme } from 'inkplot';

const wave = Float64Array.from({ length: 2000 }, (_, i) => Math.sin(i / 40) + 0.3 * Math.sin(i / 7));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Signal">
        <FlatDataSource data={wave} isSorted regularDomain-start={0} regularDomain-step={1} />
        <LinePath strokeWidth={1}><LinearCurve /></LinePath>
      </DomainSeries>
      <PanZoom meta-title="Signal plot" />
    </CartesianPlane>
  </Chart>
);
```

`direction="horizontal"` limits movement to one direction, and `axes` chooses which axes move. Wheel or pinch with the pointer over an axis zooms that axis alone, and on a touch screen one finger scrolls the page while two fingers pinch the chart ([Interaction](../guide/interaction.md#pan-and-zoom)).

## Zoom to a box

Add `BoxZoom` **before** `PanZoom`: hold Shift and drag a rectangle (the live example is in [Interaction](../guide/interaction.md#box-zoom)). `mode="auto"` zooms only along the long side of a flat box, and `activate="always"` makes every drag a box.

## Add a reset zoom button

Any button can put the axes back with `chart.resetViews()`. An axis' `onViewChange` is called each time its view changes (with `null` when it is back to natural), which is when to enable or disable the button. In plain DOM:

```ts check title="A reset button, in plain DOM"
import { Axis, BoxZoom, CartesianPlane, Chart, DOMPlatform, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, PanZoom, lightTheme } from 'inkplot';

const button = document.querySelector<HTMLButtonElement>('#reset')!;
const host = document.querySelector<HTMLElement>('#chart')!;
const zoomed = new Set<Axis>();
const track = (axis: Axis) => (view: unknown) => {
  if (view) zoomed.add(axis); else zoomed.delete(axis);
  button.disabled = zoomed.size === 0;
};
const x: Axis = new Axis({ orientation: 'bottom', onViewChange: (v) => track(x)(v) }, new LinearScale());
const y: Axis = new Axis({ orientation: 'left', onViewChange: (v) => track(y)(v) }, new LinearScale());

const chart = new Chart({ theme: lightTheme }, new CartesianPlane({}, x, y,
  new DomainSeries(new FlatDataSource({ data: [3, 5, 4, 8, 6, 9, 7], regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve())),
  new BoxZoom(), new PanZoom()));
chart.attach(new DOMPlatform(host));
button.disabled = true;
button.onclick = () => chart.resetViews();
```

In React, hold the chart with a `ref` and call the same method; `onViewChange` is an ordinary prop, so it can set state. Functions are compared by identity, so memoize it:

```tsx check title="A reset button, in React" jsx=react
import { useCallback, useRef, useState } from 'react';
import { type Chart as ChartElement, lightTheme } from 'inkplot';
import { Axis, BoxZoom, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, PanZoom } from 'inkplot/react';

export function Zoomable({ data }: { data: number[] }) {
  const chart = useRef<ChartElement>(null);
  const [zoomed, setZoomed] = useState(0);
  // Count the axes that are zoomed, so the button is on while any is.
  const view = useCallback((range: unknown) => setZoomed((n) => Math.max(0, n + (range ? 1 : -1))), []);
  return (
    <>
      <button disabled={zoomed === 0} onClick={() => chart.current?.resetViews()}>Reset zoom</button>
      <Chart ref={chart} theme={lightTheme} hostProps={{ style: { height: 300 } }}>
        <CartesianPlane>
          <Axis orientation="bottom"><LinearScale /></Axis>
          <Axis orientation="left" onViewChange={view}><LinearScale /></Axis>
          <DomainSeries name="Data">
            <FlatDataSource data={data} regularDomain={{ start: 0, step: 1 }} />
            <LinePath><LinearCurve /></LinePath>
          </DomainSeries>
          <BoxZoom />
          <PanZoom />
        </CartesianPlane>
      </Chart>
    </>
  );
}
```

## React to clicks and drags

A `PointerListener` in a plane calls your functions when the pointer hovers, clicks or drags on a point. Each is given where the pointer is in both pixels and data terms, and the point under it.

```tsx live title="Click a point" height=240
import { Axis, CartesianPlane, Chart, CircleMarker, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, PointerListener, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Orders" hit="point">
        <FlatDataSource data={[5, 8, 6, 11, 9]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
        <CircleMarker size={4} />
      </DomainSeries>
      <PointerListener onClick={(info) => info.hit && console.log(info.hit.series.attrs.name, info.hit.first, info.hit.second)} />
    </CartesianPlane>
  </Chart>
);
```

A drag (`onDrag`) reports where the grabbed point is *to go*; setting the data to match is how you build editable charts. See [Interaction](../guide/interaction.md#pointer-listener).

## Draw a million points

Put a `Decimator` between the series and its source. It reduces the data to what the plot can show, a few points per pixel column, keeping every peak and valley, and reads only the visible part, so zooming in refills from the full data.

```tsx live title="A million points" height=260
import { Axis, CartesianPlane, Chart, Decimator, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, MinMaxKernel, PanZoom, lightTheme } from 'inkplot';

const n = 1_000_000;
const signal = new Float64Array(n);
for (let i = 0; i < n; i++) signal[i] = Math.sin(i / 20000) * 50 + Math.sin(i / 300) * 8 + ((i * 7919) % 101) / 20;

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Signal">
        <Decimator>
          <MinMaxKernel />
          <FlatDataSource data={signal} isSorted regularDomain-start={0} regularDomain-step={1} />
        </Decimator>
        <LinePath strokeWidth={1}><LinearCurve /></LinePath>
      </DomainSeries>
      <PanZoom />
    </CartesianPlane>
  </Chart>
);
```

`isSorted` tells the source the data is in order, so it is read where it is and never copied. More: [Performance and size](../guide/performance.md).

## Draw a pie or ring chart

A ring chart is a stack of bars on a polar plane. The **bars run round the circle**: a series' value is an angle, and its domain is a **ring**. Normalise the stack so each ring adds up to a whole turn; each series is then one segment of every ring, and each point of a series is one ring (so one point is a pie, with `innerRadius` for a doughnut).

```tsx live title="A ring chart: three segments, three rings" height=340
import { Axis, BandScale, BarPath, Chart, DomainSeries, FlatDataSource, Legend, LinearScale, PolarPlane, Stack, lightTheme } from 'inkplot';

const segment = (name: string, data: number[]) => (
  <DomainSeries name={name} domainAxis="ring" valueAxis="share">
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <BarPath />
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <PolarPlane innerRadius={0.2} gridlines={false}>
      <Axis id="share" orientation="angle" min={0} max={1} visible={false}><LinearScale /></Axis>
      <Axis id="ring" orientation="radius" visible={false}><BandScale categories={['2022', '2023', '2024']} /></Axis>
      <Stack mode="normalize">
        {segment('Mobile', [30, 45, 60])}
        {segment('Desktop', [55, 40, 28])}
        {segment('Other', [15, 15, 12])}
      </Stack>
    </PolarPlane>
    <Legend side="right" />
  </Chart>
);
```

Both axes are hidden (the share is read off the legend and the rings off their order), and `gridlines={false}` leaves only the segments. With one point per series the result is a pie. To show each segment's value on it, add a [`PointAnnotations`](../guide/labels.md#pointannotations-notes-on-chosen-points) for each series (it is a plane child after the stack, anchored to the segment's bars), as in the example there.

## Use a polar or radar chart

Planes are interchangeable: a `PolarPlane` or `RadarPlane` takes an `angle` axis and a `radius` axis, and the series and renderers are the same ones. On a radar there is a spoke at each tick of the angle axis; `wrap` repeats the first point at the end so the shape closes.

```tsx live title="A radar chart" height=380
import { AreaPath, Axis, Chart, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, RadarPlane, lightTheme } from 'inkplot';

const skills = ['Speed', 'Power', 'Range', 'Armour', 'Stealth', 'Control'];
const profile = (name: string, scores: number[], colour: string) => (
  <DomainSeries name={name}>
    <FlatDataSource data={scores} regularDomain-start={0} regularDomain-step={1} wrap={skills.length} />
    <AreaPath fill={colour} opacity={0.25}><LinearCurve /></AreaPath>
    <LinePath stroke={colour}><LinearCurve /></LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <RadarPlane>
      <Axis orientation="angle" min={0} max={skills.length} tickCount={skills.length + 1} format={(v: number) => skills[v] ?? ''}><LinearScale /></Axis>
      <Axis orientation="radius" min={0} max={10} tickCount={6}><LinearScale /></Axis>
      {profile('Profile A', [8, 5, 7, 4, 9, 6], '#2a6fdb')}
      {profile('Profile B', [5, 9, 4, 8, 3, 7], '#e8590c')}
    </RadarPlane>
    <Legend side="bottom" />
  </Chart>
);
```

## Use a dark theme

Give the chart `darkTheme`. The chart paints no background unless you ask, so it sits on whatever your page is; to fill it, set `style={{ chart: { background: '#14161a' } }}` on the chart.

```tsx live title="The dark theme" height=240 dark
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, darkTheme } from 'inkplot';

const line = (name: string, data: number[]) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <LinePath><LinearCurve /></LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={darkTheme} style={{ chart: { background: '#14161a' } }}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {line('Night', [3, 5, 4, 7, 6, 8])}
      {line('Day', [6, 4, 7, 3, 5, 4])}
    </CartesianPlane>
    <Legend />
  </Chart>
);
```

To make your own theme, or change a few things in one, see [Styling](../guide/styling.md).

## Change how a number is written

An axis' `format` is a function from a number to text. A tooltip has one too.

```tsx live title="Formatting tick labels" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" title="Month" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left" format={(v: number) => money.format(v)}><LinearScale /></Axis>
      <DomainSeries name="Revenue">
        <FlatDataSource data={[12000, 15500, 14200, 18900, 21000]} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

## Update a chart that is on screen

Keep the elements you will change (a `ref`, a variable, or `findById`) and set their attributes. The chart redraws on the next frame; you do not call anything else.

```tsx check title="Live updates"
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const source = new FlatDataSource({ data: [1, 2, 3], regularDomain: { start: 0, step: 1 } });
export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Live">{source}<LinePath><LinearCurve /></LinePath></DomainSeries>
    </CartesianPlane>
  </Chart>
);

// New data: a new array.
source.setAttribute('data', [1, 2, 3, 5, 8]);

// Appending to a buffer you own: edit it in place, then say so.
const buffer = new Float64Array(1000);
source.setAttributes({ data: buffer, count: 0, isSorted: true });
let used = 0;
export function push(value: number) {
  buffer[used++] = value;
  source.setAttribute('count', used);
}
```

More about what a change costs: [Performance and size](../guide/performance.md).

## Hide and show a series

`visible={false}` takes a series out of the drawing, the axes' ranges and the pointer's reach, and keeps it in the tree, so showing it again is cheap. A `Legend` does this when an entry is clicked.

```tsx live title="A hidden series" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const line = (name: string, data: number[], visible: boolean) => (
  <DomainSeries name={name} visible={visible}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <LinePath><LinearCurve /></LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {line('Shown', [3, 5, 4, 7], true)}
      {line('Hidden until its legend entry is clicked', [9, 8, 9, 8], false)}
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
);
```

## Make it accessible

Give the chart a name and description with `meta`, and add a `ChartSummary` (a generated description of what the chart holds). Keyboard use comes with the interactive elements: a `Cursor` and a `PanZoom` are tab stops with arrow-key control. See [Accessibility](../guide/accessibility.md).

```tsx live title="A named, described chart" height=240
import { Axis, CartesianPlane, Chart, ChartSummary, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme} meta-title="Monthly rainfall" meta-description="Rainfall rises from January to a peak in October">
    <CartesianPlane>
      <Axis orientation="bottom" title="Month"><LinearScale /></Axis>
      <Axis orientation="left" title="mm"><LinearScale /></Axis>
      <DomainSeries name="Rainfall">
        <FlatDataSource data={[20, 25, 30, 42, 55, 60, 70, 74, 80, 95, 88, 70]} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
    <ChartSummary />
  </Chart>
);
```

## Get an SVG string

On a server, in a build step, or in a test: no DOM needed.

```ts check title="Rendering to a string"
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme, toSvgString } from 'inkplot';

const chart = new Chart({ theme: lightTheme },
  new CartesianPlane({},
    new Axis({}, new LinearScale()),
    new Axis({}, new LinearScale()),
    new DomainSeries({}, new FlatDataSource({ data: [1, 3, 2] }), new LinePath({}, new LinearCurve()))));

export const svg: string = toSvgString(chart, { width: 600, height: 300 });
```

The string uses presentation attributes only (no stylesheet), so it can be saved as a `.svg` file or inlined in HTML. Save it as a PNG with any SVG renderer.

## Save a chart as a PNG in the browser

`toPng` draws the chart's SVG into a canvas and gives back a `Blob`. It is a separate import (`inkplot` bundles it only if you use it). For a chart on the page it uses what is showing; for one that is not attached it renders a copy.

```ts check title="Download the chart as a PNG"
import { type Chart, toPng } from 'inkplot';

export async function download(chart: Chart, name = 'chart.png') {
  const blob = await toPng(chart, { scale: 2, background: '#ffffff' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
```

`scale` multiplies the pixel size (2 is sharp on a dense screen), and without a `background` the picture is transparent. Web fonts your page loaded are not available to an SVG drawn as an image, so text comes out in the system font. `svgToPng(svgString)` does the same for an SVG you already hold.

## Make a PNG on a server

Rendering a chart to SVG needs no DOM (see above); turning that SVG into pixels needs a renderer. [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js) is the Rust renderer `resvg` compiled to WebAssembly, so it runs wherever WebAssembly does: Node, serverless functions, edge workers. Nothing about it is in the library. Two things to know: initialise the WASM **once** per process, and give it a **font**, because a serverless function has no system fonts and the SVG's text would otherwise vanish.

```js
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { toSvgString } from 'inkplot';

const require = createRequire(import.meta.url);
await initWasm(readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const font = new Uint8Array(await readFile(new URL('./Inter-Regular.ttf', import.meta.url)));

/** The chart as PNG bytes. `chart` must not be attached to a platform. */
export function renderPng(chart, { width = 640, height = 400, scale = 2 } = {}) {
  const svg = toSvgString(chart, { width, height });
  const resvg = new Resvg(svg, {
    background: '#ffffff',
    fitTo: { mode: 'zoom', value: scale },
    font: { fontBuffers: [font], defaultFontFamily: 'Inter', loadSystemFonts: false },
  });
  return resvg.render().asPng();
}
```

Send the bytes back as `image/png`. On Cloudflare Workers and other edge runtimes the WASM comes from a bundler import instead of a file (`import wasm from '@resvg/resvg-wasm/index_bg.wasm'` then `await initWasm(wasm)`), and the font from a bundled asset; everything else is the same. The `svg2png-wasm` package wraps the same renderer if you prefer its interface. This recipe is run by the repository's tests (`npm run png-server:test`) when the package is installed.

## Export the chart as a table

A source or a transform needs no chart to be read: `readTable(node)` gives its columns (the domain, the value, then every channel it offers) as typed arrays, ascending in the domain, with `rows()` for one object per row. It is the data as a series would be given it, before any scale, pixel or decimation, so a table of a `BoxStats` is the five-number summary and a table of a `Density` is the bins.

```ts check title="A table from a source, from a transform, and from a chart"
import { BoxStats, Chart, ObjectDataSource, Series, descendantsOfType, readTable } from 'inkplot';

const samples = [{ group: 0, x: 2 }, { group: 0, x: 4 }, { group: 0, x: 9 }, { group: 1, x: 3 }, { group: 1, x: 5 }];
const source = () => new ObjectDataSource({ source: samples, domain: 'group', value: 'x' });

// The stored rows, then what a transform makes of them.
export const raw = readTable(source(), { names: { domain: 'group', value: 'x' } }).rows();
export const summary = readTable(new BoxStats({}, source())).rows();   // { domain, value, min, q1, median, q3, max, mean, sd, sem, n }

/** The data behind every series of a chart, as CSV text: a block for each series, named by its `name`. */
export function chartToCsv(chart: Chart): string {
  const blocks: string[] = [];
  for (const series of descendantsOfType(chart, Series)) {
    const table = readTable(series.data);
    const lines = [table.columns.join(',')];
    for (let i = 0; i < table.count; i++) lines.push(table.data.map((column) => column[i]).join(','));
    blocks.push(`# ${series.attrs.name ?? 'series'}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}
```

Three things to know:

- **Generated data has no rows of its own.** A function (`SyntheticDataSource`) or a trendline is read where you say: `readTable(trend, { domain: { min: 0, max: 10 }, samples: 11 })` (a trendline covers the data's span and its `extend`). For the fitted value at positions you choose, whatever they are, a trendline is a function: `trend.evaluate([1, 2.5, 40])` gives a `Float64Array`, and `trend.fit` the `r2`, `rmse` and coefficients to put beside it ([Trendlines](../guide/series.md#trendlines)).
- **A `Decimator` reads as its thinned output**, with `samples` as the width it reduces to. Read the decimator's *source* (`series.data` is the decimator; its `source` is the data) to get every row.
- **Missing values are `NaN`.** Turn them into empty cells (or `null` in JSON) as the format needs; `Number.isNaN` is the test.

## Use it from React or plain HTML

The same tree, through an adapter. See [Frameworks](../guide/frameworks.md) for the details of each. For React, import the components you use from `inkplot/react` (only those are bundled) and write the chart with them:

```tsx check title="A chart in a React component" jsx=react
import { lightTheme } from 'inkplot';
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale } from 'inkplot/react';

export function Rainfall({ data }: { data: number[] }) {
  return (
    <Chart theme={lightTheme} hostProps={{ style: { height: 300 } }}>
      <CartesianPlane>
        <Axis orientation="bottom"><LinearScale /></Axis>
        <Axis orientation="left"><LinearScale /></Axis>
        <DomainSeries name="Rainfall">
          <FlatDataSource data={data} regularDomain={{ start: 0, step: 1 }} />
          <LinePath><LinearCurve /></LinePath>
        </DomainSeries>
      </CartesianPlane>
    </Chart>
  );
}
```

For plain HTML, define the elements you use as custom elements and write the chart as markup (attribute names are lowercase, as HTML makes them, and hyphens nest):

```html
<script type="module">
  import * as inkplot from 'inkplot';
  import { defineElements } from 'inkplot/web-components';
  const { Chart, CartesianPlane, Axis, LinearScale, DomainSeries, FlatDataSource, LinePath, LinearCurve } = inkplot;
  defineElements({ Chart, CartesianPlane, Axis, LinearScale, DomainSeries, FlatDataSource, LinePath, LinearCurve }, { prefix: 'ink' });
  document.querySelector('ink-chart').props = { theme: inkplot.lightTheme };
</script>

<ink-chart style="height: 300px">
  <ink-cartesian-plane>
    <ink-axis orientation="bottom"><ink-linear-scale></ink-linear-scale></ink-axis>
    <ink-axis orientation="left"><ink-linear-scale></ink-linear-scale></ink-axis>
    <ink-domain-series name="Rainfall">
      <ink-flat-data-source data="[3, 5, 4, 8]" regulardomain-start="0" regulardomain-step="1"></ink-flat-data-source>
      <ink-line-path><ink-linear-curve></ink-linear-curve></ink-line-path>
    </ink-domain-series>
  </ink-cartesian-plane>
</ink-chart>
```

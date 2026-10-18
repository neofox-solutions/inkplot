# Quick start

This page takes you from nothing to a chart on a page, and shows the three ways of writing one. It assumes you know TypeScript or JavaScript and have used a bundler.

> **Note.** inkplot is in beta: install it with `npm install inkplot@beta` (`inkplot` alone is the latest stable release, once there is one).

## What it is

inkplot draws charts as SVG. A chart is a **tree of elements** you build and keep: a `Chart` holds a plane, the plane holds axes and series, a series holds its data and the renderers that draw it. Changing an element's attributes changes what is on the screen; the library works out the least that has to be redone.

It is small: a line chart is about 17 KB gzipped, and you pay only for what you import (see [Performance and size](../guide/performance.md)). It has no dependencies, and the core runs anywhere JavaScript does: a browser, Node, an edge worker.

## A first chart

Write the tree as JSX, with the library's own JSX runtime. Nothing is virtual: each tag *is* the element, created at once.

```tsx live title="A first line chart" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Temperature">
        <FlatDataSource data={[12, 14, 13, 17, 21, 19, 22]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

Read it from the outside in:

- `Chart` is the root. It needs a **theme**, the set of default looks. `lightTheme` and `darkTheme` are included; a chart bundles only the one you name.
- `CartesianPlane` is an x/y coordinate space. It owns the axes and the series.
- Each `Axis` has a side (`orientation`) and one child, its **scale**: `LinearScale` for numbers. The first axis is at the bottom and the second on the left unless you say otherwise.
- `DomainSeries` is "a value at each position along a domain". Its first child is the **data**; the rest are **renderers**.
- `FlatDataSource` reads numbers from an array. With `regularDomain`, the numbers are y values at x = 0, 1, 2…. Hyphens in an attribute name reach into an object: `regularDomain-start={0}` means `regularDomain: { start: 0 }`.
- `LinePath` draws a line, and its child `LinearCurve` says how the points are joined (straight segments).

The series finds its axes and the plane's. There is nothing to wire up, and nothing to tell the axes about the data: they fit themselves to it.

### Setting up JSX

Point your compiler's JSX at the library. In `tsconfig.json`:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "inkplot" } }
```

With esbuild, Rolldown or Vite: `jsx: 'automatic', jsxImportSource: 'inkplot'`. Or per file: `/** @jsxImportSource inkplot */`. TypeScript checks each tag's attributes. It cannot check the hyphenated ones (`regularDomain-start`) or which children go where; those are checked when the chart is built, with errors that name the element.

## Putting it on a page

A chart is only a tree until you give it a **platform** to draw on. In a browser that is `DOMPlatform`, which creates an `<svg>` inside an element of yours and follows its size:

```ts
import { DOMPlatform } from 'inkplot';
import { makeChart } from './chart';

const chart = makeChart();
chart.attach(new DOMPlatform(document.getElementById('chart')!));
```

The container needs a height of its own (CSS `height: 320px`, say). The chart fills it, redraws when it resizes, and redraws when you change an element. To remove it, `chart.detach()`; the tree is kept and can be attached again.

## Making it a little richer

More of the same: a second series, a legend, a title, axis titles, and a tooltip that follows the pointer.

```tsx live title="Two series with a legend and tooltip" height=300
import { Axis, CartesianPlane, Chart, ChartTitle, ChartTooltip, Crosshair, Cursor, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const north = [12, 14, 13, 17, 21, 19, 22, 20];
const south = [18, 17, 19, 16, 15, 17, 14, 15];

export default () => (
  <Chart theme={lightTheme}>
    <ChartTitle text="Daily high" />
    <CartesianPlane>
      <Axis orientation="bottom" title="Day"><LinearScale /></Axis>
      <Axis orientation="left" title="°C" include={[0]}><LinearScale /></Axis>
      <DomainSeries name="North">
        <FlatDataSource data={north} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
      <DomainSeries name="South">
        <FlatDataSource data={south} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
    <Legend />
    <Cursor>
      <Crosshair />
      <ChartTooltip />
    </Cursor>
  </Chart>
);
```

Each new thing is one more element in the tree:

- `ChartTitle`, `Legend` and `Cursor` are children of the `Chart`, beside the plane.
- `include={[0]}` makes the left axis reach zero whatever the data says.
- `Cursor` finds the point under the pointer (or reached by the keyboard); `Crosshair` and `ChartTooltip` inside it draw what it found. Add neither and you have a cursor nobody sees; add only a tooltip and there are no guide lines.

Series take their colours from the theme's palette in order, so the two lines differ with no work from you.

## Three ways to write the same chart

The tree is the same however you write it. Choose per file.

**JSX** (as above). Short, and reads like the tree. Best for static structure, and for functions that return pieces of a chart.

**Plain classes.** Every element is a class: `new X(attributes, ...children)`.

```ts check title="The first chart with new"
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export const chart = new Chart({ theme: lightTheme },
  new CartesianPlane({},
    new Axis({ orientation: 'bottom' }, new LinearScale()),
    new Axis({ orientation: 'left' }, new LinearScale()),
    new DomainSeries({ name: 'Temperature' },
      new FlatDataSource({ data: [12, 14, 13, 17, 21, 19, 22], regularDomain: { start: 0, step: 1 } }),
      new LinePath({}, new LinearCurve()),
    ),
  ),
);
```

Here the compiler checks *everything*: attribute names and types, and which children each element takes and in what order. Best for code that builds charts from data, and for libraries.

**Markup or a framework**: [React components](../guide/frameworks.md#react) that build the same tree, and [Web Components](../guide/frameworks.md#web-components) (`<ink-chart>`) for plain HTML. See [Frameworks](../guide/frameworks.md).

All three can be mixed: a function can return JSX and be called from `new` code, and the other way round.

## Drawing without a browser

On a server, in a test, or for an image, draw to a string. No DOM is needed.

```ts
import { toSvgString } from 'inkplot';

const svg = toSvgString(chart, { width: 640, height: 360 });   // "<svg …>…</svg>"
```

`toSvgString` attaches the chart to a string platform, draws once, and detaches it. The text is measured by a built-in estimate, since there are no fonts to measure with; give `Chart` a `measureText` attribute to match a font you know.

## Where next

- [Concepts](concepts.md): the element tree, attributes, children, drawing, in more depth.
- [Recipes](recipes.md): "how do I…" with a live example for each.
- The [guide](../README.md#guide) goes through each part of the library in turn.

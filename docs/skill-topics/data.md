# inkplot topic: data sources and big data

For: a million points (decimation), data as columns or from a function, updating live data, reading a chart's data back as a table.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Large data, and a live update


`Decimator` takes a **kernel first, then the source**, and goes where the source would. It cannot carry channels (other than `domain` and `value`) or sit on an `XYSeries`.

```tsx check title="A million points, then updates"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, Decimator, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, MinMaxKernel, PanZoom, lightTheme } from 'inkplot';

const values = new Float64Array(1_000_000);
for (let i = 0; i < values.length; i++) values[i] = Math.sin(i / 5000) + Math.sin(i / 37) * 0.1;
const source = new FlatDataSource({ data: values, regularDomain: { start: 0, step: 1 }, isSorted: true });

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Signal">
        <Decimator><MinMaxKernel />{source}</Decimator>
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
      <PanZoom />
    </CartesianPlane>
  </Chart>
) as Chart;

// New data: set the attribute. Edited in place: tell the source.
export function replace(next: Float64Array) { source.setAttribute('data', next); }
export function bump(i: number, v: number) { values[i] = v; source.invalidate(); }
```

### In a worker

For data too big to reduce on the page, put a `WorkerBoundary` between the series and the `Decimator`, and serve the same classes from the worker file with `serveWorker(registry)` (from `'inkplot/worker'`). The chart draws what it has and updates when the worker answers; `await chart.idle()` waits for that. `transfer` moves the arrays instead of copying them; `shared` (opt-in, needs cross-origin isolation) shares `SharedArrayBuffer` arrays and `refresh()` tells the worker they changed. Use `WebWorker(new URL('./x.worker.ts', import.meta.url))` in a browser and `NodeWorker` from `'inkplot/node-worker'` on Node. Only worth it above a few hundred thousand points.

### One source in several places

Give the source an `id` and make it a child of the `Chart` (or a `ChartGroupItem`), where it draws nothing; each series reads it through `<LinkedData source="id" />`, inside its own `Decimator` or `Slice` if it needs one. A change to the source redraws every chart that links to it. `channels={{ x: 'time' }}` renames a channel on the way. Across separate charts an id cannot be seen: pass the element, `new LinkedData({ source: shared })`.

## Notes

| To… | Use |
|---|---|
| Chart data as a table | `readTable(node)` (a source, transform, trendline or `series.data`): typed-array columns and `rows()` |

## Attributes of this topic's elements

An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`.

<!-- api:start -->
### CompositeDataSource

Separate columns.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `count` (required) | `number` |  |
| `domain` (required) | `Column` | Where each row is along the domain: for a made-up domain, `(i) => start + step * i`. |
| `value` | `Column` | The number a domain series plots. |
| `channels` | `Readonly<Record<Channel, Column>>` | Extra columns that bindings and tooltips can address by name. |
| `isSorted` | `boolean` | The stored points already ascend in the domain. Default false. |
| `wrap` | `number` | The domain repeats with this period, and the source delivers one more point: the first, again, one period on. |

### SyntheticDataSource

A function sampled when drawn.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `fn` (required) | `(x: number) => number` | Value at a domain position. |
| `domain` (required) | `Extent` | The span the function is defined over: the data's whole domain. |
| `count` | `number` | Number of samples, evenly spaced across the domain, always. |
| `isSorted` | `boolean` | The stored points already ascend in the domain. Default false. |
| `wrap` | `number` | The domain repeats with this period, and the source delivers one more point: the first, again, one period on. |

### Decimator

Reduces large data to what the plot can show.

**In** a series · **Holds** 1 kernel, then 1 source

| Attribute | Type | |
|---|---|---|
| `resolution` | `number` | Pixel columns reduced to per pixel of plot width. Default 1; raise it for high-DPI output. |
| `enabled` | `boolean` | Turn it off without removing it. Default true. |

### Slice

Keeps a window of rows of the data: move it to animate.

**In** a series · **Holds** 1 source

| Attribute | Type | |
|---|---|---|
| `start` | `number` | The first row kept. Default 0. |
| `end` | `number` | One past the last row kept. Default all. |
| `last` | `number` | Keep this many rows ending at `end`, instead of from `start`. |
| `keyed` | `boolean` | In a `SeriesGroup`: window the rows of each series on their own (the default), or, when false, the rows of the data as a whole, as they stand before they are split by key. |

### LinkedData

The data of another source or transform, elsewhere in the chart or in another chart.

**In** a series, or a transform · **Holds** none

| Attribute | Type | |
|---|---|---|
| `source` (required) | `ElementRef<DataNode>` | The stage to forward to: a source or a transform, as an element or the id of one in the same chart. |
| `channels` | `Readonly<Record<string, string>>` | Channels this stage calls by other names: `{ trace: 'ch2' }` makes the channel `ch2` of the source `trace` here. |

### WorkerBoundary

Runs the stages inside it in a worker: draws what it has, and what the worker sends when it arrives.

**In** a series · **Holds** 1 source or transform: a description the worker builds

| Attribute | Type | |
|---|---|---|
| `worker` (required) | `WorkerLike` | Where the stages inside run. |
| `registry` (required) | `ElementRegistry` | The classes the description is made of, by the names the worker's registry knows them under. |
| `transfer` | `boolean` | Move the arrays to the worker instead of copying them: fast and without a second copy, but the page no longer has the rows (a hit has no row, the data cannot be edited here). |
| `shared` | `boolean` | Allow arrays that are backed by a `SharedArrayBuffer`, which the worker then reads where they are, with no copy: change them in place and call `refresh()`. |
| `envelope` | `Envelope` | For a worker that carries other traffic too (see `Envelope`). |

### MinMaxKernel

Keeps the lowest and highest of each pixel column.

**In** Decimator · **Holds** none

No attributes of its own.

### M4Kernel

First, last, lowest and highest of each column.

**In** Decimator · **Holds** none

No attributes of its own.

### LttbKernel

Largest-triangle-three-buckets: keeps the shape.

**In** Decimator · **Holds** none

No attributes of its own.

### StrideKernel

Every nth point.

**In** Decimator · **Holds** none

No attributes of its own.
<!-- api:end -->

# Data

A series' first child is its **data**: an element that holds, or generates, the points, with attributes like any other. Everything downstream (axes fitting themselves, decimation, hit testing, pan and zoom) works with whichever you choose.

| Source | Holds | Best for |
|---|---|---|
| [`FlatDataSource`](#flatdatasource) | Numbers in an array or typed array, read where they are | Large data; y values at regular intervals; x/y pairs |
| [`ObjectDataSource`](#objectdatasource) | Rows as objects | Data from an API, by property name |
| [`CompositeDataSource`](#compositedatasource) | Separate columns (an `x` array, a `y` array) | Column-oriented data; made-up domains |
| [`SyntheticDataSource`](#syntheticdatasource) | Nothing: a function sampled when drawn | Mathematical curves; smooth zoom |

## The model: domain, value, channels

A point has a **domain** (where it is along the series' first axis, usually x or time), a **value** (what is plotted against the second axis, usually y), and optionally named **channels**: extra numbers per point, used by [bindings](mapped.md) (a marker's size or colour), by an `XYSeries` (its x), and shown in tooltips.

Sources always **deliver points in ascending order of domain**, whatever the storage order was. If your data is already ascending, say so with `isSorted` and a source reads it in place, with no copy and no sort; otherwise it sorts a copy once per change.

A value that is `NaN` (or infinite) is a **gap**: nothing is there. What a gap means is the series' choice, via its `gaps` attribute ([Series and renderers](series.md#gaps)). A point whose domain is `NaN` is dropped.

Attributes common to all sources:

| Attribute | Meaning |
|---|---|
| `isSorted` | The stored points already ascend in the domain. Default `false`. Setting it for data that is not ordered draws wrong lines. |
| `wrap` | The domain repeats with this period, and the source delivers one more point: the first, again, one period on. That closes the turn on a polar or radar plane. `wrap: 6` for six categories at 0 to 5 puts a copy of the first at 6. |

## `FlatDataSource`

Numbers in a flat array (`number[]`, `Float64Array`, `Float32Array`: anything array-like). It reads them in place and never copies them.

| Attribute | Meaning |
|---|---|
| `data` | The numbers. |
| `regularDomain` | `{ start, step }`: evenly spaced domain with no stored x values, a y-only array. The domain of point *i* is `start + step * i`. |
| `stride` | Numbers per point. Default 2 (x, y pairs), or 1 with `regularDomain`. |
| `domainOffset`, `valueOffset` | Where the domain and the value sit within a point's `stride` numbers. Default 0 and 1 (0 with no stored domain). |
| `count` | Number of points. Default `data.length / stride`. |
| `channels` | Extra named columns, as offsets within a point: `{ weight: 2 }`. |

```tsx live title="Three numbers per point, one of them a channel" height=300
import { Axis, CartesianPlane, Chart, CircleMarker, FlatDataSource, LinearScale, ScalarAxis, XYSeries, lightTheme } from 'inkplot';

// x, y, weight for each point, in one array.
const readings = [1, 2.0, 3, 2, 3.1, 8, 3, 2.6, 5, 4, 4.4, 12, 5, 3.9, 6, 6, 5.2, 9];

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane frame>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left" include={[0]}><LinearScale /></Axis>
      <XYSeries x="x">
        <FlatDataSource data={readings} stride={3} valueOffset={1} channels={{ x: 0, weight: 2 }} />
        <CircleMarker bind={{ size: { axis: 'w', channel: 'weight' } }} opacity={0.8} />
      </XYSeries>
    </CartesianPlane>
    <ScalarAxis id="w" output={[4, 16]}><LinearScale /></ScalarAxis>
  </Chart>
);
```

> **Note.** For an `XYSeries` the x is a channel (here the first column), and the domain is only the order the points are drawn in. With no `domainOffset`, a flat source takes column 0 as the domain too, which sorts the points by it. For a path that must stay in the order you gave (a trajectory), see [Series and renderers](series.md#xyseries).

## `ObjectDataSource`

Rows as objects, read through accessors. It is convenient and not the fastest: reading goes through the accessor, so the numbers are loaded into a buffer once per change.

| Attribute | Meaning |
|---|---|
| `source` | The rows. |
| `domain` | A property name, or a function `(row, index) => number`. Left out, the row's index. |
| `value` | A property name, or a function. |
| `channels` | Extra columns, by name: `{ size: 'population', colour: (row) => row.region === 'EU' ? 0 : 1 }`. |

A function field is how you derive things: dates from ISO strings (`domain: (row) => Date.parse(row.date)`), a unit change, a categorical code.

## `CompositeDataSource`

Each column kept by itself: the shape of column-oriented data, and of data whose domain is made up.

| Attribute | Meaning |
|---|---|
| `count` | Number of rows. Required. |
| `domain`, `value` | Each a column: an array (typed or plain), or a function of the row index, `(i) => start + step * i`. |
| `channels` | Extra columns by name, each an array or a function of the index. |

Nothing is copied from arrays that are already in order (`isSorted`); otherwise the columns are gathered into a buffer once per change.

## `SyntheticDataSource`

A function of the domain, sampled when drawn. There is no storage, so the points are made up: they carry no row, cannot be edited, and a tooltip reads them as they are.

| Attribute | Meaning |
|---|---|
| `fn` | `(x) => value`. `NaN` is a gap. |
| `domain` | `{ min, max }`: the span the function is defined over. |
| `count` | A fixed number of samples across the domain. Leave it out and the source samples as finely as the plot needs: one per pixel across the part of the domain in view, so zooming in stays smooth and zooming out never draws more than the screen can show. |

## Changing data

There are two ways, and the first is nearly always right.

**Give it new data**: `source.setAttribute('data', newArray)` (or `source`, `domain`, `value`…). The chart redraws on the next frame, and axes refit.

**Edit it in place** (a big typed array you own) and tell the source: `source.invalidate()`. A source's `version` rises on every change, and everything it feeds caches against that, so an unchanged source costs nothing to redraw.

Appending to a growing buffer: allocate it larger than you need, set `count` as it grows, and set `isSorted`. [A recipe](../start/recipes.md#update-a-chart-that-is-on-screen) shows it.

## Decimation

A line over a million points cannot show more than about one distinct value per pixel column, yet generating, normalising and writing out a million points is the dominant cost of a redraw. A **`Decimator`** reduces the data to the extremes of each pixel column first, so the cost grows with the plot's width, not the data's size, and the picture is the same to within a pixel.

A decimator is a **data transform**: it sits between a series and its source, and takes a **kernel** (the reduction rule) and the source:

```tsx
<DomainSeries name="Signal">
  <Decimator>
    <MinMaxKernel />
    <FlatDataSource data={signal} isSorted regularDomain-start={0} regularDomain-step={1} />
  </Decimator>
  <LinePath><LinearCurve /></LinePath>
</DomainSeries>
```

It reads only the part of the data in view, so zooming in refills from the full data, and the value axis fits what is *in view*, not the whole.

| Attribute | Meaning |
|---|---|
| `resolution` | Pixel columns reduced to per pixel of plot width. Default 1; raise it for high-DPI output. |
| `enabled` | `false` turns it off without removing it. Default true. |

| Kernel | Keeps | Notes |
|---|---|---|
| `MinMaxKernel` | The lowest and highest value in each pixel column, in the order they occur. At most 2 points per column. | **The default choice.** Every extreme survives, so the line covers what the full data would. Keeps gaps. |
| `M4Kernel` | Min and max, plus the first and last value in each column. At most 4 per column. | Keeps the joins between columns exact. |
| `LttbKernel` | One point per column, chosen to keep the line's shape (Largest Triangle Three Buckets). | Spikes can vanish, and it does not handle gaps. |
| `StrideKernel` | Every k-th point. | The cheapest; it aliases. For previews and for comparison. |

```tsx live title="What each kernel keeps of a spiky signal" height=300
import { Axis, CartesianPlane, Chart, Decimator, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, LttbKernel, M4Kernel, MinMaxKernel, StrideKernel, lightTheme } from 'inkplot';

const n = 20000;
const signal = new Float64Array(n);
for (let i = 0; i < n; i++) signal[i] = Math.sin(i / 700) * 5 + (i % 1997 === 0 ? 14 : 0);   // a few narrow spikes

const kernels = { MinMax: () => <MinMaxKernel />, M4: () => <M4Kernel />, LTTB: () => <LttbKernel />, Stride: () => <StrideKernel /> };

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {Object.entries(kernels).map(([name, kernel]) => (
        <DomainSeries name={name} visible={name === 'MinMax' || name === 'Stride'}>
          <Decimator>
            {kernel()}
            <FlatDataSource data={signal} isSorted regularDomain-start={0} regularDomain-step={1} />
          </Decimator>
          <LinePath strokeWidth={1}><LinearCurve /></LinePath>
        </DomainSeries>
      ))}
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
);
```

Click the legend entries to compare. The stride kernel loses most of the spikes; the min/max kernel keeps all of them.

Things to know:

- **An `XYSeries` refuses a decimator.** Kernels thin by pixel column of the domain, which means nothing when the domain is only the order of a path. Markers already leave out what is off the plot.
- **A decimator's points are made up** (the extremes of a column are not a row), so a hit on one can be shown but not edited (the hit has no `row`).
- **In a stack, decimate the sources before the stack**, not per series: decimation is per series and would thin each differently, so rows would no longer line up (`Stack` has `align` for that).
- **Sources that are not sorted** still work under a decimator; they are sorted once into a copy. Set `isSorted` on data you know is ordered and it is read in place.

## Working in a worker

Decimating a few million points takes tens of milliseconds, and that is a frame the page cannot draw. A **`WorkerBoundary`** moves the stages inside it, the source and its transforms, to a Web Worker (or a Node worker thread). The chart draws at once with what it has, and again when the worker's answer arrives, so panning and zooming stay smooth however large the data. It pays when the work is longer than the round trip, roughly above a few hundred thousand points; below that, leave it out.

The boundary holds a **description** of the stages, not the stages themselves. The page and the worker each build it from a **registry** (the classes the description may use, by name), so the worker's bundle carries only the classes it needs:

```tsx
// page
import { WebWorker, WorkerBoundary } from 'inkplot';
const worker = new WebWorker(new URL('./signal.worker.ts', import.meta.url));

<DomainSeries name="Signal">
  <WorkerBoundary worker={worker} registry={registry}>
    <Decimator><MinMaxKernel /><FlatDataSource data={signal} isSorted regularDomain-start={0} regularDomain-step={1} /></Decimator>
  </WorkerBoundary>
  <LinePath><LinearCurve /></LinePath>
</DomainSeries>

// signal.worker.ts
import { serveWorker, Decimator, FlatDataSource, MinMaxKernel } from 'inkplot/worker';
serveWorker({ Decimator, FlatDataSource, MinMaxKernel });
```

`registry` on the page is the same map of names to classes. `new URL('./x.worker.ts', import.meta.url)` is the form Vite, webpack 5 and esbuild all bundle; `WebWorker` also takes a `Worker` you made yourself, and starts module workers by default (`{ worker: {} }` for a classic one). On Node use `NodeWorker` from `inkplot/node-worker`, and give the worker file `serveWorker(registry)`, which listens on `parentPort`.

Things to know:

- **Stale while revalidating.** One request is in flight at a time and only the newest waits behind it; while it runs the chart draws the last answer. Pan fast and you see slightly old data, never a stalled page. `await chart.idle()` resolves when the worker has answered and the chart has drawn it, which is what tests and exports should wait for.
- **Copy or move.** By default the arrays are copied to the worker once, and the page keeps its rows (hits have a `row`, data can be edited). With `transfer`, the buffer moves instead: no second copy, but the page no longer has it. A moved array cannot be serialized to JSON afterwards.
- **`shared` (opt-in).** With `shared` and arrays backed by a `SharedArrayBuffer`, nothing is copied at all. The page must be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`). Without `shared`, a shared array is an error rather than a silent assumption. After writing into one, call `boundary.refresh()` so the worker recomputes.
- **Groups.** A `SeriesGroup` may sit over a boundary: the worker splits the rows by key and answers every series in one request. The order must be `first` or `sorted`. A `Density` or `BoxStats` inside a boundary in a group is not supported.
- **Axis width.** The value axis keeps the width it measured until the labels need clearly more or less. The first answer from the worker can therefore shift the plot a pixel or two from the same chart without a boundary.
- **Other traffic.** If the worker carries other messages, give both ends the same `envelope` (a name, or `{ wrap, unwrap }`) so the two do not mix.
- **Errors.** A failure in the worker (a thrown error, a bad message, a crash) is raised on the chart that asked.

## Writing a source

A source implements `fill`, `scanDomain`, and optionally `orderedView`; the base class does ordering, caching and extents. See [Custom data and scales](../extending/custom-data-and-scales.md).

# Performance and bundle size

Two different costs: what a page **downloads** (code), and what a chart **does** (drawing). inkplot is built so that both scale with what you actually use.

## Bundle size

Everything is an element in its own module, and nothing imports an element it does not use. A bundler therefore includes only the classes you name. Measured with Rolldown (minified, ESM), gzipped:

| What | gzip KB | On top of a minimal chart |
|---|---:|---:|
| Minimal line chart, drawn to an SVG string | 17.3 |  |
| …drawn in a browser (`DOMPlatform`, instead of the string) | 18.2 | +0.9 |
| Pan and zoom | 21.5 | +4.2 |
| Legend | 19.6 | +2.4 |
| Circle markers | 18.9 | +1.6 |
| Entrance animation (on top of the browser chart, +0.4) | 18.6 | +1.3 |
| Point annotations | 19.8 | +2.5 |
| Cursor with a crosshair | 22.9 | +5.6 |
| Cursor with a tooltip | 24.5 | +7.2 |
| A time axis (`Date` and `Intl`) | 19.1 | +1.8 |
| A log scale | 17.6 | +0.4 |
| A dark theme as well as the light one | 17.5 | +0.2 |
| Colour axis, key and markers | 21.1 | +3.8 |
| The `pieChart` shortcut (the whole chart) | 24.9 | +7.6 |
| Vanilla JSX (runtime and attribute expansion) | 17.9 | +0.7 |
| React wrappers (React itself not counted) | 19.7 | +2.4 |
| Web Components (the tags defined) | 19.8 | +2.5 |
| Every feature above, in one chart | 43.4 | +26.1 |
| `import * as inkplot` (the whole barrel, as a worst case) | 87.4 |  |

`tools/size.mjs` regenerates the table, with many more rows.

Input costs only where it is used: the code that routes the pointer, keys and focus (the input host) is bundled by the first interactive element, and a chart with none of them neither carries it nor listens to the page's input, so a browser leaves it its touches and wheel.

To keep it small:

- **Import by name** (`import { Chart, LinePath } from 'inkplot'`) and never `import * as`. The React components are the same: `import { Chart, Axis } from 'inkplot/react'` bundles only those two and what they need.
- **Avoid `registry`** unless you need JSON. It names every class, so it pulls in the whole library (about 80 KB gzipped to read and write JSON with it). For configuration-driven charts, build a registry of just the classes you allow: `{ Chart, CartesianPlane, Axis, … }`. That version costs about 19 KB.
- **Name one theme.** A `Chart` requires its `theme`, so the bundle holds exactly the ones you import.
- **The core has no words.** Nothing in the core is English or any other language; text lives in opt-in components (`ChartSummary`, tooltip formats) and your own `format` functions.
- **Time axes are two classes.** `IntlTimeScale` uses `Date` and `Intl`; `TemporalTimeScale` uses `Temporal`. Import the one you want.

## What drawing costs

A chart is **retained**: a change invalidates the parts it touches, and the next flush redoes only those, in stages (generate, decimate, normalize, place, path). Unchanged attributes are not written to the SVG, and results cached against an unchanged source are reused. Many edits in a frame cost one flush.

So the rules for speed follow from what is cached:

### Data

- **Give a `FlatDataSource` typed arrays** (`Float64Array`) or plain number arrays and set `isSorted` if they already ascend. It reads them in place: no copy, no sort.
- **Edit in place, then say so.** If you change a number in an array a source holds, call `source.invalidate()`. Replacing the whole attribute (`source.setAttribute('data', next)`) also works and is the safer default; in-place edits avoid allocating for a stream of updates.
- **Decimate big data.** A `Decimator` between the series and its source reduces it to a few points per pixel column, keeping every peak and valley, and reads only the visible range, so zooming refills from the full data. The cost then grows with the plot's width, not the size of the data. See [Data](data.md#decimation) for the kernels (`MinMaxKernel`, `M4Kernel`, `LttbKernel`, `StrideKernel`).
- **Move the work off the page.** A `WorkerBoundary` runs the source and its transforms in a worker, so a pan never waits on a large reduction. It pays above a few hundred thousand points. See [Data](data.md#working-in-a-worker).
- **Avoid per-point objects for big data.** `ObjectDataSource` is for the thousands, `FlatDataSource` for the hundreds of thousands and more.

### Markers and mapped styles

A scatter of a hundred thousand points does not make a hundred thousand SVG nodes. Markers with the same look are **merged into one path**, and a mapped (bound) colour or width is quantized into steps so that the number of paths is bounded by `maxNodes` (default 1000), not by the data. See [Mapped dimensions](mapped.md).

```tsx live title="Twenty thousand points, a few paths" height=320
import { Axis, CartesianPlane, Chart, ColorAxis, DotMarker, LinearScale, ObjectDataSource, XYSeries, lightTheme } from 'inkplot';

// A deterministic spiral of points: no random numbers, so the page and its tests draw the same thing.
const rows = Array.from({ length: 20000 }, (_, i) => {
  const t = i / 20000, angle = t * 60;
  return { x: Math.cos(angle) * (0.2 + t), y: Math.sin(angle) * (0.2 + t), t };
});

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries>
        <ObjectDataSource source={rows} channels={{ x: 'x', y: 'y', t: 't' }} />
        <DotMarker size={2} bind={{ stroke: { axis: 'age', channel: 't' } }} />
      </XYSeries>
    </CartesianPlane>
    <ColorAxis id="age" ramp="viridis"><LinearScale /></ColorAxis>
  </Chart>
);
```

Set the marker's `merge={false}` only for small data where every point needs its exact value or blending; it makes a node per point.

### Axes and layout

- Ticks and their text measurements are the main cost of layout. A pan or zoom changes the range and so the ticks, so keep tick labels cheap: avoid a very high `tickCount`, and prefer simple `format` functions.
- `DOMPlatform` measures text with a canvas. `preciseText: false` uses a fast estimate and is the right choice for many small charts on a page.
- A dashboard of many charts: give each its own container and platform, leave `schedule: 'frame'`, and let the browser batch the work.

## Measuring

`onFlush` on the `Chart` (or the value `chart.flush()` returns) gives the cost of each flush:

| Field | Tells you |
|---|---|
| `total` | Milliseconds for the flush. |
| `stages` | Milliseconds in each stage. A large `decimate` means the data is large; a large `place` means many ticks or labels. |
| `pointsIn`, `pointsDrawn` | Points read, and points that reached a path. A big gap says decimation or merging is working. |
| `pathBytes` | Size of the path data written. |
| `attributeWrites`, `attributeWritesSkipped` | SVG attributes set, and sets avoided because the value had not changed. After a small edit, `attributeWrites` should be small. |
| `fillsCached`, `projected` | Generated results reused, and points projected to pixels. |

```ts check title="Watching the cost of each flush"
import type { Chart, FlushStats } from 'inkplot';

export function watch(chart: Chart): () => void {
  const log = (s: FlushStats) => console.log(`${s.total.toFixed(1)} ms: ${s.pointsIn} points in, ${s.pointsDrawn} drawn, ${s.attributeWrites} writes`);
  chart.setAttribute('onFlush', log);
  return () => chart.setAttribute('onFlush', undefined);
}
```

If a chart is slow, look at the stage that dominates, then: decimate if it is data; reduce ticks if it is placement; check that you are not replacing structure (adding and removing elements) when you could change an attribute.

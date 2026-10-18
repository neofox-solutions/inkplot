# How it works

A map of the machinery, for reading the source or extending the library. Nothing here is needed to *use* inkplot.

## Layers

The source is in three layers, and `tools/deps.test.ts` holds the import graph to them, so a feature can never become a hidden cost of every chart.

| Layer | Modules | Rule |
|---|---|---|
| **Foundation** | `geometry`, `events`, `theme`, `surface`, `platform`, `text`, `element`, `aria`, `focus`, `attrs` | Know nothing of charts. The element tree, drawing surface and platform contract. |
| **Core** | `chart`, `plane`, `axis`, `dimension`, `series`, `renderer`, `curve`, `scale`, `data` | What every chart pulls in: the skeleton of chart → plane → axes and series → data and renderers. |
| **Features** | Everything else: `legend`, `cursor`, `panzoom`, `annotation`, `marker`, `bars`, `curves`, `steps`, `stack`, `radial`, `mapped`, `key`, `decimation`, `time*`, `summary`, the adapters… | Independent of one another, except for a short list of declared uses (an annotation uses `callout`; a cursor uses `hit`). |

Features are **opt-in by import**: a chart that draws no markers carries no marker code. That is how a minimal chart is under 15 KB gzipped while the whole library is about 60 KB.

## The tree

A chart is a retained tree of `ChartElement`s: `Chart` → `Plane` → `Axis` / `Series` → data and renderers. Each element has attributes (plain data), ordered children, and one method, `onEvent`.

Three systems sit on that tree:

1. **Events.** A parent never calls a child's methods to lay it out or draw it; it sends an event (`MEASURE`, `ARRANGE`, `PAINT`…) and the child's `onEvent` answers. One extension point keeps subclasses small, and lets the same tree be driven by tests, an adapter or the real chart.
2. **Drawing.** Each element draws through its own `Surface`, created lazily. A surface hands out the same node for the same key and remembers the last value written to every attribute, skipping identical writes. So drawing is *idempotent*: an element says what its nodes look like, every time.
3. **Invalidation.** Any change calls `invalidate()`, which walks up to the root. The chart there asks the platform to schedule a flush.

## A flush

`chart.flush()` draws everything, and it is cheap when little changed because every stage caches against versions.

1. **Layout.** The chart measures its non-plane children (titles, legends, keys), gives each its strip, and arranges the plane in what is left. A plane then works in this order: it **fits** the axes' ranges against a rough estimate of the plot size (so decimation has a width to work to); it **measures** the axes (ticks are chosen here, which needs text sizes) and insets the plot area by what they ask; and with the real plot size known it places the axes along it and **projects** every series.
2. **Series pipelines.** Projecting a series runs it in stages:

   | Stage | Does |
   |---|---|
   | `generate` | Fill a buffer from the data source for the visible range (or reuse the cache: sources have a `version`). |
   | `decimate` | If a `Decimator` is in the pipeline, reduce to the extremes of each pixel column. |
   | `normalize` | Turn data into 0..1 along each axis with its scale (in place). |
   | `place` | Turn fractions into pixels with the plane (a rectangle, a polar disc, a radar). |
   | `path` | Renderers build path text from the placed points. |

   The time in each is in `FlushStats.stages`.
3. **Paint.** Every element receives `PAINT` after layout and draws through its surface; only changed attributes reach the platform.
4. **Accessibility and statistics.** The chart writes its own name and description (from `meta` and a describer such as `ChartSummary`), broadcasts the paint, and returns `FlushStats`, which `onFlush` also receives.

Axes and series depend on each other (the data sets the axis range; the axis range sets the window the series reads), which is why a plane fits against an estimate first and projects once the real plot is known.

## Placement

SVG paint order is document order, so a later sibling draws over an earlier one: the node order must follow the tree order. Yet elements are mounted, drawn and removed independently. Rather than store positions, each surface asks the live tree when it needs a place: `container()` (the nearest ancestor with a wrapper `<g>`, else the platform root) and `end()` (the first node of whatever element draws next). Because the answer is derived from the tree, inserting or removing an element anywhere cannot leave a stale position behind.

## Attributes and the adapters

Attributes are plain data, so the tree maps to JSON (`toJSON`/`fromJSON`) and the adapters (JSX, React, Web Components) are thin: each turns its own idea of "props" or "HTML attributes" into `setAttributes` on the same elements. `attrTypes` is how text becomes values, and the same table drives the compiler's completeness check. See [Serialization](../guide/serialization.md) and [JSX, React and Web Components](../guide/frameworks.md).

## Style

A theme is a plain object of selectors; an element asks for its look with a chain (`['tickLabel', 'axis', 'text']`) and gets back every property of the last name's root, resolved by nearest-wins over the `style` blocks up the tree, then the base theme. See [Styling](../guide/styling.md).

## Data

Everything downstream wants the domain ascending, so sources always **deliver** ascending points (in place when already sorted, from a sorted copy when not). Stages form a pipeline (`plan(context)` → `{ capacity, fill }`) in which the caller owns the buffer, so a series reuses one allocation across redraws. A plan over a source can also write just a range of its rows, which is how a `Slice` reads a window of a long source without reading the rest. `version` keys all caches. See [Custom data and scales](custom-data-and-scales.md).

## Testing

- Unit tests run on a `StringPlatform` subclass that can be resized and poked, and flush on demand.
- `tools/deps.test.ts` enforces the layering.
- `tools/docs.test.ts` extracts every code block in these docs, type-checks it, and runs the live ones, so the examples cannot rot.
- `tools/size.mjs` measures the bundle cost of each feature.
- The playground (`playground.html`) is a page with a chart of each kind, tested in a real browser.

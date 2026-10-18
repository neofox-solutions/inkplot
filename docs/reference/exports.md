# Functions and other exports

The element classes (with every attribute) are in the [attribute reference](api.md). This page lists everything else the package exports, grouped by what it is for. Names come from `import { … } from 'inkplot'`; the adapters are separate entry points (`inkplot/react`, `inkplot/web-components`, `inkplot/jsx-runtime`).

## Drawing

| Export | Is |
|---|---|
| `toSvgString(chart, { width, height, idPrefix })`, `SvgOptions` (type) | Draws a chart once to an SVG string, with no DOM. Ids inside it are `ink<hash>-<n>` unless `idPrefix` names them. [Rendering](../guide/rendering.md) |
| `AnyElement` (type) | The type of any element, and of every JSX expression: write `as Chart` where a `Chart` is needed. |
| `DOMPlatform` | A platform that draws a live `<svg>` in a container element: `new DOMPlatform(container, { size, preciseText, schedule })`. |
| `StringPlatform` | A platform that keeps the SVG in memory and prints it with `toString()`. |
| `estimateTextWidth` | The default text measure of a platform with no fonts (about 0.6 em per character). |

## Themes and style

| Export | Is |
|---|---|
| `lightTheme`, `darkTheme` | Complete base themes. [Styling](../guide/styling.md) |
| `extendTheme(base, patch)` | A new theme: each selector in `patch` merged over the base's, property by property. |
| `resolveStyle(chain, scopes, theme, local?, accent?)` | The look for a selector chain; what `styleFor` calls. |
| `Selectors`, `Roots`, `Theme`, `BaseTheme`, `TextProps`, `LineProps`, `ShapeProps`, `AxisMetrics`, `MarkerMetrics` | Types. Augment `Selectors` to add a selector. |

## Data helpers

| Export | Is |
|---|---|
| `lineChart(series, options)` | A whole `Chart` of lines, with the plane and axes (optionally markers, a decimator and a curve), in one call. See [Chart shortcuts](../guide/series.md#chart-shortcuts). |
| `barChart(series, options)` | A whole `Chart` of bars, with stacking and an axis swap as options. |
| `pieChart(slices, options)` | A whole `Chart` for a pie or doughnut, built from the polar plane, axes, a normalized `Stack` and `PointAnnotations` (a [convenience](../start/recipes.md#the-piechart-shortcut)). |
| `moveView(axis, range)`, `parseEasing(css)` | Ease an axis to a view range (or back to the data's, with `null`) as the chart's `transition` says; and a CSS timing function as `(t) => progress`. See [Transitions](../guide/transitions.md#moving-the-view). |
| `DataSource`, `DataTransform` | Bases for [a source and a transform of your own](../extending/custom-data-and-scales.md). |
| `PointBuffer`, `PlanContext`, `FillPlan`, `FillResult` | Types of the data contract. |
| `rowRange(n, from?, to?)` | The rows `from` to `to` of `n`, as `[start, end]`, clamped: what a source's ranged `fill` loops over. |

## Serialization

| Export | Is |
|---|---|
| `toJSON`, `fromJSON`, `applyJSON` | A tree to JSON, JSON to a tree, and JSON applied to a live tree. [Serialization](../guide/serialization.md) |
| `Refs` | A table of names for functions and objects that JSON cannot hold. |
| `registry` | Every shipped class by name (pulls the whole library into a bundle). |

## Finding elements

| Export | Is |
|---|---|
| `findById(source, id)` | The element with that `id` nearest to `source` (itself, below it, then outwards), or `undefined`. |
| `findNearest(source, test)`, `findClosestOfType(source, Class)` | The same search for any test or class. No recursion and no allocation. |
| `descendantsOfType(root, Class)`, `childrenOfType`, `firstDescendantOfType`, `closestAncestorOfType` | Typed searches. |
| `walk(root, visit)` | Calls `visit(element, depth)` for an element and everything under it; returning `false` skips a subtree. |
| `resolveRef(ref, from, Class?)` | Turns an attribute that is an element or an id into the element. |
| `seriesOf(child)` | The series a plane child stands for: itself, a stack's members, or none. |

## Hit testing

Used by `Cursor`, `PointerListener` and your own interaction ([Custom elements](../extending/custom-elements.md#interaction)).

| Export | Is |
|---|---|
| `hitTest(series, x, y, maxDistance?)` | The series' point near (x, y) in plot pixels, as its `hit` mode measures it. A `NaN` coordinate leaves that direction out. |
| `hitPlane(plane, x, y)`, `hitAll(plane, x, y, radius?)` | The nearest hit over a plane's series; the nearest of each series, topmost first. |
| `hitAcross(plane, x, y)`, `interpolate(series, first)`, `interpolateAll(plane, x, y)` | Every series at a place along the first axis; a line read between its points, for one series or all. |
| `nearest`, `nearestPoint`, `nearestSegment`, `nearestShape`, `nearestTraced`, `insideArea`, `insideTrace`, `pointHit` | The measurements underneath. |

## Paths and text, for renderers

| Export | Is |
|---|---|
| `polyline(points, connect)`, `areaOutline(top, base, connect)` | Straight-line path text through placed points, and the closed shapes between a line and its baseline. |
| `lineTo`, `quadTo`, `cubicTo`, `arcTo`, `hermiteTo`, `smoothTo`, `StrokeCurve`, `Piece` | The pieces a curve is made of. |
| `stepLines`, `stemLines`, `barShapes` | The geometry of steps, stems and bars. |
| `applyText(surface, node, textProps, anchor?)` | Sets a text node's font attributes from a look. |
| `measureBlock`, `paintLines`, `LINE_HEIGHT` | Multi-line text. |
| `calloutSize`, `paintCallout`, `clearCallout` | The callout box, used by annotations and tooltips. |
| `paintSample` | A small picture of a series (for a legend). |
| `alignRows`, `layOut` | Stack arithmetic. |

## Accessibility and focus

| Export | Is |
|---|---|
| `writeAria(surface, node, meta, defaults?)` | Writes role, name, description and `meta.aria` on a node. |
| `hideFromAssistive(surface, node)` | Marks decoration `aria-hidden`. |
| `makeTabStop(surface, node)`, `drawFocusRing(surface, key, look, rect)`, `pressesButton(event)` | Keyboard focus building blocks. |
| `englishSummary(facts)` | The default `ChartSummary` wording. |
| `DEFAULT_CURSOR_KEYS`, `DEFAULT_PANZOOM_KEYS` | The default keys of those elements. |

## Elements and events

| Export | Is |
|---|---|
| `ChartElement` | The base class of everything. [Custom elements](../extending/custom-elements.md) |
| `Surface` | What an element draws with. |
| `EVENT_ATTACH`, `EVENT_MEASURE`, `EVENT_ARRANGE`, `EVENT_PAINT`, `EVENT_POINTER`, `EVENT_HOVER`, `EVENT_KEY`, `EVENT_FOCUS`, `EventBase` | Event types and the base of events. |
| `STRING`, `NUMBER`, `BOOLEAN`, `AUTO`, `AttrTypes`, `AttrTypesFor`, `Coerce` | How attribute text becomes values, for `static attrTypes`. |
| `expandAttributes(flat)` | Nests hyphenated names (`meta-title`) the way JSX and markup do. |

## Bases for your own classes

`Plane`, `RadialPlane`, `Series`, `SeriesRenderer`, `Marker`, `ShapeMarker`, `LineMarker`, `BarRenderer`, `Curve`, `StrokeCurve`, `Scale`, `TimeScale`, `Dimension`, `MappedDimension`, `Key`, `DecimationKernel`: see [Custom elements](../extending/custom-elements.md), [Custom renderers](../extending/custom-renderers.md) and [Custom data and scales](../extending/custom-data-and-scales.md).

## Adapters

| Entry point | Export | Is |
|---|---|---|
| `inkplot/jsx-runtime` | `jsx`, `jsxs`, `Fragment`, `JSX` | The vanilla JSX runtime (set `jsxImportSource: "inkplot"`). |
| `inkplot/react` | a component per built-in element class (`Chart`, `Axis`, `LinePath`…), `reactWrapper(Class)`, `ChartView` | Components for React; one for a class of your own; showing a chart made another way. |
| `inkplot/web-components` | `defineElements(classes, { prefix, names?, registry? })` | Custom HTML elements for classes. |

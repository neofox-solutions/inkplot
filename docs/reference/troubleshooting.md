# Troubleshooting

Find the symptom, read the cause, apply the fix. Errors are thrown by the element at fault and say which one; the first part of this page is those messages, the second is charts that draw wrongly or not at all.

## Error messages

| Message | Cause | Fix |
|---|---|---|
| `Axis: child 0 should be Scale, but is LinePath` (any `X: child N should be …`) | Children in the wrong order or kind. Fixed children come first, in the order the class documents: an axis's scale, a series's data then renderers. | Reorder the children. |
| `X: has no child 0 (it needs …)` | A fixed child is missing. | Add it: every `Axis` needs a scale, every `DomainSeries` a data source, every `LinePath` a curve. |
| `<Y>: a child must be a chart element, not string "…"` | Text written inside a JSX tag. | JSX text is not supported: use an attribute (`<ChartTitle text="Sales" />`). |
| `<Y>: a function used as a tag must return a chart element` | A function component returned something else. | Return one element (or a fragment). |
| `chart is already attached` | `attach` was called twice. | `detach()` first, or use a new platform. |
| `chart is not attached` / `X is not attached` | `flush()` or drawing before `attach`. | Attach the chart to a platform first. |
| `X is not in a chart` | An element asked for its style, or the chart, while it has no parent chart. | Build the tree under a `Chart` before using the element. |
| `element already has a parent` | An element was added to two parents. | Create a second element, or `remove` it from the first. |
| `X has no parent` | `requireParent()` on an element that was never added. | Add it to the right kind of parent. |
| `a series needs one horizontal and one vertical axis` | A Cartesian plane without both an x and a y axis, or with orientations that do not match. | Give the plane `orientation="bottom"` and `orientation="left"` axes. |
| `an axis on the "angle" side needs a PolarPlane` | A polar axis in a Cartesian plane, or the reverse. | Use `bottom`/`left` for Cartesian planes; `angle`/`radius` for polar and radar. |
| `a series needs one angle axis and one radius axis` | A polar or radar plane missing one of its two axes. | Add both. |
| `too many axes without an orientation` | More than the defaults (two) axes, with some left to the default orientation. | Give each axis an `orientation`. |
| `a floating axis needs an axis on the other orientation to cross` | `crossesAt` without a crossing axis. | Add one on the other orientation, or name it with `crossAxis`. |
| `no element with id "x"` / `element "x" is not a Y` | A ref (`bind`, `domainAxis`, `dimension`…) names an id that does not exist, or names the wrong kind of element. | Check the `id` is on the element and is spelt the same. |
| `the data has no channel "x"` | A binding, an `XYSeries` `x` or `y`, or a tooltip asks for a channel the source does not deliver. | Declare it: `channels={{ x: 'x', y: 'y' }}` (object and column sources), `channels` offsets (flat; plain pairs have `x` and `y` already). A transform's output is `x="domain" y="value"`. |
| `a Decimator cannot carry channels: bind on undecimated data…` | Channels bound through a `Decimator`. | Put the decimator only on series with no channels; bind on undecimated data. |
| `Expected 'domain' and 'value' as the first requested channels but got …; a Decimator must be attached to a DomainSeries or compatible` | A decimator under an `XYSeries` (or anything that asks for other columns first). | Draw an XY series undecimated, or use a `DomainSeries`. |
| `the data says it is sorted along the domain (isSorted), but the first column asked of it is …` | Data flagged `isSorted` read by something that asks for another column first. | `isSorted` means sorted by the domain: drop the flag, or ask for `domain` first. |
| `a Decimator needs a regular domain that ascends` | `regularDomain` with a non-positive step. | Use a positive `step`. |
| `the wrap period is shorter than the domain of the data` | `wrap` smaller than the data's span. | Make `wrap` reach past the last point. |
| `the series of a stack have to share their domain axis and their value axis` | Series in a `Stack` on different axes. | Put them on the same pair. |
| `add a PointerListener before PanZoom in a plane` | `PanZoom` is first among siblings. | Put the `PointerListener` before it: it has to see a press first to claim it. |
| `maxNodes N leaves fewer than 2 steps for K bound styles` | Too few `maxNodes` for the number of bound styles. | Raise `maxNodes`, or bind fewer styles. |
| `a linear colour ramp takes #rgb or #rrggbb stops, not "…"` | A CSS colour name in a linearly interpolated ramp. | Use hex colours, or `interpolation="step"`. |
| `LinePath bindings is not implemented yet` (also `AreaPath`) | `bind` on a line or an area, which are one stroke or region and cannot vary along it. | Bind on a marker, a bar renderer or a heat map, or use several series. |
| `unknown type "X"` (JSON) | A `type` that is not in the registry; the message suggests near matches. | Spell it right, or add your class: `{ ...registry, X }`. |
| `X is not in the registry: add it, as in { ...registry, X }` | `toJSON` met a class of your own. | Add it to the registry you pass. |
| `refers to "name", and no refs were given to look it up in` / `no ref named "name"` | JSON has a `{ "$ref" }` and `fromJSON` got no `Refs`, or a table that lacks it. | Pass the same `Refs` you wrote with. |
| `…, which JSON cannot hold: name it in refs` | A function or big array in an attribute, written without a `Refs`. | Add it to a `Refs` (or `new Refs({}, { auto: true })`). |
| `refers to a X that has no id: give it one so JSON can name it` | An attribute holds an element without an `id`. | Give that element an `id`. |
| `'X' and 'x' differ only in case` (adapters) | Two attribute names that HTML cannot tell apart. | Rename one. |
| `attribute 'x': 'y' is not a number` (Web Components) | A numeric attribute written as text that does not parse. | Write a number, or set it from JavaScript with `props`. |

## Nothing appears

- **The container has no height.** A `DOMPlatform` fills its container and follows its size; a container with none falls back to 600 wide by 300 high, and a flex or grid item may collapse to zero. Give it a height in CSS. The React root takes `hostProps={{ style: { height: 300 } }}`; the `<ink-chart>` tag needs `style="height: 300px"`.
- **No flush.** On a `StringPlatform`, or a `DOMPlatform` with `schedule: 'manual'`, nothing draws until you call `chart.flush()`. `toSvgString` does it for you.
- **The chart was never attached.** Constructing a chart draws nothing; `chart.attach(platform)` does.
- **The theme is missing.** `Chart` requires `theme={lightTheme}` (or `darkTheme`, or your own); without it nothing has a colour or size.
- **No axes, or axes without a scale.** A plane draws only the axes you give it, and an axis needs a scale child.
- **A series is invisible.** It has no renderer (`LinePath`, a marker), `visible={false}`, an empty source, or its colour equals the background. A line of one point draws nothing; add a marker.
- **A `NaN` or `undefined` in the data** is a gap, not a point. If every value is `NaN` the axis has nothing to fit.

## The chart draws wrongly

- **A line zigzags or backtracks.** Data was marked `isSorted` but is not ascending, or an x/y source is in a different order than you think. Remove `isSorted`: sources sort for you.
- **The y axis starts at an odd place.** Axes fit to the data and `nice` the ends. Use `min`/`max` for exact limits, `include={[0]}` to make a value part of the range, `padding` for headroom.
- **A bar chart has gaps or overlaps.** Bars sit on a `BandScale` (categories) or any numeric domain, and `width` is the fraction of the room each bar fills. Series that should sit side by side need a `Stack` in `'group'` mode ([Series](../guide/series.md#bars)).
- **A time axis is a day off.** Time scales default to UTC so that a chart looks the same everywhere. Set `timeZone` (an IANA name, or `'local'`).
- **A timestamp is 1970.** The data must be milliseconds since the epoch; Unix seconds need `* 1000`.
- **Labels are cut off or crowd one another.** Give the chart more room, shorten the labels, or set `tickCount`. Without a measuring platform the estimate is wide; give `Chart` a `measureText` for the real font.
- **A colour key or legend clips its title.** Give it a `breadth`, shorten the title, or give the chart more height.
- **A colour is the "nearest step", not the exact value.** Mapped styles are quantized so that points sharing a look share a path. Use `merge={false}` (small data) or raise `maxNodes`.
- **Two planes overlap.** Every plane gets the whole plot area, on purpose, so that several can be overlaid. Use one plane with several axes, or separate charts, for side-by-side.
- **A theme change does nothing.** Set it as `chart.setAttribute('theme', theme)` on the chart itself; `style` blocks nearer an element beat the theme.
- **`style={{ text: { color: 'red' } }}` colours more than you expected.** Style blocks win by *nearness*: a block near an element beats the whole base theme, even for more specific selectors. Set the specific selector at the same level (`tickLabel`) to override a general one.

## Interaction does not work

- **No tooltip or crosshair.** They are children of a `Cursor`, which is a child of the **chart** (not of a plane): `<Cursor><Crosshair /><ChartTooltip /></Cursor>`.
- **Nothing is found under the pointer.** The series is `hit={false}`, its `hit` mode or `radius` is too strict (try `'line'`, or a larger radius), or the series is hidden.
- **Drag does nothing.** `PanZoom` is a plane child; with a `PointerListener` that handles drags, the listener must come **first** (the library throws if it does not).
- **Zoom stops.** `limit` (default true) keeps the view inside the data. Set `limit={false}`.
- **Keyboard does not work.** `keys` is `false` somewhere, or the plot has no focus: it is a tab stop only when a `Cursor` or `PanZoom` with keys is present. Click it, or press Tab.
- **Legend clicks do nothing.** `toggle` is `false`, or the series has no `name`, so it is not listed.
- **Callbacks stop firing in React.** Functions (and typed arrays) are compared by identity, plain objects and arrays by content: memoize `onClick` and similar with `useCallback`, and do not recreate them on every render if they need stable behaviour.

## Updates do not show

- **You edited an array in place.** Call `source.invalidate()`, or set the attribute to a new array (`source.setAttribute('data', next)`).
- **You changed an object inside an attribute** (`style.text.color = 'red'`). Attributes compare by `===`: set a new object, `setAttribute('style', { … })`.
- **A React state change does not reach the chart.** If the chart is made with `ChartView`, the chart is yours to update; with the wrappers, props are attributes and update on commit. Check you are not wrapping chart elements in `React.memo` or passing them as `children` through a component that does not re-render.
- **A chart you removed still draws.** Call `chart.detach()` and `platform.dispose()` (the adapters do this for you on unmount).

## TypeScript

- **`JSX element type '…' does not have any construct or call signatures`.** The file is using another JSX runtime. Add `/** @jsxImportSource inkplot */` or set `jsxImportSource` to `inkplot` in the tsconfig.
- **`Type 'Element' is not assignable to type 'Chart'`.** The JSX runtime in this file is React's (or the default). A file uses one runtime.
- **A helper that takes a JSX element will not accept it.** Type it `AnyElement`, not `JSX.Element`.
- **`Property 'x' does not exist` on `setAttribute`.** Attribute names are typed per element: `setAttribute('min', …)` on an `Axis`. For hyphenated JSX attributes (`regularDomain-start`) TypeScript does not check the name.
- **A custom selector is not accepted in `style`.** Augment `Selectors`: see [Custom elements](../extending/custom-elements.md#styling).
- **The compiler accepts `new Plane({}, myElement)` only after augmenting `PlaneChildMap`.** See [Custom elements](../extending/custom-elements.md#children-and-parents).

## Still stuck

1. Reduce the chart to the smallest tree that shows the problem (a plane, two axes, one series).
2. Draw it with `toSvgString` and read the SVG: a missing `<path>` means nothing reached the renderer; a path of `d=""` means all points were gaps or off-plot.
3. Read `chart.flush()`'s statistics: `pointsIn` is zero when the source gave nothing.
4. `console.log(element)` prints its class, id and number of children, not the whole tree.

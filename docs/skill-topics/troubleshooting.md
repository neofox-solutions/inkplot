# inkplot topic: troubleshooting

For: an error message, or a chart that draws nothing or draws wrongly. Find the symptom, apply the fix.

| Symptom | Cause and fix |
|---|---|
| Error `X: child 0 should be Scale, but is …` | Children in the wrong order. `Axis`: scale. `DomainSeries`: data, then renderers. |
| Error `X: has no child 0 (it needs …)` | A required child is missing: scale on an `Axis`, data on a series, curve on a `LinePath`. |
| Error `a child must be a chart element, not string` | Text inside a tag. Use an attribute: `text="…"`. | <!-- jsx-only -->
| Error `a series needs one horizontal and one vertical axis` | Missing or mismatched axes. `bottom` + `left` for `CartesianPlane`; `angle` + `radius` for polar and radar. |
| Error `the data has no channel "x"` | Add it: `channels={{ x: 'x' }}` on an `ObjectDataSource`. |
| Error `no element with id "x"` | The `id` is missing or misspelt on the axis or series that is referred to. |
| Error `LinePath bindings is not implemented yet` | Only markers can `bind`. |
| Error `add a PointerListener before PanZoom` / `add a BoxZoom before PanZoom` / `add a Brush before PanZoom` | Put the `PointerListener`, `BoxZoom` or `Brush` first. |
| Error `a Decimator cannot carry channels` | No bound channels through a `Decimator`. |
| Type error: `JSX element type … construct or call signatures` | The file is using another JSX runtime. Add `/** @jsxImportSource inkplot */`. | <!-- jsx-only -->
| Type error: `Type 'Element' is not assignable to type 'Chart'` | Same: this file is using React's JSX. | <!-- jsx-only -->
| Nothing is drawn (browser) | The container has no height; the chart was not attached (`chart.attach(new DOMPlatform(el))`); no `theme`. |
| Nothing is drawn (`toSvgString`) | No renderer on the series; empty data; `visible={false}`. |
| Axis starts somewhere odd | Axes fit the data and tidy the ends: set `min`/`max`, or `include={[0]}`. |
| A line jumps backwards | `isSorted` set on unsorted data: remove it. |
| Series missing from legend or tooltip | It has no `name`. |
| Tooltip or crosshair missing | `Cursor` must be a child of the **chart**, holding `ChartTooltip`/`Crosshair`. |
| Dates wrong or in 1970 | Values must be milliseconds since 1970. Time zone defaults to UTC: set `timeZone`. |
| Chart does not update | You mutated an object: set a new one with `setAttribute`. For an in-place array edit call `source.invalidate()`. |
| A colour is only roughly right | Bound colours are stepped; `merge={false}` on the marker for small data. |


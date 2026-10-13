# inkplot topic: interaction

For: tooltips, a crosshair, pan and zoom, drag-to-zoom, brushing a range, clicks and hovers, touch.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Tooltip, crosshair, pan and zoom, reference line


`Cursor` is a child of the **chart**; `PanZoom` and annotations are children of the **plane**.

```tsx check title="Interactive"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, ChartTooltip, Crosshair, Cursor, DomainSeries, FlatDataSource, LineAnnotation, LinePath, LinearCurve, LinearScale, PanZoom, lightTheme } from 'inkplot';

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane meta-title="Latency">
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left" title="ms"><LinearScale /></Axis>
      <DomainSeries name="p95" hit="line">
        <FlatDataSource data={[120, 135, 128, 160, 142, 150, 138]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
      <LineAnnotation value={150} label="Target" stroke="#c0392b" />
      <PanZoom />
    </CartesianPlane>
    <Cursor mode="shared">
      <Crosshair />
      <ChartTooltip />
    </Cursor>
  </Chart>
) as Chart;
```

## Notes

- A tooltip's `format` gets a `Hit`: `hit.series` (its `attrs.name`), `hit.first` and `hit.second` (the point's two coordinates in data terms: for a line chart the domain, e.g. a date in milliseconds, and the value), `hit.index`, `hit.channels` (bound channels by name). Hover is live in a browser only; `toSvgString` draws no tooltip, so test the text by calling your `format` on a sample.

| To… | Use |
|---|---|
| Click a point | `<PointerListener onClick={(info) => info.hit && … } />` in the plane (before `PanZoom`) |
| Select a range and report it (no zoom) | `<Brush mode="x" onBrush={...} />` before `<PanZoom />`; `brush.select()` / `clear()` from code |
| Zoom to a dragged box | `<BoxZoom mode="auto" />` in the plane, **before** `<PanZoom />` (Shift-drag; `activate="always"` for every drag) |
| Reset zoom (button) | `chart.resetViews()`; know when it is zoomed with `onViewChange` on an `Axis` |
| Touch | Default: one finger scrolls the page, two pinch the chart; `<PanZoom touch="always" />` for one-finger pan |
| Tooltip text | ``<ChartTooltip format={(hit) => `${hit.series.attrs.name}: ${hit.second}`} />`` |

## Attributes of this topic's elements

An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`.

<!-- api:start -->
### ChartTooltip

A box of text at the cursor.

**In** Cursor · **Holds** none

| Attribute | Type | |
|---|---|---|
| `follow` | `boolean` | Whether the box moves with the cursor, with no arm, or is set beside what is read, with an arm to it. Default: moves with the cursor when the cursor is 'shared' (there is no one point to be beside), else set beside the point. |
| `swatch` | `boolean` | A sample of the series (its line, box or marker, as drawn on the plot) before its name, or without one before its first line. Default false. |
| `format` | `(hit: Hit) => string` | The text for one hit. Default: the series name, then each coordinate (with its axis' title if it has one) and the channels. |
| `announce` | `boolean` | Tell a screen reader what the box says when the cursor is moved by keyboard (see `Platform.announce`), so it can be read without seeing it. Default true. |

### Cursor

Finds what the pointer or keyboard is on; its children draw it.

**In** Chart · **Holds** Crosshair, ChartTooltip

| Attribute | Type | |
|---|---|---|
| `mode` | `'nearest' \| 'shared'` | What it finds: the 'nearest' point, or every series 'shared' at its place along the first axis. Default 'nearest'. |
| `interpolate` | `boolean` | Read the line between its two points at the cursor instead of reporting a point. Default false. |
| `plane` | `ElementRef<Plane>` | The plane it works in. Default: the plane the pointer is over, and the first plane for the keyboard. |
| `keys` | `CursorKeys \| false` | Keys for moving it from the keyboard, or `false` for none (and no tab stop). |

### Crosshair

Guide lines through the cursor.

**In** Cursor · **Holds** none

| Attribute | Type | |
|---|---|---|
| `lines` | `'first' \| 'second' \| 'both'` | Which guide: the line of constant first coordinate (across a line chart: vertical), of the second, or both. Default 'both'. |
| `dots` | `boolean` | A dot in the series' colour on each reading under the cursor. Default false. |
| `dotSize` | `number` | Radius of those dots, in pixels. Default 4. |
| `snap` | `boolean` | Put the lines through the first reading (a point) rather than through the cursor itself. Default false. |

### PanZoom

Drag, wheel, pinch, touch and keys change the view.

**In** a plane · **Holds** none

| Attribute | Type | |
|---|---|---|
| `axes` | `readonly ElementRef<Axis>[]` | The axes it may move, as elements or ids. Default: all of the plane's that can be dragged along: not the rim of a polar or radar plane. |
| `direction` | `'both' \| 'horizontal' \| 'vertical'` | Which way things may move. Default 'both'. |
| `pan` | `boolean` | Drag with the primary button to pan. Default true. |
| `zoom` | `boolean` | Turn the wheel to zoom about the pointer. Default true. |
| `limit` | `boolean` | Keep the view inside the natural range of each axis, so there is no panning off the data or zooming out past it. Default true. |
| `zoomSpeed` | `number` | Zoom per wheel pixel, as a natural-log factor. Default 0.002, which is about 20% for one notch of a typical wheel. |
| `axisZoom` | `boolean` | With the pointer (or both fingers) over an axis, a wheel turn, a pinch or a drag moves that axis alone. Default true. |
| `pinchSpeed` | `number` | Zoom per pixel of a pinch on a trackpad, which browsers report as small wheel turns with Ctrl held. Default 0.02, ten times the wheel's step per pixel. |
| `touch` | `'two-finger' \| 'always'` | What a touch does. 'two-finger' (the default): one finger scrolls the page as usual, and two pinch and pan the chart. 'always': one finger pans the chart too, and the page cannot be scrolled from it. |
| `inertia` | `boolean` | A finger that lets go while still moving carries the view on, slowing to a stop (a flick). Default true. |
| `resetOnDoubleClick` | `boolean` | Two quick presses put every axis back to its natural range. Default true. |
| `keys` | `PanZoomKeys \| false` | The keys, once the plot has keyboard focus. |
| `keyStep` | `number` | How far an arrow moves the view, as a fraction of it. Default 0.1. |
| `keyZoom` | `number` | The factor of one press of a zoom key. Default 1.25. |

### BoxZoom

Drag a box (Shift by default) to zoom to it. Before PanZoom.

**In** a plane · **Holds** none

| Attribute | Type | |
|---|---|---|
| `axes` | `readonly ElementRef<Axis>[]` | The axes it may zoom, as elements or ids. Default: all of the plane's that can be followed along (not the rim of a polar plane). |
| `activate` | `'shift' \| 'always'` | When a drag makes a box: with Shift held (the default), so a plain drag can pan, or always. |
| `mode` | `'xy' \| 'x' \| 'y' \| 'auto'` | Which axes the box zooms. Default 'xy'. |
| `minSize` | `number` | Smallest side of a box, in pixels, along an axis it zooms; below that the box does nothing. Default 8. |
| `onZoom` | `(box: { x: number; y: number; width: number; height: …` | Called after a zoom, with the box in plot pixels. |

### Brush

Drag a range to select it and report it with onBrush; the selection stays drawn. Before PanZoom.

**In** a plane · **Holds** none

| Attribute | Type | |
|---|---|---|
| `axes` | `readonly ElementRef<Axis>[]` | The axes it may cover, as elements or ids. Default: all of the plane's that can be followed along. |
| `activate` | `'shift' \| 'always'` | When a drag brushes: always (the default) or with Shift held, to leave a plain drag to `PanZoom`. |
| `mode` | `'xy' \| 'x' \| 'y'` | Which axes it covers. Default 'xy'. |
| `minSize` | `number` | Smallest side of a brush, in pixels, along an axis it covers; below that a drag only clears. Default 4. |
| `live` | `boolean` | Call `onBrush` while dragging too. Default false. |
| `onBrush` | `(selection: BrushSelection \| null) => void` | Called with the selection, or null when it is cleared. |

### PointerListener

Calls your functions on hover, click and drag.

**In** a plane · **Holds** none

| Attribute | Type | |
|---|---|---|
| `onHover` | `(info: PointerInfo) => void` | The pointer came onto a point, left it, or moved to another: `info.hit` is the new one, null for none. |
| `onClick` | `(info: PointerInfo) => void` | A press and release in the same place: on a point, or `info.hit` null on empty plot. |
| `onDrag` | `(info: DragInfo) => void` | A drag that began on a point. |
| `dragThreshold` | `number` | How far in pixels the pointer must travel before a press is a drag and no longer a click. Default 3. |
<!-- api:end -->

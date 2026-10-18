# Interaction

Interaction is made of elements too. A `Cursor`, a `PanZoom` and a `PointerListener` are children like any other, so a chart that wants no input carries none of their code, and each does one job:

| Element | Parent | Job |
|---|---|---|
| [`Cursor`](#cursor) with [`Crosshair`](#crosshair) and [`ChartTooltip`](#tooltip) | `Chart` | Find what the pointer or keyboard is on, and show it. |
| [`PanZoom`](#pan-and-zoom) | plane | Turn drag, wheel, pinch, touch and keys into view ranges on axes. |
| [`BoxZoom`](#box-zoom) | plane | Zoom to a rectangle dragged on the plot. |
| [`Brush`](#brush) | plane | Select a range by dragging, and report it. |
| [`PointerListener`](#pointer-listener) | plane | Call your functions on hover, click and drag. |
| [`Legend`](labels.md#legend) | `Chart` | Click an entry to hide or show a series. |

All of it works from the keyboard as well as the pointer (see [Accessibility](accessibility.md)), and from touch: a finger down is a pointer down.

## Hit testing

Which drawn point is a pointer "near"? That is the **series'** choice, because only it knows what its renderers draw. Set it with the series' `hit` attribute:

| `hit` | Distance is measured to | Right for |
|---|---|---|
| `'point'` | The nearest point. | Markers, and a line only read at its points. **Default** unless the renderer says otherwise. |
| `'line'` | The nearest point *on the line* joining them, so the pointer can be anywhere along a segment. | A line that should be grabbable anywhere along it. |
| `'area'` | Zero anywhere inside the shape between the line and its baseline, else as `line`. | Filled series. |
| `'shape'` | Zero anywhere inside a shape the renderer drew for the point, else the distance to its edge. | Bars (they say this themselves, so a bar series needs no `hit`). |

`hit` can also be an options object, `{ mode, radius, baseline }` (`radius` is the farthest a pointer may be, in pixels, and still hit: default 10), or `false` for a series that should never be hit (a reference line, a selection overlay).

In every mode the hit is one of the points, never a place between two: the one nearest to where the pointer is. Steps and curves are measured *as drawn*: their renderers trace the path they draw, so a point's reach follows the line on screen.

A hit (`Hit`) has: `series`, `plane`, `index` (in the drawn points), `row` (the point's row in the source's own storage, absent if the point was made up, as by a decimator), `first` and `second` (its two coordinates in data terms), `channels` (its bound channels' values by name), `px` and `py` (where it is drawn, in plot pixels), and in a stack `lift`.

The functions that do the testing are exported for your own use (`hitTest`, `hitPlane`, `hitAll`, `nearestPoint`…), and are only bundled if you import them.

## Cursor

A `Cursor` is a `Chart` child. It finds, from the pointer or from the keyboard, what is under it, and the elements inside it draw that. It draws nothing itself, which is what lets you mix them freely: a crosshair with no tooltip, a tooltip with no crosshair, two tooltips reading the same cursor.

| Attribute | Meaning |
|---|---|
| `mode` | `'nearest'` (default): the one point nearest the pointer, as the series' `hit` settings measure it. `'shared'`: every series at the cursor's place along the *first* axis, so a line chart is read across all its lines at once. |
| `interpolate` | Read the line between its two points at the cursor, in place of the nearest point. Domain series only. Default `false`. |
| `plane` | The plane it works in (element or id). Default: the plane the pointer is over, and the first plane for the keyboard. |
| `keys` | Keys for moving it by keyboard, or `false` for none (and no tab stop). |

```tsx live title="Shared cursor reading the line between points" height=300
import { Axis, CartesianPlane, Chart, ChartTooltip, Crosshair, Cursor, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const line = (name: string, data: number[]) => (
  <DomainSeries name={name} hit="line">
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={10} />
    <LinePath><LinearCurve /></LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme} meta-title="Two sensors over time">
    <CartesianPlane>
      <Axis orientation="bottom" title="Seconds"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {line('Sensor A', [20, 24, 23, 29, 31])}
      {line('Sensor B', [30, 28, 26, 22, 19])}
    </CartesianPlane>
    <Cursor mode="shared" interpolate>
      <Crosshair lines="first" dots />
      <ChartTooltip swatch />
    </Cursor>
  </Chart>
);
```

**From the keyboard.** With a `Cursor` in the chart, the plot is a tab stop. These are the default keys (`keys` replaces any: `{ next: ['n'] }`, the others keep theirs):

| Action | Keys | |
|---|---|---|
| `next`, `previous` | → ← | Step to the next or previous point of the series (skipping gaps). |
| `nextSeries`, `previousSeries` | ↓ ↑ | Move to another series. |
| `first`, `last` | Home, End | |
| `jumpNext`, `jumpPrevious` | PageDown, PageUp | A tenth of the series. |
| `clear` | Escape | Put the cursor away. |

An empty list turns an action off. Whichever moved last, the pointer or the keys, has the cursor. Name the plot with `meta-title`: it is what a screen reader says on arriving.

Reading the cursor from code: `cursor.state` is `{ plane, x, y, source, hits }` (or `null`), refreshed after each flush; `cursor.select(series, index)` puts the keyboard cursor on a point.

### Crosshair

| Attribute | Meaning |
|---|---|
| `lines` | `'first'` (the line of constant first coordinate: across a line chart, vertical), `'second'`, or `'both'` (default). |
| `dots` | A dot in the series' colour on each reading under the cursor. Default `false`. |
| `dotSize` | Radius of those dots in pixels. Default 4. |
| `snap` | Put the lines through the first reading (a point) rather than through the cursor itself. Default `false`. |

On a polar plane the lines are spokes and rings: it asks the plane for them, so it needs no per-plane code. Its look is the `crosshair` selector.

### Tooltip

A `ChartTooltip` shows what the cursor reads, in a box styled like a callout (`tooltipBox`, `tooltipText`, `tooltip`, each falling back to the callout's own). It takes no room, and hides while a button is held, which is when something is being dragged. Put a `Crosshair` *before* it in the cursor to have the lines under the box.

| Attribute | Meaning |
|---|---|
| `follow` | The box moves with the cursor, with no arm; or is set beside what is read, with an arm to it. Default: follows when the cursor is `'shared'` (there is no one point to be beside), else beside the point. |
| `swatch` | A sample of the series (its line, box or marker, as drawn on the plot) before its name. Default `false`. |
| `format` | `(hit) => string`: the text for one hit. Default: the series name, then each coordinate (with its axis' title if it has one) and the channels. |
| `announce` | Tell a screen reader what the box says when the cursor is moved by keyboard. Default `true`. |

```tsx live title="A tooltip with its own words" height=260
import { Axis, BandScale, BarPath, CartesianPlane, Chart, ChartTooltip, Cursor, DomainSeries, FlatDataSource, LinearScale, lightTheme } from 'inkplot';
import type { Hit } from 'inkplot';

const months = ['Jan', 'Feb', 'Mar', 'Apr'];
const words = (hit: Hit) => `${months[Math.round(hit.first)] ?? ''}: ${hit.second} orders`;

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={months} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Orders">
        <FlatDataSource data={[120, 95, 143, 170]} regularDomain-start={0} regularDomain-step={1} />
        <BarPath />
      </DomainSeries>
    </CartesianPlane>
    <Cursor><ChartTooltip format={words} /></Cursor>
  </Chart>
);
```

A tooltip's words come from you (`format`) or are the default numbers: the library has none of its own, so a chart in another language needs nothing from it.

## Pan and zoom

`PanZoom` is a plane child that turns pointer and keyboard input into **view ranges** on the plane's axes. The axes then fit what is in view.

| Attribute | Default | Meaning |
|---|---|---|
| `axes` | all that can be dragged along | The axes it may move, as elements or ids. The rim of a polar or radar plane cannot be dragged. |
| `along` | `'xy'` | `'x'` or `'y'` to move only the horizontal or only the vertical axes. Along one direction only, the other axes keep fitting what is in view. A radius axis counts as vertical. |
| `pan` | `true` | Drag with the primary button to pan. |
| `zoom` | `true` | Turn the wheel, or pinch, to zoom about the pointer. |
| `limit` | `true` | Keep the view inside the natural range of each axis: no panning off the data or zooming out past it. |
| `zoomSpeed` | `0.002` | Zoom per wheel pixel, as a natural-log factor (about 20% for one notch). |
| `pinchSpeed` | `0.02` | The same for a pinch on a trackpad, which browsers send as small wheel turns with Ctrl held (a few pixels each), so it needs ten times the gain. |
| `axisZoom` | `true` | With the pointer, or both fingers, over an axis, a wheel turn, pinch or drag moves **that axis alone**, and a double press resets it. Off, the axes take no input. |
| `touch` | `'two-finger'` | What a touch does. `'two-finger'`: one finger scrolls the page as usual, two pinch and pan the chart. `'always'`: one finger pans too, and the page cannot be scrolled from the chart. |
| `inertia` | `true` | A finger that lets go while moving carries the view on and slows to a stop (a flick). Only with `touch="always"`; a mouse drag stops where it is released. |
| `resetOnDoubleClick` | `true` | Two quick presses put every axis back to its natural range. |
| `keys` | the defaults | Keys, once the plot has focus; or `false` for none and no tab stop. |
| `keyStep` | `0.1` | How far an arrow moves the view, as a fraction of it. A page is five times that, up to half. |
| `keyZoom` | `1.25` | The factor of one press of a zoom key. |

Default keys: arrows pan (with Shift, a page); PageUp and PageDown move a page (up and down); `+`/`=` and `-`/`_` zoom about the middle; `0` or Home reset. Replace any with `keys={{ zoomIn: ['i'], reset: ['r'] }}`; the others keep theirs.

Everything is worked out in the **fractions of the scale**, so it behaves the same on a linear axis, an inverted one, one on the far side, a log axis, or a time axis: the value under the pointer stays under the pointer. Each axis' ruler says how far along it a position is, so dragging along a spoke or a rectangle's edge is the same code.

The limit is measured against the range **all the data** on the axis asks for, not the part in view, so zooming one axis never moves the limit of the other under your hand.

A mostly sideways wheel turn (a trackpad swipe, or Shift and the wheel) pans the horizontal axes. A pinch keeps the content under each finger under it, so it zooms and pans in one movement; along an axis where the fingers are barely apart it only pans, so a level pinch zooms the horizontal axes alone and a plumb one the vertical. Safari's own pinch gesture is handled too.

### Resetting

`panZoom.reset()` puts every axis it controls back. `plane.resetViews()` and `chart.resetViews()` do it for everything, whoever zoomed it (a `PanZoom`, a `BoxZoom`, your own code), so a **Reset zoom** button is one line, and an axis' `onViewChange` (called with the new range, or `null` when it is back to natural) tells it when to enable itself: see [the recipe](../start/recipes.md#add-a-reset-zoom-button). `axis.setViewRange({ min, max })` sets a view from code, and `setViewRange(null)` clears it.

A plane with a `PointerListener` that handles drags must list it **before** the `PanZoom`: the listener claims the presses that begin on a point, so they do not pan.

## Box zoom

`BoxZoom` is a plane child that zooms to a rectangle dragged on the plot. By default the box is made with **Shift held**, so a plain drag can still pan; with `activate="always"` every drag is a box (give the `PanZoom` `pan={false}`). It takes a press, so list it **before** `PanZoom`, as for a `PointerListener`.

| Attribute | Default | Meaning |
|---|---|---|
| `activate` | `'shift'` | `'shift'`: a box with Shift held. `'always'`: every drag. |
| `along` | `'xy'` | Which axes the box zooms: `'xy'`, `'x'`, `'y'`, or `'auto'`, which zooms the one direction a box is much longer in (a wide flat box zooms x alone) and both otherwise. |
| `axes` | all that can be followed | The axes it may zoom. |
| `minSize` | `8` | The least a side of the box may be, in pixels, along an axis it zooms. A smaller box does nothing, which is how to take one back: drag it small again before letting go. |
| `onZoom` | | Called after a zoom with the box in plot pixels. |

The box looks as `selection` says (a shape). It sets the same view ranges as `PanZoom`, so a reset, a pinch and the `limit` of the `PanZoom` all work on what it did. A touch makes no box: pinch instead.

```tsx live title="Shift-drag a box to zoom, drag to pan, double-click to reset" height=260
import { Axis, BoxZoom, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, PanZoom, lightTheme } from 'inkplot';

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
      <BoxZoom along="auto" />
      <PanZoom meta-title="Signal plot" />
    </CartesianPlane>
  </Chart>
);
```

## Brush

`Brush` is the other half of box zoom: the same drag, but it **zooms nothing**. The rectangle stays drawn, and the range it covers is reported to `onBrush`, in the axes' own values, for you to filter a table, total a selection, or move another chart's view. It is held in data terms, so it follows the axes as they pan and zoom. A click, or `brush.clear()`, takes it away and calls `onBrush(null)`; `brush.select([{ axis, min, max }])` sets it from code, which is how two charts follow one another.

| Attribute | Default | Meaning |
|---|---|---|
| `mode` | `'xy'` | `'x'` or `'y'` brushes a band across the plot (a time range). |
| `activate` | `'always'` | Every drag brushes. `'shift'` leaves a plain drag to `PanZoom`. |
| `live` | `false` | Call `onBrush` while dragging too. |
| `minSize` | `4` | Smallest side in pixels; a smaller box only clears. |
| `onBrush` | none | Called with `{ ranges, x?, y? }` (`x` and `y` are the first horizontal and vertical axes' ranges), or `null`. |

Like `BoxZoom` it takes a press, so list it **before** `PanZoom`. It looks as `selection` says. A touch brushes only with `activate="always"` and a `PanZoom` that does not take the touch (or no `PanZoom`).

```tsx live title="Drag across the plot to brush a range" height=260
import { Axis, Brush, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const wave = Float64Array.from({ length: 400 }, (_, i) => Math.sin(i / 25) + 0.3 * Math.sin(i / 6));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Signal">
        <FlatDataSource data={wave} isSorted regularDomain-start={0} regularDomain-step={1} />
        <LinePath strokeWidth={1}><LinearCurve /></LinePath>
      </DomainSeries>
      <Brush along="x" onBrush={(b) => console.log(b ? `${b.x!.min.toFixed(0)} to ${b.x!.max.toFixed(0)}` : 'cleared')} />
    </CartesianPlane>
  </Chart>
);
```

## Pointer listener

A `PointerListener` calls your functions when the pointer hovers, clicks or drags on a point of the plane it is in.

| Attribute | Meaning |
|---|---|
| `onHover` | The pointer came onto a point, left it, or moved to another. `info.hit` is the new one, `null` for none. |
| `onClick` | A press and release in the same place: on a point, or `info.hit` `null` on empty plot. |
| `onDrag` | A drag that began on a point. The listener claims such presses, so they do not pan. |
| `dragThreshold` | How far, in pixels, the pointer must travel before a press is a drag and no longer a click. Default 3. |

Each callback gets a `PointerInfo`: `plane`, `x` and `y` (the pointer in plot pixels), `first` and `second` (where that is in data terms, on the axes of the hit's series, else the plane's first and second axes), `hit`, and `shift` and `ctrl`. A drag gets a `DragInfo`: the same, with a `hit` that is always the point being dragged and a `phase` of `'start'`, `'move'` or `'end'`. While dragging, `first` and `second` are where the grabbed point is *to go*: the pointer's position carrying the grab's offset, so the point does not jump to be under the pointer's tip.

**Editing data by dragging.** `hit.row` is the point's row in the source's own storage, and it stays the same when edits re-sort the points, so edit by that. Write the new value and tell the source:

```tsx check title="A chart whose points can be dragged"
import { Axis, CartesianPlane, Chart, CircleMarker, DomainSeries, LinePath, LinearCurve, LinearScale, ObjectDataSource, PointerListener, lightTheme } from 'inkplot';

const rows = [{ x: 0, y: 3 }, { x: 1, y: 7 }, { x: 2, y: 4 }, { x: 3, y: 8 }];
const source = new ObjectDataSource({ source: rows, domain: 'x', value: 'y' });

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left" min={0} max={10}><LinearScale /></Axis>
      <DomainSeries name="Editable" hit="point">
        {source}
        <LinePath><LinearCurve /></LinePath>
        <CircleMarker size={5} />
      </DomainSeries>
      <PointerListener
        onDrag={(info) => {
          if (info.hit.row === undefined) return;          // a made-up point (a decimator's) cannot be edited
          rows[info.hit.row]!.y = info.second - (info.hit.lift ?? 0);   // lift: how far a stack plots it above its own value
          source.invalidate();
        }}
      />
    </CartesianPlane>
  </Chart>
);
```

> **Note.** `info.hit.lift` is how far a point is plotted from its own value in a stack (the layers below it): subtract it to get the layer's own value. It is absent outside a stack, and where the stack scales the values (`'normalize'`), which an edit cannot undo.

The listener can also be used with no visible change at all, to feed a sidebar or a selection: `onHover` gives the point under the pointer, with its series and channels.

## Touch, keyboard focus and the pointer

- By default one finger on a chart **scrolls the page** (`touch-action: pan-x pan-y`) and two fingers belong to the chart: they pinch and pan it. `PanZoom` has `touch="always"` for a chart that should take every touch. With no interactive element at all the chart takes none: it is a picture and the page scrolls over it. With some other interactive element but no `PanZoom` (a `Cursor`, say) it takes every touch. A second finger that lands after the first has begun to scroll the page cannot take the gesture back: the browser decides that. With `touch="always"` a flick carries on after the finger lifts (`inertia={false}` to stop where it lifted).
- A tap shows a cursor reading and a tooltip, and while the last input is a finger the `hit` radius of a series is at least 24 pixels, so a point can be hit with a fingertip.
- Pointer events are captured while a button or finger is down, so a drag keeps going when it leaves the chart. If the chart is in a scrolling page and the wheel should scroll it, set `zoom={false}` on the `PanZoom`.
- The `focus` ring follows the keyboard (selector `focusRing`).

## Writing your own

An element inside a `Cursor` that draws what it reads (`CursorChild`), or a plane child that takes pointer events, is a few lines: see [Custom elements](../extending/custom-elements.md#interaction).

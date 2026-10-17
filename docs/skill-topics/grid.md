# inkplot topic: several charts in one picture

For: a dashboard, or several charts in a grid.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Charts in a grid

A `ChartGroup` takes the place of the plane in a `Chart`, cuts its area into equal cells, and gives each `ChartGroupItem` the cells it spans. An item takes what a chart takes: a plane, titles, a legend, a cursor. The `Chart` keeps what belongs to the whole picture.

```tsx check id="grid-topic" title="Four charts and a title" height=420
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, ChartGroup, ChartGroupItem, ChartTitle, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const wave = (k: number) => Float64Array.from(Array.from({ length: 24 }, (_, i) => [i, Math.sin(i / (3 + k)) * (k + 1) + k]).flat());
const cell = (name: string, k: number) => (
  <ChartGroupItem>
    <ChartTitle text={name} role="subtitle" />
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries>
        <FlatDataSource data={wave(k)} stride={2} isSorted />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </ChartGroupItem>
);

export const chart = (
  <Chart theme={lightTheme}>
    <ChartTitle text="Four charts" />
    <ChartGroup columns={2}>
      {cell('Slow', 0)}
      {cell('Quick', 1)}
      {cell('Tall', 2)}
      {cell('Wide', 3)}
    </ChartGroup>
  </Chart>
) as Chart;
```

## The grid


| `ChartGroup` attribute | Default | Meaning |
|---|---|---|
| `columns`, `rows` | a square | How many cells across and down. Give one and the other follows from the items; give neither and the cells make a square, rounded up; give both and the items have to fit, or it is an error. |
| `flow` | `'row'` | `'row'` fills a row and then goes down; `'column'` fills a column and then goes along. |
| `gap` | `8` | Pixels between cells: a number, or `{ row, column }`. |
| `align` | `true` | Plots line up: charts in a column leave the same room left and right of their plots (the most any of them needs for its axis labels), charts in a row the same above and below. `false` lets each plot take what its own axes need. A side fixed with the plane's `insets` is left alone. |
| `reverse` | `false` | Run each line the other way: right to left along a row, bottom to top up a column. A right-to-left chart's rows already start at its right, and `reverse` turns them back. |
| `reverseLines` | `false` | Stack the lines from the other end: the first row at the bottom, or, with `flow: 'column'`, the first column at the right. |
| `justify` | `'start'` | Where the items of a line that is not full go: `'start'`, `'center'`, `'end'`, `'space-between'`, `'space-around'`, `'space-evenly'`. That is the last line, a line that an item with `newLine` ended early, and one that the next item was too wide to join. A line with an item reaching down into the next, or with cells taken from the line above, stays where it is. |

| `ChartGroupItem` attribute | Default | Meaning |
|---|---|---|
| `span` | `1` | Cells taken: a number of columns, or `[columns, rows]`. |
| `newLine` | `false` | Start a new line with this item even though the last one has room. For lines of 3, 2 and 3 charts with the middle one centred: `newLine` on the sixth, `justify="center"`. |
| `visible` | `true` | `false` takes no cell and no room. |

Items go in the order they are written, each after the last; the grid does not go back to fill holes. All cells are the same size. An item takes more with `span`: a number of columns, or `[columns, rows]` (`span={[2, 1]}` for a chart twice as wide). A span wider than the line is an error.

An item with nothing in it is an empty cell: it holds its place and draws nothing, so it can reserve room. It does not count when a chart decides whether it is at the edge of the group for `edgeOnly`.

An item that is not `visible` takes no cell and no room, and the others close up; a hidden chart is not drawn, nor asked for by a legend of the whole chart. A grid of one cell (`columns={1} rows={1}`) puts every item in it, one on another: show one at a time with `visible`.


## Sharing an axis

Charts that show the same thing over the same range should line up. A `SharedRange` in the group holds one scale and one range; a `SharedAxis` in each plane names it with `sharedRef` and draws it. The range is fitted to everything every chart draws against it, so a chart with a shorter series still has the longer one's span. Pan, zoom and `resetViews` act on the range, so all the charts move together. Each plane's own axes (the value axes, say) stay its own.

```tsx check id="grid-shared" title="Three charts, one time axis" height=420
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, ChartGroup, ChartGroupItem, ChartTitle, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, SharedAxis, SharedRange, lightTheme } from 'inkplot';

const series = (k: number, from: number, to: number) =>
  Float64Array.from(Array.from({ length: to - from + 1 }, (_, i) => [from + i, Math.sin((from + i) / (4 + k)) * (k + 1)]).flat());

const strip = (name: string, k: number, from: number, to: number) => (
  <ChartGroupItem>
    <ChartTitle text={name} role="subtitle" />
    <CartesianPlane>
      <SharedAxis orientation="bottom" sharedRef="time" edgeOnly />
      <Axis orientation="left" tickCount={3}><LinearScale /></Axis>
      <DomainSeries>
        <FlatDataSource data={series(k, from, to)} stride={2} isSorted />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </ChartGroupItem>
);

export const chart = (
  <Chart theme={lightTheme}>
    <ChartGroup columns={1}>
      <SharedRange id="time"><LinearScale /></SharedRange>
      {strip('Sensor A', 0, 0, 60)}
      {strip('Sensor B', 1, 10, 90)}
      {strip('Sensor C', 2, 30, 100)}
    </ChartGroup>
  </Chart>
) as Chart;
```

A `SharedAxis` has no scale of its own, and only says how it is drawn: `orientation`, `title`, `format`, ticks. The range's attributes (`min`, `max`, `include`, `padding`, `nice`) go on the `SharedRange`. `edgeOnly` draws the axis only where its chart is at the edge of the group it faces, and takes no room elsewhere: one row of labels along the bottom, and the plots above it keep their height. A chart is on an edge when no chart lies beyond it, so the chart above a gap in the last row counts as being at the bottom. Shared axes are for Cartesian planes.

## Pointer and keyboard

The pointer goes to the chart under it. A `Cursor`, `Crosshair` and `ChartTooltip` inside an item follow the pointer in that chart only; one in the `Chart` follows it into whichever chart it is over. Pan and zoom (`PanZoom`, `BoxZoom`) on an axis that is a `SharedAxis` change the range's view, so every chart that shows it moves. Without a shared axis they act on their own chart's.

`linkCursor` on the group goes further: when the pointer is over one chart, the charts that share an axis with it are told it is at the same value of that axis, so their own cursors show it too. Give each chart a `Cursor` with `mode="shared"` (a cursor that looks for the nearest point has nothing to compare the other charts' pointer with). The keyboard is per chart: each chart's cursor is its own tab stop.

```tsx check id="grid-cursor" title="A cursor across three charts" height=460
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, ChartGroup, ChartGroupItem, ChartTitle, ChartTooltip, Crosshair, Cursor, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, PanZoom, SharedAxis, SharedRange, lightTheme } from 'inkplot';

const series = (k: number, from: number, to: number) =>
  Float64Array.from(Array.from({ length: to - from + 1 }, (_, i) => [from + i, Math.sin((from + i) / (4 + k)) * (k + 1)]).flat());

const strip = (name: string, k: number, from: number, to: number) => (
  <ChartGroupItem>
    <ChartTitle text={name} role="subtitle" />
    <CartesianPlane>
      <SharedAxis orientation="bottom" sharedRef="time" edgeOnly />
      <Axis orientation="left" tickCount={3}><LinearScale /></Axis>
      <DomainSeries name={name}>
        <FlatDataSource data={series(k, from, to)} stride={2} isSorted />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
      <PanZoom direction="horizontal" />
    </CartesianPlane>
    <Cursor mode="shared"><Crosshair lines="first" /><ChartTooltip /></Cursor>
  </ChartGroupItem>
);

export const chart = (
  <Chart theme={lightTheme}>
    <ChartGroup columns={1} linkCursor>
      <SharedRange id="time"><LinearScale /></SharedRange>
      {strip('Sensor A', 0, 0, 60)}
      {strip('Sensor B', 1, 10, 90)}
      {strip('Sensor C', 2, 30, 100)}
    </ChartGroup>
  </Chart>
) as Chart;
```

## What goes where


A chart has one plane or one group; two planes straight in a `Chart` are an error that points here. A `ChartGroupItem` may hold a `ChartGroup` in place of a plane, so grids nest. `chart.planes` lists every plane, in grid order.

A `Legend` in the `Chart` lists the series of every chart; one in an item lists that chart's own. A `Cursor` works in the item it is in, or in the plane it is tied to. An `id` is looked up from the element that names it: itself, what is under it, then its parent and what is under that, and so on outwards, so the nearest one wins. Each item can use `x` and `y` for its own axes; only an id meant to be shared (a `SharedRange` in the group) has to be unique where the items can see it.

<!-- api:start -->
### ChartGroup

A grid of charts in one picture, in place of a plane: equal cells, filled along a row or a column.

**In** Chart or ChartGroupItem · **Holds** ChartGroupItem, any number; SharedRange

| Attribute | Type | |
|---|---|---|
| `columns` | `number` | How many columns. |
| `rows` | `number` | How many rows; the counterpart of `columns`. |
| `flow` | `'row' \| 'column'` | The direction the items fill the grid in: along a row and then down (`'row'`, the default) or down a column and then along. |
| `reverse` | `boolean` | Run each line the other way: right to left along a row, bottom to top down a column. Default false. |
| `reverseLines` | `boolean` | Stack the lines the other way: the first line at the bottom of the group (or, with `flow: 'column'`, at the right). Default false. |
| `gap` | `number \| { row?: number; column?: number }` | Space between cells in pixels: one number, or one for each direction. Default 8. |
| `justify` | `Justify` | Where the items of a line go when it is not full: the last line, one that an item with `newLine` ended early, or one the next item was too big for. Default 'start'. |
| `align` | `boolean` | Give charts in a column the same room left and right of their plots, and charts in a row the same above and below, so the plots line up whatever their labels need. Default true. |
| `linkCursor` | `boolean` | Show the cursor in every chart that shares an axis with the one the pointer is over, at the same value of it: a crosshair and a tooltip in each chart of a column, all reading one time. Default false. |

### ChartGroupItem

One chart of a group, in the cells it spans; its titles and keys go round its own plane.

**In** ChartGroup · **Holds** what a Chart holds: a plane (or a nested ChartGroup), ChartTitle, Legend, Cursor, keys

| Attribute | Type | |
|---|---|---|
| `span` | `number \| readonly [columns: number, rows: number]` | How many cells it takes along the flow and across it: one number is columns (rows being 1), or `[columns, rows]`. Default 1. |
| `newLine` | `boolean` | Start a new line with this item, even if the one before has room: the way to make lines of 3, 2 and 3 charts, the middle one centred with `justify`. Default false. |

### SharedRange

A scale and range the charts of a group share; each chart draws it with a SharedAxis.

**In** ChartGroup · **Holds** 1 scale (required)

| Attribute | Type | |
|---|---|---|
| `min` | `number` | Fix an end of the range. |
| `max` | `number` | Fix the top end of the range. |
| `include` | `readonly number[]` | Values the range must cover, e.g. `[0]` to anchor a bar-like axis at zero. |
| `padding` | `number` | Extra room at both ends as a fraction of the data's span. |
| `nice` | `boolean` | Round the ends outwards to tidy tick values. |
| `inverted` | `boolean` | Run from max to min along the axis. |
| `title` | `string` | The axis title (or, on a `ColorAxis` or `ScalarAxis`, the default title of its key). Default: none. |
| `tickCount` | `number` | Ask for about this many ticks, whatever the length. |
| `ticks` | `readonly number[] \| ((range: Readonly<Extent>) => readonly …` | Put ticks exactly here (those inside the range are drawn), or at whatever a function of the range returns. |
| `tickStep` | `number` | Put ticks at every multiple of this step. |
| `format` | `(value: number) => string` | Turns a tick's number into its label, e.g. (v) => `${v}%`. Default: plain digits, grouped by `locale` if one is set. |
| `locale` | `string` | A BCP 47 tag for how this writes its numbers (grouping and decimal mark). Default: the chart's `locale`, else plain digits. |
| `onViewChange` | `(view: Readonly<Extent> \| null) => void` | Called when the view (what pan, zoom or a reset has set) changes: the new range, or null when it is back to the natural one. |

### SharedAxis

An axis that draws a SharedRange of the group, with the same attributes as Axis except for a scale.

**In** a plane in a ChartGroup · **Holds** none

| Attribute | Type | |
|---|---|---|
| `orientation` | `AxisOrientation` | The side of the plot the axis sits on. Default: 'bottom' for the first axis in a plane, then 'left', 'top', 'right'. |
| `titlePosition` | `Side` | The edge of the plot the title sits at: past the axis' labels for an axis fixed to that side, otherwise at the middle of the edge, outside any axes there, which then take the room it needs. Default: the axis' own side. |
| `titleDirection` | `'horizontal' \| 'vertical'` | Whether the title runs along the horizontal or the vertical. Default: horizontal at the top and bottom, vertical at the left and right. |
| `crossesAt` | `number` | Float across the plot at this value of the crossing axis (the other one, or `crossAxis`), instead of sitting on a side. |
| `crossAxis` | `ElementRef<Axis>` | The axis `crossesAt` is a value of. Default: the plane's first axis on the other orientation. |
| `sharedRef` | `ElementRef<SharedRange>` | For a `SharedAxis`: the `SharedRange` it draws. |
| `edgeOnly` | `boolean` | For a `SharedAxis`: draw only where its chart is at the edge of the group it faces, and take no room elsewhere. |
| `min` | `number` | Fix an end of the range. |
| `max` | `number` | Fix the top end of the range. |
| `include` | `readonly number[]` | Values the range must cover, e.g. `[0]` to anchor a bar-like axis at zero. |
| `padding` | `number` | Extra room at both ends as a fraction of the data's span. |
| `nice` | `boolean` | Round the ends outwards to tidy tick values. |
| `inverted` | `boolean` | Run from max to min along the axis. |
| `title` | `string` | The axis title (or, on a `ColorAxis` or `ScalarAxis`, the default title of its key). Default: none. |
| `tickCount` | `number` | Ask for about this many ticks, whatever the length. |
| `ticks` | `readonly number[] \| ((range: Readonly<Extent>) => readonly …` | Put ticks exactly here (those inside the range are drawn), or at whatever a function of the range returns. |
| `tickStep` | `number` | Put ticks at every multiple of this step. |
| `format` | `(value: number) => string` | Turns a tick's number into its label, e.g. (v) => `${v}%`. Default: plain digits, grouped by `locale` if one is set. |
| `locale` | `string` | A BCP 47 tag for how this writes its numbers (grouping and decimal mark). Default: the chart's `locale`, else plain digits. |
| `onViewChange` | `(view: Readonly<Extent> \| null) => void` | Called when the view (what pan, zoom or a reset has set) changes: the new range, or null when it is back to the natural one. |
<!-- api:end -->

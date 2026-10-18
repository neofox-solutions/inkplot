# Charts in a grid

A `ChartGroup` puts several charts in one picture, as a dashboard does. It takes the place of the plane in a `Chart`, cuts its area into equal cells, and gives each `ChartGroupItem` the cells it spans. An item takes what a chart takes: a plane, titles, a legend, a cursor, keys. Its furniture goes round its own plane, inside its cells. The `Chart` keeps what belongs to the whole picture: a title across the top, a legend for every series, a key for a colour all the charts share.

```tsx live title="Four charts and a title" height=420
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

export default () => (
  <Chart theme={lightTheme}>
    <ChartTitle text="Four charts" />
    <ChartGroup columns={2}>
      {cell('Slow', 0)}
      {cell('Quick', 1)}
      {cell('Tall', 2)}
      {cell('Wide', 3)}
    </ChartGroup>
  </Chart>
);
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
| `justify` | `'start'` | Where the items of a line that is not full go: `'start'`, `'center'`, `'end'`, `'space-between'`, `'space-around'`, `'space-evenly'`. That is the last line, a line that an item with `newLine` ended early, and one that the next item was too wide to join. Eight items in three columns leave two in the last row. A line with an item reaching down into the next, or with cells taken from the line above, stays where it is. |

| `ChartGroupItem` attribute | Default | Meaning |
|---|---|---|
| `span` | `1` | Cells taken: a number of columns, or `[columns, rows]`. |
| `newLine` | `false` | Start a new line with this item even though the last one has room. At the start of a line it changes nothing. |
| `visible` | `true` | `false` takes no cell and no room. |

Items go in the order they are written, each after the last; the grid does not go back to fill holes. All cells are the same size. An item takes more with `span`: a number of columns, or `[columns, rows]` (`span={[2, 1]}` for a chart twice as wide). A span wider than the line is an error.

An item with nothing in it is an empty cell: it holds its place and draws nothing, so it can reserve room (a chart that is narrower than its neighbours, a gap in a row). It does not count when a chart decides whether it is at the edge of the group for `edgeOnly`.

Lines of three, two and three, the middle one centred: `newLine` on the sixth chart ends the second line early, and `justify="center"` centres it.

```tsx live title="3 + 2 + 3, the middle row centred" height=300
import { Axis, CartesianPlane, Chart, ChartGroup, ChartGroupItem, ChartTitle, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const cell = (name: string, newLine = false) => (
  <ChartGroupItem newLine={newLine}>
    <ChartTitle text={name} role="subtitle" />
    <CartesianPlane>
      <Axis orientation="bottom" visible={false}><LinearScale /></Axis>
      <Axis orientation="left" visible={false}><LinearScale /></Axis>
      <DomainSeries>
        <FlatDataSource data={[2, 5, 3, 6, 4]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </ChartGroupItem>
);

export default () => (
  <Chart theme={lightTheme}>
    <ChartGroup columns={3} justify="center">
      {cell('A')}
      {cell('B')}
      {cell('C')}
      {cell('D')}
      {cell('E')}
      {cell('F', true)}
      {cell('G')}
      {cell('H')}
    </ChartGroup>
  </Chart>
);
```

An item that is not `visible` takes no cell and no room, and the others close up; a hidden chart is not drawn, nor asked for by a legend of the whole chart. A grid of one cell (`columns={1} rows={1}`) puts every item in it, one on another: show one at a time with `visible`.

## Sharing an axis

Charts that show the same thing over the same range should line up. A `SharedRange` in the group holds one scale and one range; a `SharedAxis` in each plane names it with `sharedRef` and draws it. The range is fitted to everything every chart draws against it, so a chart with a shorter series still has the longer one's span. Pan, zoom and `resetViews` act on the range, so all the charts move together. Each plane's own axes (the value axes, say) stay its own.

```tsx live title="Three charts, one time axis" height=420
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

export default () => (
  <Chart theme={lightTheme}>
    <ChartGroup columns={1}>
      <SharedRange id="time"><LinearScale /></SharedRange>
      {strip('Sensor A', 0, 0, 60)}
      {strip('Sensor B', 1, 10, 90)}
      {strip('Sensor C', 2, 30, 100)}
    </ChartGroup>
  </Chart>
);
```

A `SharedAxis` has no scale of its own, and only says how it is drawn: `orientation`, `title`, `format`, ticks. The range's attributes (`min`, `max`, `include`, `rangePadding`, `nice`) go on the `SharedRange`. `edgeOnly` draws the axis only where its chart is at the edge of the group it faces, and takes no room elsewhere: one row of labels along the bottom, and the plots above it keep their height. A chart is on an edge when no chart lies beyond it, so the chart above a gap in the last row counts as being at the bottom. `edgeOnly` is for Cartesian planes (a polar plane has no edge to face, so it is ignored there); a shared range works on any plane, so radar and polar charts side by side can share a radius scale, or a polar chart a scale with a Cartesian one.

## Pointer and keyboard

The pointer goes to the chart under it. A `Cursor`, `Crosshair` and `ChartTooltip` inside an item follow the pointer in that chart only; one in the `Chart` follows it into whichever chart it is over. Pan and zoom (`PanZoom`, `BoxZoom`) on an axis that is a `SharedAxis` change the range's view, so every chart that shows it moves. Without a shared axis they act on their own chart's.

`linkCursor` on the group goes further: when the pointer is over one chart, the charts that share an axis with it are told it is at the same value of that axis, so their own cursors show it too. Give each chart a `Cursor` with `mode="shared"` (a cursor that looks for the nearest point has nothing to compare the other charts' pointer with). The keyboard is per chart: each chart's cursor is its own tab stop.

```tsx live title="A cursor across three charts" height=460
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
      <PanZoom along="x" />
    </CartesianPlane>
    <Cursor mode="shared"><Crosshair lines="first" /><ChartTooltip /></Cursor>
  </ChartGroupItem>
);

export default () => (
  <Chart theme={lightTheme}>
    <ChartGroup columns={1} linkCursor>
      <SharedRange id="time"><LinearScale /></SharedRange>
      {strip('Sensor A', 0, 0, 60)}
      {strip('Sensor B', 1, 10, 90)}
      {strip('Sensor C', 2, 30, 100)}
    </ChartGroup>
  </Chart>
);
```

## What goes where

A chart has one plane or one group; two planes straight in a `Chart` are an error that points here. A `ChartGroupItem` may hold a `ChartGroup` in place of a plane, so grids nest. `chart.planes` lists every plane, in grid order.

A `Legend` in the `Chart` lists the series of every chart; one in an item lists that chart's own. A `Cursor` works in the item it is in, or in the plane it is tied to. An `id` is looked up from the element that names it: itself, what is under it, then its parent and what is under that, and so on outwards, so the nearest one wins. Each item can use `x` and `y` for its own axes; only an id meant to be shared (a `SharedRange` in the group) has to be unique where the items can see it.

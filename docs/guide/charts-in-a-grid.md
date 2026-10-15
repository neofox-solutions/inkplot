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
| `columns`, `rows` | one line | How many cells across and down. Give one and the other follows from the items; give both and the items have to fit, or it is an error. |
| `flow` | `'row'` | `'row'` fills a row and then goes down; `'column'` fills a column and then goes along. |
| `gap` | `8` | Pixels between cells: a number, or `{ row, column }`. |
| `justify` | `'start'` | Where the items of a last line that is not full go: `'start'`, `'center'`, `'end'`, `'space-between'`, `'space-around'`, `'space-evenly'`. Eight items in three columns leave two in the last row. |

Items go in the order they are written, each after the last; the grid does not go back to fill holes. All cells are the same size. An item takes more with `span`: a number of columns, or `[columns, rows]` (`span={[2, 1]}` for a chart twice as wide). A span wider than the line is an error.

An item that is not `visible` takes no cell and no room, and the others close up; a hidden chart is not drawn, nor asked for by a legend of the whole chart. A grid of one cell (`columns={1} rows={1}`) puts every item in it, one on another: show one at a time with `visible`.

## What goes where

A chart has one plane or one group; two planes straight in a `Chart` are an error that points here. A `ChartGroupItem` may hold a `ChartGroup` in place of a plane, so grids nest. `chart.planes` lists every plane, in grid order.

A `Legend` in the `Chart` lists the series of every chart; one in an item lists that chart's own. A `Cursor` works in the item it is in, or in the plane it is tied to. Series, axes and colour axes are found by `id` across the whole chart, so ids have to be unique across items.

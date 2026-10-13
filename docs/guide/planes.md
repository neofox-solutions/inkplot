# Planes

A plane is a coordinate space. It owns the axes and the series drawn against them, lays them out, projects the data into pixels, and routes pointer input. **Only the plane knows what its two axes mean spatially**; the axes know values and the series know data. That is why the same series and renderers draw on any plane: a radar chart needs a new plane and nothing else.

| Plane | Axes | Draws as |
|---|---|---|
| `CartesianPlane` | Horizontal and vertical, on the plot's edges or floating across it | x/y |
| `PolarPlane` | `angle` and `radius` | A continuous circle: lines of constant value are circles and spokes |
| `RadarPlane` | `angle` and `radius` | A spoke at each tick of the angle axis, straight chords between them |

A plane's children are its **axes**, its **series**, a [`Stack`](series.md#stacks) of series, [annotations](labels.md#annotations), a [`PanZoom`](interaction.md#pan-and-zoom), a [`BoxZoom`](interaction.md#box-zoom), a [`Brush`](interaction.md#brush) and a [`PointerListener`](interaction.md#pointer-listener).

Order matters in two ways. Series are drawn in order, so later ones are on top. And the *first* axis on the horizontal and the first on the vertical are the plane's defaults: a series with no `domainAxis` or `valueAxis` uses them, and the gridlines follow their ticks.

## `CartesianPlane`

| Attribute | Default | Meaning |
|---|---|---|
| `gridlines` | `true` | Lines at the first horizontal and first vertical axis' ticks. |
| `frame` | `false` | A border round the plot area, above the series. |
| `clip` | `true` | Clip series to the plot area. |
| `insets` | fitted | Fixed margins round the plot (room for axes): `{ top, right, bottom, left }`, any subset. A side left out is sized to fit its axes. |

```tsx live title="Frame, no gridlines, fixed insets" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane frame gridlines={false} insets={{ left: 60 }}>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left" title="Value"><LinearScale /></Axis>
      <DomainSeries name="A">
        <FlatDataSource data={[2, 6, 4, 8, 5]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

### Which axis is where

An axis says its side with `orientation` (`bottom`, `top`, `left`, `right`). Left out, the first axis in the plane is `bottom`, then `left`, `top`, `right`. Axes on the same side stack outwards from the plot, in child order. A series' *first* value (its domain, or x) is placed on whichever of its axes is horizontal, so **swapping the sides turns the chart**: put the domain axis on the left and the value axis at the bottom and a line chart runs top to bottom, and a bar chart has horizontal bars.

### Floating axes

An axis can cross the plot instead of sitting on its edge. `crossesAt` is a value of the *other* axis (or of `crossAxis`). Where that value is off the plot, the axis stays at the nearest edge.

```tsx live title="Axes crossing at zero" height=280
import { Axis, CartesianPlane, Chart, DomainSeries, LinePath, LinearCurve, LinearScale, SyntheticDataSource, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane gridlines={false}>
      <Axis orientation="bottom" crossesAt={0} style-tickLabel-halo="#fff"><LinearScale /></Axis>
      <Axis orientation="left" crossesAt={0} style-tickLabel-halo="#fff"><LinearScale /></Axis>
      <DomainSeries name="x³ − 3x">
        <SyntheticDataSource fn={(x: number) => x * x * x - 3 * x} domain={{ min: -2.2, max: 2.2 }} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

A floating axis' labels sit over the plot, so give them a `halo` (a colour drawn round the glyphs) to stay legible over the data. A floating axis takes no room from the plot.

## `PolarPlane` and `RadarPlane`

Both take two axes with the orientations `angle` and `radius`, and series whose first value is an angle and second a radius. They share these attributes:

| Attribute | Default | Meaning |
|---|---|---|
| `startAngle` | `0` | Radians, clockwise from twelve o'clock, where the angle axis begins. |
| `sweep` | `2π` | Radians swept by the angle axis, clockwise; negative runs the other way. Less than a full turn makes a sector, or a gauge. |
| `innerRadius` | `0` | Fraction of the radius left empty in the middle. |
| `gridlines` | `true` | Rings at the radius axis' ticks and spokes at the angle axis'. |
| `clip` | `true` | Clip series to the plot's outline. |

The plot is the largest circle that fits. The angle axis is drawn round the rim, with its labels outside; the radius axis is a spoke at the start angle.

```tsx live title="A polar plot: a rose curve" height=340
import { Axis, Chart, DomainSeries, LinePath, LinearCurve, LinearScale, PolarPlane, SyntheticDataSource, lightTheme } from 'inkplot';

const turn = 2 * Math.PI;

export default () => (
  <Chart theme={lightTheme}>
    <PolarPlane>
      <Axis orientation="angle" min={0} max={turn} tickStep={Math.PI / 4} format={(v: number) => (v >= turn - 1e-9 ? '' : `${Math.round((v * 180) / Math.PI)}°`)}><LinearScale /></Axis>
      <Axis orientation="radius" min={0} max={1} tickCount={3}><LinearScale /></Axis>
      <DomainSeries name="r = cos 3θ">
        <SyntheticDataSource fn={(t: number) => Math.abs(Math.cos(3 * t))} domain={{ min: 0, max: turn }} count={400} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </PolarPlane>
  </Chart>
);
```

A half circle with a hole is a gauge. The area is the part of the ring from the start of the angle axis to the value, and it is traced with enough points to follow the arc:

```tsx live title="A gauge from a part of a turn" height=240
import { AreaPath, Axis, Chart, DomainSeries, LinearCurve, LinearScale, PolarPlane, SyntheticDataSource, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <PolarPlane startAngle={-Math.PI / 2} sweep={Math.PI} innerRadius={0.55} gridlines={false}>
      <Axis orientation="angle" min={0} max={100} tickStep={25}><LinearScale /></Axis>
      <Axis orientation="radius" min={0} max={1} tickCount={2} visible={false}><LinearScale /></Axis>
      <DomainSeries name="Load">
        <SyntheticDataSource fn={() => 1} domain={{ min: 0, max: 68 }} count={60} />
        <AreaPath fill="#2a6fdb" opacity={0.9}><LinearCurve /></AreaPath>
      </DomainSeries>
    </PolarPlane>
  </Chart>
);
```

Bars on a polar plane are wedges. Put the **value** on the angle axis and the domain on the radius axis (name them with `domainAxis` and `valueAxis`) and a normalised `Stack` of bars becomes a **ring chart**: each series a segment, each point a ring ([recipe](../start/recipes.md#draw-a-pie-or-ring-chart)).

On a **radar** plane there is a spoke at each tick of the angle axis (the ends of the sweep too), and straight lines between them: a ring is a polygon, and between two spokes a point is on the chord. So a radar wants a **fixed** angle range with a tick on each category: give the angle axis `min`, `max` and a `tickCount` of one more than the categories. The data's `wrap` attribute repeats the first point at the end so the shape closes ([recipe](../start/recipes.md#use-a-polar-or-radar-chart)). Rings follow the radius axis' ticks, so `nice` is a good idea unless the range is fixed.

> **Tip.** On a polar or radar plane, `PanZoom` moves the radius axis only: the rim cannot be dragged.

## Writing a plane

A plane is a class that says where its axes go, how a fraction of each axis becomes a place, and the inverse. See [Custom elements](../extending/custom-elements.md#planes).

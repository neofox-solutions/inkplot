# inkplot topic: lines, areas and bars

For: bars (grouped, stacked), areas, smooth and stepped lines, curves, gaps in the data, several series sharing a plane.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Bars on categories


```tsx check title="Bars"
/** @jsxImportSource inkplot */
import { Axis, BandScale, BarPath, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinearScale, lightTheme } from 'inkplot';

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['Q1', 'Q2', 'Q3', 'Q4']} /></Axis>
      <Axis orientation="left" title="Revenue"><LinearScale /></Axis>
      <DomainSeries name="2024">
        <FlatDataSource data={[42, 58, 51, 73]} regularDomain-start={0} regularDomain-step={1} />
        <BarPath />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
) as Chart;
```

Stacked or side by side: wrap several `DomainSeries` in `<Stack mode="stack">` (or `"group"`), add `<Legend side="bottom" />` to the `Chart`.

## Notes

- `Stack` `mode`: `'stack'`, `'group'`, `'normalize'`, `'center'`.
- `BarPath` bars start at `baseline` (default 0, and the axis includes it); the tallest bar touches the top of the plot, so add `padding={0.05}` (a fraction of the span) to the value `Axis` for headroom.
- Curves: `LinearCurve`, `MonotoneCurve`, `StepCurve`, `NaturalCurve`, `CardinalCurve`, `CatmullRomCurve`, `BasisCurve`, `BumpCurve`, `QuadraticCurve`, `ArcCurve`.
- `hit` on a series: `'point'`, `'line'`, `'area'`, `'shape'` or `false`. `gaps`: `'break'` (default), `'connect'`, `'zero'`.

| To… | Use |
|---|---|
| Smooth lines | `<LinePath><MonotoneCurve /></LinePath>`; steps: `<StepCurve mode="after" />` |
| Series gaps | `NaN` values are gaps; `gaps="connect"` on the series to cross them |
| Hide a series | `series.setAttribute('visible', false)` |

## Attributes of this topic's elements

An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`.

<!-- api:start -->
### Stack

Series that share axes and are laid on each other or side by side.

**In** a plane · **Holds** DomainSeries, any number

| Attribute | Type | |
|---|---|---|
| `mode` | `StackMode` | How the members' values are laid out. Default 'stack'. |
| `align` | `StackAlign` | How rows are matched up when the members' domains differ. Default 'strict': they must not. |

### AreaPath

The region between a line and a baseline.

**In** a series · **Holds** 1 curve (required)

| Attribute | Type | |
|---|---|---|
| `baseline` | `number` | The value the area is filled from, kept inside the value axis' range. Default 0. |
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |

### MonotoneCurve

A smooth curve that never overshoots.

**In** LinePath or AreaPath · **Holds** none

No attributes of its own.

### NaturalCurve

A natural cubic spline.

**In** LinePath or AreaPath · **Holds** none

No attributes of its own.

### CardinalCurve

A cardinal spline.

**In** LinePath or AreaPath · **Holds** none

| Attribute | Type | |
|---|---|---|
| `tension` | `number` | How far the curve is tightened towards straight lines, 0 (the Catmull-Rom spline) to 1. Default 0. |

### CatmullRomCurve

A Catmull-Rom spline.

**In** LinePath or AreaPath · **Holds** none

| Attribute | Type | |
|---|---|---|
| `alpha` | `number` | The spacing of the knots: 0 even, 0.5 centripetal, 1 chordal. Default 0.5. |

### BasisCurve

A B-spline that smooths past the points.

**In** LinePath or AreaPath · **Holds** none

No attributes of its own.

### BumpCurve

S-shaped joins.

**In** LinePath or AreaPath · **Holds** none

| Attribute | Type | |
|---|---|---|
| `along` | `'x' \| 'y'` | Whether the level ends are along x (a line level at each point) or y. Default: along the series' first axis. |

### QuadraticCurve

Quadratic joins.

**In** LinePath or AreaPath · **Holds** none

No attributes of its own.

### ArcCurve

Circular arcs.

**In** LinePath or AreaPath · **Holds** none

| Attribute | Type | |
|---|---|---|
| `bend` | `number` | The rise of each arc as a fraction of its chord, positive bulging to the left of the way along. Default 0.3. |

### StepCurve

Levels and jumps.

**In** LinePath or AreaPath · **Holds** none

| Attribute | Type | |
|---|---|---|
| `mode` | `StepMode` | Where the value changes between one point and the next. Default 'after'. |

### BarPath

Bars, in one path.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |
| `width` | `number` | Fraction of the room each bar fills. Default: a band's own `bandwidth`, else 0.8. |
| `baseline` | `number` | The value bars grow from when there is no stack to say. Default 0. |

### BarLinePath

Bars drawn as stems.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `cap` | `'butt' \| 'round' \| 'square'` | How the end of a stem is finished: 'butt' (flat, at the value), 'round' or 'square' (both reach half a width past). Default 'butt'. |
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |
| `width` | `number` | Fraction of the room each bar fills. Default: a band's own `bandwidth`, else 0.8. |
| `baseline` | `number` | The value bars grow from when there is no stack to say. Default 0. |
<!-- api:end -->

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
- Floating bars (a waterfall's steps, a candlestick's body and wick): put each bar's start in a data channel and name it with `from="start"` on `BarPath` or `StemPath`; the series' value is the end. Draw one series per colour (a row of another kind has `NaN` for its value), a `StepCurve` line under the bars for connectors, and a `StemPath` from `low` to `high` under `BarPath` bodies from `open` to `close` for a candlestick. Colour bars by data with `bind={{ fill: { channel: 'kind', map: (v) => … } }}` (a function of a channel; `StemPath` binds `stroke`), so up and down need no separate series. Both are worked in the recipes page.
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

### SeriesGroup

One series for each value of a channel of the data, each drawn with a copy of the renderers. The series are made from the data and are not saved.

**In** a plane · **Holds** 1 data (source, or a transform over one), then any renderers: a template

| Attribute | Type | |
|---|---|---|
| `channel` (required) | `string` | The channel of the data that says which series a point is in. |
| `name` | `(key: number) => string` | What a series is called, from its key. Default: the key as text. |
| `domainAxis` | `ElementRef<Axis>` | The axes of every series (as a `DomainSeries` names them). |
| `valueAxis` | `ElementRef<Axis>` |  |
| `x` | `string` | The channel that is x, when the series are `XYSeries` (a path or scatter for each key, or a heat map): leave it out for `DomainSeries`. |
| `xAxis` | `ElementRef<Axis>` |  |
| `yAxis` | `ElementRef<Axis>` |  |
| `gaps` | `'break' \| 'connect' \| 'zero'` | What a missing value means in every series (see `Series`). |
| `bind` | `Readonly<Record<string, GroupBinding>>` | An attribute of the renderers of every series, from the key: `{ stroke: { axis: 'heat' }, opacity: { map: (key) => key > year ? 0.2 : 1 } }`. |
| `order` | `'first' \| 'sorted' \| ((a: number, b: number) => number)` | The order of the series, so their palette colours: 'first' (as the keys first appear in the domain, the default), 'sorted' (by key), or a comparison of keys. |
| `maxGroups` | `number` | The most series made; more keys than this are left out (`omitted` says how many). Default 100. |

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
| `from` | `string` | The channel of the data that holds where each bar starts, for bars that float: a waterfall's steps, a candlestick's body (the series' value is where it ends). |

### StemPath

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
| `from` | `string` | The channel of the data that holds where each bar starts, for bars that float: a waterfall's steps, a candlestick's body (the series' value is where it ends). |
<!-- api:end -->

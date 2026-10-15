# inkplot topic: markers, colour and size from data

For: scatter and bubble charts, dots and crosses, colour or size taken from the data, colour and size keys.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Scatter, coloured by a value, with a key


`XYSeries` takes x from a channel (`x="x"` names the channel; the source's `domain` is not used and can be left out), and y from the source's `value`. Colour comes from a `ColorAxis` (a child of the **chart**, beside the plane) that the marker binds to by id. A `ColorKey` shows it.

```tsx check title="Coloured scatter"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, CircleMarker, ColorAxis, ColorKey, LinearScale, ObjectDataSource, XYSeries, lightTheme } from 'inkplot';

const rows = Array.from({ length: 30 }, (_, i) => ({ x: i, y: Math.sin(i / 4) * 10, temp: i * 1.5 }));

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries name="Readings" x="x">
        <ObjectDataSource source={rows} value="y" channels={{ x: 'x', temp: 'temp' }} />
        <CircleMarker size={5} bind={{ fill: { axis: 'heat', channel: 'temp' } }} />
      </XYSeries>
    </CartesianPlane>
    <ColorAxis id="heat" title="Temperature" ramp="magma"><LinearScale /></ColorAxis>
    <ColorKey dimension="heat" side="right" />
  </Chart>
) as Chart;
```

Only **markers** (and `HeatMap`) can `bind` for now. A `bind`'s `channel` is the name on the left of the source's `channels` map, not the field name in the rows. Sizes work the same way:

```tsx check title="Bubble chart with a size key"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, CircleMarker, LinearScale, ObjectDataSource, ScalarAxis, SizeKey, XYSeries, lightTheme } from 'inkplot';

const rows = Array.from({ length: 20 }, (_, i) => ({ x: i, y: Math.sin(i / 3) * 10, weight: 1 + (i % 7) }));

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries name="Items" x="x">
        <ObjectDataSource source={rows} value="y" channels={{ x: 'x', mass: 'weight' }} />
        <CircleMarker bind={{ size: { axis: 'size', channel: 'mass' } }} />
      </XYSeries>
    </CartesianPlane>
    <ScalarAxis id="size" title="Weight" output={[3, 12]}><LinearScale /></ScalarAxis>
    <SizeKey dimension="size" side="right" />
  </Chart>
) as Chart;
```

`ScalarAxis` `output` is the marker size range in pixels (default `[2, 12]`). A bound `size` replaces the marker's own `size`. Both keys can share a side.

## Notes

- A `bind` can carry several properties at once: `bind={{ fill: { axis: 'heat', channel: 'temp' }, size: { axis: 'size', channel: 'mass' } }}`. Markers come out as merged `<path>` elements (a dot is a zero-length stroke with a round cap), not `<circle>`s.
- Markers: `CircleMarker`, `SquareMarker`, `DotMarker`, `CrossMarker`, `PlusMarker`. A series may have a marker *and* a line.
- `bind` (markers and `HeatMap` only) takes `fill`, `stroke`, `opacity`, and for markers `size`. A `ColorAxis` `ramp` is `'viridis'`, `'magma'`, `'turbo'`, `'blues'`, `'greys'` or `'diverging'`. A `ColorKey` shows its `title`, else the axis's `title`.
- `Legend` and the keys: `side` is `'top'`, `'right'`, `'bottom'` or `'left'`; `orientation` is `'horizontal'` or `'vertical'`.

## Attributes of this topic's elements

An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`.

<!-- api:start -->
### XYSeries

Points with x and y both from the data.

**In** a plane · **Holds** 1 data, then any renderers

| Attribute | Type | |
|---|---|---|
| `x` (required) | `Channel` | The channel of the source that is x. |
| `xAxis` | `ElementRef<Axis>` | Default: the plane's first axis (a Cartesian plane's horizontal one). |
| `yAxis` | `ElementRef<Axis>` | Default: the plane's second axis (the vertical one). |
| `name` | `string` | What the series is called where it is named: a tooltip's heading. |
| `hit` | `false \| HitMode \| HitOptions` | How pointer hits find this series: a mode name, options, or `false` for a series that should never be hit (a selection overlay, a reference line). |
| `gaps` | `'break' \| 'connect' \| 'zero'` | What a missing value (NaN, or infinite) means. 'break' (default): nothing is there, so a line stops and starts again and an area splits. 'connect': the line goes straight across to the next value there is. 'zero': the value is 0 (and the axis reaches it). |

### DotMarker

A dot at each point: the cheapest marker.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `cap` | `'round' \| 'square'` | Round caps make circles, square caps make squares. Default 'round'. |
| `size` | `number` | Half the width of a marker in pixels: a radius, or the distance from the centre to an edge. Default 3. |
| `merge` | `boolean` | Draw all the markers that look alike as one path. Default true. |
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |

### CrossMarker

× at each point.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `size` | `number` | Half the width of a marker in pixels: a radius, or the distance from the centre to an edge. Default 3. |
| `merge` | `boolean` | Draw all the markers that look alike as one path. Default true. |
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |

### PlusMarker

+ at each point.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `size` | `number` | Half the width of a marker in pixels: a radius, or the distance from the centre to an edge. Default 3. |
| `merge` | `boolean` | Draw all the markers that look alike as one path. Default true. |
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |

### CircleMarker

A filled circle at each point.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `size` | `number` | Half the width of a marker in pixels: a radius, or the distance from the centre to an edge. Default 3. |
| `merge` | `boolean` | Draw all the markers that look alike as one path. Default true. |
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |

### SquareMarker

A square at each point.

**In** a series · **Holds** none

| Attribute | Type | |
|---|---|---|
| `size` | `number` | Half the width of a marker in pixels: a radius, or the distance from the centre to an edge. Default 3. |
| `merge` | `boolean` | Draw all the markers that look alike as one path. Default true. |
| `stroke` | `string` | Outline colour (a CSS colour). Default: from the theme. |
| `strokeWidth` | `number` | Outline width in pixels. Default: from the theme. |
| `fill` | `string` | Fill colour (a CSS colour; 'none' for no fill). Default: from the theme. |
| `opacity` | `number` | Opacity from 0 to 1. Default 1. |
| `bind` | `Bindings<Bindable>` | Attributes fed from data instead of fixed. |
| `maxNodes` | `number` | Most paths this renderer may create. Default 1000. |

### ColorAxis

Maps data to colours.

**In** Chart · **Holds** 1 scale (required)

| Attribute | Type | |
|---|---|---|
| `ramp` | `ColorRampName \| readonly string[]` | A named ramp, or a list of colours spread evenly. Default 'viridis'. |
| `interpolation` | `'linear' \| 'step'` | Blend between the stops or pick the nearest band. Default 'linear'. |
| `missing` | `string` | Colour for data with no value or outside the range. Default '#bbb'. |
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

### ScalarAxis

Maps data to sizes or other numbers.

**In** Chart · **Holds** 1 scale (required)

| Attribute | Type | |
|---|---|---|
| `output` | `readonly [min: number, max: number]` | The output range. |
| `missing` | `number` | Output for data with no value or outside the range. Default: the low end of `output`. |
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

### ColorKey

Shows what a ColorAxis means.

**In** Chart · **Holds** none

| Attribute | Type | |
|---|---|---|
| `thickness` | `number` | Thickness of the colour bar in pixels. Default 14. |
| `dimension` (required) | `ElementRef<Dimension>` | The dimension this key shows, or its id. |
| `side` | `Side` | The edge of the chart it sits along. Default 'right'. |
| `orientation` | `KeyOrientation` | Which way its scale runs. Default: along its side, so vertical on the left and right, horizontal on the top and bottom. |
| `title` | `string` | Default: the dimension's own title. |
| `length` | `number` | Length of the scale in pixels. Default 140. |
| `breadth` | `number` | Width of a vertical key: the scale and its labels. Default 72. |

### SizeKey

Shows what a ScalarAxis means.

**In** Chart · **Holds** none

| Attribute | Type | |
|---|---|---|
| `dimension` (required) | `ElementRef<Dimension>` | The dimension this key shows, or its id. |
| `side` | `Side` | The edge of the chart it sits along. Default 'right'. |
| `orientation` | `KeyOrientation` | Which way its scale runs. Default: along its side, so vertical on the left and right, horizontal on the top and bottom. |
| `title` | `string` | Default: the dimension's own title. |
| `length` | `number` | Length of the scale in pixels. Default 140. |
| `breadth` | `number` | Width of a vertical key: the scale and its labels. Default 72. |
<!-- api:end -->

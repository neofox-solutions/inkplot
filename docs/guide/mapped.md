# Mapped dimensions and keys

An axis turns data into a *position*. A **mapped dimension** turns data into a *value*: a colour, a size, an opacity. It is how you draw a bubble chart, colour points by a measurement, or shade bars by category, with the same renderers as any other chart.

Three pieces work together:

1. A **mapped axis** (`ColorAxis` or `ScalarAxis`) that owns the mapping. It is a child of the `Chart`, beside the planes, and takes a scale like any axis.
2. A **binding** on a renderer (`bind`) that feeds one of its attributes from one **channel** of the data through that axis.
3. A **key** (`ColorKey`, `SizeKey`) beside the chart that shows what the mapping means.

```tsx live title="Colour from a measurement, with a key" height=320
import { Axis, CartesianPlane, Chart, CircleMarker, ColorAxis, ColorKey, LinearScale, ObjectDataSource, XYSeries, lightTheme } from 'inkplot';

const rows = Array.from({ length: 30 }, (_, i) => ({ x: i, y: Math.sin(i / 4) * 10 + 10, reading: Math.cos(i / 6) * 20 + 20 }));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries>
        <ObjectDataSource source={rows} channels={{ x: 'x', y: 'y', reading: 'reading' }} />
        <CircleMarker size={6} bind={{ fill: { axis: 'heat', channel: 'reading' } }} />
      </XYSeries>
    </CartesianPlane>
    <ColorAxis id="heat" title="Reading" ramp="magma"><LinearScale /></ColorAxis>
    <ColorKey dimension="heat" side="right" />
  </Chart>
);
```

## Bindings

`bind` is an attribute of a renderer: an object of `{ attribute: { axis, channel } }`, or, for a rule of your own, `{ attribute: { channel, map } }` ([below](#a-function-instead-of-a-dimension)).

```tsx
<CircleMarker bind={{ fill: { axis: heat, channel: 'temperature' }, size: { axis: weight, channel: 'mass' } }} />
```

- `axis` is the mapped axis, or its `id`.
- `channel` is a channel of the series' data ([Data](data.md#the-model-domain-value-channels)).
- The plain attribute (`fill`, `strokeWidth`…) stays as the **fallback**, so `{ strokeWidth: 0.5, bind: { stroke: … } }` mixes fixed and bound freely.
- A renderer lists what it lets you bind: a `CircleMarker` takes `stroke`, `strokeWidth`, `fill`, `opacity` and `size`; a `DotMarker` takes `stroke`, `size` and `opacity`. In TypeScript, binding something the renderer cannot vary, or a dimension of the wrong kind (a colour axis for `size`), is a compile error.
- **Where it works.** Markers, `BarPath` (`stroke`, `strokeWidth`, `fill`, `opacity`), `StemPath` (`stroke`, `strokeWidth`, `opacity`), `HeatMap`, and the two gradient paths ([below](#gradient-lines-and-areas)). A plain `LinePath` or `AreaPath` is one colour, and throws if given a `bind`: use `GradientLinePath` or `GradientAreaPath`.
- Several renderers on a series can each bind.

**Geometric versus stylistic.** A bound property is either *geometric*, going into the path data (a marker's `size` on a `CircleMarker`, which costs the same however much it varies), or *stylistic*, which has to vary per path (a colour, a stroke width, an opacity). A stylistic binding is **quantized** into steps so that points with the same look share one path: with `maxNodes` of 1000 (the default) and one stylistic binding there are 1000 colours at most; with two, 31 steps each. That bound on path count is what keeps a scatter of a hundred thousand coloured points fast. The cost is that a colour is the nearest step. Marker `merge={false}` gives every point its own node, exact value and blending, and is for small data.

### A function instead of a dimension

For a rule that is not a ramp (red below zero and green above, a colour for each status, a thin stroke for the old data), give the binding a `map`, a function from the channel's value to the look, in place of an `axis`:

```tsx
<BarPath bind={{ fill: { channel: 'change', map: (v) => (v < 0 ? '#d1495b' : '#3a9d6e') } }} />
```

Each different result is one look, and the shapes that share it are drawn as one path, so it is meant for **a handful of results** (the signs of a number, the values of a rating or status), not a different one for every row: the number of looks is held to what `maxNodes` allows, and a binding that returns more than a few dozen different results is better written as a `ColorAxis`. `map` is called once for each row of the channel on every draw, so keep it cheap and give it the same identity each time (in React, memoize it). It sees only finite values; a row with no number is given what `map(NaN)` returns, so write it so that it answers. There is no key for a function, since it has no range to show; if you need a legend, add one by hand, or use a stepped `ColorAxis` (`ramp` of two colours, `interpolation="step"`, `min` and `max` either side of the threshold), which is the same split with a dimension a `ColorKey` can describe.

The mapped axis fits itself to **all** the data bound to it (not just the part in view), so colours and sizes stay put while you zoom.

## `ColorAxis`

| Attribute | Meaning |
|---|---|
| `ramp` | A named ramp (`viridis` (default), `magma`, `turbo`, `blues`, `greys`, `diverging`), or a list of colours spread evenly. |
| `interpolation` | `'linear'` blends between stops (needs `#rgb` or `#rrggbb` colours); `'step'` picks the nearest band (any CSS colour). Default `'linear'`. |
| `missing` | The colour for data with no value or outside the range. Default `#bbb`. |

and the usual dimension attributes: `min`, `max`, `tickCount`, `ticks`, `format`, `title`…

For **categories**, use a stepped ramp with a fixed range, a tick per category and a `format` that names them:

```tsx live title="Categories by colour" height=340
import { Axis, CartesianPlane, Chart, CircleMarker, ColorAxis, ColorKey, LinearScale, ObjectDataSource, XYSeries, lightTheme } from 'inkplot';

const regions = ['Europe', 'Asia', 'Africa', 'Americas'];
const rows = Array.from({ length: 36 }, (_, i) => ({ x: (i * 37) % 100, y: (i * 53) % 90, region: i % 4 }));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane frame>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries>
        <ObjectDataSource source={rows} channels={{ x: 'x', y: 'y', region: 'region' }} />
        <CircleMarker size={6} opacity={0.85} bind={{ fill: { axis: 'region', channel: 'region' } }} />
      </XYSeries>
    </CartesianPlane>
    <ColorAxis id="region" title="Region" ramp={['#2a6fdb', '#e8590c', '#2a8f4a', '#9c36b5']} interpolation="step" min={0} max={3} tickCount={4} format={(v: number) => regions[Math.round(v)] ?? ''}>
      <LinearScale />
    </ColorAxis>
    <ColorKey dimension="region" side="right" breadth={92} />
  </Chart>
);
```

## `ScalarAxis`

| Attribute | Meaning |
|---|---|
| `output` | The output range: `[min, max]`. Pixels for a marker size (default `[2, 12]`); it can equally map to an opacity (`[0.2, 1]`) or a width. |
| `missing` | The output for data with no value or outside the range. Default the low end of `output`. |

**Area, not radius.** A bubble reads best when its *area* follows the value. Size maps linearly, so bind a channel holding the square root of the value (or give the axis a `SqrtScale`, and a `format` that squares it back for the key).

## Gradient lines and areas

A marker takes the colour of its own point. A line or an area is one shape, so a colour bound to data has to *run along it*: `GradientLinePath` (bind `stroke`) and `GradientAreaPath` (bind `fill`, and `stroke` for an outline) draw what `LinePath` and `AreaPath` draw, painted with a gradient that has a colour stop at each point.

```tsx live title="A line and the area under it, coloured by a second channel" height=320
import { Axis, CartesianPlane, Chart, ColorAxis, ColorKey, DomainSeries, GradientAreaPath, GradientLinePath, LinearCurve, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const rows = Array.from({ length: 120 }, (_, i) => ({ km: i / 3, altitude: 200 + 90 * Math.sin(i / 14) + 30 * Math.sin(i / 4), speed: 24 - 8 * Math.cos(i / 14) }));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" title="Distance (km)"><LinearScale /></Axis>
      <Axis orientation="left" title="Altitude (m)"><LinearScale /></Axis>
      <DomainSeries>
        <ObjectDataSource source={rows} domain="km" value="altitude" channels={{ speed: 'speed' }} />
        <GradientAreaPath opacity={0.35} bind={{ fill: { axis: 'speed', channel: 'speed' } }}><LinearCurve /></GradientAreaPath>
        <GradientLinePath strokeWidth={3} bind={{ stroke: { axis: 'speed', channel: 'speed' } }}><LinearCurve /></GradientLinePath>
      </DomainSeries>
    </CartesianPlane>
    <ColorAxis id="speed" title="Speed (km/h)" ramp="turbo"><LinearScale /></ColorAxis>
    <ColorKey dimension="speed" side="right" />
  </Chart>
);
```

It is one SVG path whatever the number of points, painted with a `linearGradient` laid along the series' first axis (the horizontal one, or the vertical one when the domain runs up the plot). That is why it is cheap, and it sets the limits:

- **A rectangular plane.** The colour runs along a straight axis; on a polar plane the path throws and says so.
- **A place along the axis has one colour.** An `XYSeries` that doubles back takes the colour of its last pass, so use these for a value along a domain.
- **At most `maxStops` colour stops** (default 500). More points than that are averaged into stops, so a long line stays a few hundred nodes and a spike in the channel is smoothed, not lost: raise `maxStops` if one matters. Neighbouring stops of one colour are merged.
- **Banded colours.** A `ColorAxis` with `interpolation="step"` gives hard bands: each colour holds halfway to its neighbours.
- **Gaps** in the data leave the line broken, and the colours either side carry on from where they were.

To colour a line by its own value, give the source a channel with the same numbers (`channels={{ temp: 'temp' }}` beside `value="temp"`).

## Keys

A key is a child of the `Chart`, so one key can sit beside several planes. It reserves a strip along an edge of the chart and draws the scale, ticks and labels.

| Attribute | Meaning |
|---|---|
| `dimension` | **Required.** The mapped axis (or its `id`) this key shows. A `ColorKey` takes a `ColorAxis`, a `SizeKey` a `ScalarAxis`. |
| `side` | The edge of the chart: `top`, `right`, `bottom`, `left`. Default `right`. Several keys on one side stack along it. |
| `orientation` | `'vertical'` or `'horizontal'`. Default: along its side. |
| `title` | Default: the dimension's own `title`. |
| `length` | Length of the scale in pixels. Default 140. |
| `breadth` | Width of a vertical key, the scale and its labels. Default 72. |
| `thickness` (`ColorKey`) | Thickness of the colour bar. Default 14. |

A `ColorKey` is a bar of the dimension's colours, low to high, with its ticks. A `SizeKey` is circles at the dimension's tick values, each as big as the size it stands for.

> **Tip.** A key that has no room clips its title. Give it a `breadth`, shorten the title, or give the chart more height: a `SizeKey` below a `ColorKey` needs both.

## Writing a mapped dimension

`MappedDimension<Out>` is the base: it says what a position 0 to 1 along the dimension *is* (`valueAt`) and what missing data maps to. A new kind (a dash pattern, a symbol) is one class. See [Custom elements](../extending/custom-elements.md#mapped-dimensions).

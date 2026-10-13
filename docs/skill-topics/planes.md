# inkplot topic: polar and radar charts

For: polar and radar charts.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Polar and radar


`RadarPlane` and `PolarPlane` take an `angle` axis and a `radius` axis; the series and renderers are the same. For named spokes use a `LinearScale` with `min={0}`, `max` the number of categories, `tickCount` one more, and a `format` that turns the index into a name. `wrap` repeats the first point so the shape closes.

```tsx check title="Radar" height=380
/** @jsxImportSource inkplot */
import { AreaPath, Axis, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, RadarPlane, lightTheme } from 'inkplot';

const skills = ['Speed', 'Power', 'Range', 'Armour', 'Stealth', 'Control'];

export const chart = (
  <Chart theme={lightTheme}>
    <RadarPlane>
      <Axis orientation="angle" min={0} max={skills.length} tickCount={skills.length + 1} format={(v: number) => skills[v] ?? ''}><LinearScale /></Axis>
      <Axis orientation="radius" min={0} max={10} tickCount={6}><LinearScale /></Axis>
      <DomainSeries name="Profile A">
        <FlatDataSource data={[8, 5, 7, 4, 9, 6]} regularDomain-start={0} regularDomain-step={1} wrap={skills.length} />
        <AreaPath fill="#2a6fdb" opacity={0.25}><LinearCurve /></AreaPath>
        <LinePath stroke="#2a6fdb"><LinearCurve /></LinePath>
      </DomainSeries>
    </RadarPlane>
  </Chart>
) as Chart;
```


Raw readings on a polar plane are a scatter: an `XYSeries` whose `x` is the channel that carries the angle, the data value as the radius. The angle axis spans whatever range you give it round the full turn, so angles in degrees need no conversion: `min={0} max={360}`. `bind` colours the points by another channel, here the time, through a `ColorAxis`.

```tsx check title="Polar scatter, angle in degrees, coloured by time" height=420
/** @jsxImportSource inkplot */
import { Axis, Chart, CircleMarker, ColorAxis, ColorKey, LinearScale, ObjectDataSource, PolarPlane, XYSeries, lightTheme } from 'inkplot';

const rows = Array.from({ length: 400 }, (_, i) => ({ t: i / 10, deg: (i * 9) % 360, volts: 1 + 3 * Math.abs(Math.sin(i / 40)) }));

export const chart = (
  <Chart theme={lightTheme} width={520} height={420}>
    <PolarPlane>
      <Axis orientation="angle" min={0} max={360} ticks={[0, 45, 90, 135, 180, 225, 270, 315]} format={(v: number) => `${v}°`}><LinearScale /></Axis>
      <Axis orientation="radius" min={0}><LinearScale /></Axis>
      <XYSeries name="Readings" x="angle">
        <ObjectDataSource source={rows} value="volts" channels={{ angle: 'deg', time: 't' }} />
        <CircleMarker size={3} bind={{ fill: { axis: 'time', channel: 'time' } }} />
      </XYSeries>
    </PolarPlane>
    <ColorAxis id="time" ramp="viridis" title="Time (s)"><LinearScale /></ColorAxis>
    <ColorKey dimension="time" side="right" />
  </Chart>
) as Chart;
```

A polar plane is a circle fitted into the room that is left, so a square chart with a colour key at the side leaves blank space below the circle: make the chart wider than it is tall (as above). Give a full turn's angle axis `ticks` that stop short of 360, as above: 0° and 360° are the same spot, and their labels would print over each other. Leave the `radius` axis without a `title`: it is drawn over the 0° spoke and the tick labels. Put the unit in the chart's title or caption instead ("radius = magnitude (V)").


## Attributes of this topic's elements

An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`.

<!-- api:start -->
### PolarPlane

A disc: angle and radius.

**In** Chart · **Holds** as CartesianPlane

| Attribute | Type | |
|---|---|---|
| `startAngle` | `number` | Radians clockwise from twelve o'clock. Default 0. |
| `sweep` | `number` | Radians swept by the angle axis, clockwise; negative runs the other way. Default 2π. |
| `innerRadius` | `number` | Fraction of the radius left empty in the middle. Default 0. |
| `gridlines` | `boolean` | Rings at the radius axis' ticks and spokes at the angle axis'. Default true. |
| `clip` | `boolean` | Clip series to the plot's outline. Default true. |
| `insets` | `Partial<Insets>` | Fixed margins round the plot (room for axes). |

### RadarPlane

A polygon with a spoke per category.

**In** Chart · **Holds** as CartesianPlane

| Attribute | Type | |
|---|---|---|
| `startAngle` | `number` | Radians clockwise from twelve o'clock. Default 0. |
| `sweep` | `number` | Radians swept by the angle axis, clockwise; negative runs the other way. Default 2π. |
| `innerRadius` | `number` | Fraction of the radius left empty in the middle. Default 0. |
| `gridlines` | `boolean` | Rings at the radius axis' ticks and spokes at the angle axis'. Default true. |
| `clip` | `boolean` | Clip series to the plot's outline. Default true. |
| `insets` | `Partial<Insets>` | Fixed margins round the plot (room for axes). |
<!-- api:end -->

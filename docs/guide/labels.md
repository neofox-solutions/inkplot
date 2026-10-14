# Labels and annotations

Words and marks that are not data: titles, a legend, reference lines and callouts.

## Titles

`ChartTitle` is text across the top or bottom of the chart. One element serves every role: a title, a subtitle, a caption or a footnote differ only in their `role`, which decides their look, and `side`. Several on one edge stack outwards from it, in the order they are added.

| Attribute | Meaning |
|---|---|
| `text` | **Required.** The words. A `'\n'` starts another line. |
| `role` | `'title'` (default), `'subtitle'` or `'caption'`. Decides the look and, unless `side` says, where it goes. |
| `side` | `'top'` or `'bottom'`. Default: the top, except for a caption, which goes at the bottom. |

Where the text sits along its band is the *style* property `align` (`start`, `middle`, `end`) of `chartTitle`, `chartSubtitle` or `chartCaption`:

```tsx live title="A centred title and a footnote" height=260
import { Axis, CartesianPlane, Chart, ChartTitle, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme} style={{ chartTitle: { align: 'middle' }, chartCaption: { align: 'end' } }}>
    <ChartTitle text="Server response time" />
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left" title="ms"><LinearScale /></Axis>
      <DomainSeries name="p95">
        <FlatDataSource data={[120, 135, 128, 160, 142, 150]} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
    <ChartTitle text="p95 over six deploys" role="caption" />
  </Chart>
);
```

The title is also visible text; for what a *screen reader* is told, see `meta` in [Accessibility](accessibility.md).

## Legend

A `Legend` lists the **named series** of every plane in the chart, each as a small sample of what it draws (its line, a box, a marker) beside its name, in the series' own look. A series with no `name` is not listed.

| Attribute | Meaning |
|---|---|
| `side` | The edge of the chart: `top`, `right`, `bottom`, `left`. Default `right`. |
| `orientation` | `'vertical'` or `'horizontal'`. Default: along its side (a column at left and right, a row at top and bottom). |
| `title` | A heading above the entries. |
| `toggle` | Clicking an entry hides or shows its series (it sets the series' `visible`). Default `true`. |

Each entry is a button for the keyboard too: Tab reaches it, Enter or Space presses it, and a ring shows where focus is. A hidden series' entry is dimmed.

```tsx live title="A horizontal legend with a title" height=260
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const line = (name: string, data: number[]) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <LinePath><LinearCurve /></LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {line('Series one', [3, 5, 4, 6])}
      {line('Series two', [6, 4, 5, 2])}
    </CartesianPlane>
    <Legend side="top" title="Experiments" />
  </Chart>
);
```

The legend is a child of the chart, not of a plane, so it lists the series of all of them.

## Annotations

Annotations live in a plane and are placed in *data* terms, so they stay on the right value when the axes change or the view is zoomed.

### `LineAnnotation`: a reference line

Give exactly one of:

| Attributes | The line |
|---|---|
| `value` | A constant value across the whole domain: horizontal on a rectangle. |
| `domain` | A constant position along the domain, across the whole value range: vertical on a rectangle, a spoke on a radial plane. |
| `from` and `to` | Straight between two `[domain, value]` points in data space: a diagonal. |

Plus `label` (text beside the line), `stroke`, `strokeWidth` (or the `annotationLine` style), and `domainAxis`/`valueAxis` (default: the plane's first axes, as for a series). Where the label sits along the line is the style property `align` of `annotationLabel`.

The line is **traced** through the plane with as few points as it allows: two when it stays straight (anything axis-aligned on a rectangle, a diagonal between linear scales), enough to follow the curve otherwise (a circle on a polar plane; a diagonal on a log axis is a curve), and for a radar just the corners, at its spokes. It is clipped to the plot; its label is not.

### `CalloutAnnotation`: a note on a point

A note attached to a data point by an arm.

| Attribute | Meaning |
|---|---|
| `domain`, `value` | **Required.** The point, in data space. |
| `text` | **Required.** What it says. A `'\n'` starts another line; `align` (style) says how the lines sit in the box. |
| `dx`, `dy` | Where the middle of the box is, in pixels from the point. Leave both out for automatic placement; give either (the other is 0) to place it yourself. |

With no offset, the box is tried in the eight directions round the point and the spot with the least trouble wins: parts of the box outside the plot, series points under it, and earlier callouts it would cover, with a slight preference for the upper right. It is a heuristic, which is why `dx` and `dy` exist. Callouts keep clear of one another, in order.

Its look is four selectors (`calloutText`, `calloutBox`, `calloutArm`, and the metrics `callout`); `outline` in `callout` chooses between a full border, only the edge the arm meets, or none.

```tsx live title="A trend line and two callouts" height=300
import { Axis, CalloutAnnotation, CartesianPlane, Chart, CircleMarker, DomainSeries, FlatDataSource, LineAnnotation, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const data = [10, 13, 12, 17, 15, 21, 19, 24, 30, 26];

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left" include={[0]}><LinearScale /></Axis>
      <DomainSeries name="Sales">
        <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
        <CircleMarker size={3} />
      </DomainSeries>
      <LineAnnotation from={[0, 10]} to={[9, 28]} label="Trend" stroke="#888" style-annotationLabel-align="end" />
      <CalloutAnnotation domain={8} value={30} text={'Record\nquarter'} />
      <CalloutAnnotation domain={4} value={15} text="Outage" dx={0} dy={50} />
    </CartesianPlane>
  </Chart>
);
```

Both are plane children, so they are drawn above the series that come before them and below those after: put them last to have them on top.

### `PointAnnotations`: notes on chosen points

A `CalloutAnnotation` is one note at a point you name. `PointAnnotations` writes a note beside **each point of a series that you choose**, with the words and the choice both in your hands: the value and month on every negative bar of a report, the share on every segment of a pie.

**What it is for:** flexible labels on a small number of points. Each note is drawn from nodes of its own with its text measured, so it is meant for tens of points, and `maxCount` (default 40) stops it there. **What it is not for:** labelling every point of a large series (that is what a [tooltip](interaction.md) is for), or a layout that promises notes never touch (`placement="auto"` looks for a clear place; nothing more).

| Attribute | Meaning |
|---|---|
| `text` | **Required.** A function from a point to its note: `(hit, words) => string`. Return `null` (or an empty string) for a point that gets no note: that is how you filter. `hit` is what a tooltip's `format` is given (`hit.first`, `hit.second`, `hit.row` for the source row, `hit.channels`, `hit.series`) and `words` is its two coordinates written by their axes (`words.first`, `words.second`). A `'\n'` starts another line. |
| `anchor` | The renderer that says where each point is, by `id`: a bar's note goes beyond the far end of the bar, a marker's beside the marker, a ring segment's on its rim. It also says which series. |
| `series` | A series, by `id`, when there is no `anchor` (the notes go beside its points). Default: the anchor's series, else the plane's first. |
| `shape` | `'box'` (default), `'text'` for the words alone, or `'callout'` for a box with an arm to the point. |
| `placement` | `'outside'` (default) beyond the anchor, away from what is drawn there (on a polar plane, a plain point leads out from the middle); `'inside'` towards the foot; `'center'` with the middle of the note on the anchor (a name on a point, a value in a segment); `'auto'` tries the eight directions and takes the clearest. |
| `offset`, `contain` | Pixels from the anchor; and whether a note is kept within the plot (default) or may spill into the chart's padding. |
| `maxCount` | The most notes drawn. The `omitted` property says how many points had one and were left out. |
| `aria` | `'hidden'` (default) keeps the notes from assistive technology, for when they repeat what the chart's table and summary say; `'text'` lets them be read, for when `text` carries something those do not. |

It is a plane child, so it goes after the series and draws over all of them. It looks like a callout (`calloutText`, `calloutBox`, `calloutArm`, `callout`). `text` is called for every point of the series on each draw, so keep it cheap, and return the same function each time (in React, memoize it).

```tsx live title="Negative bars called out with their value and month" height=320
import { Axis, BandScale, BarPath, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinearScale, PointAnnotations, lightTheme } from 'inkplot';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
const profit = [12, -4, 9, -7, 15, 6, -2, 11];

export default () => (
  <Chart theme={lightTheme} padding={20}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={months} /></Axis>
      <Axis orientation="left" min={-12} max={18}><LinearScale /></Axis>
      <DomainSeries name="Profit">
        <FlatDataSource data={profit} regularDomain-start={0} regularDomain-step={1} />
        <BarPath id="bars" />
      </DomainSeries>
      <PointAnnotations
        anchor="bars"
        shape="callout"
        text={(hit, words) => (hit.second < 0 ? `${words.second}\n${months[hit.first]}` : null)}
      />
    </CartesianPlane>
  </Chart>
);
```

For a pie or ring chart, one `PointAnnotations` per series puts each segment's value on its rim. The chart needs padding for labels outside the circle, and `contain={false}` lets them leave the plot:

```tsx live title="A pie with the share on each segment" height=340
import { Axis, BandScale, BarPath, Chart, DomainSeries, FlatDataSource, LinearScale, PointAnnotations, PolarPlane, Stack, lightTheme } from 'inkplot';

const shares = { Mobile: 60, Desktop: 28, Other: 12 };

const segment = (name: keyof typeof shares) => (
  <DomainSeries name={name} domainAxis="ring" valueAxis="share">
    <FlatDataSource data={[shares[name]]} regularDomain-start={0} regularDomain-step={1} />
    <BarPath id={name} />
  </DomainSeries>
);
const label = (name: keyof typeof shares) => (
  <PointAnnotations anchor={name} shape="text" contain={false} text={(hit) => `${name} ${hit.second}%`} />
);

export default () => (
  <Chart theme={lightTheme} padding={70}>
    <PolarPlane gridlines={false}>
      <Axis id="share" orientation="angle" min={0} max={1} visible={false}><LinearScale /></Axis>
      <Axis id="ring" orientation="radius" visible={false}><BandScale categories={['2024']} /></Axis>
      <Stack mode="normalize">
        {segment('Mobile')}
        {segment('Desktop')}
        {segment('Other')}
      </Stack>
      {label('Mobile')}
      {label('Desktop')}
      {label('Other')}
    </PolarPlane>
  </Chart>
);
```

`PointAnnotations`, like the plane's other annotations, is built from smaller parts that stay available: a renderer's `anchors()` (where each point's note goes), the callout drawing, and the tooltip's `Hit`. It is a convenience for the common case, not the only way to put words on a chart.

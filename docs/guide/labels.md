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

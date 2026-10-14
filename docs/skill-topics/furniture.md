# inkplot topic: title, legend, annotations, accessibility

For: a chart title or caption, a legend, reference lines and callouts, an accessible name and summary.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Example

```tsx check title="Title, legend, reference line and callout"
/** @jsxImportSource inkplot */
import { Axis, CalloutAnnotation, CartesianPlane, Chart, ChartTitle, DomainSeries, FlatDataSource, Legend, LineAnnotation, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const line = (name: string, data: number[]) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={1} regularDomain-step={1} />
    <LinePath><LinearCurve /></LinePath>
  </DomainSeries>
);

export const chart = (
  <Chart theme={lightTheme} meta-title="Sales by month" meta-description="Two years of monthly sales, 2024 above 2023.">
    <ChartTitle text="Monthly sales" />
    <ChartTitle text="Source: internal ledger" role="caption" side="bottom" />
    <CartesianPlane>
      <Axis orientation="bottom" title="Month"><LinearScale /></Axis>
      <Axis orientation="left" title="Sales (k)"><LinearScale /></Axis>
      {line('2023', [12, 15, 14, 18, 22, 25])}
      {line('2024', [14, 18, 17, 21, 26, 30])}
      <LineAnnotation value={20} label="Target" />
      <CalloutAnnotation domain={6} value={30} text="Best month" />
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
) as Chart;
```

`ChartTitle` and `Legend` are children of the **chart**; the annotations are children of the **plane**. `role="caption"` makes a smaller title; `side` puts it on another edge. Series appear in the legend by `name`; `toggle` lets a click hide one. `meta-title` and `meta-description` on the `Chart` are its accessible name and description; `<ChartSummary />` makes a spoken summary from the data.
## Notes

- `Legend` and the keys: `side` is `'top'`, `'right'`, `'bottom'` or `'left'`; `orientation` is `'horizontal'` or `'vertical'`.

| To… | Use |
|---|---|
| Title / caption | `<ChartTitle text="…" />`, `<ChartTitle text="…" role="caption" />` |
| Accessible name | `meta-title`, `meta-description` on the `Chart`; `<ChartSummary />` for an automatic one |
| A note on chosen points (the negative bars, a pie's segments) | `<PointAnnotations anchor="bars" text={(hit, words) => (hit.second < 0 ? words.second : null)} />` as a **plane** child after the series; `anchor` is the `id` of the series' renderer (`<BarPath id="bars" />`), which says where each note goes. For tens of points, not thousands: it is not a tooltip |

## Attributes of this topic's elements

An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`.

<!-- api:start -->
### ChartTitle

Text across the top or bottom: a title, subtitle or caption.

**In** Chart · **Holds** none

| Attribute | Type | |
|---|---|---|
| `text` (required) | `string` | The words. |
| `role` | `TitleRole` | What it is, which decides its look and (unless `side` says) where it goes. Default 'title'. |
| `side` | `'top' \| 'bottom'` | The edge it spans. Default: the top, except for a caption, which goes at the bottom. |

### Legend

Lists the named series; click to hide or show.

**In** Chart · **Holds** none

| Attribute | Type | |
|---|---|---|
| `side` | `Side` | The edge of the chart it sits along. Default 'right' ('left' in a chart that reads right to left). |
| `orientation` | `'vertical' \| 'horizontal'` | Entries in a column or a row. Default: along its side, so a column on the left and right, a row on the top and bottom. |
| `title` | `string` | A heading above the entries. |
| `toggle` | `boolean` | Clicking an entry hides or shows its series. Default true. |

### ChartSummary

A spoken summary of the chart, for screen readers (English, replaceable).

**In** Chart · **Holds** none

| Attribute | Type | |
|---|---|---|
| `text` | `(facts: ChartFacts) => string` | Words the facts. Default: English sentences. |
| `roleDescription` | `string` | What the chart is, as a screen reader announces it. Default 'chart'. |

### LineAnnotation

A reference line in data terms.

**In** a plane · **Holds** none

| Attribute | Type | |
|---|---|---|
| `value` | `number` | A horizontal line at this value (give one of `value`, `domain`, or `from` and `to`). |
| `domain` | `number` | A vertical line at this domain (give one of `value`, `domain`, or `from` and `to`). |
| `from` | `readonly [domain: number, value: number]` | One end of a diagonal line, as `[domain, value]` (with `to`). |
| `to` | `readonly [domain: number, value: number]` | The other end of a diagonal line, as `[domain, value]` (with `from`). |
| `domainAxis` | `ElementRef<Axis>` | Default: the plane's first axis, as for a series. |
| `valueAxis` | `ElementRef<Axis>` | Default: the plane's second axis. |
| `label` | `string` | Text beside the line. |
| `stroke` | `string` | Line colour: the same as `style: { annotationLine: { color } }`, set directly. |
| `strokeWidth` | `number` | Line width in pixels: the same as `style: { annotationLine: { width } }`, set directly. |

### CalloutAnnotation

A note attached to a data point.

**In** a plane · **Holds** none

| Attribute | Type | |
|---|---|---|
| `domainAxis` | `ElementRef<Axis>` | Default: the plane's first axis. |
| `valueAxis` | `ElementRef<Axis>` | Default: the plane's second axis. |
| `domain` (required) | `number` | The point being called out, in data space. |
| `value` (required) | `number` | The value of the point being called out. |
| `text` (required) | `string` | What it says. |
| `dx` | `number` | Where the middle of the box is, in pixels from the point. |
| `dy` | `number` | Pixels down from the point to the text box (negative is up). |

### PointAnnotations

A note beside each chosen point: its words, a box or a callout.

**In** a plane · **Holds** none

| Attribute | Type | |
|---|---|---|
| `text` (required) | `(hit: Hit, words: PointWords) => string \| null \| undefined` | What a point's note says, or nothing (`null`, `undefined` or an empty string) for a point that gets none. |
| `anchor` | `ElementRef<AnySeriesRenderer>` | The renderer that says where each point is, and so which series the notes are for: its id, or the element. |
| `series` | `ElementRef<Series>` | The series, when there is no `anchor` (the notes then go beside the series' points), or to say which series when the anchor is not enough. Default: the anchor's series, else the plane's first. |
| `contain` | `boolean` | Keep every note within the plot. Default true. |
| `shape` | `'text' \| 'box' \| 'callout'` | What is drawn: just 'text', 'box' (text in a box, the default) or a 'callout' (a box with an arm to the point). |
| `placement` | `'outside' \| 'inside' \| 'auto'` | Where a note goes from its anchor. 'outside' (the default) beyond it, away from what is drawn there (above the end of a bar that grows up, below one that grows down); 'inside' at it, towards the foot; 'auto' tries the eight directions round the point and takes the spot with the least in the way, as a `CalloutAnnotation` does. |
| `offset` | `number` | Pixels between a note and its anchor. Default: the callout's own `offset`. |
| `maxCount` | `number` | The most notes drawn; further points that have one are left out (`omitted` says how many). Default 40. |
| `aria` | `'hidden' \| 'text'` | Whether assistive technology reads the notes. 'hidden' (the default) when they repeat what the chart's table and summary say; 'text' when `text` carries something they do not, which is for you to judge. |
<!-- api:end -->

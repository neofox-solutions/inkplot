# Charts

`Chart` is the root of every tree. It holds the theme, owns the drawing, and is the one element that knows about the platform. Everything else is a child of it: planes, titles, legends, keys, a cursor.

```tsx live title="A chart with a title, subtitle and caption" height=300
import { Axis, CartesianPlane, Chart, ChartTitle, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme} padding={16}>
    <ChartTitle text="Monthly active users" />
    <ChartTitle text="Since the relaunch" role="subtitle" />
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left" include={[0]}><LinearScale /></Axis>
      <DomainSeries name="Users">
        <FlatDataSource data={[120, 180, 260, 340, 410, 520]} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
    <ChartTitle text="Source: product analytics" role="caption" />
  </Chart>
);
```

## Attributes

| Attribute | Type | Meaning |
|---|---|---|
| `theme` | `BaseTheme` | **Required.** Every default look. `lightTheme`, `darkTheme`, or your own ([Styling](styling.md)). A chart bundles exactly the theme it names. |
| `width`, `height` | number | The size of the drawing in pixels. Default: whatever the platform reports (a browser container's size), followed as it changes. |
| `padding` | number or `{ top, right, bottom, left }` | Margin round everything, in pixels. One number for all sides, or any subset of the four. Default 10. |
| `measureText` | `(text, font) => width` | Replaces the platform's text measuring, for a font the platform cannot see. |
| `locale` | BCP 47 tag | How numbers and dates are written (`'de'`, `'fr-CA'`): digit grouping, the decimal mark, month names. Axes and time scales with no `locale` of their own use it. Default: plain digits and a point. See [locale](axes.md#locale). |
| `direction` | `'ltr'` \| `'rtl'` | `'rtl'` lays the chart out for a right-to-left script ([below](#right-to-left)). Default `'ltr'`. |
| `onFlush` | `(stats) => void` | Called after every flush with its statistics. |
| `id`, `meta`, `visible`, `style` | | As on every element. |

## What goes in a chart

| Child | What it is | Page |
|---|---|---|
| `CartesianPlane`, `PolarPlane`, `RadarPlane` | A coordinate space, holding axes and series. A chart may have several. | [Planes](planes.md) |
| `ChartTitle` | A title, subtitle or caption. | [Labels and annotations](labels.md) |
| `Legend` | The named series, as a key. Clicking an entry hides the series. | [Labels and annotations](labels.md) |
| `ColorAxis`, `SizeAxis` | Mapped dimensions: data to colour or size. | [Mapped dimensions](mapped.md) |
| `ColorKey`, `SizeKey` | A key beside the chart that shows what a mapped dimension means. | [Mapped dimensions](mapped.md) |
| `Cursor` | Finds what the pointer or keyboard is on; holds a `Crosshair` and `ChartTooltip`. | [Interaction](interaction.md) |
| `ChartSummary` | A generated text description for screen readers. | [Accessibility](accessibility.md) |

**Layout.** Furniture takes room from the edge it sits on: titles at the top and bottom (several on one edge stack, in order, outwards), a legend or key on its `side`. The planes get whatever is left. Every plane is given all of it, so several planes **overlay** one another (each draws its own axes); to put charts side by side, use more than one `Chart`.

## Right to left

(Part of [Locales and languages](i18n.md).)

`direction="rtl"` mirrors the chart's layout for Arabic, Hebrew and the other right-to-left scripts. It changes only the **defaults** that depend on which way the page reads:

- the first vertical axis is on the **right** (the second on the left), and a horizontal axis runs **from the right**, so the first category or the earliest date is at the right edge;
- a `Legend` or a colour or size key is on the **left**;
- a title starts at the **right**.

Anything you place yourself stays where you put it: an axis with an `orientation`, an `inverted` you set (including `inverted={false}`), a `side` on a legend. The chart shortcuts (`lineChart`, `barChart`) set none of these, so they follow `direction` too.

What it does not do: the **text itself**. A label in Arabic or Hebrew is set right to left by the browser (and, in an SVG string, by whatever shows it) whatever the chart's direction, and every label sits where its axis puts it, so nothing here needs a font or a shaping engine. A label that mixes scripts (an Arabic name with a Latin year) is ordered by the usual rules for a left-to-right paragraph; put a right-to-left mark (U+200F) at its start if you want the other order. The rows of a legend keep their sample on the left of the name, and a polar plane keeps its angle running clockwise. Pair it with `locale` for the digits and the date format (what a locale writes, such as the digits it uses, is up to the platform's `Intl`).

```tsx check title="A chart for a right-to-left script"
import { barChart, FlatDataSource, Legend, ChartTitle, lightTheme } from 'inkplot';

const rows = (data: number[]) => new FlatDataSource({ data, regularDomain: { start: 0, step: 1 } });
export const chart = barChart(
  [{ name: 'المبيعات', source: rows([4, 7, 5, 9]) }],
  {
    theme: lightTheme,
    direction: 'rtl',
    locale: 'ar',
    categories: ['الربع الأول', 'الربع الثاني', 'الربع الثالث', 'الربع الرابع'],
    extras: [new ChartTitle({ text: 'المبيعات حسب الربع' }), new Legend({})],
  },
);
```

## Size

By default a chart is as big as its container, and follows it. To fix it, set `width` and `height`:

```tsx
<Chart theme={lightTheme} width={640} height={360}>…</Chart>
```

On a `DOMPlatform` you can also give the platform a fixed `size` (see [Rendering](rendering.md)), and `toSvgString(chart, { width, height })` takes one for a single drawing.

## Attaching, drawing, detaching

Building a chart has no side effects: it is only a tree. These make it live:

| Call | What it does |
|---|---|
| `chart.attach(platform)` | Connect the tree to a platform. Draws on the next frame (or when you call `flush()` on a platform with no scheduler). Returns the chart. |
| `chart.flush()` | Layout and paint now. Returns `FlushStats`. Needed only without a scheduler. |
| `chart.detach()` | Take the drawing out of the platform and unsubscribe. The tree is kept; attach again to show it. |
| `chart.platform` | The attached platform, or `null`. |
| `chart.lastFlush` | The statistics of the last flush, or `null`. |
| `chart.needsFlush` | True from any change until the next flush. |

A chart is attached to one platform at a time. It redraws by itself on any change ([Concepts](../start/concepts.md#5-drawing-happens-on-a-platform-a-frame-at-a-time)).

## What a flush costs: `FlushStats`

Pass `onFlush` to see what each redraw did:

```ts check title="Reading flush statistics"
import { Chart, lightTheme } from 'inkplot';

export const chart = new Chart({
  theme: lightTheme,
  onFlush: (stats) => {
    console.log(`${stats.total.toFixed(1)} ms; wrote ${stats.attributeWrites} attributes, skipped ${stats.attributeWritesSkipped}`);
    console.log(`${stats.pointsIn} points read, ${stats.pointsDrawn} drawn, ${stats.pathBytes} bytes of path data`);
  },
});
```

| Field | Meaning |
|---|---|
| `total` | Milliseconds for the whole flush. |
| `stages` | Milliseconds by stage of the data pipeline: `generate`, `decimate`, `normalize`, `place`, `path`. |
| `filled`, `fillsCached` | Series that read their data this flush, and series that reused the last read. |
| `projected` | Series that were placed in pixels this flush. |
| `attributeWrites`, `attributeWritesSkipped` | Attributes written to the platform, and writes skipped because the value had not changed. A change that moves nothing on screen shows `attributeWrites: 0`. |
| `attributesWritten` | Their names. |
| `pointsIn`, `pointsDrawn` | Points read from the data, and points that were drawn (the difference is [decimation](data.md#decimation)). |
| `pathBytes` | Total length of the path data written. |

## Drawing to a string

`toSvgString(chart, size?)` attaches a string platform, flushes once, and detaches. It is the way to render on a server or in a test ([Rendering](rendering.md)).

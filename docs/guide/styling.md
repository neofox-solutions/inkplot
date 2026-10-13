# Styling

Every colour, size and font in a chart is a **style property** of a named **selector**. The chart's **theme** sets them all; any element can override some with a `style` attribute, and a few common ones are plain attributes. By default the chart paints no background: it sits on your page. Set `chart.background` to fill the whole drawing.

## Why selectors

A chart has dozens of things that can be styled (tick labels, titles, gridlines, markers…) and every new element adds more. A theme therefore maps *selectors* (names for kinds of thing) to bags of style properties. A user can restyle a whole family at once (`text`) or one member (`tickLabel`), and a new element needs a new selector and no change to the theme.

```tsx live title="Restyling by selector" height=280
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme} style={{ text: { family: 'Georgia, serif' }, gridline: { color: '#f0e6d8', dash: '2 3' } }}>
    <CartesianPlane>
      <Axis orientation="bottom" style={{ tickLabel: { size: 13, weight: 600 } }}><LinearScale /></Axis>
      <Axis orientation="left" title="Price" style={{ axisTitle: { color: '#a0522d', size: 14 } }}><LinearScale /></Axis>
      <DomainSeries name="Price">
        <FlatDataSource data={[4, 6, 5, 8, 7, 9]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath stroke="#a0522d" strokeWidth={3}><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

## How a look is decided

An element asks for its look with a **chain** of selectors, most specific first, ending in a **root**. A tick label asks for `['tickLabel', 'axis', 'text']`: "tick label text, else axis text, else any text". Each *property* is found independently, by the first of these that defines it:

1. **The element's own attributes**: the common ones, such as `stroke`, `strokeWidth`, `fill`, `opacity`, which are exactly the style properties of the same name. Setting them directly beats any block.
2. **The `style` blocks** of the element, then of each ancestor up to the chart, nearest first. Inside one block the chain is tried in order, so `tickLabel` beats `axis` beats `text`.
3. **The chart's base theme**, the same way, except that the element's **accent** (the colour its series was given from the palette) is tried just before the root. So the palette is the default colour, and anything that names the colour beats it.

**Nearest wins.** A block you write close to an element beats the whole of the base theme, however specific the base theme's selector was: `style={{ text: { color: 'red' } }}` on a plane really does make all text in that plane red, even though the theme sets `tickLabel` and `axisTitle` more specifically. The price: to override one *specific* selector against a *nearer general* one, set the specific one at that level too.

## The selectors

The properties each selector can set come in a few kinds.

| Kind | Properties |
|---|---|
| Text (`TextProps`) | `size`, `color`, `family`, `weight`, `halo` (a colour drawn round the glyphs, to keep them legible over data), `haloWidth`, `align` (`start`, `middle`, `end`: where text sits in the room it has: a title along its band, a callout's lines in its box, a line annotation's label along its line. Text placed at a point by its own geometry, such as tick labels, ignores it) |
| Line (`LineProps`) | `color`, `width`, `dash` (an SVG dash pattern or `'none'`), `opacity` |
| Shape (`ShapeProps`) | `fill`, `stroke` (may be `'none'`), `strokeWidth`, `opacity` |
| Axis metrics | `tickLength`, `labelGap`, `spacing` (padding round the title and after the axis) |
| Marker metrics | `size` |
| Callout metrics | `padding`, `outline` (`'box'`, `'edge'`, `'none'`), `offset`, `pointer` |

| Selector | What it styles | Kind |
|---|---|---|
| `text`, `line`, `shape` | The roots: everything of that kind | text, line, shape |
| `axis` | An axis: its colour reaches labels, line and ticks alike | axis metrics, text, line |
| `axisLine`, `tickLabel`, `axisTitle` | The axis line; tick labels; an axis title | line, text, text |
| `gridline`, `frame` | Gridlines; the border round a plot | line |
| `seriesLine`, `seriesArea`, `seriesBar` | A line renderer; an area renderer; a bar renderer | line, shape, shape |
| `marker`, `dotMarker`, `lineMarker`, `shapeMarker` | Markers: all, and by kind | marker metrics and shape |
| `annotationLine`, `annotationLabel` | A reference line and its label | line, text |
| `callout`, `calloutBox`, `calloutArm`, `calloutText` | A callout's metrics, box, arm and text | |
| `tooltip`, `tooltipBox`, `tooltipText` | A tooltip, falling back to the callout's | |
| `crosshair` | A crosshair's lines | line |
| `focusRing` | The outline round what has keyboard focus | line |
| `chartTitle`, `chartSubtitle`, `chartCaption` | Titles by role | text |
| `legend`, `legendTitle`, `legendLabel` | A legend | text |
| `key`, `keyTitle`, `keyLabel`, `keyLine` | A colour or size key | text, line |
| `chart` | The chart itself: `background` is a colour for a rectangle filling the whole drawing, beneath everything. Unset, nothing is painted. Set on the chart's `style` or in the theme; it is the only selector that is not a text, line or shape | `background` |

A dash pattern is style only (`style={{ seriesLine: { dash: '4 2' } }}`): it is not an attribute of the line renderer.

## The theme

A `BaseTheme` is a complete theme: every root fully defined, plus the **palette**, the colours series take in turn. Its type is a `Theme` (selectors with some properties each) and:

```ts
interface BaseTheme extends Theme {
  palette: readonly string[];
  text: TextProps; line: LineProps; shape: ShapeProps;     // every property defined
  axis: AxisMetrics; marker: MarkerMetrics; callout: CalloutMetrics;
}
```

The theme must define every property of every root, and every chain ends in a root, so there is always a value to find. `lightTheme` and `darkTheme` are included. Each is a plain object in its own module, so a bundle that names only one leaves the other out.

**Making your own**: derive it. `extendTheme(base, patch)` merges each selector in the patch over the same one in the base, property by property.

```tsx live title="A brand theme derived from the light theme" height=280
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, extendTheme, lightTheme } from 'inkplot';

const brand = extendTheme(lightTheme, {
  palette: ['#d6336c', '#7048e8', '#0b7285', '#e67700'],
  text: { family: 'Georgia, serif', color: '#3b2f2f' },
  gridline: { color: '#f3e5ec' },
  seriesLine: { width: 2.5 },
});

const line = (name: string, data: number[]) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <LinePath><LinearCurve /></LinePath>
  </DomainSeries>
);

export default () => (
  <Chart theme={brand}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      {line('Rose', [2, 4, 3, 6, 5])}
      {line('Violet', [5, 3, 4, 2, 4])}
      {line('Teal', [3, 3, 5, 4, 7])}
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
);
```

**Switching themes** is a single attribute: `chart.setAttribute('theme', darkTheme)`, for a page that follows the system's colour scheme. The chart redraws with the new look and keeps its state (a zoom, hidden series).

```ts check title="Following the system colour scheme"
import { Chart, darkTheme, lightTheme } from 'inkplot';

export function followScheme(chart: Chart): () => void {
  const query = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => chart.setAttribute('theme', query.matches ? darkTheme : lightTheme);
  apply();
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}
```

## The series' colours

Series colours come from `theme.palette`, by position among the plane's series, and the *accent* mechanism means:

- a renderer's own `stroke` or `fill` beats it (`<LinePath stroke="crimson">`);
- so does any `style` block that names the colour;
- `color` on a legend, a tooltip and a key follows the series' first renderer, so a series coloured by hand is the same colour everywhere.

## In markup

In JSX, hyphens nest: `style-tickLabel-size={12}` is `style: { tickLabel: { size: 12 } }`. In HTML the attribute names are lowercase, and the adapter finds the real names from a list (`STYLE_NAMES`): `style-ticklabel-size="12"`. A selector you add yourself is given to `defineElements` as `names`.

## Styling by CSS

A chart draws with SVG presentation attributes (`stroke`, `fill`, `font-size`…), not with classes and a stylesheet. So the output is self-contained (a string you can save as a file looks the same anywhere) and your page's CSS does not reach into it; style a chart through the theme, `style`, and attributes. A Web Components chart draws inside a shadow root, which is the same rule enforced.

## Adding a selector

A custom element joins in by augmenting the `Selectors` interface and asking for its look with a chain: see [Custom elements](../extending/custom-elements.md#styling).

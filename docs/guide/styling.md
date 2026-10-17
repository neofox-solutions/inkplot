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

The theme must define every property of every root, and every chain ends in a root, so there is always a value to find. `lightTheme` and `darkTheme` are included, with an [accessible](#accessible-themes) version of each. Each is a plain object in its own module, so a bundle that names only one leaves the other out.

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

## Accessible themes

`accessibleTheme` and `accessibleDarkTheme` are the light and dark themes made for readers who need more from a chart:

- text is larger (14 where the others have 11) and set in **OpenDyslexic** if the page has it, then Atkinson Hyperlegible or Lexend, then the system font. The library does not ship a font: load OpenDyslexic with `@font-face` (or have it installed) and the theme picks it up;
- text and lines are near black on white (or near white on dark), over 15:1;
- lines, markers, error bars and outlines are thicker, and ticks are longer;
- the palette is six colours, each over 3:1 against the page (the WCAG 1.4.11 minimum for graphics), chosen from colour-blind-safe hues so that they differ in lightness as well as hue.

Use one like any other theme (`<Chart theme={accessibleTheme}>`), or derive from it with `extendTheme`. The sizes are for a chart seen at its own size, so a small chart in this theme has less room for its data. Colour is still not enough: see [Patterns](#pattern-fills).

## Pattern fills

A **pattern** fills a shape with lines or dots instead of a flat colour, so that series can be told apart on a grey screen, in print, or without seeing the colours. A pattern is an element of the **chart** (a child of `Chart`, or of a `ChartGroupItem`; it is not a child of a plane) with an `id`, and it is named the way SVG names it: `url(#id)`, in `fill` or in any style that takes a colour.

```tsx live title="A pattern for each series" height=300
import { Axis, BandScale, BarPath, CartesianPlane, Chart, DomainSeries, DotPattern, FlatDataSource, HatchPattern, Legend, LinePattern, LinearScale, Stack, checkerboard, lightTheme } from 'inkplot';

const series = (name: string, data: number[], fill: string) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <BarPath fill={fill} />
  </DomainSeries>
);

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['Q1', 'Q2', 'Q3', 'Q4']} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <Stack mode="group">
        {series('Lines', [30, 38, 35, 50], 'url(#lines)')}
        {series('Hatch', [22, 27, 31, 36], 'url(#hatch)')}
        {series('Dots', [14, 20, 16, 23], 'url(#dots)')}
        {series('Checks', [8, 11, 9, 14], 'url(#checks)')}
      </Stack>
    </CartesianPlane>
    <Legend side="bottom" />
    <LinePattern id="lines" angle={45} spacing={7} strokeWidth={2} />
    <HatchPattern id="hatch" spacing={8} strokeWidth={1.5} />
    <DotPattern id="dots" strokeWidth={3} gapX={4} />
    <DotPattern id="checks" {...checkerboard(4)} />
  </Chart>
);
```

| Pattern | Draws | Attributes |
|---|---|---|
| `LinePattern` | parallel lines | `angle` (degrees clockwise from the x axis, default 45), `spacing` (between lines, default 6), `dash` (an SVG dash array in pixels, such as `'6 3'`) |
| `HatchPattern` | two sets of lines that cross | the same, and `crossAngle` (default -45, so the two cross at right angles) |
| `DotPattern` | rows of dots | `cap` (`'round'` or `'square'`), `gapX` and `gapY` (the room between dots, edge to edge), `offset` (how far every other row is shifted along; the default staggers them) |

All of them take `stroke`, `fill` (the background of the tile, default none) and `strokeWidth` (the thickness of a line, or the width of a dot). A **checkerboard** is square dots whose size, both gaps and offset are the same number: `checkerboard(size)` gives those attributes.

**The colour.** Without a `stroke`, a pattern is drawn in the colour of the series that uses it: each series gets its own copy in its own palette colour, so one `HatchPattern` serves them all, the legend swatches match the bars, and a change of theme changes the pattern. Give the pattern a `stroke` and it is that colour wherever it is used. Under the hood the style resolver sees a paint of the form `url(#id)`, finds the pattern of that `id` that is nearest in the chart, and asks it for the paint to use; a `url(#id)` that names no pattern here is left as it is, so SVG you wrote yourself still works.

**Your own.** `linePattern(surface, node, key, options)` and `dotPattern(...)` are the two functions the patterns above call: a pattern of your own is a subclass of `Pattern` whose `drawTile` calls one of them (or both, in a pattern that alternates), or draws anything else into the tile (an image, glyphs). The tile of a line pattern is one cell of the lattice the lines make, so it repeats exactly at any angle and a dash array is fitted to it (a whole number of cycles each a little longer or shorter than you asked); a crosshatch of two angles shares one tile.

**Pie slices** are bars, so a slice's `color` can be a pattern too: `{ name: 'Mobile', value: 60, color: 'url(#hatch)' }`, with the pattern in the shortcut's `extras`.

**Two things to know.** An `id` is looked up from the element that uses it, outward, so put patterns on the chart; the same `id` on two patterns in different charts of a group is two patterns, but in one SVG their ids are one namespace. And a pattern is a paint: it can be the `fill` of a bar, an area, a marker, a box or a heat cell, but a line's `color` is a stroke, which draws a pattern as a thin line of lines; use it on the thick strokes of an outline.

## In markup

In JSX, hyphens nest: `style-tickLabel-size={12}` is `style: { tickLabel: { size: 12 } }`. In HTML the attribute names are lowercase, and the adapter finds the real names from a list (`STYLE_NAMES`): `style-ticklabel-size="12"`. A selector you add yourself is given to `defineElements` as `names`.

## Styling by CSS

A chart draws with SVG presentation attributes (`stroke`, `fill`, `font-size`…), not with classes and a stylesheet. So the output is self-contained (a string you can save as a file looks the same anywhere) and your page's CSS does not reach into it; style a chart through the theme, `style`, and attributes. A Web Components chart draws inside a shadow root, which is the same rule enforced.

## Adding a selector

A custom element joins in by augmenting the `Selectors` interface and asking for its look with a chain: see [Custom elements](../extending/custom-elements.md#styling).

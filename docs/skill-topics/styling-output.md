# inkplot topic: themes, styling, React, export

For: dark and custom themes, styling parts, React, a PNG, chart as JSON, your own element types.

Read `SKILL.md` first (rules, template, and the attributes of `Chart`, `CartesianPlane`, `Axis`, `LinearScale`, `DomainSeries`, `FlatDataSource`, `ObjectDataSource`, `LinePath`, `LinearCurve`). This file has the rest of what this topic needs: examples, notes, and the attributes of its elements. Everything here is exported from `'inkplot'`.

## Dark theme, and styling


```tsx check title="Theme and style" dark
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, darkTheme, extendTheme } from 'inkplot';

const brand = extendTheme(darkTheme, { palette: ['#ff6b9d', '#6bcbff'], text: { family: 'Georgia, serif' } });

export const chart = (
  <Chart theme={brand} style={{ gridline: { dash: '2 3' } }}>
    <CartesianPlane>
      <Axis orientation="bottom" style-tickLabel-size={13}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="A">
        <FlatDataSource data={[3, 5, 4, 8]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath strokeWidth={3}><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
) as Chart;
```

## Accessible themes and pattern fills

`accessibleTheme` and `accessibleDarkTheme` are `lightTheme` and `darkTheme` with larger text in OpenDyslexic (if the page has it; then Atkinson Hyperlegible, Lexend or the system font), strong contrast, thicker lines, bigger markers and a palette of colours that every reach 3:1 against the page and are told apart under common colour vision differences. Colour alone is still not enough: a **pattern** puts lines or dots in a series' fill. A pattern is an element of the **chart** (not of a plane) with an `id` that is mandatory, and it is named the way SVG names it, `url(#id)`, in `fill` (or any style that takes a colour). With no `stroke` of its own, it is drawn in the colour of the series that uses it, so one pattern serves every series and follows the theme.

```tsx check title="A pattern for each series, in the accessible theme"
/** @jsxImportSource inkplot */
import { Axis, BandScale, BarPath, CartesianPlane, Chart, DomainSeries, DotPattern, FlatDataSource, HatchPattern, LinePattern, LinearScale, Stack, accessibleTheme } from 'inkplot';

const series = (name: string, data: number[], fill: string) => (
  <DomainSeries name={name}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} />
    <BarPath fill={fill} />
  </DomainSeries>
);

export const chart = (
  <Chart theme={accessibleTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['Q1', 'Q2', 'Q3']} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <Stack mode="group">
        {series('A', [3, 5, 4], 'url(#lines)')}
        {series('B', [2, 4, 5], 'url(#hatch)')}
        {series('C', [4, 2, 3], 'url(#dots)')}
      </Stack>
    </CartesianPlane>
    <LinePattern id="lines" angle={45} spacing={6} strokeWidth={2} />
    <HatchPattern id="hatch" spacing={7} />
    <DotPattern id="dots" strokeWidth={3} gapX={4} />
  </Chart>
) as Chart;
```

`LinePattern` takes `angle` (degrees clockwise from the x axis, default 45), `spacing` and `dash`; `HatchPattern` adds `crossAngle` (default -45); `DotPattern` takes `cap` (`'round'` or `'square'`), `gapX`, `gapY` and `offset` (how far every other row is shifted). All take `stroke`, `fill` (the tile's background) and `strokeWidth`. `checkerboard(size)` returns the `DotPattern` attributes for a checkerboard. A pattern of your own is a subclass of `Pattern` that draws its tile with `linePattern` or `dotPattern` or by hand. A `url(#id)` that names no pattern is left as it is.

## In React


Import the components from `inkplot/react`: one per built-in class, same names. For your own class, `reactWrapper(MyClass)`. The root renders a `<div>`; give it a height. Props that are plain objects and arrays (`style={{ ... }}`, `meta`, `categories`) are compared by content, so writing them inline in a render costs nothing; functions and typed arrays are compared by identity, so memoize them (`useCallback`, `useMemo`), or each render replaces them and redraws.

```tsx check title="React" jsx=react
import { lightTheme } from 'inkplot';
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale } from 'inkplot/react';

export function Trend({ values }: { values: number[] }) {
  return (
    <Chart theme={lightTheme} hostProps={{ style: { height: 300 } }}>
      <CartesianPlane>
        <Axis orientation="bottom"><LinearScale /></Axis>
        <Axis orientation="left"><LinearScale /></Axis>
        <DomainSeries name="Trend">
          <FlatDataSource data={values} regularDomain={{ start: 0, step: 1 }} />
          <LinePath><LinearCurve /></LinePath>
        </DomainSeries>
      </CartesianPlane>
    </Chart>
  );
}
```

## Notes

| To… | Use |
|---|---|
| A PNG | Browser: `await toPng(chart, { scale: 2, background: '#fff' })` (a `Blob`). Server: `toSvgString` then a WASM renderer with a font (`@resvg/resvg-wasm`; recipe "Make a PNG on a server") |
| Chart as JSON | `toJSON(chart, registry, { refs })`, `fromJSON(json, registry, { refs })` |
| Custom element that listens to the pointer, keys or focus | extend `InteractiveElement` (from `inkplot`) instead of `ChartElement`, or the chart never routes input to it |
| Show gridlines or a frame | `<CartesianPlane gridlines={false} frame>` |
| Accessible name | `meta-title`, `meta-description` on the `Chart`; `<ChartSummary />` for an automatic one |


## Attributes of this topic's elements

An attribute followed by `(required)` must be given. Every element also takes `id`, `meta`, `visible` and `style`.

<!-- api:start -->
### LinePattern

A fill of parallel lines, named in a style as `url(#id)`; takes the colour of the series that uses it.

**In** Chart · **Holds** none

| Attribute | Type | |
|---|---|---|
| `angle` | `number` | Degrees clockwise from the x axis. Default 45. |
| `spacing` | `number` | The distance between lines, in pixels. Default 6. |
| `dash` | `string` | An SVG dash array in pixels, such as '6 3'. Default none (solid). |
| `stroke` | `string` | The colour of the lines or dots. |
| `fill` | `string` | The tile's background. Default none. |
| `tint` | `number` | Without a `fill`: a background in the pattern's own colour (the series colour, if the pattern has no `stroke`) at this opacity from 0 to 1. |
| `strokeWidth` | `number` | The thickness of a line, or the width of a dot. |

### HatchPattern

A fill of two crossing sets of lines (a crosshatch), named in a style as `url(#id)`.

**In** Chart · **Holds** none

| Attribute | Type | |
|---|---|---|
| `crossAngle` | `number` | The second family of lines. Default -45, so with the default `angle` the two cross at right angles. |
| `angle` | `number` | Degrees clockwise from the x axis. Default 45. |
| `spacing` | `number` | The distance between lines, in pixels. Default 6. |
| `dash` | `string` | An SVG dash array in pixels, such as '6 3'. Default none (solid). |
| `stroke` | `string` | The colour of the lines or dots. |
| `fill` | `string` | The tile's background. Default none. |
| `tint` | `number` | Without a `fill`: a background in the pattern's own colour (the series colour, if the pattern has no `stroke`) at this opacity from 0 to 1. |
| `strokeWidth` | `number` | The thickness of a line, or the width of a dot. |

### DotPattern

A fill of rows of round or square dots (a checkerboard is square dots), named in a style as `url(#id)`.

**In** Chart · **Holds** none

| Attribute | Type | |
|---|---|---|
| `cap` | `'round' \| 'square'` |  |
| `gapX` | `number` |  |
| `gapY` | `number` |  |
| `offset` | `number` |  |
| `stroke` | `string` | The colour of the lines or dots. |
| `fill` | `string` | The tile's background. Default none. |
| `tint` | `number` | Without a `fill`: a background in the pattern's own colour (the series colour, if the pattern has no `stroke`) at this opacity from 0 to 1. |
| `strokeWidth` | `number` | The thickness of a line, or the width of a dot. |
<!-- api:end -->

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

## In React


Import the components from `inkplot/react`: one per built-in class, same names. For your own class, `reactWrapper(MyClass)`. The root renders a `<div>`; give it a height. Functions in props should be memoized.

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


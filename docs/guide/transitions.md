# Transitions

A chart can ease to its new drawing when its data changes, instead of jumping. It is **off by default**, it is a browser feature (a chart drawn to an SVG string has nothing to animate), and it uses the browser's own CSS transitions rather than an animation engine, so it costs almost nothing in code.

## Switch it on

Give the `Chart` a `transition`:

```tsx check title="Easing to new data"
/** @jsxImportSource inkplot */
import { Axis, CartesianPlane, Chart, DOMPlatform, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const data = new Float64Array([3, 5, 4, 8, 6]);
const source = <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={1} /> as FlatDataSource;

export const chart = (
  <Chart theme={lightTheme} transition={{ duration: 300, easing: 'ease-in-out' }}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left" min={0} max={10}><LinearScale /></Axis>
      <DomainSeries name="Rainfall">
        {source}
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
) as Chart;

export function show(host: HTMLElement) {
  chart.attach(new DOMPlatform(host));
  data[2] = 9;          // edit the data in place…
  source.invalidate();  // …and say so: the line moves to its new shape over 300 ms
}
```

`duration` is in milliseconds (default 250) and `easing` is any CSS timing function: `'ease-out'` (the default), `'linear'`, `'cubic-bezier(0.3, 0, 0.2, 1)'`.

## What eases, and what does not

- **What is eased:** the colours, opacity, stroke widths and **shapes of paths**: a line, an area, the bars of a series, the markers. A bar chart whose values change grows and shrinks; a line moves to its new points.
- **Only a change to the data eases.** Panning, zooming, a box zoom, resizing and the cursor and tooltip are immediate, because easing them would make the chart lag behind your hand. If one of them happens while a transition is running, the transition ends where it is.
- **A shape morphs only if it keeps its structure.** The browser can interpolate between two paths with the same commands, so a line with the same number of points morphs, and one with more or fewer points (after you add a row, or a decimator picks a different set) snaps to its new shape. A bar series with a different number of bars snaps likewise.
- **Axes and their labels do not ease.** When new data rescales an axis, the ticks and labels change at once while the shapes glide, so for a change that rescales, give the axis a fixed `min` and `max` or [tween the data yourself](#when-you-need-more).
- **The first draw does not ease**: there is nothing to move from.

## Browsers, reduced motion and exports

- **Path morphing needs the CSS `d` property**, which Chrome and Firefox have and Safari does not. In Safari the shapes jump while colours and widths still ease. Nothing breaks.
- **`prefers-reduced-motion` switches everything off**, with no script: the rule that makes the easing sits in a media query for the visitors who have not asked for less motion.
- **Nothing in an exported SVG, a PNG or a server-rendered chart changes.** The attributes always hold their final values; the easing is a rule in the browser's own copy of the drawing.

## When you need more

CSS can ease what the chart has already drawn, but not the way a whole chart should move when data changes the scale: the old and new ticks, labels and shapes have to move together. That takes a frame loop, and the chart is made for one, since it is a tree you keep and each frame only rewrites what changed. Tween the numbers you already own (the data array and the axis `min` and `max`) with an animation library and call `source.invalidate()` on each frame.

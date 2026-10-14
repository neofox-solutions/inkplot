# Transitions

A chart can ease to its new drawing when its data changes, instead of jumping. It is **off by default**, it is a browser feature (a chart drawn to an SVG string has nothing to animate), and it uses the browser's own CSS transitions rather than an animation engine, so it costs almost nothing in code.

## Switch it on

Give the `Chart` a `transition` (this switches on the easing of data changes and of [view changes](#moving-the-view); an [entrance](#entrances) is a separate element):

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
- **Only a change to the data eases the shapes.** Panning, wheel zoom, pinching, resizing and the cursor and tooltip are immediate, because easing them would make the chart lag behind your hand. If one of them happens while a transition is running, the transition ends where it is. (Moving the view on purpose is eased too, in the way described [below](#moving-the-view).)
- **A shape morphs only if it keeps its structure.** The browser can interpolate between two paths with the same commands, so a line with the same number of points morphs, and one with more or fewer points (after you add a row, or a decimator picks a different set) snaps to its new shape. A bar series with a different number of bars snaps likewise.
- **Axes and their labels do not ease.** When new data rescales an axis, the ticks and labels change at once while the shapes glide, so for a change that rescales, give the axis a fixed `min` and `max` or [tween the data yourself](#when-you-need-more).
- **The first draw does not ease**: there is nothing to move from.

## Moving the view

Some changes of view are jumps, not gestures: a box zoom, a double-click that puts an axis back, `PanZoom.reset()`. With a `transition` on the chart these ease to their new range over the same `duration` and `easing`, instead of snapping. A drag, a wheel turn or a pinch is never eased, and starting one stops a move in progress.

This is not a CSS transition: the library moves the axis' range a frame at a time and redraws, so **everything moves together**, the ticks and labels as well as the shapes, in every browser, with no `d` property needed. A log axis moves evenly in its own terms. For your own jumps (a "show last month" button) call `moveView`:

```tsx check title="Easing an axis to a new range"
import { moveView } from 'inkplot';
import type { Axis } from 'inkplot';

export function showLastMonth(axis: Axis) {
  moveView(axis, { min: 1, max: 31 });  // eases if the chart has a transition, else jumps
}
export function showAll(axis: Axis) {
  moveView(axis, null);                 // back to the range the data asks for
}
```

`moveView` sets the view at once if the chart has no `transition`, if `transition.views` is `false`, or if the visitor prefers reduced motion. It asks the platform for frames, so a chart on a platform that has none (an SVG string) jumps too.

## Entrances

An `Entrance` element, a child of the chart after its planes, plays an entrance for each series **when the chart is first drawn**. It is its own element, so a chart without one carries none of its code:

```tsx check title="An entrance"
/** @jsxImportSource inkplot */
import { Axis, BandScale, BarPath, CartesianPlane, Chart, DomainSeries, Entrance, FlatDataSource, LinearScale, lightTheme } from 'inkplot';

export const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><BandScale categories={['Q1', 'Q2', 'Q3', 'Q4']} /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Revenue">
        <FlatDataSource data={[4, 7, 5, 9]} regularDomain-start={0} regularDomain-step={1} />
        <BarPath />
      </DomainSeries>
    </CartesianPlane>
    <Entrance duration={600} easing="ease-out" />
  </Chart>
) as Chart;
```

| Series | Entrance |
|---|---|
| Bars (including stacked and horizontal) | Grow from their baseline: the line they stand on stays where it is. |
| Lines, areas, markers and anything else | Drawn on from the left. |
| Anything on a round plane (polar, radar, a pie) | Fade in. |

This is a CSS animation, so it works in every browser. It plays once: a series added later, or a chart redrawn, does not play it again (a series that is hidden and shown again does, because the browser starts its animation afresh). It has its own `duration` (default 400) and `easing`, needs no `transition` on the chart, and is off with `prefers-reduced-motion`. A chart drawn to a string, an image or a server has no entrance and no markup for one.

Do not combine it with [server rendering](frameworks.md#server-rendering-and-hydration): the chart is already on the page, and the browser's first drawing of it would play the entrance over the top.

## Browsers, reduced motion and exports

- **Path morphing needs the CSS `d` property**, which Chrome and Firefox have and Safari does not. In Safari the shapes jump while colours and widths still ease. Nothing breaks.
- **`prefers-reduced-motion` switches everything off**, with no script: the rule that makes the easing sits in a media query for the visitors who have not asked for less motion.
- **Nothing in an exported SVG, a PNG or a server-rendered chart changes.** The attributes always hold their final values; the easing is a rule in the browser's own copy of the drawing.

## When you need more

CSS can ease what the chart has already drawn, but not the way a whole chart should move when data changes the scale: the old and new ticks, labels and shapes have to move together. That takes a frame loop, and the chart is made for one, since it is a tree you keep and each frame only rewrites what changed. (For the range of an axis this is `moveView`, above.) The recipe is to **tween the numbers you already own**: the data array and the axis `min` and `max`. On each frame set them to the in-between values and call `source.invalidate()`; the chart redraws only what moved.

**Leave the chart's `transition` off** when you do this. Each frame is a data change, so CSS easing would chase every frame and make the chart lag behind your tween.

Here is the whole recipe with no library, which is also the shape of it with any library:

```tsx check title="Tweening data and the axis range"
import type { Axis, FlatDataSource } from 'inkplot';

/** Move `data` (and the axis range) to new values over `ms`, drawing a frame at a time. Resolves when it arrives. */
export function tweenTo(
  source: FlatDataSource,
  data: Float64Array,
  target: ArrayLike<number>,
  axis: Axis,
  range: { min: number; max: number },
  ms = 600,
): Promise<void> {
  const from = Float64Array.from(data);
  const min0 = axis.attrs.min ?? range.min,
    max0 = axis.attrs.max ?? range.max;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return new Promise((done) => {
    const start = performance.now();
    const frame = (now: number) => {
      const raw = calm ? 1 : Math.min(1, (now - start) / ms);
      const t = 1 - (1 - raw) ** 3; // ease-out: swap in any easing, it is only a function of 0..1
      for (let i = 0; i < data.length; i++) data[i] = from[i]! + (target[i]! - from[i]!) * t;
      axis.setAttributes({ min: min0 + (range.min - min0) * t, max: max0 + (range.max - max0) * t });
      source.invalidate();
      if (raw < 1) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });
}
```

With an animation library you drop the loop and keep the body: the library supplies the clock and the easing, and your callback writes the values. With [Motion](https://motion.dev):

```ts
import { animate } from 'motion';

const from = Float64Array.from(data);
animate(0, 1, {
  duration: 0.6,
  ease: 'easeOut',
  onUpdate: (t) => {
    for (let i = 0; i < data.length; i++) data[i] = from[i] + (target[i] - from[i]) * t;
    axis.setAttributes({ min: min0 + (max - min0) * t, max: max0 + (max - max0) * t });
    source.invalidate();
  },
});
```

and with [GSAP](https://gsap.com) the same, driven by a number it tweens:

```ts
import { gsap } from 'gsap';

const progress = { t: 0 };
gsap.to(progress, {
  t: 1,
  duration: 0.6,
  ease: 'power2.out',
  onUpdate: () => {
    // …the same body, using progress.t
  },
});
```

In React, keep `data` and the source in a ref (or a `useMemo`), start the tween from an effect that runs when your new numbers arrive, and return a cleanup that stops it (`animation.stop()` in Motion, `tween.kill()` in GSAP). The tween writes to the elements directly, so React does not re-render on each frame. Tweening the number of points (a row added or removed) is not smooth for the shapes, so tween the values and change the length once, at the start or the end.

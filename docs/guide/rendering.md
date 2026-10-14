# Rendering

An element tree draws nothing by itself. `chart.attach(platform)` connects it to a **platform**, which creates the SVG nodes, measures text, reports the size, and delivers pointer and keyboard input. inkplot ships two:

| Platform | For | Draws |
|---|---|---|
| `DOMPlatform` | Browsers | A live `<svg>` in a container element. |
| `StringPlatform` | Servers, tests, export | An in-memory tree printed as an SVG string. |

To write another (a canvas, a native view), see [Custom platforms](../extending/custom-platforms.md).

## In a browser: `DOMPlatform`

```ts check title="Attach, update, detach"
import { Axis, CartesianPlane, Chart, DOMPlatform, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const source = new FlatDataSource({ data: [3, 5, 4, 8], regularDomain: { start: 0, step: 1 } });
const chart = new Chart({ theme: lightTheme },
  new CartesianPlane({},
    new Axis({ orientation: 'bottom' }, new LinearScale()),
    new Axis({ orientation: 'left' }, new LinearScale()),
    new DomainSeries({}, source, new LinePath(new LinearCurve()))));

const platform = new DOMPlatform(document.getElementById('chart')!);
chart.attach(platform);               // draws on the next frame

source.setAttribute('data', [4, 6, 5, 9]);   // redraws on the next frame

chart.detach();                       // removes the nodes; the tree stays, and can be attached again
platform.dispose();                   // releases the platform's listeners
```

- **The container needs a size.** The chart fills it and follows it as it changes (a `ResizeObserver`); a container with no height gets 600 by 300 (width by height). Give it a height in CSS.
- `size: { width, height }` fixes the size instead, for a static layout.
- A chart with nothing interactive in it is a picture: the `<svg>` leaves the page its touches and wheel. Once something listens (`PanZoom`, `BoxZoom`, `Brush`, `PointerListener`, `Cursor`, `Legend`) the `<svg>` sets `touch-action: none`, so a drag or wheel over the chart belongs to the chart.

### When it draws

A change to the tree **invalidates** the chart, and the platform decides when to **flush** (draw). `schedule` chooses:

| `schedule` | Flushes |
|---|---|
| `'frame'` (default) | On the next animation frame. Many edits in a frame cost one draw. |
| `'microtask'` | After the current code finishes. |
| `'manual'` | Only when you call `chart.flush()`. |
| a function | When your function calls back, so you can plug in your own loop. |

`chart.flush()` always works and returns statistics (`FlushStats`: time in each stage, points in and drawn, nodes written and skipped). `onFlush` on the `Chart` is called after each, which is how you [measure performance](performance.md).

```ts check title="Manual flushing and statistics"
import { Chart, DOMPlatform, lightTheme } from 'inkplot';
import type { FlushStats } from 'inkplot';

const chart = new Chart({ theme: lightTheme, onFlush: (stats: FlushStats) => console.log(stats.total.toFixed(1), 'ms') });
chart.attach(new DOMPlatform(document.body, { schedule: 'manual' }));
const stats = chart.flush();           // draws now
console.log(stats.pointsIn, stats.pointsDrawn, stats.attributeWrites);
```

## Without a browser: `StringPlatform`

`toSvgString(chart, { width, height })` attaches the chart to a string platform, draws once, detaches, and returns the SVG text. There is no DOM, no timer and no observer, so the output is deterministic: the same chart gives the same text, however many were drawn before it.

The SVG's clip paths and gradients have `id`s, and a page has one namespace for them, so two SVGs pasted into one page must not share any. Each id is therefore `ink`, eight hex digits of a hash of the picture, and a number (`ink3f9a1c2e-1`): different charts get different ids, and the same chart always gets the same. Give `idPrefix` to name them yourself (`toSvgString(chart, { idPrefix: 'sales' })` gives `sales-1`, `sales-2`), for instance to keep ids stable across edits to the chart.

```ts check title="SVG on a server"
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme, toSvgString } from 'inkplot';

export function render(values: number[]): string {
  const chart = new Chart({ theme: lightTheme },
    new CartesianPlane({},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      new DomainSeries({},
        new FlatDataSource({ data: values, regularDomain: { start: 0, step: 1 } }),
        new LinePath(new LinearCurve()))));
  return toSvgString(chart, { width: 640, height: 360 });
}
```

The output is a standalone `<svg>` using **presentation attributes only** (no stylesheet, no external fonts or images), so it can be:

- saved as a `.svg` file;
- inlined in HTML, an email or a PDF;
- rasterized for a PNG: in the browser with `toPng(chart)` (a canvas, [recipe](../start/recipes.md#save-a-chart-as-a-png-in-the-browser)), on a server with a WASM renderer such as `@resvg/resvg-wasm` ([recipe](../start/recipes.md#make-a-png-on-a-server)).

Charts are not interactive in a string; they are a picture of one flush.

For several drawings of the same chart, or to read the result of a flush, use the platform yourself:

```ts check title="Using StringPlatform directly"
import { StringPlatform } from 'inkplot';
import type { Chart } from 'inkplot';

export function twice(chart: Chart): [string, string] {
  const platform = new StringPlatform({ width: 400, height: 240 });
  chart.attach(platform);
  chart.flush();
  const first = platform.toString();
  chart.setAttribute('padding', 30);
  chart.flush();
  const second = platform.toString();
  chart.detach();
  return [first, second];
}
```

## Size

The chart's size is the platform's. `Chart` also takes `width` and `height` attributes, which win over any size given to `toSvgString` (the size given fills in what the chart leaves open, and 640 x 400 is used when neither says), and `padding` (one number, or any of `top`, `right`, `bottom`, `left`), the margin round everything. The default is 10.

## Text

Layout needs text sizes (to leave room for tick labels), and only the platform knows fonts:

- `DOMPlatform` measures with a canvas by default (`preciseText: true`). `preciseText: false` uses an estimate, which is faster and slightly wider than reality; it costs margin, never clipping.
- `StringPlatform` has no fonts, so it **estimates** (about 0.6 em per character). If you know the font that will display the SVG, give the `Chart` a `measureText` that matches it:

```ts
const chart = new Chart({ theme, measureText: (text, font) => ({ width: text.length * font.size * 0.52, height: font.size * 1.2 }) }, …);
```

A web font that has not loaded when the chart first draws is measured as its fallback. Wait for `document.fonts.ready`, or change an attribute afterwards to redraw.

## Testing

Because a `StringPlatform` chart is deterministic, a chart is easy to test: build it from fixed data, call `toSvgString`, and compare the string with a stored copy, or look for what matters (`<path`, a label's text). Prefer asserting on the element tree where you can (`findById(chart, 'line')`, a series' `points.count`) over pixels.

```ts check title="A chart test"
import { toSvgString } from 'inkplot';
import type { Chart } from 'inkplot';

export function check(chart: Chart): void {
  const svg = toSvgString(chart, { width: 400, height: 240 });
  if (!svg.includes('<path')) throw new Error('nothing was drawn');
  if (/NaN|undefined/.test(svg)) throw new Error('a bad number reached the output');
}
```

## Server rendering and hydration

Draw the SVG on the server with `toSvgString` and put it in the page. On the client, build the same chart and attach a `DOMPlatform` to replace the picture with a live one. Both use the same element tree, so one function can make the chart for either.

For React, the root's `hydrate` size does all of this, with an exact hydration and a stated contract ([Frameworks](frameworks.md#server-rendering-and-hydration)); to show a chart made another way, see `ChartView` ([Frameworks](frameworks.md#showing-a-chart-made-another-way)); a Web Components page can ship the markup and let the tags draw on load.

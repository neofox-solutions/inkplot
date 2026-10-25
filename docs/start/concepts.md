# Concepts

Six ideas explain nearly everything in inkplot. Read this page once and the rest of the documentation will mostly be details.

## 1. A chart is a tree of elements you keep

```
Chart                              the root: theme, size, drawing
├─ ChartTitle                      a title, one of the notes around the plot
├─ CartesianPlane                  a coordinate space
│  ├─ Axis ── LinearScale          an axis has exactly one scale
│  ├─ Axis ── LinearScale
│  ├─ DomainSeries                 a series has one data source…
│  │  ├─ FlatDataSource
│  │  └─ LinePath ── LinearCurve   …then any number of renderers
│  └─ LineAnnotation               a reference line (and, in a plane, PanZoom and other handlers)
├─ Legend
└─ Cursor
   ├─ Crosshair
   └─ ChartTooltip
```

Every box is an **element**: an instance of a class that extends `ChartElement`. The tree is built once and then *kept*: you hold on to elements and change them, rather than building a new description for every change.

Each kind of parent takes particular children. A `Chart` takes planes and the things around them (titles, a legend, keys, a cursor); a plane takes axes, series and things that belong to the plane; an `Axis` takes exactly one scale; a series takes one data source and then renderers. The class documentation, and the compiler for `new` code, say which.

## 2. Elements are configured with attributes

Every element is made with an **attributes** object, then its children:

```ts
new Axis({ orientation: 'left', title: 'Revenue', include: [0] }, new LinearScale())
```

In JSX the attributes are the tag's attributes, and the children are its content:

```tsx
<Axis orientation="left" title="Revenue" include={[0]}><LinearScale /></Axis>
```

Attributes are plain data (numbers, strings, booleans, arrays, plain objects) and sometimes a function (`format`, `onClick`). There is nothing else to configure an element with.

**Changing one.** `element.setAttribute('title', 'Sales')` or `element.setAttributes({ title: 'Sales', min: 0 })`. Setting `undefined` removes the attribute, so its default applies again. `element.attrs` reads them all, and `getAttribute(name)` reads one. Setting a value equal (`===`) to the old one does nothing.

```ts check title="Changing a chart that is on screen"
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const left = new Axis({ orientation: 'left', title: 'Revenue' }, new LinearScale());
const source = new FlatDataSource({ data: [3, 1, 4, 1, 5], regularDomain: { start: 0, step: 1 } });
export const chart = new Chart({ theme: lightTheme },
  new CartesianPlane({}, new Axis({}, new LinearScale()), left,
    new DomainSeries({}, source, new LinePath({}, new LinearCurve()))));

left.setAttribute('title', 'Sales');          // the title changes on the next frame
left.setAttributes({ min: 0, max: 10 });      // two at once, one redraw
source.setAttribute('data', [2, 7, 1, 8, 2]); // new data
```

> **Note.** An attribute is replaced, not edited. If its value is an array or object, setting a *new* array or object is a change; mutating the old one is not seen. To edit data in place (a large typed array, say) change it and then call `source.invalidate()`.

**Nested attributes.** An attribute that holds an object (`meta`, `style`, `regularDomain`) is written in JSX with hyphens: `meta-title="Sales"` is `meta: { title: 'Sales' }`, and `style-tickLabel-size={12}` is `style: { tickLabel: { size: 12 } }`. You can also pass the object, `meta={{ title: 'Sales' }}`; giving both is an error.

## 3. Children: fixed and variadic

Some children are **fixed**: an axis' scale, a series' data. There is always exactly one, so you give it when you make the parent, and replace it with `setChild`. The others are **variadic**: a plane's axes and series, a series' renderers. They come and go, and the methods are the DOM's: `append`, `prepend`, `before`, `after`, `remove` (the element itself) and `replaceWith`. All but `remove` take any number of elements. An element that already has a parent is an error, not a move: `remove()` it first.

```ts check title="Adding, removing and replacing children"
import { Axis, CartesianPlane, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, LogScale } from 'inkplot';

const axis = new Axis({}, new LinearScale());
axis.setChild(0, new LogScale());                  // swap the scale (a fixed child)

const plane = new CartesianPlane({}, axis);
const series = new DomainSeries({ name: 'a' }, new FlatDataSource({ data: [1, 2, 3] }), new LinePath({}, new LinearCurve()));
plane.append(series);                              // add at the end
const other = new DomainSeries({ name: 'b' }, new FlatDataSource({ data: [3, 2, 1] }), new LinePath({}, new LinearCurve()));
series.before(other);                              // add before another child (also: after, prepend)
series.remove();                                   // take one out
other.replaceWith(series);                         // or swap one for another
console.log(axis.child(0, LogScale));              // read a fixed child, checked for its class
```

Order matters: children are drawn in order, so a later series is on top of an earlier one, and axes on one side are stacked in order, outwards.

`child(index, Class)` reads a fixed child and checks it is what the reader expects, naming the element and the problem if not (`Axis: child 0 should be Scale, but is LinePath`). The same mistakes in JSX or markup, where the compiler cannot see them, are reported the same way, when the chart is first drawn.

## 4. Finding elements: ids and refs

Several attributes name another element: a series' `domainAxis` says which axis it is drawn against, a `Cursor` has a `plane`, a `Key` has a `dimension`. Each takes the **element itself or its `id`**:

```tsx
const time = new Axis({ id: 'time', orientation: 'bottom' }, new LinearScale());
<DomainSeries domainAxis={time} />        // the element…
<DomainSeries domainAxis="time" />        // …or its id: the same, and what markup and saved JSON use
```

An id is looked up from the element that names it: itself, what is under it, then its parent and what is under that, outwards to the root, and the nearest match wins. Two charts in a group can each have an axis `x`; an id you refer to from far away needs to be unique.

To keep hold of an element made by JSX, use a **`ref`**: a function that is given the element, or an object with `current`:

```tsx
const plane: { current: CartesianPlane | null } = { current: null };
<CartesianPlane ref={plane}>…</CartesianPlane>
```

Or look it up afterwards: `findById(chart, 'time')`, `descendantsOfType(chart, Axis)`, `firstDescendantOfType`, `childrenOfType`, `closestAncestorOfType`, and `walk(chart, visit)`.

## 5. Drawing happens on a platform, a frame at a time

An element tree draws nothing by itself. `chart.attach(platform)` connects it to a **platform**: the thing that creates SVG nodes, measures text, reports the size and receives the pointer and keyboard. There are two: `DOMPlatform` (a browser `<svg>`) and `StringPlatform` (an SVG string, for servers and tests). Writing a third is described in [Custom platforms](../extending/custom-platforms.md).

Once attached, the chart **redraws itself** whenever something changes: you call `setAttribute`, `append`, change the container's size, or move the pointer. Changes made in one go are collected and drawn together on the next animation frame. A redraw is a **flush**: layout (axes measured, plot sized, data read and placed) and then paint. It re-runs from the top every time, which is cheap because each stage remembers its last output and writes only what differs: if nothing a node depends on has changed, nothing is written to the DOM.

You normally never think about this. Two places where it shows:

- A platform with no scheduler (`StringPlatform`, or `DOMPlatform` with `schedule: 'manual'`) draws only when you call `chart.flush()`. It returns statistics about what the flush did.
- `onFlush` on the `Chart` is called after every flush with those statistics, which is how you see that a change was cheap.

## 6. Looks come from a theme, then from `style`

The chart does not paint a background, and every colour, size and font in it is a **style property** of a named **selector** (`tickLabel`, `gridline`, `seriesLine`…). The `theme` you give the `Chart` sets all of them. Any element can override some with a `style` attribute, and the override applies to that element and everything inside it:

```tsx
<Axis orientation="left" style={{ tickLabel: { size: 11 }, gridline: { color: '#eee' } }}>…</Axis>
<LinePath stroke="crimson" strokeWidth={3}>…</LinePath>   // a few common ones are plain attributes
```

The nearest setting wins. [Styling](../guide/styling.md) has the whole list of selectors.

## What else to know

- **Data lives in the tree too.** A series' data source is an element, with attributes. The source reads your arrays *in place* when it can, and caches what it computes.
- **Everything is optional that can be.** Axes choose their ranges and ticks, planes their margins, series their colours, a chart its size. Anything you set beats the default.
- **Nothing is English** in the core: words (titles, a screen-reader summary) come from you, or from opt-in elements such as `ChartSummary` that you choose to include.
- **Interaction is elements too.** A `Cursor`, a `PanZoom` or a `PointerListener` is a child like any other, and a chart without them takes no input and carries none of their code.
- **Trees can be saved.** Because attributes are plain data and children are ordered, a tree turns into JSON and back ([Serialization](../guide/serialization.md)).

Next: [Recipes](recipes.md).

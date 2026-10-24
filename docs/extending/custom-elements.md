# Custom elements

Everything in a chart is a `ChartElement`, and the library's own axes, annotations and tooltips are written with exactly the tools described here. Writing your own means subclassing it and answering events. This page goes from the smallest element to planes, mapped dimensions, interaction and styling.

## What an element is

```ts
class ValueBand extends ChartElement<Plane, [], ValueBandAttributes> { … }
//                                    │      │   └ its attributes (an interface extending BaseAttributes)
//                                    │      └ its children, as a tuple: [] means none
//                                    └ the kind of parent it lives in
```

- **`Parent`** types `this.parent` and `requireParent()`. It is also how you say where the element belongs: a plane child has `Plane`.
- **`Children`** is a tuple type read by the constructor. `[Scale]` is exactly one scale; `[DataNode, ...SeriesRenderer[]]` is one source then any renderers; `Axis[]` is any number. Fixed positions are replaced with `setChild`; the rest come and go with `append`, `insertBefore` and `remove`.
- **Attributes** are a plain interface extending `BaseAttributes` (`id`, `meta`, `visible`, `style`). Every attribute is optional or has a default you apply when you read it; there is no hidden state.

Construction does nothing but store the attributes and children: it never draws, subscribes or reads the parent. The chart calls `onEvent` as things happen.

## A first element

A shaded band between two values, in data terms, that stays put when the axes change or the view is zoomed.

```tsx live title="A shaded band, as a custom plane child" height=280
import { Axis, CartesianPlane, Chart, ChartElement, DomainSeries, EVENT_PAINT, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';
import type { BaseAttributes, ChartEvent, Plane, ShapeProps } from 'inkplot';

// 1. Attributes: a plain interface.
interface ValueBandAttributes extends BaseAttributes {
  /** The band's edges, in value terms. */
  from: number;
  to: number;
  fill?: string;
}

// 2. A selector for its look, so a theme can restyle every band. See "Styling" below.
declare module 'inkplot' {
  interface Selectors { valueBand: ShapeProps }
}

// 3. The element.
class ValueBand extends ChartElement<Plane, [], ValueBandAttributes> {
  override onEvent(ev: ChartEvent): void {
    if (ev.type !== EVENT_PAINT) return;
    const plane = this.requireParent(), s = this.surface, a = this.attrs;
    const first = plane.defaultAxis('first'), second = plane.defaultAxis('second');
    if (!first || !second) return;

    // Four corners in axis fractions (0 to 1), then placed into the plane's pixels. The plane knows its shape.
    const lo = second.fractionOf(a.from), hi = second.fractionOf(a.to);
    const corners = new Float64Array([0, lo, 1, lo, 1, hi, 0, hi]);
    plane.place({ data: corners, stride: 2, count: 4 }, first, second);
    let d = '';
    for (let i = 0; i < 4; i++) d += (i ? 'L' : 'M') + corners[2 * i]!.toFixed(2) + ' ' + corners[2 * i + 1]!.toFixed(2);

    const look = this.styleFor(['valueBand', 'shape'], { fill: a.fill });
    const node = s.node('band', 'path');
    s.set(node, 'd', d + 'Z');
    s.set(node, 'fill', look.fill);
    s.set(node, 'opacity', look.opacity);
    s.set(node, 'clip-path', plane.clipUrl ?? 'none');
  }
}

export default () => (
  <Chart theme={lightTheme} style={{ valueBand: { opacity: 0.25 } }}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <ValueBand from={4} to={7} fill="#2a8f4a" />
      <DomainSeries name="Reading">
        <FlatDataSource data={[2, 5, 6, 4, 8, 7, 3]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

That is a whole element. Points to take from it:

- **`onEvent` is the one extension point.** Switch on `ev.type` and ignore what you do not handle.
- **Draw every paint, idempotently.** `EVENT_PAINT` arrives after layout on every flush. You do not diff: you say what each node should look like, every time, and the surface skips the writes that did not change. So there is no "update" code path, and the element is correct whatever changed.
- **Use data terms, then ask the plane.** `axis.fractionOf(value)` is a position 0 to 1 along the axis whatever its scale; `plane.place` turns fractions into pixels for whatever shape the plane is. The same band is a ring on a polar plane without another line.
- The chart's **order** is the paint order: this band is before the series, so it is drawn under it.
- JSX needs nothing registered: a class is a tag.

## Events

| Event | Sent | You |
|---|---|---|
| `EVENT_ATTACH` | Once, when the element joins an attached chart. | Create a wrapper (`this.surface.wrapper()`), subscribe to things. |
| `EVENT_MEASURE` | Parent to child, asking how much room it wants. | Write `ev.request = { min, max }` (sizes). Elements that take no room ignore it. |
| `EVENT_ARRANGE` | Parent to child, giving its final `rect`. | Keep it for painting. |
| `EVENT_PAINT` | Everyone, after layout. | Draw. |
| `EVENT_POINTER` | The chart, to the plane under the pointer and what is in it. | See [Interaction](#interaction). |
| `EVENT_HOVER` | To elements that asked (`inputOf(chart).watchPointer`). | A pointer-following element outside a plane. |
| `EVENT_KEY`, `EVENT_FOCUS` | To the owner of the focused node. | See [Interaction](#interaction). |

A parent never calls a child's methods to lay it out or draw it: it sends an event and the child answers. That is what lets the same tree be driven by tests, by an adapter, or by the real chart.

## Drawing: the surface

`this.surface` is what an element draws with. It is created on first use, so an element that draws nothing costs nothing.

| Call | Does |
|---|---|
| `s.node(key, tag, options?)` | The node for `key`, created the first time and the same node after. Keys are per element. `tag` is an SVG tag (`g`, `path`, `rect`, `line`, `circle`, `text`, `clipPath`, `defs`…). `{ above: true }` draws it over the element's children, `{ parent }` puts it inside another of your nodes. |
| `s.set(node, name, value)` | Sets an attribute, skipping the write if it is unchanged. Use `'none'` or `0` rather than trying to unset. |
| `s.text(node, content)` | Sets text content, likewise. |
| `s.remove(key)`, `s.removePrefix(key)` | Drops a node (or a node and every `key/…`) for content that comes and goes. |
| `s.wrapper(tag?)` | The element's own `<g>`, for a transform or clip your content shares. Create it on `EVENT_ATTACH`, before drawing; ask again and it is the same node. |

The surface places nodes for you: an element's nodes sit **below** its children's unless `above`, and tree order is paint order, whatever order elements were added, mounted or drawn in. Use numbers rounded sensibly (`toFixed(2)`) in path data to keep the output small and stable.

For text, `applyText(s, node, textProps, anchor?)` sets the font attributes from a text look. `circlePath`, `polyline` and the other geometry helpers are in the barrel.

## Attributes and `attrTypes`

Attributes are read as `this.attrs.name`, changed with `setAttribute` or `setAttributes` (which invalidate the chart; setting the same value again, by `===`, does nothing; setting `undefined` removes it), and carried by JSON and the adapters.

HTML attributes are text, so an adapter needs to know how to turn text into your attribute's value. You say so with a **static `attrTypes`**, which the compiler checks is complete:

```ts
static override attrTypes = {
  ...ChartElement.attrTypes,          // id, meta
  fill: STRING,                       // stays text, even if it looks like a number
  from: NUMBER,
  keys: { next: AUTO },               // a nested object: one entry per field
} satisfies AttrTypesFor<ValueBandAttributes>;
```

- `STRING` keeps text as text; `NUMBER` and `BOOLEAN` convert; `AUTO` guesses (`true`/`false`, numbers, JSON); an object spec describes a nested attribute (`meta`, `regularDomain`).
- An attribute whose value is a function or other thing an attribute string can never hold: `AUTO` (set from JavaScript).
- A namespace object the adapters must not take apart: `Opaque<T>`.
- Write `...ParentClass.attrTypes` first to inherit.

If you only use `new` and JSX, the static is not needed at runtime, but `satisfies AttrTypesFor<…>` makes the compiler tell you when an attribute is missing, which is worth having.

## Children and parents

To accept children, give the second type parameter. A custom container:

```ts
class Row extends ChartElement<Chart, Marker[], RowAttributes> { … }   // any number of Markers
class Pair extends ChartElement<Plane, [Series, Series], PairAttributes> {
  first() { return this.child(0, DomainSeries); }  // checked where used
}
```

`child(index, ...classes)` returns a fixed child, typed, and throws an error that names the element and what it found when the tree was built wrongly, whether by `new`, JSX, React or markup. Use it instead of casting.

**Telling TypeScript where it may be used.** The parents list what they accept in an interface your code can extend:

```ts
declare module 'inkplot' {
  interface PlaneChildMap { valueBand: ValueBand }      // now a plane's constructor and append() accept it
  interface ChartChildMap { scoreboard: Scoreboard }    // and a chart's
}
```

(Other maps: `CursorChildMap` for what goes inside a `Cursor`.) With no augmentation the element still works in JSX, which does not check children, and is simply rejected by `new CartesianPlane({}, …)` types.

Find things in the tree with the helpers: `findById` and `findClosestOfType` (nearest first), `descendantsOfType`, `closestAncestorOfType`, `childrenOfType`, `resolveRef` (turn an attribute that is an element or its id into the element).

## Planes

A plane child is positioned in data terms, as the band is. The tools a `Plane` gives you:

| Member | Is |
|---|---|
| `plane.rect` | The plot area in the chart's pixels. Drawing inside the plane is in plot pixels, from its corner. |
| `plane.defaultAxis('first' \| 'second')` | The plane's first and second axes: x and y on a rectangle, angle and radius on a polar one. |
| `axis.fractionOf(value)`, `axis.normalize(buffer, count, stride, offset)` | Data to 0..1 along an axis (in place for a buffer). NaN for a value that cannot be placed. |
| `plane.place(buffer, first, second)` | Turn a buffer of `[firstFraction, secondFraction]` pairs into pixels, in place. |
| `plane.unplace(x, y, first, second)` | The reverse: a pixel position to the two coordinates in data terms. |
| `plane.clipUrl` | The `clip-path` value that keeps drawing inside the plot, or null. |
| `plane.rectilinear` | Whether a line that is straight in the plane's terms is straight on the page (true for a rectangle). |
| `plane.alignedPath(coords, count, first, second, closed?)` | Path data for moves that each change one coordinate (a bar's outline, a step line), drawn in the plane's own terms: `H`/`V` on a rectangle, arcs and spokes on a polar plane, chords through the spokes on a radar. |
| `plane.exactPath(coords, count, first, second, closed?)` | Path data for lines that are straight in the plane's terms between any vertices: chords on a rectangle, a spiral of short pieces for a diagonal on a polar plane, a bend at each spoke on a radar. |
| `plane.breaks(axis)` | Where a line along the axis bends (a radar's spokes). |
| `plane.guide(role, value)` | A path of constant value along an axis: a gridline in the plane's shape. |

An element that works only on one kind of plane can say so by typing its parent (`ChartElement<CartesianPlane, …>`); one that uses only these methods works on all of them.

## Series, renderers, data

Each has a base class to extend, and each is in one module in the library to read as a model:

| To add… | Extend | Read |
|---|---|---|
| A way to draw a series (a candlestick, a violin) | `SeriesRenderer` | `renderer.ts`, `bars.ts`, `marker.ts` |
| A marker shape | the marker base in `marker.ts` | `marker.ts` |
| A way to join points | `Curve` | `curve.ts`, `curves.ts`, `steps.ts` |
| A source of data | `DataSource` | `sources.ts`; [Custom data and scales](custom-data-and-scales.md) |
| A data stage between source and series | `DataTransform` | `decimation.ts` |
| A scale | `Scale` | `scales.ts`; [Custom data and scales](custom-data-and-scales.md) |

See [Custom renderers, markers and curves](custom-renderers.md) for the rendering side.

## Mapped dimensions

A **mapped dimension** turns data into a value rather than a position. The base class `MappedDimension<Out>` needs two things: what a position 0 to 1 *is*, and what missing data is. It takes its range from every series that binds to it, and it is a child of the `Chart`.

```tsx live title="A mapped dimension of your own: traffic-light colours" height=300
import { Axis, CartesianPlane, Chart, CircleMarker, LinearScale, MappedDimension, ObjectDataSource, XYSeries, lightTheme } from 'inkplot';

// Three colours with hard edges: the lowest third green, then amber, then red.
class TrafficLight extends MappedDimension<string> {
  valueAt(fraction: number): string {
    if (!(fraction >= 0 && fraction <= 1)) return this.missing;
    return fraction < 1 / 3 ? '#2a8f4a' : fraction < 2 / 3 ? '#e8a317' : '#d6336c';
  }
  get missing(): string { return '#bbb'; }
}

const rows = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 10 + 6 * Math.sin(i / 3), load: 50 + 45 * Math.sin(i / 5) }));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries>
        <ObjectDataSource source={rows} channels={{ x: 'x', y: 'y', load: 'load' }} />
        <CircleMarker size={6} bind={{ fill: { axis: 'light', channel: 'load' } }} />
      </XYSeries>
    </CartesianPlane>
    <TrafficLight id="light" title="Load" min={0} max={100} tickCount={3}><LinearScale /></TrafficLight>
  </Chart>
);
```

The dimension is bound by `id` exactly like a `ColorAxis`, and `bind` is type-checked: a renderer that binds `fill` accepts any `MappedDimension<string>`; one that binds `size` accepts a `MappedDimension<number>`. A key (`ColorKey`, `SizeKey`) needs the dimension to be those classes. For a new kind of output (a dash pattern, a symbol), give your dimension an `Out` type and have a renderer that reads it.

## Interaction

Input reaches an element as an event, in the element's own coordinates. It comes through the chart's **input host** (`InputHost`), which a chart only has once something in it asks: a chart with no interactive element never listens to the platform's input, so a browser leaves the page its touches and wheel, and a bundle for it holds none of the routing code. **An element that takes input extends `InteractiveElement`** instead of `ChartElement` (same type parameters; exported from `inkplot`). As it joins a chart, the chart starts listening. Extending it is what brings the input code into a bundle, which is why `ChartElement` itself does not do it. If your element must have another base class, ask for the host yourself when it attaches: `inputOf(chart)`.

**Pointer.** A plane child receives `EVENT_POINTER` with `kind` (`move`, `down`, `up`, `leave`, `wheel`), `x` and `y` in plot pixels, `buttons`, and the modifiers. Set `ev.handled = true` when you used it, so the browser does not also act (scrolling on a wheel turn). `unplace` turns the pixel position into data terms; the hit-testing functions in `hit.ts` (`hitPlane`, `hitAcross`, `interpolate`) find the series point near it.

```ts check title="A plane child that reacts to the pointer"
import { EVENT_POINTER, InteractiveElement } from 'inkplot';
import type { BaseAttributes, ChartEvent, Plane } from 'inkplot';

interface ProbeAttributes extends BaseAttributes {
  onProbe?: (domain: number, value: number) => void;
}

export class Probe extends InteractiveElement<Plane, [], ProbeAttributes> {   // takes input: the chart listens for it
  override onEvent(ev: ChartEvent): void {
    if (ev.type !== EVENT_POINTER || ev.kind !== 'down') return;
    const plane = this.requireParent();
    const first = plane.defaultAxis('first'), second = plane.defaultAxis('second');
    if (!first || !second) return;
    const [domain, value] = plane.unplace(ev.x, ev.y, first, second);
    this.attrs.onProbe?.(domain, value);
    ev.handled = true;
  }
}
```

**Pointer outside a plane.** An element in the chart that follows the pointer (a tooltip) is an `InteractiveElement` and asks `inputOf(chart).watchPointer(this)` when it attaches and receives `EVENT_HOVER` with the plane the pointer is over.

**Under a `Cursor`.** The `Cursor` finds what the pointer or keyboard is on; an element inside it (a `Crosshair`, a `ChartTooltip`, yours) reads `parent.state` when it paints and draws from it. It implements `CursorChild` (`follows`: whether it is drawn at the pointer's own place, so the cursor must redraw on every move).

**Keyboard.** To be reachable by Tab, an element does three things (`focus.ts`):

1. Gives a node a `tabindex` (`makeTabStop(surface, node)`) and tells the input host it owns it: `inputOf(chart).focusable(this, node)`.
2. Draws the ring while it has focus (`EVENT_FOCUS` says when, and whether a ring is wanted: only for keyboard focus). `drawFocusRing` draws it in the `focusRing` look.
3. Answers `EVENT_KEY` (`key` is `KeyboardEvent.key`), setting `handled`. `pressesButton(ev)` implements Enter and Space the way a browser button does.

Give it a name for screen readers with `writeAria(surface, node, this.attrs.meta, { role: 'button', label: '…' })`, keep decoration out of the way with `hideFromAssistive`, and speak with `inputOf(chart).speak(text)`. See [Accessibility](../guide/accessibility.md).

## Styling

An element should take its look from the theme, not from constants, so that a `style` block or theme can change it. Ask for the look with a **chain of selectors**, most specific first, ending in a root:

```ts
const look = this.styleFor(['valueBand', 'shape'], { fill: a.fill });
```

- The chain's last name must be a **root**: `text`, `line` or `shape` (or `axis`, `marker`, `callout`). That is what guarantees every property has a value.
- The second argument is the element's own attributes that are style properties; they beat any block.
- The third argument is an **accent**: a default colour from the palette that anything named in a theme beats (this is how series take palette colours).

To add a selector, augment the `Selectors` interface, as the band example does:

```ts
declare module 'inkplot' {
  interface Selectors { valueBand: ShapeProps }       // ShapeProps, TextProps, LineProps, or Partial<…>
}
```

A theme or `style` block can then say `{ valueBand: { fill: '#2a8f4a', opacity: 0.25 } }` and it type-checks. For the adapters, give `defineElements` the names so HTML can say `style-valueband-opacity`: `defineElements(classes, { prefix: 'ink', names: ['valueBand'] })`. See [Styling](../guide/styling.md).

## Registering

Nothing needs registering to use an element in code or JSX. Registering is how an element joins **JSON** and the **adapters**:

```ts
import { registry } from 'inkplot';
const mine = { ...registry, ValueBand };           // toJSON, fromJSON and applyJSON accept 'ValueBand'
```

```ts
reactWrapper(ValueBand)                             // a React component
defineElements({ ValueBand }, { prefix: 'ink' })    // <ink-value-band from="4" to="7">
```

An element written under one name must be registered once (two names for one class write under the first). See [Serialization](../guide/serialization.md).

## A checklist for a new element

- [ ] Attributes in an interface extending `BaseAttributes`; all optional or defaulted when read.
- [ ] `static override attrTypes = {…} satisfies AttrTypesFor<…>`, spreading the parent's.
- [ ] Constructor untouched; no work before `EVENT_ATTACH`.
- [ ] Drawing in `EVENT_PAINT`, saying what every node looks like every time; nothing cached by hand.
- [ ] Positions in data terms through the axes and `plane.place`; clipped with `plane.clipUrl` when it belongs inside the plot.
- [ ] Looks through `styleFor` with a chain ending in a root; selectors added by augmentation.
- [ ] Decorative nodes `hideFromAssistive`; named things given `meta` through `writeAria`.
- [ ] Added to `PlaneChildMap` (or the right map) so `new` accepts it.
- [ ] Registered in your own registry if it must serialize.

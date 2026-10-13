# JSX, React and Web Components

One chart can be written four ways, and all four build **the same element tree**:

| Way | You write | Good for |
|---|---|---|
| `new` | `new Chart({…}, plane, …)` | Code that builds charts, libraries, tests. |
| **Vanilla JSX** | `<Chart>…</Chart>` | The default in these docs: markup-shaped, builds elements immediately. |
| **React** | `<Chart>` components from `inkplot/react` | A chart that follows React state. |
| **Web Components** | `<ink-chart>` tags | Plain HTML, server-templated pages, any framework. |

Mix them freely: a chart made with JSX can be shown by React (`ChartView`), serialized ([Serialization](serialization.md)), or attached to a page.

## Vanilla JSX

Point the JSX transform at inkplot and every tag becomes a call that makes its element **at once**. The value of a JSX expression *is* the `Chart` (or whatever element), not a description of one.

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "inkplot" } }
```

Or per file: `/** @jsxImportSource inkplot */`. The runtime costs about 0.6 KB gzipped.

The rules:

- **Attributes** are the element's attributes, type-checked. Hyphens nest: `meta-title="x"` is `meta={{ title: 'x' }}`, and `regularDomain-start={0}` is `regularDomain={{ start: 0 }}`. TypeScript cannot check hyphenated names.
- **Children** go to the constructor in order. A parent's fixed children (an axis's scale, a series's source) come first, as its page documents. TypeScript cannot check which children go where; the element throws, naming itself, when the chart is built.
- `null`, `undefined` and `false` children are dropped, so `{cond && <Legend />}` works, but a *fixed* child cannot be skipped this way.
- `ref` receives the element (a function, or an object with `current`) to keep hold of it.
- Text content (`<ChartTitle>Sales</ChartTitle>`) is **not** supported: write `text="Sales"`.
- `key` is ignored: the tree is retained, nothing is diffed.
- A function can be a tag, which is how you make reusable pieces. `<>…</>` groups several elements into their parent.

```tsx live title="Reusable pieces from functions" height=280
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, Legend, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';
import type { AnyElement } from 'inkplot';

function Line(props: { name: string; data: number[] }): AnyElement {
  return (
    <DomainSeries name={props.name}>
      <FlatDataSource data={props.data} regularDomain-start={0} regularDomain-step={1} />
      <LinePath><LinearCurve /></LinePath>
    </DomainSeries>
  );
}

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <>
        <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
        <Axis orientation="left"><LinearScale /></Axis>
      </>
      <Line name="North" data={[3, 5, 4, 7]} />
      <Line name="South" data={[6, 4, 5, 3]} />
    </CartesianPlane>
    <Legend side="bottom" />
  </Chart>
);
```

A helper that takes a JSX element as an argument is typed `AnyElement`, not `JSX.Element`.

Changing a chart made with JSX afterwards is the same as for any chart: hold the elements (`ref`, `findById`) and call `setAttribute`, `setChild`, `append`. See [Charts](charts.md).

## React

`inkplot/react` has a component for every built-in element class, under the class's own name, so a chart can be written in your components and follow their state. Import the ones you use: each is marked so that a bundler leaves out the rest, and the classes behind them.

```tsx check title="A chart that follows props" jsx=react
import { lightTheme } from 'inkplot';
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale } from 'inkplot/react';

export function Trend({ values, title }: { values: number[]; title: string }) {
  return (
    <Chart theme={lightTheme} meta={{ title }} hostProps={{ style: { height: 300 } }}>
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

How it behaves:

- **The root** (the wrapper with no wrapper above it) renders a `<div>` and attaches the chart to it. Give that div a size, with `hostProps={{ style: { height: 300 } }}` or a class; it fills its parent's width by default. `platformOptions` are the `DOMPlatform`'s ([Rendering](rendering.md)).
- **Props are attributes**, and hyphenated names nest as in JSX. An attribute that did not change is not written.
- Plain objects and arrays are compared **by content**, so `meta={{ title }}` written inline does not invalidate the chart on each render. **Functions are compared by identity**: wrap `format`, `onClick` and similar in `useCallback`.
- Each wrapper owns one element, made on its first render and kept. Reordering or removing children in React moves or removes the elements; the chart redraws on the next frame.
- A `ref` on a wrapper receives its element, so you can call its methods (`ref.current.setAttribute(...)`, `ref.current.flush()`…).
- Rendering collects and committing applies, so an abandoned render (Strict Mode, an interrupted transition) changes nothing.

Limits, which come from the element tree knowing nothing of where React put things:

- A chart element that appears through state in a component *between* chart elements lands in the right place only if its parent renders too; otherwise it goes last. Keep the condition in the component that renders the parent.
- Do not wrap a component that renders chart elements in `React.memo`, or pass chart elements as `children` through a component that re-renders on its own: a child that does not render cannot be reordered.
- Fixed children come first, in the documented order. Not type-checked.

### Your own elements

A class of your own gets its component from `reactWrapper`, made once in a module of yours:

```tsx check title="A component for a custom element" jsx=react
import { type BaseAttributes, ChartElement } from 'inkplot';
import { reactWrapper } from 'inkplot/react';

interface NoteAttributes extends BaseAttributes { text?: string }
class Note extends ChartElement<never, [], NoteAttributes> {}
export const NoteView = reactWrapper(Note);
```

### Showing a chart made another way

`ChartView` shows a chart built with `new` or JSX. The chart is attached while the component is mounted and detached when it is not. The attributes and children are yours to change, not React's.

```tsx check title="A chart built once, shown by React" jsx=react
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';
import { ChartView } from 'inkplot/react';
import { useMemo } from 'react';

export function Spark({ data }: { data: number[] }) {
  const chart = useMemo(() => new Chart({ theme: lightTheme },
    new CartesianPlane({},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      new DomainSeries({},
        new FlatDataSource({ data, regularDomain: { start: 0, step: 1 } }),
        new LinePath(new LinearCurve())))), [data]);
  return <ChartView chart={chart} hostProps={{ style: { height: 120 } }} />;
}
```

Use the wrappers when the chart's *structure* follows state; use `ChartView` with a stable chart when only its *data* changes (edit the source and call `invalidate()`, see [Data](data.md)).

A file uses one JSX runtime. To write a chart as vanilla JSX inside a React project, put it in a file that starts with `/** @jsxImportSource inkplot */` and export the chart or a function that makes it.

## Web Components

`defineElements` makes a custom HTML element for each class you give it, so a chart can be written as markup, from any page or framework.

```html
<script type="module">
  import * as inkplot from 'inkplot';
  import { defineElements } from 'inkplot/web-components';
  const { Chart, CartesianPlane, Axis, LinearScale, DomainSeries, FlatDataSource, LinePath, LinearCurve } = inkplot;
  defineElements({ Chart, CartesianPlane, Axis, LinearScale, DomainSeries, FlatDataSource, LinePath, LinearCurve }, { prefix: 'ink' });
  document.querySelector('ink-chart').props = { theme: inkplot.lightTheme };
</script>

<ink-chart style="height: 300px" meta-title="Rainfall">
  <ink-cartesian-plane>
    <ink-axis orientation="bottom"><ink-linear-scale></ink-linear-scale></ink-axis>
    <ink-axis orientation="left"><ink-linear-scale></ink-linear-scale></ink-axis>
    <ink-domain-series name="Rainfall">
      <ink-flat-data-source data="[3, 5, 4, 8]" regulardomain-start="0" regulardomain-step="1"></ink-flat-data-source>
      <ink-line-path><ink-linear-curve></ink-linear-curve></ink-line-path>
    </ink-domain-series>
  </ink-cartesian-plane>
</ink-chart>
```

- **The tag** is the prefix and the class's name, kebab-cased: `ink-cartesian-plane`. `defineElements` returns the tags by name.
- **The DOM tree is the element tree.** Adding, moving or removing a tag moves the chart element. The outermost tag (the `Chart`) draws into a shadow root, so your page's CSS does not reach it, and it is `display: block`: give it a height.
- **Attributes** are the element's attributes. HTML lowercases names, so `regulardomain-start` finds `regularDomain.start`; hyphens nest. Text becomes a value by the attribute's type: text stays text; numbers, `true`/`false` and JSON (`[…]`, `{…}`) convert; a bare attribute is `true`. Change one later and the chart updates on the next microtask.
- **Values HTML cannot carry** (functions, typed arrays, themes) are set from JavaScript: `tag.props = { theme, format: fn }`. `props` wins over attributes. `tag.element` is the chart element itself.
- **Callbacks become events.** For a `PointerListener`, once the page listens (`addEventListener('click', …)` or `onclick=""`) the tag dispatches a bubbling `CustomEvent` named like the DOM's (`click`, `hover`, `drag`) with the callback's argument as `detail`. `onFlush` is the `flush` event.
- `style` and `class` are the page's. Set the chart's `style` blocks with `style-…` names: `style-ticklabel-size="12"`. Selectors you add yourself are passed as `defineElements(…, { names: ['mySelector'] })`.
- `platformOptions` on the Chart tag are the `DOMPlatform`'s.

`defineElements` does nothing at import, so a module that imports it also loads where there is no DOM.

## Which to choose

- Library or application code that builds charts from data: `new`, or vanilla JSX for the markup shape.
- A React app where the structure follows state: the wrappers. Where only the data does: `ChartView`.
- A static or server-rendered page, a CMS, or a framework you do not want a dependency on: Web Components.
- Charts as images (a report, an email, SSR): any of them with `toSvgString` (and `toPng` in the browser); see [Rendering](rendering.md).

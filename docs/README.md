# inkplot

A small chart library for the web and for servers. A chart is a **tree of elements you keep** (`Chart` → plane → axes and series → data and renderers) that draws SVG through a platform. It is tree-shakeable, has no dependencies, and a minimal chart is about 15 KB gzipped, growing only with the features you import.

```tsx
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

const chart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Load">
        <FlatDataSource data={[3, 5, 4, 8, 6, 9]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

## How these docs are organised

| If you want to… | Go to |
|---|---|
| Get a chart on a page | [Quick start](start/quick-start.md) |
| Understand the model once | [Concepts](start/concepts.md) |
| Find "how do I…" | [Recipes](start/recipes.md) |
| Learn a part in depth | [Guide](#guide) |
| Add your own element, renderer, scale, data source or platform | [Extending](#extending) |
| Look something up | [Reference](#reference) |
| Brief an LLM to write inkplot code | [SKILL.md](SKILL.md) |

Code blocks marked `live` are real examples that a docs site can run inline; to any other reader they are ordinary code blocks. Every one is compiled and run by the test suite. The format is described in [Writing documentation](authoring.md).

## Start

1. [**Quick start**](start/quick-start.md): install, your first chart, and the three ways to write one (`new`, vanilla JSX, framework adapters).
2. [**Concepts**](start/concepts.md): the six ideas: a chart is a tree you keep; attributes; children; finding elements; platforms and frames; themes.
3. [**Recipes**](start/recipes.md): 25 "how do I…" answers, each a complete example: data from arrays and objects, bars, areas, stacks, time axes, tooltips, pan and zoom, a million points, polar charts, dark themes, live updates, accessibility, SVG export, React and plain HTML.

## Guide

One page per part of the library, from the user's point of view.

| Page | About |
|---|---|
| [Charts](guide/charts.md) | The root: theme, size, padding, children, and the flush. |
| [Planes](guide/planes.md) | Cartesian, polar and radar coordinate spaces; overlaying planes. |
| [Axes and scales](guide/axes.md) | Ranges, ticks, labels, titles, linear, log, sqrt, band and time scales. |
| [Data](guide/data.md) | Flat, object, column and synthetic sources; updating; decimating large data. |
| [Series and renderers](guide/series.md) | Series, lines, areas, bars, markers, curves, gaps, stacks. |
| [Mapped dimensions and keys](guide/mapped.md) | Colour and size from data; bubble charts; keys. |
| [Labels and annotations](guide/labels.md) | Titles, legends, reference lines and callouts. |
| [Interaction](guide/interaction.md) | Cursor, crosshair, tooltip, pan and zoom, pointer callbacks, hit testing. |
| [Styling](guide/styling.md) | Themes, selectors, `style` blocks, palettes, dark mode. |
| [Accessibility](guide/accessibility.md) | `meta`, summaries, keyboard, announcements. |
| [JSX, React and Web Components](guide/frameworks.md) | The adapters. |
| [Serialization](guide/serialization.md) | Charts as JSON: `toJSON`, `fromJSON`, `applyJSON`, `Refs`. |
| [Rendering](guide/rendering.md) | Platforms, scheduling, SVG on a server, text measurement, testing. |
| [Performance and bundle size](guide/performance.md) | What a feature costs; how to keep charts fast. |

## Extending

For when the library's elements are not enough. Every built-in element is written with the tools these pages describe.

| Page | About |
|---|---|
| [Custom elements](extending/custom-elements.md) | The element model; a first element; events, surfaces, attributes, children, planes, mapped dimensions, interaction, styling, registering; a checklist. |
| [Custom renderers, markers and curves](extending/custom-renderers.md) | A marker shape, a curve, a whole renderer. |
| [Custom data and scales](extending/custom-data-and-scales.md) | A data source, a transform, a scale, a time scale over any date library. |
| [Custom platforms](extending/custom-platforms.md) | Rendering somewhere other than SVG text or a browser. |
| [How it works](extending/how-it-works.md) | Layers, events, surfaces, the flush pipeline, placement. |

## Reference

| Page | About |
|---|---|
| [Attribute reference](reference/api.md) | Every element: where it goes, what it holds, every attribute. Generated from the source. |
| [Functions and other exports](reference/exports.md) | Everything the package exports that is not an element. |
| [Troubleshooting](reference/troubleshooting.md) | Error messages and "it draws wrongly" symptoms, with fixes. |
| [Writing documentation](authoring.md) | The live example format, for people writing these docs. |

## For LLMs

[`SKILL.md`](SKILL.md) is a single dense file for a model that writes inkplot code: the API at a glance, the rules that matter, a few distinct examples, a checklist and troubleshooting. It is checked by the same tests as the rest.

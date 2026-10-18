# inkplot

A small chart library for the web and for servers. A chart is a **tree of elements you keep** (`Chart` → plane → axes and series → data and renderers) that draws SVG through a platform. It is tree-shakeable, has no dependencies, and a minimal chart is about 17 KB gzipped, growing only with the features you import.

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
| Decide whether inkplot is for you | [Why inkplot](start/why-inkplot.md) |
| Get a chart on a page | [Quick start](start/quick-start.md) |
| Understand the model once | [Concepts](start/concepts.md) |
| Find "how do I…" | [Recipes](start/recipes.md) |
| Learn a part in depth | [Guide](#guide) |
| Add your own element, renderer, scale, data source or platform | [Extending](#extending) |
| Look something up | [Reference](#reference) |
| Brief an LLM to write inkplot code | [SKILL.md](SKILL.md), and [installing it](guide/ai-agents.md) |

Code blocks marked `live` are real examples that a docs site can run inline; to any other reader they are ordinary code blocks. Every one is compiled and run by the test suite. The format is described in [Writing documentation](authoring.md).

## Start

1. [**Why inkplot**](start/why-inkplot.md): what it is for, how small and fast it is, and how well it works with people and with AI agents.
2. [**Quick start**](start/quick-start.md): install, your first chart, and the three ways to write one (`new`, vanilla JSX, framework adapters).
3. [**Concepts**](start/concepts.md): the six ideas: a chart is a tree you keep; attributes; children; finding elements; platforms and frames; themes.
4. [**Recipes**](start/recipes.md): 37 "how do I…" answers, each a complete example: data from arrays and objects, bars, areas, stacks, time axes, tooltips, pan and zoom, a million points, polar charts, dark themes, live updates, accessibility, SVG export, React and plain HTML.

## Guide

One page per part of the library, from the user's point of view.

| Page | About |
|---|---|
| [Charts](guide/charts.md) | The root: theme, size, padding, children, and the flush. |
| [Planes](guide/planes.md) | Cartesian, polar and radar coordinate spaces. |
| [Charts in a grid](guide/charts-in-a-grid.md) | `ChartGroup`: several charts in one picture, spans, alignment. |
| [Axes and scales](guide/axes.md) | Ranges, ticks, labels, titles, linear, log, sqrt, band and time scales. |
| [Data](guide/data.md) | Flat, object, column and synthetic sources; updating; decimating large data. |
| [Series and renderers](guide/series.md) | Series, lines, areas, bars, markers, curves, gaps, stacks. |
| [Mapped dimensions and keys](guide/mapped.md) | Colour and size from data; bubble charts; keys. |
| [Labels and annotations](guide/labels.md) | Titles, legends, reference lines and callouts. |
| [Interaction](guide/interaction.md) | Cursor, crosshair, tooltip, pan and zoom, pointer callbacks, hit testing. |
| [Styling](guide/styling.md) | Themes, selectors, `style` blocks, palettes, dark mode. |
| [Accessibility](guide/accessibility.md) | `meta`, summaries, keyboard, announcements. |
| [Locales and languages](guide/i18n.md) | Number and date formats, time zones, right to left, and wiring up an i18n framework. |
| [Transitions](guide/transitions.md) | Easing a chart to new data, with CSS transitions. Off by default. |
| [JSX, React and Web Components](guide/frameworks.md) | The adapters. |
| [AI agents](guide/ai-agents.md) | Install the inkplot skills in Claude, ChatGPT, Codex, VS Code, Cursor and Gemini CLI, with `npx inkplot install-skill`. |
| [Serialization](guide/serialization.md) | Charts as JSON: `toJSON`, `fromJSON`, `applyJSON`, `Refs`. |
| [Rendering](guide/rendering.md) | Platforms, scheduling, SVG on a server, text measurement, testing. |
| [Performance and bundle size](guide/performance.md) | What a feature costs; how to keep charts fast. |
| [Browsers and runtimes](guide/compatibility.md) | What a platform needs: Chrome, Firefox, Safari, Node, Deno, Bun. |

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
| [Error codes](reference/errors.md) | What a `Minified inkplot error` code means. Generated from the source. |
| [Writing documentation](authoring.md) | The live example format, for people writing these docs. |

## For LLMs

[`SKILL.md`](SKILL.md) is a single dense file for a model that writes inkplot code: the API at a glance, the rules that matter, a few distinct examples, a checklist and troubleshooting. It is checked by the same tests as the rest.

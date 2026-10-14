# Writing documentation

This page is for people who write the docs. It describes the one convention that matters: how a code block becomes a **live example**.

## Live examples

A fenced code block whose info string says `live` is an example that a documentation site shows *running*, next to its code. To a reader of the plain Markdown it is an ordinary TSX code block.

````md
```tsx live title="A first line chart" height=240
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    …
  </Chart>
);
```
````

### The info string

`tsx live title="…"` followed by any of these, in any order:

| Word | Meaning | Default |
|---|---|---|
| `live` | Compile, run and show this block. | |
| `check` | Compile this block against the library (so it cannot go stale), but show it as plain code. For snippets that are complete modules but are not a chart on their own. Use instead of `live`. | |
| `title="…"` | A short name. Required. The docs site shows it as the caption, and the ID comes from it. | |
| `id=…` | A stable ID, when the title is not unique or may change. | the title in `kebab-case` |
| `height=N` | The preview's height in pixels. | `260` |
| `width=N` | A fixed preview width in pixels. | fills the page |
| `jsx=react` | The block is written for React's JSX, not the library's. The checker compiles it with React's runtime; show the reader nothing extra. Not for `live` blocks. | `ink` |
| `dark` | Show the preview on a dark page. Use with `darkTheme`. | |
| `static` | The example needs no pointer or keyboard, so a site may show it as an image. | |

Anything else in the info string is an error. Plain blocks (`ts`, `bash`, `html`, …) have no docs words.

### The module

The code of a `live` block is a complete **ES module**, as a reader would write it in their own project:

- It imports from `'inkplot'` (and `'inkplot/react'`, `'inkplot/web-components'` where the page is about those). Nothing else is available, so a docs site only has to provide the library.
- Its **default export is a function with no parameters that returns a `Chart`**. The site calls it, attaches the chart to a platform it provides (`new DOMPlatform(container)`), and flushes it. The site, not the example, decides the size: a chart fills its container.
- It is **self-contained and deterministic**: no network, no `Math.random()`, no `Date.now()`. Data is written out or computed with a small function in the block (a seeded generator if it must look noisy).
- It contains only what the reader needs. Every import is used; the compiler runs with `noUnusedLocals`.
- Names are the library's own. Do not rename imports.

The standard style is **vanilla JSX**: the library's own JSX runtime, which makes elements directly. A page that is about another style (`new` calls, React, Web Components) says so and uses it for its examples; every such block is still a module with a default export, and for React or Web Components the default export builds the same kind of chart through that adapter's `ChartView` or a function that returns `Chart` (see [Frameworks](guide/frameworks.md)).

### What is checked

`npm run docs` (part of `npm run all`) does this for every `live` and `check` block in `docs/`:

1. Writes it to its own file and runs the TypeScript compiler over all of them, with the project's strict settings. A mistake is reported as the Markdown file and line.
2. For `live` blocks: bundles it, calls the default export, checks that the result is a `Chart`, draws it to an SVG string, and checks that something was drawn and that nothing in it is `NaN` or `undefined`.

`INKPLOT_DOCS_SHEET=1 pnpm run docs` also writes `out/docs-sheet.html`: every live example drawn on one page, for looking at.

### Everything else on a page

- One `#` heading per page, `##` for sections. A page starts with one paragraph saying what it is for.
- Prefer a short live example near the top of each section, then the options in a table, then the details.
- Link to other pages with relative paths. Name attributes and classes in `code`.
- Say what is *not* supported when a reader would expect it.
- A tip is a block quote beginning `> **Tip.**`, a warning one beginning `> **Note.**`.

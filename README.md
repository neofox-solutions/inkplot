# inkplot

A small chart library for the web and for servers. A chart is a **tree of elements you keep** (`Chart` → plane → axes and series → data and renderers) that draws SVG through a platform. It is tree-shakeable, has no dependencies, and a minimal chart is about 15 KB gzipped, growing only with the features you import.

> **Beta.** `1.0.0-beta.1` is feature-complete and is out for user testing. Install it with the `beta` tag.

```sh
npm install inkplot@beta
```

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

The same chart can be written without JSX (`new Chart(attrs, ...children)`), and there are adapters for React (`inkplot/react`) and custom elements (`inkplot/web-components`).

## Why inkplot

- **Small when you want it, big when you need it.** One idea (a tree of parts that fit together) runs from a simple line chart at about 15 KB gzipped, with no dependencies, to composite charts, saved and shared as JSON.
- **Data and drawing compose.** A histogram is a data step plus a bar drawer; a heat map is the same step in two dimensions plus a cell drawer. Mix and match instead of waiting for a chart type.
- **Fast.** A million points zooms and pans in about 3 ms, and big scatters stay a bounded number of shapes.
- **Designed for humans, works with agents.** JSX, plain calls, React or Web Components; and in our tests Claude Haiku, given only the skill file, drew a correct chart in all 95 runs.

[The longer version, with the numbers](https://github.com/neofox-solutions/inkplot/blob/main/docs/start/why-inkplot.md).

## Try it

Every release has `inkplot-playground-<version>.html` attached: one self-contained page, no server needed, with every feature and component live. Open it in a browser from the [latest release](https://github.com/neofox-solutions/inkplot/releases).

## Documentation

- [Quick start](https://github.com/neofox-solutions/inkplot/blob/main/docs/start/quick-start.md): install, your first chart, and the three ways to write one.
- [Concepts](https://github.com/neofox-solutions/inkplot/blob/main/docs/start/concepts.md) and [recipes](https://github.com/neofox-solutions/inkplot/blob/main/docs/start/recipes.md).
- [All the docs](https://github.com/neofox-solutions/inkplot/blob/main/docs/README.md): guide, extending and reference.
- [SKILL.md](https://github.com/neofox-solutions/inkplot/blob/main/docs/SKILL.md): a brief for an LLM that writes inkplot code.

## inkplot-scratch

`inkplot-scratch` is a command-line tool for turning a module that exports inkplot charts into SVG, PNG, JSON facts or a single-file interactive HTML page, with a skill for agents doing data work. To use it in Claude, download `inkplot-data-charts-<version>.zip` from the [latest release](https://github.com/neofox-solutions/inkplot/releases) and upload it under Customize → Skills. See [scratch/](https://github.com/neofox-solutions/inkplot/tree/main/scratch).

## Developing

Node 26 or later and [pnpm](https://pnpm.io) (the version is pinned in `package.json`; `corepack enable` picks it up). `pnpm install`, then `pnpm vp run all` runs the type check, lint, format check, tests, docs checks, and the browser, PNG and packaging tests that CI runs (the tasks are in `vite.config.ts`; `pnpm vp run fmt` formats, and `pnpm vp run` lists them).

## Licence

MIT

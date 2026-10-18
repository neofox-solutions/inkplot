# inkplot-scratch

Turns a TypeScript module that exports [inkplot](https://www.npmjs.com/package/inkplot) charts into SVG files, PNG files, JSON facts, or one self-contained interactive HTML page. It type-checks the module first and prints what every chart holds (series, point counts, axis ranges, warnings), so a chart that draws nothing is caught before anyone looks at it.

```sh
npm i inkplot@beta inkplot-scratch@beta
npx inkplot-scratch charts.ts --html report.html --svg figures --png figures
```

```ts
// charts.ts
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export const load = new Chart(
  { theme: lightTheme, meta: { title: 'Load' } },
  new CartesianPlane(
    {},
    new Axis({ orientation: 'bottom' }, new LinearScale()),
    new Axis({ orientation: 'left' }, new LinearScale()),
    new DomainSeries({ name: 'Load' }, new FlatDataSource({ data: [3, 5, 4, 8], regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve())),
  ),
);
```

| Option | Writes |
|---|---|
| `--check` | type-check, draw every chart and print what each holds (the default) |
| `--svg <dir>`, `--png <dir>` | one file per chart |
| `--html <file>` | one page with every chart, pan and zoom, a tooltip, copy and download buttons |
| `--json <file\|->` | the facts, for writing prose from |

`inkplot-scratch --help` lists the rest (size, PNG scale and background, title, `--static`).

The package also carries an agent skill, `skill/SKILL.md`, which tells an AI assistant how to chart a spreadsheet or CSV with this tool. Needs Node 22 or later. PNG output uses `@resvg/resvg-wasm` (an optional dependency) and the fonts bundled here.

MIT licensed. Source and issues: [neofox-solutions/inkplot](https://github.com/neofox-solutions/inkplot/tree/main/scratch).

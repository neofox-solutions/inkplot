---
name: inkplot-data-charts
description: Use when the user wants charts, plots or visualisations of their data (Excel, CSV, JSON) as an interactive HTML page, as SVG/PNG figures, or as figures inside a Word, PowerPoint or PDF report. Builds them with the inkplot npm package and a checking command.
---

# Charts from data with inkplot

You write one TypeScript module that exports the charts; `inkplot-scratch` type-checks it, draws it, and writes an interactive HTML page, SVG files, PNG files or JSON facts. Reading the spreadsheet and building the Word/PowerPoint/PDF file are other skills' jobs: use them.

## 1. Set up (once per workspace; skip if `inkplot-scratch/` exists)

```sh
mkdir -p inkplot-scratch && cd inkplot-scratch && npm init -y >/dev/null && npm i inkplot inkplot-scratch
```

Run everything below from that folder. If `npm i` cannot reach the registry, say so and stop: do not hand-write SVG.

Then read `node_modules/inkplot-scratch/skill/inkplot/SKILL.md` (rules, template, attributes of the common elements). Its examples are plain TypeScript, `new Element(attributes, ...children)`, which is how you write charts here. Its **Topics** index names a file in `…/skill/inkplot/topics/` for each kind of chart (histograms, box plots, polar, heat maps, axes, time…): open only the one or two you need.

## 2. Look at the data before charting

Print the sheet names, column names, types, ranges and row count. Decide which columns the request means (units too: an angle may be degrees or radians) and say your assumptions in the reply; ask only if a wrong guess would mislead. Write the rows to `inkplot-scratch/data.json`, next to `source.ts` (an array of objects; numbers as numbers, times as epoch milliseconds or ISO strings). The module imports it, so the page is self-contained and every re-run uses the same data.

## 3. Write `source.ts`

It differs from the template in the inkplot skill in one way: instead of printing the SVG with `toSvgString`/`console.log`, the file ends with the charts:

```ts
import rows from './data.json';
// … imports from 'inkplot' …
const histogram = () => new Chart({ theme: lightTheme, meta: { title: 'Magnitude histogram' } }, /* plane, axes, series */);
export default [histogram(), { name: 'Box by second', caption: 'Quartiles per 1 s bucket', chart: box() }];
```

- Each item is a chart or `{ chart, name?, caption?, interactive? }`; the name (else `meta.title`, else "Figure N") becomes the figure title and file name.
- One chart object per figure: a chart used twice, or one element shared between charts, is an error. Make charts with functions.
- Reshaping the request names (bins, buckets, filters) can be done right in the module on `rows`.
- "Axis starts at 0" is `min: 0` on that axis (a histogram's axis otherwise starts at its first bin centre).
- `tsc` checks every `new` call: attribute names and types, and which children each element takes, in what order. Read its message for the element named in it.

## 4. Run, read, fix

```sh
npx inkplot-scratch source.ts --check
```

- Type errors print to stderr exactly as `tsc` prints them; runtime errors name the line in `source.ts`. Fix and run again; nothing is written until it type-checks. (`.tsx` with JSX also works, but TypeScript does not check JSX children.)
- On success it prints, per figure: series and point counts, the **real range of each axis** and its ticks, and `WARNING` lines (empty series, NaN). Compare this with the request: "x starts at 0" must read `range 0 to …`; a bin width shows in the ticks and bar count. Fix before you deliver.
- `--check` cannot see overlapping labels, clipped text or crowded keys. After it passes, run `--png` once and open the PNG of each figure (the image viewer, not the facts) and fix what you see: shorten category labels, use fewer ticks, widen the chart. Label overlap is the usual one.

Outputs (combine freely, `--check` runs with all of them; paths are relative to where you run it): `--html page.html`, `--svg dir`, `--png dir` (2x, white background, fonts bundled; files are named `01-<figure name>.svg`, in order), `--json facts.json` (what `--check` prints: point counts and axis ranges, not statistics), `--title "Page title"` for the page (default: the file name). Charts are 640x400 unless the chart sets `width`/`height` or you pass `--width/--height`.

## 5. Deliver

- **Interactive:** `--html` gives one self-contained file: every chart live, with Copy/Download for SVG and PNG, a Stats panel, download-all, and pan/zoom, Shift-drag zoom box, crosshair and tooltip added for you (don't add these yourself; `--static` or `interactive: false` on an item turns them off). Give the person that file.
- **In a document:** write the numbers in the prose by computing them from the data in code (counts, means, quartiles, per-bin counts), or from `--json` for axis ranges and point counts, never by reading the picture. Embed the figures with the Word/PowerPoint/PDF skill. Word takes SVG natively, but docx-js insists on a PNG fallback beside it: run `--svg figs --png figs` and use the pair, `new ImageRun({ type: 'svg', data: svg, fallback: { type: 'png', data: png }, transformation: { width, height } })`, with `data` read as a Buffer (`readFileSync` with no encoding; a string is taken as base64). For anything else use the PNG. A figure's `caption` shows on the HTML page only: write captions into the document yourself.
- **Changes:** edit `source.ts`, run all the outputs again, re-embed. Keep `source.ts` and `data.json` so the next request starts from them.

## Know the limits

The page exports a chart as written, not as zoomed (the added interactions never reach the SVG or PNG files). Clipboard buttons need browser permission and fall back to a download. SVG text uses the viewer's `system-ui` font; PNGs use the bundled Inter.

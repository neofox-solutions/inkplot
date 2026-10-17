# Accessibility

A chart is a picture, so a screen reader needs words from you. inkplot gives you three places to put them, makes the interactive parts work from the keyboard, and keeps decoration out of the way.

The core bundle holds **no words of its own**. Anything a reader hears comes from `meta` or from an opt-in component, so a chart in another language never carries English it does not use.

## Name the chart: `meta`

Every element takes a `meta` attribute:

| Field | Becomes | Use |
|---|---|---|
| `title` | `aria-label` | The short accessible name. |
| `description` | `aria-description` | A longer explanation, such as the point of the chart. |
| `role` | `role` | Override the default (a chart is a `group`). |
| `aria` | any `aria-*` attribute | An object whose keys are attribute names; the `aria-` prefix is optional. It wins over everything else. |

A role is written only when there is something to name, because an unnamed `group` is noise to a screen reader. A chart with no `meta` says nothing at all.

```tsx live title="A chart with a name and a description" height=260
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme} meta={{ title: 'Weekly sign-ups', description: 'Sign-ups rose steadily over six weeks, from 12 to 31.' }}>
    <CartesianPlane>
      <Axis orientation="bottom" title="Week" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left" title="Sign-ups"><LinearScale /></Axis>
      <DomainSeries name="Sign-ups" meta-title="Sign-ups per week">
        <FlatDataSource data={[12, 15, 19, 22, 27, 31]} regularDomain-start={1} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

Planes and series take `meta` too. Name the **plane** you add `PanZoom` or a keyboard `Cursor` to: it is what a screen reader says on arriving at the plot.

## Describe the data: `ChartSummary`

Writing a description by hand goes stale when the data changes. `ChartSummary` is an opt-in chart child that words what the chart holds as of its last layout: how many series and points, and where each axis runs. It writes the chart's description, and calls the chart a "chart" (`aria-roledescription`).

```tsx live title="An automatic summary" height=260
import { Axis, CartesianPlane, Chart, ChartSummary, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme} meta={{ title: 'Rates' }}>
    <CartesianPlane>
      <Axis orientation="bottom" title="Day" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left" title="Value"><LinearScale /></Axis>
      <DomainSeries name="Rate">
        <FlatDataSource data={[1, 3, 2, 4, 8, 5]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
    <ChartSummary />
  </Chart>
);
```

A screen reader hears: *"Rates, chart. 1 series: Rate, 6 points. Horizontal axis Day, from 0 to 5. Vertical axis Value, from 1 to 8."* It is rebuilt on each layout, and a hidden series is reported as hidden.

A `meta.description` on the chart wins over the summary.

### Another language

The summary's words are two attributes you can replace. `text` is a function from plain facts (`ChartFacts`: `title`, `series`, `axes`) to a sentence, and `roleDescription` names the chart.

```ts check title="A French summary"
import { ChartSummary, type ChartFacts } from 'inkplot';

const texte = (f: ChartFacts) =>
  `${f.series.length} séries. ` + f.axes.map((a) => `Axe ${a.horizontal ? 'horizontal' : 'vertical'} de ${a.from} à ${a.to}.`).join(' ');

export const summary = new ChartSummary({ text: texte, roleDescription: 'graphique' });
```

## Keyboard

Interactive parts are tab stops with a visible focus ring, shown only for keyboard focus as the browser's own controls do.

| Element | Keys |
|---|---|
| `Cursor` | Left and Right step along a series (skipping gaps); Up and Down change series; Home and End go to the first and last point; PageUp and PageDown jump a tenth of the series; Escape puts the cursor away. |
| `PanZoom` | Arrows pan; `+` and `-` zoom; `0` or Home resets; PageUp and PageDown pan a page. |
| `Legend` | Tab reaches each entry; Enter or Space shows or hides its series. Entries are buttons with `aria-pressed`. |

Both `Cursor` and `PanZoom` take `keys`: an object giving new keys for named actions (the others keep their defaults), or `false` for no keyboard control and no tab stop.

```ts check title="Changing keys"
import { Cursor, PanZoom } from 'inkplot';

export const cursor = new Cursor({ keys: { next: ['l'], previous: ['h'] } });
export const pan = new PanZoom({ keys: { zoomIn: ['i'], zoomOut: ['o'], reset: ['r'] }, keyStep: 0.2 });
export const mouseOnly = new Cursor({ keys: false });
```

The active keys are published as `aria-keyshortcuts`.

### Hearing the tooltip

When the cursor is moved by keyboard, a `ChartTooltip` also **announces** its text through a visually hidden live region beside the chart, because text inside an SVG is not reliably read when it changes. This is on by default (`announce`); the words are the tooltip's own `format`, so write them in the reader's language.

```tsx live title="A keyboard-reachable chart" height=300
import { Axis, CartesianPlane, Chart, ChartTooltip, Cursor, Crosshair, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane meta-title="Latency by hour">
      <Axis orientation="bottom" title="Hour" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left" title="ms"><LinearScale /></Axis>
      <DomainSeries name="p95">
        <FlatDataSource data={[120, 135, 128, 160, 142, 150, 138]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
    <Cursor>
      <Crosshair />
      <ChartTooltip format={(hit) => `p95 at hour ${hit.first}: ${hit.second} milliseconds`} />
    </Cursor>
  </Chart>
);
```

Click the chart and press Tab, then the arrow keys.

## Seeing the chart: contrast, size, and not only colour

`accessibleTheme` (and `accessibleDarkTheme`) is a theme with larger text in OpenDyslexic if the page has it, strong contrast and thicker lines, and a palette whose colours each reach 3:1 against the page and are told apart under common colour vision differences ([Styling](styling.md#accessible-themes)). It is a first step and not the last: colour should not be the only way to tell two series apart, since a chart is printed in grey and seen by people who cannot tell the colours. Give each series a **pattern** (`LinePattern`, `HatchPattern`, `DotPattern`) in its `fill`, or markers and dashes, so that it differs in more than hue ([Styling](styling.md#pattern-fills)). The playground has an Accessible button that puts any demo in the accessible theme.

## What is hidden

Decoration is kept out of the accessibility tree (`aria-hidden`): gridlines, ticks and tick labels, legend swatches. What remains is the chart's name and description, the focusable plot, and the legend's buttons. Tick labels are covered by the summary's axis spans, and exact values by the tooltip.

## A checklist

- Give the chart a `meta.title`, and say what it shows in `meta.description` or add a `ChartSummary`.
- Name the plane that carries a `Cursor` or `PanZoom`.
- Give every series a `name`; the summary, legend and tooltip use it.
- Do not rely on colour alone: use patterns, markers, dashes or direct labels as well (`style-seriesLine-dash`, `fill="url(#hatch)"`).
- Consider `accessibleTheme` (or `accessibleDarkTheme`): larger text, stronger contrast, thicker lines.
- Keep the default focus ring, or restyle it through the `focusRing` selector ([Styling](styling.md)).
- Supply `format` for tooltips and `text` for summaries in the page's language.

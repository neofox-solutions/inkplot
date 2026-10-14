# Why inkplot

inkplot draws charts. So do plenty of other libraries, so here is what we think makes this one worth your time, with the numbers we can stand behind.

## One idea, from a sparkline to a platform

A chart in inkplot is a **tree of small parts that fit together**: the chart, a plane, axes, a series, a source of data, maybe a step that reshapes that data, and something that draws it. You put the parts you want inside each other, and that is the whole chart.

The parts for *working with data* and the parts for *drawing it* live in the same tree and snap together the same way. A histogram is not a special chart type: it is a data step that counts points into bins, with a bar drawer after it. Swap the bar drawer for a line and you have a frequency polygon. Put a two-dimensional version of the same step in front of a heat map and you have a heat map. Because it is one idea, it works at both ends:

- **Small.** A simple line chart is about **15 KB gzipped** (that is the whole chart, the SVG output included), and every extra feature costs only what it adds: pan and zoom about 4 KB, a legend about 2.5 KB, a tooltip about 7 KB. Nothing you do not use is shipped, and there are no dependencies. Even the entire library, imported all at once as a worst case, is about 65 KB.
- **Large.** The same parts build composite charts: several planes, shared axes, stacks, trendlines, statistics, colour and size driven by data. Because the chart is a tree you keep, you can look inside it, change one thing and have only that thing redrawn. And because the tree is plain data underneath, a chart can be **written out as JSON and read back**, which is what you need for saved dashboards, shareable views, or a data analysis tool where users build charts themselves.

```tsx check title="Data, a step that reshapes it, and a drawing: three nested parts"
import { Axis, BarPath, CartesianPlane, Chart, Density, DomainSeries, LinearScale, ObjectDataSource, lightTheme } from 'inkplot';

const people = Array.from({ length: 400 }, (_, i) => ({ height: 150 + (i * 37) % 50 }));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" title="Height (cm)"><LinearScale /></Axis>
      <Axis orientation="left" title="People"><LinearScale /></Axis>
      <DomainSeries name="Heights">
        <Density width={4}>
          <ObjectDataSource source={people} domain="height" value="height" />
        </Density>
        <BarPath width={0.95} />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

## Fast where it counts

Drawing a lot of data should not mean drawing a lot of shapes. inkplot works out which parts of a chart a change touches and redoes only those, merges things that look alike into one shape, and thins big data down to what the screen can show while keeping every peak and valley. On our test machine, zooming or panning a chart of **a million points refills and redraws it in about 3 milliseconds**, and a scatter of a hundred thousand points is drawn with a bounded number of shapes (a thousand at most, by default), not a hundred thousand. [Performance and bundle size](../guide/performance.md) has the full list, and the rules for keeping it that way.

## Designed for humans, works with agents

**For people who write code**, there is more than one way in, and you pick the one that suits your product. Write charts as JSX, or as plain function calls (`new Chart(...)`) with no JSX compiler. Use the React components or the Web Components if that is what your app is made of. Draw in the browser, or to an SVG string on a server. Keep the chart as an object and update it as your data changes. Everything is typed, the error messages are written to be read, and charts are accessible out of the box: keyboard navigation, screen reader summaries and announcements.

**For AI agents**, the same simplicity matters even more. A model has to hold the whole idea in its head at once, and inkplot's idea is small: nested parts, with the same few rules everywhere. We tested this directly. We gave Claude Haiku, the smallest of Claude's models, nothing but a single skill file and asked it for charts, from a plain line chart to box plots, heat maps and trendlines, and from specific instructions to vague ones such as "show me how these regions compare".

- Across **95 runs**, every run ended with a valid, correctly labelled chart. **93 got it right on the first check**; in the other two the type checker caught a slip and the agent fixed it on the next try.
- With only a vague request, the agent picked sensible chart types by itself: bars for regions, a histogram for a distribution, a date axis with a tooltip for a time series.
- A typical run used about **83,000 tokens in total**. About 58,000 of that is the agent's own fixed overhead, whatever it is asked to do; the inkplot documentation it read was roughly **6,000 to 13,000 tokens**, split into a short core file plus topics it opens only when the chart needs them.

These were our own tasks and a small number of runs, so read them as "an agent can do this", not as a guarantee. The point is that the library does not need a large model, a long prompt or many attempts. If you want to use it from an agent, [SKILL.md](../SKILL.md) is the file to give it, and `inkplot-scratch` packages the whole thing for people who would rather ask for a chart in plain English than write code.

## Where next

[Quick start](quick-start.md) gets a chart on a page in a few minutes, [Concepts](concepts.md) explains the idea properly, and [Recipes](recipes.md) has an answer for most things you will want to draw.

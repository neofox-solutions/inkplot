/**
 * What a source module hands over, checked and described: shared by the command (in node) and the app (in a browser),
 * so what the agent is told about a figure is what the person sees.
 *
 *   export default [chart1, { name: 'Histogram', caption: 'Bins of 0.5', chart: chart2 }];
 */
import { type Axis, type Chart, Plane, SeriesRenderer, StringPlatform, toSvgString } from 'inkplot';

export interface Figure {
  /** A file-safe name, numbered in order: `01-histogram`. */
  readonly id: string;
  /** What the figure is called: the `name` given, else the chart's `meta.title`, else `Figure 3`. */
  readonly title: string;
  readonly caption?: string;
  /** Whether the page adds pan/zoom, a crosshair and a tooltip. Default true; `interactive: false` on an item turns it off. */
  readonly interactive: boolean;
  readonly chart: Chart;
}

/** `orientation` is the axis's place: bottom, left, top, right on a Cartesian plane, angle or radius on a polar one. */
export interface AxisFacts {
  title?: string;
  orientation: string;
  min: number;
  max: number;
  ticks: string[];
}
export interface SeriesFacts {
  name: string;
  points: number;
  shown: boolean;
}
export interface Facts {
  id: string;
  title: string;
  caption?: string;
  width: number;
  height: number;
  series: SeriesFacts[];
  axes: AxisFacts[];
  problems: string[];
}

export class FigureError extends Error {}

const looksLikeChart = (x: unknown): x is Chart =>
  typeof x === 'object' &&
  x !== null &&
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a type guard: the members are probed before use, on a value of unknown type
  typeof (x as Chart).attach === 'function' &&
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a type guard: the members are probed before use, on a value of unknown type
  typeof (x as Chart).flush === 'function' &&
  'attrs' in x;
const describe = (x: unknown) =>
  x === null
    ? 'null'
    : Array.isArray(x)
      ? 'an array'
      : typeof x === 'object'
        ? `an object${x.constructor?.name && x.constructor.name !== 'Object' ? ` (${x.constructor.name})` : ` with keys ${Object.keys(x).slice(0, 5).join(', ') || '(none)'}`}`
        : // oxlint-disable-next-line typescript/no-base-to-string -- only primitives and functions reach String(x) here: arrays and objects are described above
          `${typeof x} ${String(x).slice(0, 30)}`;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** The figures in a module's default export: an array of charts or `{ chart, name?, caption?, interactive? }`. A lone chart is one figure. */
export function figuresOf(module: Record<string, unknown>): Figure[] {
  if (!('default' in module))
    throw new FigureError('The module has no default export. End the file with: export default [chart1, chart2];');
  const given = module.default;
  const list = Array.isArray(given) ? given : [given];
  if (list.length === 0) throw new FigureError('The default export is an empty array: put at least one chart in it.');
  const width = String(list.length).length < 2 ? 2 : String(list.length).length;
  const taken = new Set<string>(),
    charts = new Map<unknown, number>();
  return list.map((item, i): Figure => {
    const at = `export default [...] item ${i + 1}`;
    const wrapped = typeof item === 'object' && item !== null && !looksLikeChart(item) && 'chart' in item;
    // oxlint-disable-next-line typescript/consistent-type-assertions -- `wrapped` was checked just above: the item is a `{ chart }` wrapper
    const chart = wrapped ? (item as { chart: unknown }).chart : item;
    if (!looksLikeChart(chart)) {
      throw new FigureError(
        `${at} is ${describe(chart)}, not a Chart. Each item is a <Chart> / new Chart(...), or { chart, name?, caption? }.`,
      );
    }
    const earlier = charts.get(chart);
    if (earlier !== undefined)
      throw new FigureError(
        `${at} is the same chart object as item ${earlier + 1}. One chart can be one figure: build a second one (a function that returns a new chart works well).`,
      );
    charts.set(chart, i);
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the wrapper's fields are read as `unknown` and checked one by one below
    const o = (wrapped ? item : {}) as { name?: unknown; caption?: unknown; interactive?: unknown };
    const title = typeof o.name === 'string' && o.name ? o.name : (chart.attrs.meta?.title ?? `Figure ${i + 1}`);
    let id = `${String(i + 1).padStart(width, '0')}-${slug(title) || 'figure'}`;
    while (taken.has(id)) id += '-';
    taken.add(id);
    return { id, title, ...(typeof o.caption === 'string' && { caption: o.caption }), interactive: o.interactive !== false, chart };
  });
}

export interface SizeOptions {
  width?: number;
  height?: number;
}

/** The chart as an SVG document, at its own size (the options only fill in what it leaves out). */
export const svgOf = (figure: Figure, size: SizeOptions = {}): string => toSvgString(figure.chart, size);

const round = (n: number) => Number(n.toPrecision(12));

/** What the chart holds once laid out. The chart is attached (to `platform`, or a string one) for the look and detached again. */
export function factsOf(figure: Figure, size: SizeOptions = {}): Facts {
  const { chart } = figure,
    a = chart.attrs;
  const platform = new StringPlatform({ width: a.width ?? size.width ?? 640, height: a.height ?? size.height ?? 400 });
  chart.attach(platform).flush();
  const series: SeriesFacts[] = [],
    axes: AxisFacts[] = [],
    problems: string[] = [],
    seen = new Set<Axis>();
  let n = 0;
  for (const plane of chart) {
    if (!(plane instanceof Plane)) continue;
    for (const s of plane.allSeries) {
      n++;
      const f = { name: s.attrs.name ?? s.attrs.meta?.title ?? `series ${n}`, points: s.points.count, shown: s.shown };
      series.push(f);
      if (![...s].some((c) => c instanceof SeriesRenderer))
        problems.push(
          `${f.name} has no renderer, so nothing is drawn for it: add one after its data (LinePath, BarPath, BoxPath, a marker, …)`,
        );
      else if (f.shown && f.points === 0) problems.push(`${f.name} has no points: the data is empty, or its domain misses the axis range`);
    }
    for (const axis of plane.axes) {
      if (seen.has(axis)) continue;
      seen.add(axis);
      const ticks = axis.getTicks(axis.ruler.length);
      if (ticks.length < 2) {
        problems.push(`the ${axis.orientation} axis${axis.attrs.title ? ` "${axis.attrs.title}"` : ''} has fewer than two ticks`);
        continue;
      }
      axes.push({
        ...(axis.attrs.title && { title: axis.attrs.title }),
        orientation: axis.orientation,
        min: round(axis.range.min),
        max: round(axis.range.max),
        ticks: ticks.map((t) => t.label),
      });
    }
  }
  const { width, height } = platform.size(),
    svg = platform.toString();
  chart.detach();
  if (/NaN|Infinity/.test(svg)) problems.push('the SVG contains NaN or Infinity: a value, scale or size is not a finite number');
  return {
    id: figure.id,
    title: figure.title,
    ...(figure.caption !== undefined && { caption: figure.caption }),
    width,
    height,
    series,
    axes,
    problems,
  };
}

/** The facts as the lines `--check` prints. */
export function checkText(f: Facts): string {
  const lines = [`${f.id}  "${f.title}"  ${f.width}x${f.height}`];
  for (const s of f.series) lines.push(`  series ${JSON.stringify(s.name)}: ${s.points} points${s.shown ? '' : ' (hidden)'}`);
  for (const a of f.axes)
    lines.push(
      `  ${a.orientation} axis${a.title ? ` ${JSON.stringify(a.title)}` : ''}: range ${a.min} to ${a.max}; ticks ${a.ticks.length > 12 ? [...a.ticks.slice(0, 6), '…', ...a.ticks.slice(-3)].join(' ') : a.ticks.join(' ')}`,
    );
  for (const p of f.problems) lines.push(`  WARNING ${p}`);
  return lines.join('\n');
}

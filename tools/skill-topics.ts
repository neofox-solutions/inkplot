// The skill is a short core file (docs/SKILL.md) and topic files (docs/skill-topics/*.md). Each topic holds the attributes of its
// elements, generated from the source through docs/reference/api.md, so a reader opens only the topics a chart needs.
//   node tools/skill-topics.ts          rewrite the generated parts of the core file and of every topic
import { readFileSync, writeFileSync } from 'node:fs';
import { reference } from './api.ts';
import { load } from './api.ts';

export const ROOT = new URL('../', import.meta.url).pathname;

/** The elements the core file's Template uses, so a plain chart needs the core file alone. */
export const CORE = [
  'Chart',
  'CartesianPlane',
  'Axis',
  'LinearScale',
  'DomainSeries',
  'FlatDataSource',
  'ObjectDataSource',
  'LinePath',
  'LinearCurve',
];

export interface Topic {
  file: string;
  use: string;
  elements: string[];
}
/** Topic name to its file, what it is for (the line in the core index), and the elements whose attributes it holds. */
export const TOPICS: Record<string, Topic> = {
  axes: {
    file: 'axes.md',
    use: 'dates and times, categories, log and sqrt scales, tick labels and formats, axis limits, a second or reversed axis, number and date language',
    elements: ['LogScale', 'SqrtScale', 'BandScale', 'IntlTimeScale', 'TemporalTimeScale'],
  },
  'lines-bars': {
    file: 'lines-bars.md',
    use: 'bars (grouped, stacked), areas, smooth and stepped lines, curves, gaps in the data, several series sharing a plane',
    elements: [
      'Stack',
      'SeriesGroup',
      'AreaPath',
      'MonotoneCurve',
      'NaturalCurve',
      'CardinalCurve',
      'CatmullRomCurve',
      'BasisCurve',
      'BumpCurve',
      'QuadraticCurve',
      'ArcCurve',
      'StepCurve',
      'BarPath',
      'StemPath',
    ],
  },
  'markers-color': {
    file: 'markers-color.md',
    use: 'scatter and bubble charts, dots and crosses, colour or size taken from the data, colour and size keys',
    elements: [
      'XYSeries',
      'DotMarker',
      'CrossMarker',
      'PlusMarker',
      'CircleMarker',
      'SquareMarker',
      'ColorAxis',
      'ScalarAxis',
      'ColorKey',
      'SizeKey',
    ],
  },
  statistics: {
    file: 'statistics.md',
    use: 'histograms (a histogram is `Density` + `BarPath`), heat maps, density, box plots, trendlines (linear, polynomial, sinusoidal, loess), error bars and bands',
    elements: [
      'BoxPath',
      'BoxStats',
      'Density',
      'HeatMap',
      'LinearTrend',
      'PolynomialTrend',
      'SinusoidalTrend',
      'LoessTrend',
      'ErrorBars',
      'ErrorBand',
    ],
  },
  furniture: {
    file: 'furniture.md',
    use: 'a chart title or caption, a legend, reference lines and callouts, notes on chosen points, an accessible name and summary',
    elements: ['ChartTitle', 'Legend', 'ChartSummary', 'LineAnnotation', 'CalloutAnnotation', 'PointAnnotations'],
  },
  interaction: {
    file: 'interaction.md',
    use: 'tooltips, a crosshair, pan and zoom, drag-to-zoom, brushing a range, clicks and hovers, touch, an entrance animation',
    elements: ['ChartTooltip', 'Cursor', 'Crosshair', 'PanZoom', 'BoxZoom', 'Brush', 'PointerListener', 'Entrance'],
  },
  grid: {
    file: 'grid.md',
    use: 'a dashboard: several charts in one picture, in a grid',
    elements: ['ChartGroup', 'ChartGroupItem', 'SharedRange'],
  },
  planes: { file: 'planes.md', use: 'polar and radar charts', elements: ['PolarPlane', 'RadarPlane'] },
  data: {
    file: 'data.md',
    use: "a million points (decimation), data as columns or from a function, updating live data, reading a chart's data back as a table",
    elements: ['CompositeDataSource', 'SyntheticDataSource', 'Decimator', 'MinMaxKernel', 'M4Kernel', 'LttbKernel', 'StrideKernel'],
  },
  'styling-output': {
    file: 'styling-output.md',
    use: 'dark and custom themes, styling parts, React, a PNG, chart as JSON, your own element types',
    elements: [],
  },
  troubleshooting: { file: 'troubleshooting.md', use: 'an error message or a chart that draws nothing or draws wrongly', elements: [] },
};

const SKILL = ROOT + 'docs/SKILL.md';
const topicPath = (t: Topic) => `${ROOT}docs/skill-topics/${t.file}`;

/** The attribute sections of the named elements, from the generated reference, one level down from its own headings. */
export function sections(names: readonly string[], level = '###'): string {
  const parts = new Map<string, string>();
  for (const chunk of reference().split(/^## /m).slice(1)) {
    const name = chunk.slice(0, chunk.indexOf('\n')).trim();
    parts.set(name, chunk.slice(name.length).trim());
  }
  return names
    .map((n) => {
      const body = parts.get(n);
      if (body === undefined) throw new Error(`skill-topics: no element "${n}" in the reference`);
      return `${level} ${n}\n\n${body}`;
    })
    .join('\n\n');
}

/** Every registry element is in the core file or in exactly one topic. */
export function coverage(): { missing: string[]; twice: string[]; unknown: string[] } {
  const { registry } = load();
  const count = new Map<string, number>();
  for (const n of [...CORE, ...Object.values(TOPICS).flatMap((t) => t.elements)]) count.set(n, (count.get(n) ?? 0) + 1);
  return {
    missing: registry.filter((n) => !count.has(n)),
    twice: [...count].filter(([, c]) => c > 1).map(([n]) => n),
    unknown: [...count.keys()].filter((n) => !registry.includes(n)),
  };
}

/** The topic index the core file carries: what each topic is for and which elements it holds. */
export function index(): string {
  const rows = Object.entries(TOPICS).map(([name, t]) => {
    const els = t.elements.length ? ` Elements: ${t.elements.join(', ')}.` : '';
    return `- **${name}** (\`topics/${t.file}\`): ${t.use}.${els}`;
  });
  return rows.join('\n');
}

const between = (text: string, tag: string, body: string): string => {
  const a = text.indexOf(`<!-- ${tag}:start -->`),
    b = text.indexOf(`<!-- ${tag}:end -->`);
  if (a < 0 || b < 0) throw new Error(`skill-topics: markers "${tag}" missing`);
  return text.slice(0, a) + `<!-- ${tag}:start -->\n${body}\n` + text.slice(b);
};

/** The core file and the topic files as they should be, by path. */
export function expected(): Map<string, string> {
  const out = new Map<string, string>();
  let core = readFileSync(SKILL, 'utf8');
  core = between(core, 'api', sections(CORE));
  core = between(core, 'index', index());
  out.set(SKILL, core);
  for (const t of Object.values(TOPICS)) {
    if (!t.elements.length) continue;
    out.set(topicPath(t), between(readFileSync(topicPath(t), 'utf8'), 'api', sections(t.elements)));
  }
  return out;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  for (const [path, text] of expected()) writeFileSync(path, text);
  const c = coverage();
  if (c.missing.length || c.twice.length || c.unknown.length) {
    console.error('skill-topics: coverage', c);
    process.exit(1);
  }
}

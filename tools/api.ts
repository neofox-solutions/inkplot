// The attribute reference, generated from the source so that it cannot drift: every element class in the registry, the kind of
// parent it lives in, its children, and each attribute with its type and the first sentence of its comment.
//   node tools/api.ts            prints docs/reference/api.md
//   node tools/api.ts --compact  prints the one-line-per-element form SKILL.md carries
// tools/docs.test.ts checks that the files in docs/ match what this prints.
import { readFileSync, readdirSync } from 'node:fs';

const SRC = new URL('../src/', import.meta.url);

/** Where an element goes and what it holds. Hand-written because TypeScript's tuples cannot be read at run time; checked to cover every class. */
export const STRUCTURE: Record<string, { parent: string; children: string; about: string }> = {
  Chart: {
    parent: 'none (the root)',
    children: 'a plane or a ChartGroup, ChartTitle, Legend, Cursor, ColorAxis, ScalarAxis, ColorKey, SizeKey, ChartSummary, Entrance',
    about: 'The root: a theme, a size, and what is drawn on it.',
  },
  ChartGroup: {
    parent: 'Chart or ChartGroupItem',
    children: 'ChartGroupItem, any number; SharedRange',
    about: 'A grid of charts in one picture, in place of a plane: equal cells, filled along a row or a column.',
  },
  SharedRange: {
    parent: 'ChartGroup',
    children: '1 scale (required)',
    about: 'A scale and range the charts of a group share; each chart draws it with an Axis that has sharedRef.',
  },
  ChartGroupItem: {
    parent: 'ChartGroup',
    children: 'what a Chart holds: a plane (or a nested ChartGroup), ChartTitle, Legend, Cursor, keys',
    about: 'One chart of a group, in the cells it spans; its titles and keys go round its own plane.',
  },
  ChartTitle: { parent: 'Chart', children: 'none', about: 'Text across the top or bottom: a title, subtitle or caption.' },
  ChartTooltip: { parent: 'Cursor', children: 'none', about: 'A box of text at the cursor.' },
  Entrance: {
    parent: 'Chart',
    children: 'none',
    about: 'The series play an entrance when the chart first appears: bars grow, lines draw on, round charts fade in.',
  },
  ChartSummary: { parent: 'Chart', children: 'none', about: 'A spoken summary of the chart, for screen readers (English, replaceable).' },
  Cursor: {
    parent: 'Chart',
    children: 'Crosshair, ChartTooltip',
    about: 'Finds what the pointer or keyboard is on; its children draw it.',
  },
  Crosshair: { parent: 'Cursor', children: 'none', about: 'Guide lines through the cursor.' },
  Legend: { parent: 'Chart', children: 'none', about: 'Lists the named series; click to hide or show.' },
  CartesianPlane: {
    parent: 'Chart',
    children:
      'Axis, series, Stack, SeriesGroup, LineAnnotation, CalloutAnnotation, PointAnnotations, PanZoom, BoxZoom, Brush, PointerListener',
    about: 'A rectangular plot (x and y).',
  },
  PolarPlane: { parent: 'Chart', children: 'as CartesianPlane', about: 'A disc: angle and radius.' },
  RadarPlane: { parent: 'Chart', children: 'as CartesianPlane', about: 'A polygon with a spoke per category.' },
  Axis: { parent: 'a plane', children: '1 scale (required)', about: 'Positions data along one side of a plane, with ticks and labels.' },
  ColorAxis: { parent: 'Chart', children: '1 scale (required)', about: 'Maps data to colours.' },
  ScalarAxis: { parent: 'Chart', children: '1 scale (required)', about: 'Maps data to sizes or other numbers.' },
  ColorKey: { parent: 'Chart', children: 'none', about: 'Shows what a ColorAxis means.' },
  SizeKey: { parent: 'Chart', children: 'none', about: 'Shows what a ScalarAxis means.' },
  LinearScale: { parent: 'an axis', children: 'none', about: 'Equal steps in the data are equal steps on the page.' },
  LogScale: { parent: 'an axis', children: 'none', about: 'Logarithmic.' },
  SqrtScale: { parent: 'an axis', children: 'none', about: 'Square root: gives zero a place.' },
  BandScale: { parent: 'an axis', children: 'none', about: 'Categories in equal bands.' },
  IntlTimeScale: { parent: 'an axis', children: 'none', about: 'Timestamps on the calendar, with Date and Intl.' },
  TemporalTimeScale: { parent: 'an axis', children: 'none', about: 'Timestamps on the calendar, with Temporal.' },
  DomainSeries: {
    parent: 'a plane or Stack',
    children: '1 data (source or Decimator), then any renderers',
    about: 'A value at each position along a domain.',
  },
  XYSeries: { parent: 'a plane', children: '1 data, then any renderers', about: 'Points with x and y both from the data.' },
  Stack: {
    parent: 'a plane',
    children: 'DomainSeries or SeriesGroup, any number',
    about: 'Series that share axes and are laid on each other or side by side.',
  },
  SeriesGroup: {
    parent: 'a plane',
    children: '1 data (source, or a transform over one), then any renderers: a template',
    about:
      'One series for each value of a channel of the data, each drawn with a copy of the renderers. The series are made from the data and are not saved.',
  },
  FlatDataSource: { parent: 'a series', children: 'none', about: 'Numbers in an array or typed array, read in place.' },
  ObjectDataSource: { parent: 'a series', children: 'none', about: 'Rows as objects, read by property name.' },
  CompositeDataSource: { parent: 'a series', children: 'none', about: 'Separate columns.' },
  SyntheticDataSource: { parent: 'a series', children: 'none', about: 'A function sampled when drawn.' },
  Decimator: { parent: 'a series', children: '1 kernel, then 1 source', about: 'Reduces large data to what the plot can show.' },
  MinMaxKernel: { parent: 'Decimator', children: 'none', about: 'Keeps the lowest and highest of each pixel column.' },
  M4Kernel: { parent: 'Decimator', children: 'none', about: 'First, last, lowest and highest of each column.' },
  LttbKernel: { parent: 'Decimator', children: 'none', about: 'Largest-triangle-three-buckets: keeps the shape.' },
  StrideKernel: { parent: 'Decimator', children: 'none', about: 'Every nth point.' },
  LinePath: { parent: 'a series', children: '1 curve (required)', about: 'A line through the points.' },
  AreaPath: { parent: 'a series', children: '1 curve (required)', about: 'The region between a line and a baseline.' },
  BarPath: { parent: 'a series', children: 'none', about: 'Bars, in one path.' },
  StemPath: { parent: 'a series', children: 'none', about: 'Bars drawn as stems.' },
  BoxPath: { parent: 'a series', children: 'none', about: 'Box and whisker from min, q1, median, q3, max channels.' },
  Density: {
    parent: 'a series',
    children: '1 data',
    about: 'Bins points over any number of dimensions: count, sum, mean, fraction, density per bin (a histogram with BarPath).',
  },
  BoxStats: {
    parent: 'a series',
    children: '1 data',
    about: 'Samples in; per group min q1 median q3 max mean sd sem n out (or the outliers).',
  },
  ErrorBars: {
    parent: 'a series',
    children: 'none',
    about: 'Whiskers with caps from an error channel (error, optional negativeError; absolute or relative).',
  },
  ErrorBand: { parent: 'a series', children: 'none', about: 'The region between value minus and plus an error channel.' },
  LinearTrend: { parent: 'a series', children: '1 data', about: 'The least-squares line through its source, sampled across the domain.' },
  PolynomialTrend: { parent: 'a series', children: '1 data', about: 'A polynomial fitted to its source (`degree`).' },
  SinusoidalTrend: {
    parent: 'a series',
    children: '1 data',
    about: 'A constant plus a sine wave fitted to its source, of a given `period` or the best one.',
  },
  LoessTrend: { parent: 'a series', children: '1 data', about: 'Local linear regression: `smoothness` 0 joins the points, 1 is the line.' },
  HeatMap: { parent: 'a series', children: 'none', about: 'A rectangle at each point, coloured by a channel; with `Density`, a heat map.' },
  CircleMarker: { parent: 'a series', children: 'none', about: 'A filled circle at each point.' },
  SquareMarker: { parent: 'a series', children: 'none', about: 'A square at each point.' },
  DotMarker: { parent: 'a series', children: 'none', about: 'A dot at each point: the cheapest marker.' },
  CrossMarker: { parent: 'a series', children: 'none', about: '× at each point.' },
  PlusMarker: { parent: 'a series', children: 'none', about: '+ at each point.' },
  LinearCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'Straight lines.' },
  StepCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'Levels and jumps.' },
  MonotoneCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'A smooth curve that never overshoots.' },
  NaturalCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'A natural cubic spline.' },
  CardinalCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'A cardinal spline.' },
  CatmullRomCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'A Catmull-Rom spline.' },
  BasisCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'A B-spline that smooths past the points.' },
  BumpCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'S-shaped joins.' },
  QuadraticCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'Quadratic joins.' },
  ArcCurve: { parent: 'LinePath or AreaPath', children: 'none', about: 'Circular arcs.' },
  LineAnnotation: { parent: 'a plane', children: 'none', about: 'A reference line in data terms.' },
  CalloutAnnotation: { parent: 'a plane', children: 'none', about: 'A note attached to a data point.' },
  PointAnnotations: { parent: 'a plane', children: 'none', about: 'A note beside each chosen point: its words, a box or a callout.' },
  PanZoom: { parent: 'a plane', children: 'none', about: 'Drag, wheel, pinch, touch and keys change the view.' },
  Brush: {
    parent: 'a plane',
    children: 'none',
    about: 'Drag a range to select it and report it with onBrush; the selection stays drawn. Before PanZoom.',
  },
  BoxZoom: { parent: 'a plane', children: 'none', about: 'Drag a box (Shift by default) to zoom to it. Before PanZoom.' },
  PointerListener: { parent: 'a plane', children: 'none', about: 'Calls your functions on hover, click and drag.' },
};

interface Member {
  name: string;
  optional: boolean;
  type: string;
  doc: string;
}
interface Decl {
  extends: string[];
  members: Member[];
  refs: string[];
}

/** Strip comments the same way everywhere, but keep the doc comment before a member. */
function firstSentence(doc: string): string {
  const text = doc
    .replace(/^\s*\/\*\*|\*\/\s*$/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const guarded = text.replace(/\b(e\.g|i\.e|etc)\./g, '$1\u0000');
  const m = /^(.*?[.!?])(?=\s+[A-Z`(]|$)/.exec(guarded);
  let out = m ? m[1]! : guarded;
  // The sentence that says what an attribute is, then every sentence that says its default: a table that left the default out would have people guess it.
  if (m)
    for (const d of guarded.slice(m[1]!.length - 1).matchAll(/(?<=[.!?]\s+)(Default\b.*?[.!?])(?=\s+[A-Z`(]|\s*$)/g)) out += ' ' + d[1]!;
  return out.replaceAll('\0', '.').replace(/\|/g, '\\|');
}

/** The text between the brace at `open` and its match. */
function balanced(text: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { body: text.slice(open + 1, i), end: i };
  }
  throw new Error('unbalanced braces');
}

/** Members written at the top level of an interface or object-type body. */
function members(body: string): Member[] {
  const out: Member[] = [];
  let i = 0,
    doc = '';
  const n = body.length;
  while (i < n) {
    while (i < n && /\s/.test(body[i]!)) i++;
    if (body.startsWith('/**', i)) {
      const e = body.indexOf('*/', i) + 2;
      doc = body.slice(i, e);
      i = e;
      continue;
    }
    if (body.startsWith('//', i)) {
      i = body.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (i >= n) break;
    // A member: name, optional ?, a colon, then a type up to `;` (or a newline) at depth 0.
    const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*|'[^']+')(\?)?\s*:/.exec(body.slice(i));
    if (!m) {
      const semi = body.indexOf(';', i);
      i = semi < 0 ? n : semi + 1;
      doc = '';
      continue;
    }
    let j = i + m[0].length,
      depth = 0;
    const start = j;
    for (; j < n; j++) {
      const c = body[j]!;
      if (c === '/' && body[j + 1] === '*') {
        j = body.indexOf('*/', j) + 1;
        continue;
      }
      if ('({[<'.includes(c) && !(c === '<' && false)) depth++;
      else if (c === '>' && body[j - 1] === '=') continue;
      else if (')}]>'.includes(c)) depth--;
      else if ((c === ';' || c === ',') && depth <= 0) break;
    }
    out.push({
      name: m[1]!.replace(/'/g, ''),
      optional: m[2] === '?',
      type: body
        .slice(start, j)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      doc: firstSentence(doc),
    });
    doc = '';
    i = j + 1;
  }
  return out;
}

function parseFile(text: string, into: Map<string, Decl>): void {
  for (const m of text.matchAll(/export interface (\w+)(?:<(?:[^<>{]|<[^<>]*>)*>)?(?:\s+extends\s+([^{]+?))?\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const { body } = balanced(text, open);
    const ext = (m[2] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/<.*$/s, ''))
      .filter(Boolean);
    into.set(m[1]!, { extends: ext, members: members(body), refs: [] });
  }
  for (const m of text.matchAll(/export type (\w+Attributes)(?:<[^=]*>)?\s*=\s*/g)) {
    // A type alias made of interfaces and object types: collect the object-type members and the named parts.
    let end = m.index + m[0].length,
      depth = 0;
    for (; end < text.length; end++) {
      const c = text[end]!;
      if ('({[<'.includes(c)) depth++;
      else if (c === '>' && text[end - 1] === '=') continue;
      else if (')}]>'.includes(c)) depth--;
      else if (c === ';' && depth <= 0) break;
    }
    const expr = text.slice(m.index + m[0].length, end);
    const parts: Member[] = [],
      refs: string[] = [];
    for (const r of expr.matchAll(/\b([A-Z]\w*)\b(?=\s*[&|)]|\s*$)/g)) refs.push(r[1]!);
    for (let k = 0; k < expr.length; k++)
      if (expr[k] === '{') {
        const { body, end: e } = balanced(expr, k);
        parts.push(...members(body));
        k = e;
      }
    const seen = new Set<string>();
    into.set(m[1]!, { extends: [], members: parts.filter((p) => p.type !== 'undefined' && !seen.has(p.name) && seen.add(p.name)), refs });
  }
}

export function load(): { decls: Map<string, Decl>; attrsOf: Map<string, string>; registry: string[] } {
  const decls = new Map<string, Decl>();
  const attrsOf = new Map<string, string>();
  const supers = new Map<string, string>();
  for (const f of readdirSync(SRC)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'fake-platform.ts') continue;
    const text = readFileSync(new URL(f, SRC), 'utf8');
    parseFile(text, decls);
    for (const m of text.matchAll(
      /export (?:abstract )?class (\w+)(<(?:[^<>{]|<(?:[^<>{]|<[^<>]*>)*>)*>)?\s+extends\s+(\w+)(<[^{]*)?\s*\{/g,
    )) {
      // The attributes are named in the base class's type arguments, or else are the default of the class's own type parameter.
      const own = /\b(\w+Attributes)\b/.exec((m[4] ?? '').replace(/^<|>\s*$/g, '')) ?? /=\s*(\w+Attributes)\b/.exec(m[2] ?? '');
      supers.set(m[1]!, m[3]!);
      if (own && decls.has(own[1]!)) attrsOf.set(m[1]!, own[1]!);
    }
  }
  const resolve = (cls: string): string | undefined => attrsOf.get(cls) ?? (supers.has(cls) ? resolve(supers.get(cls)!) : undefined);
  for (const cls of supers.keys()) {
    const a = resolve(cls);
    if (a) attrsOf.set(cls, a);
  }
  const reg = readFileSync(new URL('registry.ts', SRC), 'utf8');
  const body = /export const registry[^=]*=\s*\{([\s\S]*?)\n\};/.exec(reg)![1]!;
  const names = body
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\w+$/.test(s));
  return { decls, attrsOf, registry: names };
}

/** Every attribute of an interface, own first, then inherited, nearest first. */
function collect(decls: Map<string, Decl>, name: string, seen = new Set<string>()): Member[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const d = decls.get(name);
  if (!d) return [];
  const out = [...d.members];
  for (const e of [...d.extends, ...d.refs]) out.push(...collect(decls, e, seen));
  // The same name may come from several places (the variants of a union, a part and its base): one row, optional if it is anywhere, with the comment that exists.
  const byName = new Map<string, Member>();
  for (const m of out) {
    const first = byName.get(m.name);
    if (!first) byName.set(m.name, { ...m });
    else {
      first.optional ||= m.optional;
      first.doc ||= m.doc;
    }
  }
  return [...byName.values()];
}

const COMMON = new Set(['id', 'meta', 'visible', 'style']);
const short = (t: string, n = 60) => (t.length > n ? t.slice(0, n - 1).replace(/[\s|,(]+\S*$/, '') + ' …' : t);

export function attributesOf(cls: string): Member[] {
  const { decls, attrsOf } = load();
  const a = attrsOf.get(cls);
  return a ? collect(decls, a).filter((m) => !COMMON.has(m.name)) : [];
}

export function reference(): string {
  const { decls, attrsOf, registry } = load();
  const lines: string[] = [
    '# Attribute reference',
    '',
    '<!-- Generated by `node tools/api.ts` from the source; do not edit. `pnpm vp run docs` checks it is current. -->',
    '',
    "Every element class the library ships, in the order of the registry: where it goes, what it holds, and every attribute with its type. The text of each attribute is the first sentence of the source's own comment, then its default if it has one; the pages of the guide give the rest.",
    '',
    '**Every element** also takes `id` (a name other elements and JSON refer to it by), `meta` (`{ title, description, role, aria }`: [Accessibility](../guide/accessibility.md)), `visible` (false hides it and everything in it), and `style` (a block of looks by selector: [Styling](../guide/styling.md)). Attribute names with hyphens nest in JSX and markup: `meta-title="x"`, `regularDomain-start={0}`.',
    '',
    '## Contents',
    '',
    registry.map((n) => `[${n}](#${n.toLowerCase()})`).join(' · '),
    '',
  ];
  for (const name of registry) {
    const s = STRUCTURE[name];
    lines.push(`## ${name}`, '');
    if (s) lines.push(s.about, '', `**In** ${s.parent} · **Holds** ${s.children}`, '');
    const a = attrsOf.get(name);
    const attrs = a ? collect(decls, a).filter((m) => !COMMON.has(m.name)) : [];
    if (attrs.length === 0) {
      lines.push('No attributes of its own.', '');
      continue;
    }
    lines.push('| Attribute | Type | |', '|---|---|---|');
    for (const m of attrs)
      lines.push(`| \`${m.name}\`${m.optional ? '' : ' (required)'} | \`${short(m.type).replace(/\|/g, '\\|')}\` | ${m.doc} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function compact(): string {
  const { decls, attrsOf, registry } = load();
  const lines: string[] = [];
  for (const name of registry) {
    const s = STRUCTURE[name]!;
    const a = attrsOf.get(name);
    const attrs = a ? collect(decls, a).filter((m) => !COMMON.has(m.name)) : [];
    const list = attrs.map((m) => `${m.name}${m.optional ? '' : '!'}`).join(' ');
    lines.push(`${name} | in ${s.parent} | holds ${s.children} | ${list || '-'}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])
  console.log(process.argv.includes('--compact') ? compact() : reference());

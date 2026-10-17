// The runtime import graph of src/: which module needs which when the code runs, with imports that are only types left out
// (they are erased, so they cost nothing and cannot pull a feature into a bundle). `node tools/deps.ts` prints it as a
// mermaid chart; tools/deps.test.ts holds it to the layering below.
import { readFileSync, readdirSync } from 'node:fs';

/** Every module a module needs at run time, by name without the extension. The barrel (index) and the registry are left out: they name everything. */
export function runtimeGraph(dir = new URL('../src/', import.meta.url)): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'fake-platform.ts' && f !== 'index.ts' && f !== 'registry.ts',
  );
  for (const file of files) {
    const needs = new Set<string>();
    const text = readFileSync(new URL(file, dir), 'utf8');
    for (const m of text.matchAll(/^import\s+(type\s+)?([^;]*?)\s*from\s+'\.\/([\w-]+)\.ts'/gms)) {
      const [, isType, spec = '', target = ''] = m;
      if (isType) continue;
      // `import { type A } from` keeps nothing at run time once the types are stripped, unless something else is named.
      const names =
        /\{([^}]*)\}/
          .exec(spec)?.[1]
          ?.split(',')
          .map((n) => n.trim())
          .filter(Boolean) ?? [];
      const plain =
        spec
          .replace(/\{[^}]*\}/, '')
          .replace(/,/g, '')
          .trim() !== '';
      if (plain || names.some((n) => !n.startsWith('type '))) needs.add(target);
    }
    for (const m of text.matchAll(/^import\s+'\.\/([\w-]+)\.ts'/gm)) needs.add(m[1]!);
    graph.set(file.replace(/\.ts$/, ''), needs);
  }
  return graph;
}

/** The layers the library is built in: a module may use its own layer and the ones below, features only the few listed ways. */
export const FOUNDATION = [
  'geometry',
  'events',
  'theme',
  'surface',
  'platform',
  'text',
  'stub',
  'element',
  'aria',
  'focus',
  'attrs',
  'quantile',
  'bucket',
];
export const CORE = ['chart', 'container', 'plane', 'axis', 'dimension', 'series', 'renderer', 'curve', 'scale', 'data'];
/** The only places one feature may use another: the rest of the features are independent. Add here on purpose. */
export const FEATURE_USES: Record<string, string[]> = {
  annotation: ['callout'],
  furniture: ['callout'],
  pointannotations: ['callout', 'hit'],
  entrance: ['plane', 'renderer'],
  decimation: ['partition'],
  slice: ['partition'],
  stats: ['partition'],
  density: ['partition'],
  trend: ['partition'],
  seriesgroup: ['partition'],
  workerhost: ['serialize', 'workerproto', 'partition'],
  workerboundary: ['serialize', 'workerproto', 'partition'],
  pie: ['bars', 'sources', 'pointannotations', 'radial', 'scales', 'stack', 'chart'],
  cursor: ['hit', 'input'],
  legend: ['input'],
  panzoom: ['input', 'viewtween'],
  boxzoom: ['input', 'viewtween'],
  brush: ['input'],
  pointer: ['hit', 'input'],
  simple: ['decimation', 'shortcut', 'axis', 'chart', 'plane', 'curve', 'renderer', 'scales', 'series'],
  barchart: ['shortcut', 'axis', 'bars', 'chart', 'plane', 'scales', 'series', 'stack'],
  errors: ['bars'],
  boxplot: ['bars'],
  time: ['scales'],
  'time-intl': ['time'],
  'time-temporal': ['time'],
  'jsx-dev-runtime': ['jsx-runtime'],
  react: [
    'dom-platform',
    'adapt',
    'chartgroup',
    'boxzoom',
    'brush',
    'boxplot',
    'stats',
    'density',
    'heatmap',
    'trend',
    'errors',
    'annotation',
    'pointannotations',
    'bars',
    'crosshair',
    'cursor',
    'curves',
    'decimation',
    'slice',
    'furniture',
    'key',
    'legend',
    'mapped',
    'marker',
    'panzoom',
    'pointer',
    'radial',
    'scales',
    'sources',
    'stack',
    'steps',
    'summary',
    'entrance',
    'time-intl',
    'time-temporal',
  ],
  'web-components': ['dom-platform', 'adapt', 'style-names'],
  worker: ['workerhost'],
};

/** The graph with every edge that a longer path already implies dropped: what is left is the shape. */
export function reduce(graph: Map<string, Set<string>>): [string, string][] {
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(graph.get(from) ?? [])].some((n) => reaches(n, to, seen));
  };
  const out: [string, string][] = [];
  for (const [from, needs] of graph)
    for (const to of needs) if (![...needs].some((other) => other !== to && reaches(other, to))) out.push([from, to]);
  return out;
}

export function mermaid(graph = runtimeGraph()): string {
  const lines = (m: string) => readFileSync(new URL(`../src/${m}.ts`, import.meta.url), 'utf8').split('\n').length;
  const features = [...graph.keys()].filter((m) => !FOUNDATION.includes(m) && !CORE.includes(m)).sort();
  const box = (title: string, mods: string[]) =>
    `  subgraph ${title}\n${mods.map((m) => `    ${m}["${m}<br/>${lines(m)}"]`).join('\n')}\n  end\n`;
  return (
    'flowchart BT\n' +
    box('F["Foundation"]', FOUNDATION) +
    box('C["Core: every chart pulls these"]', CORE) +
    box('X["Features: opt in by import"]', features) +
    reduce(graph)
      .map(([a, b]) => `  ${a} --> ${b}\n`)
      .join('') +
    `  classDef f fill:#eceff1,stroke:#90a4ae,color:#263238\n  classDef c fill:#e3f2fd,stroke:#42a5f5,color:#0d47a1\n  classDef x fill:#e8f5e9,stroke:#66bb6a,color:#1b5e20\n` +
    `  class ${FOUNDATION.join(',')} f\n  class ${CORE.join(',')} c\n  class ${features.join(',')} x\n`
  );
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) console.log(mermaid());

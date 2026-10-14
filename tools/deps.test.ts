// Holds the runtime import graph to its layering, so that a feature cannot end up in every bundle by accident: an
// `import` of something only used as a type has to be `import type`, and a feature that needs another has to say so in
// FEATURE_USES (tools/deps.ts). The numbers this protects are in tools/size.mjs.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CORE, FEATURE_USES, FOUNDATION, runtimeGraph } from './deps.ts';
import { test } from 'vite-plus/test';

test('deps', () => {
  const graph = runtimeGraph();
  const layer = (m: string) => (FOUNDATION.includes(m) ? 0 : CORE.includes(m) ? 1 : 2);
  const problems: string[] = [];
  for (const [from, needs] of graph) {
    for (const to of needs) {
      if (!graph.has(to)) {
        problems.push(`${from} imports ${to}, which is not a module`);
        continue;
      }
      const [a, b] = [layer(from), layer(to)];
      if (a === 0 && b > 0) problems.push(`${from} (foundation) needs ${to}: the foundation depends on nothing above it`);
      else if (a === 1 && b > 1)
        problems.push(
          `${from} (core) needs ${to} (a feature): every chart would carry it. Make the import \`import type\` or move the code`,
        );
      else if (a === 2 && b === 2 && !FEATURE_USES[from]?.includes(to))
        problems.push(`${from} (feature) needs ${to} (a feature): add it to FEATURE_USES if it is meant`);
    }
  }
  // No cycles, so any module can be understood, and bundled, from what is below it.
  const state = new Map<string, 1 | 2>();
  const visit = (m: string, path: string[]) => {
    if (state.get(m) === 2) return;
    if (state.get(m) === 1) {
      problems.push(`a cycle: ${[...path.slice(path.indexOf(m)), m].join(' → ')}`);
      return;
    }
    state.set(m, 1);
    for (const n of graph.get(m) ?? []) visit(n, [...path, m]);
    state.set(m, 2);
  };
  for (const m of graph.keys()) visit(m, []);
  // Nothing outside the library is imported except by the adapter for that thing, which then needs it as a peer dependency.
  const EXTERNAL: Record<string, string[]> = { react: ['react'] };
  for (const file of readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/^(?:import|export)\s+(?:type\s+)?[^;]*?from\s+'([^'.][^']*)'/gms)) {
      const mod = file.replace(/\.ts$/, '');
      if (!EXTERNAL[mod]?.includes(m[1]!) && !m[1]!.startsWith('node:'))
        problems.push(
          `${file} imports '${m[1]}': only an adapter may import from outside the library (see EXTERNAL in tools/deps.test.ts)`,
        );
    }
  }
  assert.deepEqual(problems, []);
  // What is listed as allowed is still used: a stale entry hides the next real change.
  for (const [from, to] of Object.entries(FEATURE_USES))
    for (const t of to) assert(graph.get(from)?.has(t), `FEATURE_USES lists ${from} → ${t}, which no longer exists`);
});

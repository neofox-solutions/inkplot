// The unit tests, bundled so that a runtime without Vitest can run them (docs/guide/compatibility.md). Each test file becomes
// out/runtime-tests/<name>.mjs, which runs itself:
//   node tools/runtime-tests.ts           build them
//   for f in out/runtime-tests/*.mjs; do node "$f" || exit 1; done        run them (or `deno run -A`, or `bun`)
// The three that need a bundler, React's DOM or jsdom (jsx, react, web-components) are left to Vitest, which the whole suite runs under anyway.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { bundle } from './bundle.ts';

const root = new URL('../', import.meta.url).pathname;
const out = root + 'out/runtime-tests/';
const SKIP = new Set(['jsx.test.ts', 'react.test.ts', 'web-components.test.ts']);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = readdirSync(root + 'src').filter((f) => f.endsWith('.test.ts') && !SKIP.has(f));
for (const f of files) {
  const { code } = await bundle({
    entry: root + 'src/' + f,
    platform: 'node',
    format: 'esm',
    alias: { 'vite-plus/test': root + 'tools/runtime-test-shim.ts' },
    pinImportMeta: out,
  });
  writeFileSync(out + f.replace(/\.ts$/, '.mjs'), code);
}
console.log(`${files.length} test files in out/runtime-tests/`);

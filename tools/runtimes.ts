// Draws a chart to an SVG string on the oldest and newest of each server runtime the docs name (docs/guide/compatibility.md).
// Not part of `all`: it fetches the runtimes from npm, which takes a minute.
//   pnpm vp run runtimes
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { bundle } from './bundle.ts';

const root = new URL('../', import.meta.url).pathname;
const entry = `
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme, toSvgString } from ${JSON.stringify(root + 'src/index.ts')};
const chart = new Chart({ theme: lightTheme }, new CartesianPlane({},
  new Axis({ orientation: 'bottom' }, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()),
  new DomainSeries({ name: 'a' }, new FlatDataSource({ data: [3, 5, 4, 8, 6, 9], regularDomain: { start: 0, step: 1 } }), new LinePath({}, new LinearCurve()))));
const svg = toSvgString(chart, { width: 400, height: 240 });
if (!svg.startsWith('<svg') || !/<path/.test(svg)) throw new Error('no chart');
console.log('drew', svg.length, 'characters');
`;
mkdirSync(root + 'out', { recursive: true });
const file = root + 'out/runtimes-smoke.mjs';
writeFileSync(file, (await bundle({ contents: entry, resolveDir: root, platform: 'node', format: 'esm' })).code);

// [npm package, arguments before the file]
const runtimes: [string, string[]][] = [
  ['node@16.20.2', []],
  ['node@20.19.0', []],
  ['node@latest', []],
  ['deno@1.46.3', ['run', '-A']],
  ['deno@latest', ['run', '-A']],
  ['bun@1.0.0', []],
  ['bun@latest', []],
];
let failed = 0;
for (const [pkg, args] of runtimes) {
  const r = spawnSync('npx', ['-y', pkg, ...args, file], { encoding: 'utf8', timeout: 240_000, env: { ...process.env, NO_COLOR: '1' } });
  const ok = r.status === 0 && /drew \d+ characters/.test(r.stdout);
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${pkg.padEnd(14)} ${ok ? r.stdout.trim() : (r.stderr || r.stdout).trim().split('\n').slice(0, 4).join(' | ')}`,
  );
}
process.exit(failed ? 1 : 0);

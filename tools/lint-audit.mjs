/**
 * The strict-rules audit, for what the everyday lint (`vp lint`, configured in vite.config.ts) cannot say on its own.
 *
 * Non-null assertions. The lint forbids `!` everywhere and lets a file or a line opt out with a comment that gives the reason, which is
 * how the reads of the form `a[i]!` in numeric kernels are owned: `noUncheckedIndexedAccess` types every indexed read as possibly
 * undefined, and a loop bound that makes it safe is something the compiler cannot see. This audit then reads the source with those
 * comments removed and fails on any `!` that is not an indexed read, so a file-level opt-out cannot hide a `!` of another kind:
 * those are written as a guard, a restructure, or a `??` fallback.
 *
 * Casts. `consistent-type-assertions` (`as T`, never `as const`) is enforced the same way: a file or a line opts out with a reason, and
 * this audit only reports how many sites that covers.
 *
 * Run `node tools/lint-audit.mjs --list` to print every site.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
// Inside the repository (out/ is ignored), because `vp` only runs where it can find its workspace.
mkdirSync(join(root, 'out'), { recursive: true });
const dir = mkdtempSync(join(root, 'out', 'lint-audit-'));
let json;
try {
  writeFileSync(join(dir, 'oxlintrc.json'), JSON.stringify({
    plugins: ['typescript'],
    rules: { 'typescript/no-non-null-assertion': 'error', 'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }] },
  }));
  // A copy of the sources with the opt-out comments taken out. The files are named one by one: a folder inside the ignored out/ would be skipped.
  const bare = join(dir, 'bare'), listed = [];
  for (const sub of ['src', 'scratch/src']) {
    cpSync(join(root, sub), join(bare, sub), { recursive: true });
    for (const name of readdirSync(join(bare, sub))) {
      if (!/\.tsx?$/.test(name)) continue;
      listed.push(`${sub}/${name}`);
      const file = join(bare, sub, name);
      writeFileSync(file, readFileSync(file, 'utf8')
        .replace(/\/\* oxlint-disable[^*]*\*\/\n/g, '\n')
        .replace(/^[ \t]*\/\/ oxlint-disable-next-line typescript\/(?:no-non-null-assertion|consistent-type-assertions)[^\n]*\n/gm, '\n'));
    }
  }
  let text;
  try { text = execFileSync(join(root, 'node_modules/.bin/vp'), ['lint', '-c', join(dir, 'oxlintrc.json'), '-f', 'json', ...listed], { cwd: bare, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { text = e.stdout; }
  if (!text) throw new Error('`vp lint` printed nothing: is it installed? (pnpm install)');
  json = { diagnostics: JSON.parse(text).diagnostics, bare };
} catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }

const isTest = (f) => /\.(test|check)\.tsx?$/.test(f) || f.includes('fake-platform');
const sources = new Map();
const bytes = (f) => sources.get(f) ?? (sources.set(f, readFileSync(join(json.bare, f))), sources.get(f));
const sites = { index: [], other: [], casts: [] };
for (const d of json.diagnostics) {
  const f = d.filename;
  if (isTest(f)) continue;
  const { offset, length, line } = d.labels[0].span;
  if (d.code.includes('no-non-null-assertion')) {
    // The span is the whole expression: `a[i]!` ends in `]!`.
    (bytes(f).subarray(offset, offset + length).toString('utf8').endsWith(']!') ? sites.index : sites.other).push({ f, line });
  } else sites.casts.push({ f, line });
}
rmSync(dir, { recursive: true, force: true });

const byFile = (list) => Object.entries(list.reduce((m, s) => ((m[s.f] = (m[s.f] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
if (process.argv.includes('--list')) for (const k of Object.keys(sites)) for (const s of sites[k]) console.log(`${k}\t${s.f}:${s.line}`);
console.log(`audit: ${sites.index.length} indexed reads a[i]! (each file or line carries its reason), ${sites.other.length} other !, ${sites.casts.length} casts (each file or line carries its reason)`);
console.log(`       heaviest cast files: ${byFile(sites.casts).slice(0, 5).map(([f, n]) => `${f.replace(/^src\//, '')} ${n}`).join(', ')}`);
let bad = false;
if (sites.other.length > 0) {
  console.error(`audit: a ! that is not an indexed read: ${sites.other.map((s) => `${s.f}:${s.line}`).join(', ')}\n       write a guard, restructure, or use a ?? fallback`);
  bad = true;
}
if (bad) process.exit(1);

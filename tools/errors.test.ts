// The error codes: the table, its use, the page generated from it, and what a production build prints and leaves out.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vite-plus/test';
import { bundle } from './bundle.ts';
import { entries, reference } from './errors.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const sources = readdirSync(join(root, 'src'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => [f, readFileSync(join(root, 'src', f), 'utf8')] as const);

test('errors: the table and where it is used', () => {
  const table = entries();
  assert.ok(table.length > 100);
  const codes = table.map((e) => e.code);
  assert.deepEqual(codes, [...new Set(codes)], 'a code appears twice');
  assert.ok(
    codes.every((c) => c >= 101),
    'codes start at 101',
  );
  // The same text under two codes would be one entry for the reader.
  const texts = table.map((e) => e.message);
  assert.deepEqual(texts, [...new Set(texts)], 'two codes have the same message');
  // Placeholders count up from %0 without a gap, so a call site can be checked against them.
  for (const e of table) {
    const used = [...new Set([...e.message.matchAll(/%(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    assert.deepEqual(
      used,
      used.map((_, i) => i),
      `code ${e.code}: placeholders must be %0, %1 … without a gap`,
    );
  }
  // Every code that is thrown is in the table (the types check the values given), and every code in the table is thrown somewhere.
  // A code that is retired stays in the table (messages in the wild point at it): list it here, so that the retirement is on purpose.
  const RETIRED: number[] = [];
  const thrown = new Set<number>();
  for (const [file, text] of sources)
    for (const m of text.matchAll(/\b(?:fail|inkplotError|errorText)\(\s*(\d+)\b/g)) {
      thrown.add(Number(m[1]));
      assert.ok(codes.includes(Number(m[1])), `${file}: code ${m[1]} is not in src/messages.ts`);
    }
  // Two codes chosen by a condition, as `cond ? 252 : 253`, are not of the form above.
  for (const [, text] of sources)
    for (const m of text.matchAll(/\? (\d{3}) : (\d{3})\b/g)) {
      thrown.add(Number(m[1]));
      thrown.add(Number(m[2]));
    }
  assert.deepEqual(
    codes.filter((c) => !thrown.has(c) && !RETIRED.includes(c)),
    [],
    'in the table but never thrown: delete it only if no release used it, else add it to RETIRED',
  );
  // An error written by hand would be in every bundle in full and have no code.
  for (const [file, text] of sources)
    if (file !== 'fail.ts')
      assert.ok(!/new (?:Type|Range)?Error\(/.test(text), `${file}: use inkplotError(code, …) (src/messages.ts) rather than new Error`);
});

test('errors: the page is up to date', () => {
  const file = join(root, 'docs/reference/errors.md');
  assert.equal(
    readFileSync(file, 'utf8'),
    reference() + '\n',
    'docs/reference/errors.md is out of date: run  node tools/errors.ts > docs/reference/errors.md',
  );
});

test('errors: development prints the message, production the code and drops the table', async () => {
  const program = `import { fail } from 'inkplot-fail';\nexport function boom() { try { fail(255, 'Axis'); } catch (e) { return e.message; } }`;
  const build = (define?: Record<string, string>) =>
    bundle({
      contents: program,
      resolveDir: root,
      type: 'ts',
      minify: true,
      format: 'esm',
      platform: 'node',
      ...(define ? { define } : {}),
      alias: { 'inkplot-fail': join(root, 'src/fail.ts') },
    });
  const dir = mkdtempSync(join(tmpdir(), 'inkplot-errors-'));
  try {
    const run = async (name: string, define?: Record<string, string>) => {
      const { code } = await build(define);
      const file = join(dir, name + '.mjs');
      writeFileSync(file, code);
      const out = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `import { boom } from ${JSON.stringify(file)}; console.log(boom());`],
        { encoding: 'utf8' },
      );
      assert.equal(out.status, 0, out.stderr);
      return { code, said: out.stdout.trim() };
    };
    const development = await run('development');
    assert.equal(development.said, '[inkplot 255] Axis: has no child 0 (it needs Scale)');
    // `process.env.NODE_ENV` alone (webpack, esbuild and Rolldown with a define) removes the table.
    const production = await run('node-env', { 'process.env.NODE_ENV': '"production"' });
    assert.equal(production.said, 'Minified inkplot error: https://inkplot.neofox.solutions/errors#255 [Axis]');
    assert.ok(!production.code.includes('it needs Scale'), 'the table is still in the bundle');
    // No `process`, no `import.meta.env` and nothing defined (an unbundled module in a browser): the short message, not a crash.
    const bare = await build();
    writeFileSync(join(dir, 'bare.mjs'), bare.code);
    const out = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `delete globalThis.process; const { boom } = await import(${JSON.stringify(join(dir, 'bare.mjs'))}); console.log(boom());`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /^Minified inkplot error: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('errors: a Vite production build (import.meta.env.PROD) drops the table', async () => {
  const vite = await import('vite-plus');
  const dir = mkdtempSync(join(tmpdir(), 'inkplot-vite-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="./main.ts"></script>');
    writeFileSync(
      join(dir, 'main.ts'),
      `import { fail } from ${JSON.stringify(join(root, 'src/fail.ts'))};\ntry { fail(255, 'Axis'); } catch (e) { document.title = (e as Error).message; }`,
    );
    // Vite takes NODE_ENV from the environment when it is set, and Vitest sets it to 'test'.
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const built = await vite.build({ root: dir, logLevel: 'silent', build: { write: false } }).finally(() => {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    });
    const code = (Array.isArray(built) ? built[0]! : (built as { output: { code?: string }[] })).output
      .map((o: { code?: string }) => o.code ?? '')
      .join('');
    assert.ok(code.includes('Minified inkplot error'), 'the short message is in the build');
    assert.ok(!code.includes('it needs Scale'), 'the table is still in the Vite build');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Stands in for `vite-plus/test` when the unit tests are bundled to run on a runtime that Vitest does not support (the oldest
// Node, Deno, Bun): a test runs as soon as it is declared, and a failure fails the process.
import process from 'node:process';

// Vitest runs the tests of a file one after another; so does this: each waits for the one before. The count is printed when the
// process ends, so a file that registers no tests (or stops early) is seen rather than passing in silence.
let chain: Promise<void> = Promise.resolve();
let ran = 0;
// Deno before 2 has no global `process`; fail.ts reads `process.env.NODE_ENV` and, finding no `process`, would use the short production message the tests do not expect.
(globalThis as { process?: unknown }).process ??= process;
process.on('beforeExit', () => {
  console.log(`# ${ran} tests`);
  if (ran === 0) process.exitCode = 1;
});

export const test = (name: string, run: () => unknown): Promise<void> => {
  chain = chain.then(async () => {
    ran++;
    try {
      await run();
      console.log(`ok ${name}`);
    } catch (e) {
      console.error(`FAIL ${name}\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      process.exitCode = 1;
    }
  });
  return chain;
};

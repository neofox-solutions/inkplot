// Stands in for `vite-plus/test` when the unit tests are bundled to run on a runtime that Vitest does not support (the oldest
// Node, Deno, Bun): a test runs as soon as it is declared, and a failure fails the process.
import process from 'node:process';

export const test = async (name: string, run: () => unknown): Promise<void> => {
  try {
    await run();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exitCode = 1;
  }
};

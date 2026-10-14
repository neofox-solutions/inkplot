#!/usr/bin/env node
// The entry point of the `inkplot` command: reads the real environment and hands it to `run`.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './main.ts';

// The package's own files sit next to this one once packed, and one folder up in the repository.
const here = dirname(fileURLToPath(import.meta.url)),
  root = existsSync(join(here, 'package.json')) ? here : join(here, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  home: homedir(),
  source: join(root, 'skill'),
  version,
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});

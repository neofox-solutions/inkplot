// The error reference, generated from src/messages.ts so that it cannot drift: a production build prints only a code and a link to
// the entry for that code (https://inkplot.neofox.solutions/errors#101), and this is the page the link points at.
//   node tools/errors.ts            prints docs/reference/errors.md
// tools/docs.test.ts checks that the file in docs/ matches what this prints.
import { readFileSync } from 'node:fs';
import { messages } from '../src/messages.ts';

export type ErrorEntry = { code: number; message: string; module: string };

/** The table in src/messages.ts, read as text so that the module is not loaded (and the order and the grouping comments are kept). */
export function entries(): ErrorEntry[] {
  const text = readFileSync(new URL('../src/messages.ts', import.meta.url), 'utf8');
  const out: ErrorEntry[] = [];
  let module = '';
  for (const line of text.split('\n')) {
    const group = /^ {2}\/\/ (.+)$/.exec(line);
    if (group) module = group[1]!;
    const row = /^ {2}(\d+): /.exec(line);
    if (row) out.push({ code: Number(row[1]), message: String(Reflect.get(messages, row[1]!)), module });
  }
  return out;
}

export function reference(): string {
  const rows = entries();
  const lines = [
    '# Error codes',
    '',
    'A development build of inkplot throws errors with a full message: `[inkplot 144] X is not in a chart`. A production build leaves the messages out to keep the bundle small, and throws `Minified inkplot error: https://inkplot.neofox.solutions/errors#144` instead, with the values the message mentions in brackets after the link. Find the code here.',
    '',
    'In a message, `%0`, `%1` … stand for those values, in order. To see the full messages while you debug a production build, run the build in development mode (see [Compatibility](../guide/compatibility.md)).',
    '',
  ];
  for (const e of rows) lines.push(`## ${e.code}`, '', '```text', e.message, '```', '', `First thrown in ${e.module}.`, '');
  return lines.join('\n').trimEnd();
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) console.log(reference());

// The camelCase style names the Web Components adapter knows are the ones theme.ts declares.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STYLE_NAMES } from './style-names.ts';
import { test } from 'vite-plus/test';

test("style-names", () => {
const source = readFileSync(new URL('./theme.ts', import.meta.url), 'utf8');
const declared = new Set<string>();
// Every property of every interface in theme.ts that has a capital in its name.
for (const body of source.matchAll(/^export interface \w+ \{([\s\S]*?)^\}/gm)) {
  for (const m of body[1]!.matchAll(/^\s+(?:\/\/.*\n\s+)*(\w+)\??:/gm)) if (/[A-Z]/.test(m[1]!)) declared.add(m[1]!);
}
// And the same where they are written on one line.
for (const m of source.matchAll(/export interface \w+ \{([^}\n]*)\}/g)) for (const n of m[1]!.matchAll(/(\w+)\??:/g)) if (/[A-Z]/.test(n[1]!)) declared.add(n[1]!);
assert.ok(declared.size > 20, `found the names (${declared.size})`);
assert.deepEqual([...declared].filter((n) => !(STYLE_NAMES as readonly string[]).includes(n)), [], 'every declared name is listed');
assert.equal(new Set(STYLE_NAMES).size, STYLE_NAMES.length, 'none twice');
const lower = STYLE_NAMES.map((n) => n.toLowerCase());
assert.equal(new Set(lower).size, lower.length, 'none differs from another only in case');
});

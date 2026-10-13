/** What the adapters (React, Web Components) share: writing only the attributes that differ. */
import { expandAttributes } from './attrs.ts';

type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
/** Same value, or same content for plain objects and arrays (not typed arrays, elements or anything else with an identity). */
export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (isPlain(a) && isPlain(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  return false;
}
/** What to change to get from `prev` to `next`: changed values, and `undefined` for what is gone. Null when nothing differs. */
export function difference(prev: Plain, next: Plain): Plain | null {
  let patch: Plain | null = null;
  for (const k of Object.keys(next)) if (!same(prev[k], next[k])) (patch ??= {})[k] = next[k];
  for (const k of Object.keys(prev)) if (!(k in next)) (patch ??= {})[k] = undefined;
  return patch;
}
/** The element's attributes from props: nested names expanded, and what is `undefined` left out. */
export function attributesOf(props: Plain, options?: Parameters<typeof expandAttributes>[1]): Plain {
  const attrs = expandAttributes(props, options);
  for (const k of Object.keys(attrs)) if (attrs[k] === undefined) delete attrs[k];
  return attrs;
}


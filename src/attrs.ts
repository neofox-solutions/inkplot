/**
 * Attribute names and types for the places that only have strings and flat names: XML-like syntaxes (JSX, HTML).
 *
 * Two jobs, both small:
 *
 * 1. `expandAttributes` turns hyphenated names into nested objects, because those syntaxes carry only primitives:
 *    `meta-title="Sales"` is `{ meta: { title: 'Sales' } }`. Having both an object and nested names for one key is an error.
 * 2. Every element class lists, in `static attrTypes`, the attributes an HTML parser would get wrong: names with capitals
 *    (HTML lowercases them, so `strokewidth` must find `strokeWidth`) and text that looks like something else (a title
 *    of `2024` must stay text). Attributes that hold objects list their parts the same way, nested:
 *    `{ meta: { title: STRING }, padding: { topSide: NUMBER } }`. Everything else is left to automatic coercion.
 *    The compiler enforces the list (`AttrTypesFor`), so a new attribute cannot be forgotten.
 *
 * Only the Web Components adapter reads `attrTypes`; the classes carry them as plain data, which costs a few bytes each.
 */

import type { AnyElement } from './element.ts';
import type { Theme } from './theme.ts';

/** How an HTML attribute's text becomes a value. AUTO: `true`/`false` and numbers convert, `[…]` and `{…}` are JSON, the rest is text. */
export const AUTO = 0;
/** Always text: titles, names, ids, colours. Needed wherever the text might look like a number or a boolean. */
export const STRING = 1;
/** A number, whatever it looks like. */
export const NUMBER = 2;
/** A boolean: present with no value, or `true`, is true; `false` is false. */
export const BOOLEAN = 3;
export type Coerce = typeof AUTO | typeof STRING | typeof NUMBER | typeof BOOLEAN;
/** How one attribute's text becomes a value, or, for an attribute that holds an object, the same for each part of it. */
export type AttrType = Coerce | AttrTypes;
/** An element class' attribute types by name, as in `{ strokeWidth: NUMBER, padding: { topSide: NUMBER } }`. Inherited ones are repeated by spreading the parent's. */
export interface AttrTypes { readonly [name: string]: AttrType }

declare const opaque: unique symbol;
/** Marks an attribute that holds an object which only code can supply (a library namespace), so it has no nested spec. */
export type Opaque<T> = T & { readonly [opaque]?: never };

/** The plain object an attribute type holds (what a nested spec describes), or never: not functions, arrays, data, elements, dates or the style theme. */
type Inner<T> = NonNullable<T> extends infer N
  ? N extends (...args: never[]) => unknown ? never
    : typeof opaque extends keyof N ? never
    : N extends readonly unknown[] | ArrayLike<unknown> | AnyElement | Date | Theme | string | number | boolean ? never
    : N extends object ? (string extends keyof N ? never : N) : never
  : never;
/** A text-only type: the AUTO guess could turn its text into a number or a boolean. */
type TextOnly<T> = string extends NonNullable<T> ? number extends NonNullable<T> ? never : boolean extends NonNullable<T> ? never : true : never;

/**
 * The attributes of `A` that must be listed in `attrTypes`: those with a capital in the name; those that are text and
 * nothing else (not also a number or a boolean), because AUTO could turn their text into one of those; and those that hold an
 * object with parts that need one of the two (`meta` has a `title`), which are listed with a nested spec.
 */
export type NeededAttrs<A> = {
  [K in keyof A & string]-?: [Inner<A[K]>] extends [never]
    ? (K extends Lowercase<K> ? ([TextOnly<A[K]>] extends [never] ? never : K) : K)
    : (K extends Lowercase<K> ? ([NeededAttrs<Inner<A[K]>>] extends [never] ? never : K) : K);
}[keyof A & string];
type SpecFor<T> = [Inner<T>] extends [never] ? Coerce : [NeededAttrs<Inner<T>>] extends [never] ? Coerce | AttrTypes : AttrTypesFor<Inner<T>>;
/** What `static attrTypes` must satisfy for an element whose attributes are `A`: every needed name, each with a type (or a nested spec). */
export type AttrTypesFor<A> = { readonly [K in NeededAttrs<A>]: SpecFor<A[K]> } & AttrTypes;

type Obj = Record<string, unknown>;

/** What `expandAttributes` can be told. Both are for the Web Components adapter; JSX and React pass names as written. */
export interface ExpandOptions {
  /** The real name for a path segment, given the segments above it (HTML hands over lowercase). Default: as written. */
  name?: (segment: string, parents: readonly string[]) => string;
  /** The value for the attribute at `path` (HTML hands over text). Default: as given. */
  value?: (path: readonly string[], value: unknown) => unknown;
}

/**
 * The attributes an element takes, from a flat set of names and values in which hyphens mean nesting.
 * Names without hyphens pass through, and values are never copied, so objects and functions stay the same objects.
 * An attribute whose value is `undefined` counts as not given for conflicts, but stays in the result when nothing else claims the key.
 * Throws when one key is given both as a value and as a path to nested values (`meta` and `meta-title`, or `a-b` and `a-b-c`),
 * when a name has an empty part (`a--b`), or for `__proto__`.
 */
export function expandAttributes(flat: Readonly<Obj>, options: ExpandOptions = {}): Obj {
  const out: Obj = {};
  /** The objects made here, as opposed to ones the caller passed, which must not be written into. */
  const made = new WeakSet<object>();
  for (const key of Object.keys(flat)) {
    const raw = key.split('-');
    const path: string[] = [];
    for (const part of raw) {
      if (part === '') throw new Error(`attribute '${key}': empty name part`);
      const name = options.name ? options.name(part, path) : part;
      if (name === '__proto__') throw new Error(`attribute '${key}': not allowed`);
      path.push(name);
    }
    let at = out;
    for (let i = 0; i < path.length - 1; i++) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      const name = path[i]!;
      const have = Object.hasOwn(at, name) ? at[name] : undefined;
      if (have === undefined) {
        const next: Obj = {};
        made.add(next);
        at[name] = next;
        at = next;
      } else if (typeof have === 'object' && have !== null && made.has(have)) {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- `made` holds only the objects this function created, so a member of it is one of our `Obj`
        at = have as Obj;
      } else {
        throw new Error(`attribute '${key}' conflicts with '${path.slice(0, i + 1).join('-')}', which is a value`);
      }
    }
    // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
    const last = path[path.length - 1]!;
    const value = options.value ? options.value(path, flat[key]) : flat[key];
    if (Object.hasOwn(at, last)) {
      // An attribute given as `undefined` means "not set", so it never conflicts with the same key given nested.
      if (value === undefined) continue;
      const have = at[last];
      if (have === undefined) { at[last] = value; continue; }
      throw new Error(typeof have === 'object' && have !== null && made.has(have)
        ? `attribute '${key}' conflicts with '${key}-…', which are nested values`
        : `attribute '${key}' is given twice`);
    }
    at[last] = value;
  }
  return out;
}

// ─── Types for JSX ───

/** The hyphenated names of nested attributes in a props type (`meta-title`, `style-tickLabel-size`), which are checked as leaves. */
export type NestedProps = { [name: `${string}-${string}`]: string | number | boolean | undefined };
/** A child as written: an element, nothing (a skipped condition), or a list of those. */
export type JsxChild<E> = E | null | undefined | boolean | readonly JsxChild<E>[];
/** Receives the element made for a JSX tag. */
export type JsxRef<E> = ((element: E) => void) | { current: E | null };

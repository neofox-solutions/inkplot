/**
 * Elements to and from plain JSON. Attributes are already plain data and children are ordered, so a tree maps directly to
 * `{ type, attrs, children }`, which is what lets adapters, saved configs and an editor share one format.
 *
 *     const json = toJSON(chart, registry);              // JSON.stringify-able
 *     const copy = fromJSON(json, registry);             // a new, unattached tree
 *     applyJSON(chart, editedJson, registry);            // the same tree, changed to match
 *
 * The version
 * ───────────
 * The root of what `toJSON` returns has `version: [major, minor]`, and `fromJSON` and `applyJSON` read only a document
 * whose major is the same as this release's and whose minor is not newer, so a document kept for years is either read as
 * written or refused with a message, and never read as something it was not. A minor changes when the form gains
 * something an older release cannot read (a new marker, a new element or attribute); a major when it loses or changes
 * something (an element or attribute removed or renamed, a different meaning, a marker gone). The version covers the form
 * and the library's own elements and attributes; classes of your own are yours to keep compatible, and there is no
 * migration: an old document is read as it is or refused. `JSON_VERSION` is the current one, for writing JSON by hand.
 *
 * The registry
 * ────────────
 * `type` is the name a class is registered under (`registry.ts` has all of the library's). An element is written under the
 * name its exact class has, so a class of your own is one more entry: `{ ...registry, MyScale }`. Naming a class that is
 * not in the registry is an error that says so, with the place in the tree.
 *
 * What an attribute may hold
 * ──────────────────────────
 *  - Plain data goes through as it is: strings, booleans, finite numbers, arrays, plain objects (themes, `style`, bindings).
 *  - A number that is not finite (`NaN`, `Infinity`) is `{ "$number": "NaN" }`, since JSON has no such thing.
 *  - A typed array is `{ "$typed": "Float64Array", "data": [...] }` with `null` for NaN, so a gap in the data survives.
 *  - An element is its `id` (which is what every attribute that takes an element accepts), so it must have one.
 *  - Anything else JSON cannot hold, which is chiefly code (a `format` function, an `onClick`) and big or live data (an
 *    array of rows you go on editing), is `{ "$ref": "name" }`, and `name` is looked up in the `Refs` you give when reading.
 *
 * Refs
 * ────
 * A `Refs` is a table of names for objects and functions. Writing looks values up in it by identity, so a theme you named
 * `lightTheme` is written as `{ "$ref": "lightTheme" }` rather than spelled out. With `auto: true` it names what it is
 * asked about and does not know (`onFlush`, `format2`…), so any chart can be written; without it, an unnamed function is an
 * error that tells you what to name. Arrays longer than `inlineLimit` (default 1000) count as data too and go by reference:
 * that is the line between a chart's configuration and its data. Reading needs the same table.
 *
 * `applyJSON` changes a live tree to match edited JSON, in place: an attribute that already reads the same is left alone
 * (so a ref'd array keeps its identity, and a decimator its cache), one that differs is set, one that is gone is removed, and
 * children are matched by position and type, replaced if the type changed. It works out everything first and changes
 * nothing if the JSON turns out to be unreadable, so a bad edit leaves the chart as it was.
 */
import { hasOwn } from './attrs.ts';
import { type AnyArgs, type AnyElement, ChartElement, fail } from './element.ts';

/* oxlint-disable typescript/consistent-type-assertions -- reads untrusted JSON and arbitrary attribute values: each value is checked at runtime (`typeof`, `Array.isArray`, the registry) and then narrowed to the shape just checked */

/** The version of the JSON form: `[major, minor]`. See the top of this file for what a change to each means. */
export type JSONVersion = readonly [major: number, minor: number];

/**
 * The JSON form this release writes, and the newest it reads. Frozen, so it can be shared: to write JSON by hand, put
 * `version: JSON_VERSION` on the root; to read a document that is refused as incompatible anyway, set `version` to it
 * (the contents are then read as they are, and any attribute or element that has since changed is up to you).
 */
export const JSON_VERSION: JSONVersion = Object.freeze([1, 0] as const);

/** The JSON form of one element: its registered class name, attributes, and children in order. The root also has the `version`. */
export interface ElementJSON {
  /** Only on the root of a document (what `toJSON` returns); required there by `fromJSON` and `applyJSON`, and absent from the children. */
  version?: JSONVersion;
  type: string;
  attrs?: Record<string, unknown>;
  children?: ElementJSON[];
}
/** Maps `type` names to classes, and back: an element is written under the name its class is registered by. */
/** The text of anything thrown: a constructor or a refs lookup may throw a value that is not an Error. */
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type ElementRegistry = Readonly<Record<string, new (...args: AnyArgs) => AnyElement>>;

/** Names for objects and functions that JSON cannot hold, so that writing can point at them and reading can find them again. */
export class Refs {
  readonly #byName = new Map<string, unknown>();
  readonly #byValue = new Map<unknown, string>();
  /** Name whatever is asked about and not yet named, after the attribute it was found in. */
  auto: boolean;

  constructor(values: Readonly<Record<string, unknown>> = {}, options: { auto?: boolean } = {}) {
    this.auto = options.auto ?? false;
    for (const [name, value] of Object.entries(values)) this.set(name, value);
  }
  /** Name a value. The name must be free; a value that already has a name keeps it first and answers to both on reading. */
  set(name: string, value: unknown): this {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) fail(205, name);
    if (this.#byName.has(name) && this.#byName.get(name) !== value) fail(204, name);
    this.#byName.set(name, value);
    if (!this.#byValue.has(value)) this.#byValue.set(value, name);
    return this;
  }
  has(name: string): boolean {
    return this.#byName.has(name);
  }
  get(name: string): unknown {
    if (!this.#byName.has(name))
      fail(203, name, this.#byName.size ? ` (known: ${[...this.#byName.keys()].slice(0, 12).join(', ')})` : ' (there are none)');
    return this.#byName.get(name);
  }
  /** The name a value goes by, if it has one. */
  nameOf(value: unknown): string | undefined {
    return this.#byValue.get(value);
  }
  /** Give a value a name of its own, built on `hint` and made unique. Returns the one it has already, if so. */
  adopt(value: unknown, hint = 'ref'): string {
    const known = this.nameOf(value);
    if (known !== undefined) return known;
    let name = hint,
      n = 1;
    while (this.#byName.has(name)) name = hint + ++n;
    this.set(name, value);
    return name;
  }
  /** Drop a name, and the value's claim to it: for a long-lived table whose automatic names would otherwise pile up as data is replaced. */
  forget(name: string): void {
    if (!this.#byName.has(name)) return;
    const value = this.#byName.get(name);
    this.#byName.delete(name);
    if (this.#byValue.get(value) !== name) return;
    this.#byValue.delete(value);
    for (const [other, v] of this.#byName) if (v === value) return void this.#byValue.set(value, other);
  }
  get names(): readonly string[] {
    return [...this.#byName.keys()];
  }
}

export interface SerializeOptions {
  /** Where functions and other things JSON cannot hold are found, and named. */
  refs?: Refs;
  /** Arrays longer than this are data and go by reference, not inline. Default 1000. */
  inlineLimit?: number;
}

// ─── Names ───

const names = new WeakMap<ElementRegistry, Map<unknown, string>>();
function nameOf(ctor: unknown, registry: ElementRegistry, path: string): string {
  let map = names.get(registry);
  if (!map) {
    map = new Map();
    for (const [name, c] of Object.entries(registry)) if (!map.has(c)) map.set(c, name);
    names.set(registry, map);
  }
  const name = map.get(ctor);
  if (name === undefined)
    fail(202, at(path), (ctor as { name?: string }).name || 'an anonymous class', (ctor as { name?: string }).name || 'Mine');
  return name;
}
const at = (path: string) => (path ? `${path}: ` : '');

// ─── Writing ───

const TYPED = [
  'Float64Array',
  'Float32Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Uint8Array',
  'Uint16Array',
  'Uint32Array',
  'Uint8ClampedArray',
] as const;
interface Writing {
  readonly registry: ElementRegistry;
  readonly refs: Refs | undefined;
  readonly limit: number;
}

/** What a value is called when it is the attribute `path` names, for a ref that has to be made up. */
const hintOf = (path: string) => /([A-Za-z_]\w*)(?:\[\d+\])*$/.exec(path)?.[1] ?? 'ref';

function byReference(value: unknown, path: string, w: Writing, what: string): unknown {
  if (w.refs?.auto) return { $ref: w.refs.adopt(value, hintOf(path)) };
  fail(201, at(path), what);
}

function encode(v: unknown, path: string, w: Writing): unknown {
  if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
    const named = w.refs?.nameOf(v);
    if (named !== undefined) return { $ref: named };
  }
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return v;
    case 'number':
      return Number.isFinite(v) ? v : { $number: String(v) };
    case 'undefined':
      return null;
    case 'function':
      return byReference(v, path, w, 'a function');
    case 'bigint':
    case 'symbol':
      return fail(200, at(path), typeof v);
  }
  if (v === null) return null;
  if (v instanceof ChartElement) {
    const id = (v.attrs as { id?: unknown }).id;
    if (typeof id !== 'string') fail(199, at(path), v.constructor.name);
    return id;
  }
  if (ArrayBuffer.isView(v)) {
    const type = v.constructor.name,
      a = v as unknown as ArrayLike<number>;
    if (!(TYPED as readonly string[]).includes(type)) return byReference(v, path, w, `a ${type}`);
    if (a.length > w.limit) return byReference(v, path, w, `${type} of ${a.length} numbers (the inline limit is ${w.limit})`);
    try {
      return { $typed: type, data: Array.from(a, (n) => (Number.isFinite(n) ? n : n !== n ? null : String(n))) };
    } catch (e) {
      if (/detached/.test(messageOf(e))) fail(198, at(path), type);
      throw e;
    }
  }
  if (Array.isArray(v)) {
    if (v.length > w.limit) return byReference(v, path, w, `an array of ${v.length} values (the inline limit is ${w.limit})`);
    return v.map((x, i) => encode(x, `${path}[${i}]`, w));
  }
  const object = v as Record<string, unknown>,
    proto = Object.getPrototypeOf(object);
  if (proto === Object.prototype || proto === null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(object)) {
      const x = object[key];
      if (x === undefined) continue;
      if (key.startsWith('$')) fail(197, at(path), key);
      out[key] = encode(x, path ? `${path}.${key}` : key, w);
    }
    return out;
  }
  return byReference(v, path, w, `a ${(v as object).constructor?.name ?? 'object'}`);
}

function write(element: AnyElement, path: string, w: Writing): ElementJSON {
  const json: ElementJSON = { type: nameOf(element.constructor, w.registry, path) };
  const attrs: Record<string, unknown> = {};
  for (const key of Object.keys(element.attrs)) {
    const value = (element.attrs as Record<string, unknown>)[key];
    if (value !== undefined) attrs[key] = encode(value, `${path ? path + '.' : ''}attrs.${key}`, w);
  }
  if (Object.keys(attrs).length) json.attrs = attrs;
  const children = [...element].map((c, i) => write(c, `${path ? path + '.' : ''}children[${i}]`, w));
  if (children.length) json.children = children;
  return json;
}

/** An element and everything below it as JSON. See the top of this file for what an attribute may hold. */
export function toJSON(element: AnyElement, registry: ElementRegistry, options: SerializeOptions = {}): ElementJSON {
  return {
    version: [JSON_VERSION[0], JSON_VERSION[1]],
    ...write(element, '', { registry, refs: options.refs, limit: options.inlineLimit ?? 1000 }),
  };
}

/** Refuses a document of another major version, or a newer minor, or one with no version at all. */
function checkVersion(json: ElementJSON): void {
  if (json === null || typeof json !== 'object') return; // the reader says what it is
  const v: unknown = json.version;
  const ok = Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0);
  if (!ok) fail(196, JSON_VERSION.join('.'));
  const [major, minor] = v as number[];
  if (major !== JSON_VERSION[0] || (minor as number) > JSON_VERSION[1])
    fail(195, major, minor, JSON_VERSION[0], JSON_VERSION.join('.'), major !== JSON_VERSION[0] ? 'an incompatible' : 'a newer');
}

// ─── Reading ───

function decode(v: unknown, path: string, refs: Refs | undefined): unknown {
  if (Array.isArray(v)) return v.map((x, i) => decode(x, `${path}[${i}]`, refs));
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if ('$ref' in o) {
    if (typeof o.$ref !== 'string') fail(194, at(path));
    if (!refs) fail(193, at(path), o.$ref);
    try {
      return refs.get(o.$ref);
    } catch (e) {
      return fail(192, at(path), messageOf(e));
    }
  }
  if ('$number' in o) {
    const n = { NaN, Infinity, '-Infinity': -Infinity }[String(o.$number)];
    if (n === undefined) fail(191, at(path));
    return n;
  }
  if ('$typed' in o) {
    const type = String(o.$typed);
    if (!(TYPED as readonly string[]).includes(type) || !Array.isArray(o.data)) fail(190, at(path), TYPED.join(', '));
    // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
    const Ctor = (globalThis as unknown as Record<string, new (a: number[]) => unknown>)[type]!;
    const data = (o.data as unknown[]).map((n, i) => {
      if (n === null) return NaN;
      if (n === 'Infinity') return Infinity;
      if (n === '-Infinity') return -Infinity;
      if (typeof n !== 'number') fail(189, at(path), i, JSON.stringify(n));
      return n;
    });
    return new Ctor(data);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o)) {
    if (key.startsWith('$')) fail(188, at(path), key);
    // Assigning `__proto__` would replace the object's prototype instead of adding a key.
    if (key === '__proto__') fail(187, at(path));
    out[key] = decode(o[key], path ? `${path}.${key}` : key, refs);
  }
  return out;
}

function lookup(type: unknown, registry: ElementRegistry, path: string): new (...args: AnyArgs) => AnyElement {
  if (typeof type !== 'string') fail(186, at(path));
  if (!hasOwn(registry, type)) {
    const near = Object.keys(registry).filter(
      (n) => n.toLowerCase().includes(type.toLowerCase()) || type.toLowerCase().includes(n.toLowerCase()),
    );
    fail(
      185,
      at(path),
      type,
      near.length ? ` (did you mean ${near.slice(0, 4).join(', ')}?)` : ` (the registry has ${Object.keys(registry).length} types)`,
    );
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
  return registry[type]!;
}

function build(json: ElementJSON, registry: ElementRegistry, refs: Refs | undefined, path: string): AnyElement {
  if (json === null || typeof json !== 'object') fail(184, at(path));
  const Ctor = lookup(json.type, registry, path);
  const attrs = json.attrs === undefined ? {} : decode(json.attrs, `${path ? path + '.' : ''}attrs`, refs);
  if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs)) fail(183, at(path));
  if (json.children !== undefined && !Array.isArray(json.children)) fail(181, at(path));
  const children = (json.children ?? []).map((c, i) => build(c, registry, refs, `${path ? path + '.' : ''}children[${i}]`));
  try {
    return new Ctor(attrs, ...children);
  } catch (e) {
    return fail(182, at(path), json.type, messageOf(e));
  }
}

/** A new, unattached element tree from JSON. `refs` is where the `$ref`s are found. */
export function fromJSON<T extends AnyElement = AnyElement>(
  json: ElementJSON,
  registry: ElementRegistry,
  options: SerializeOptions = {},
): T {
  checkVersion(json);
  return build(json, registry, options.refs, '') as T;
}

// ─── Changing a live tree ───

/** Deep equality of two JSON values, however their keys are ordered. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a),
    kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => hasOwn(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function plan(el: AnyElement, json: ElementJSON, path: string, w: Writing, ops: (() => void)[]): void {
  const here = path ? path + '.' : '';
  const want = json.attrs === undefined ? {} : (decode(json.attrs, `${here}attrs`, w.refs) as Record<string, unknown>);
  const wantJson = json.attrs ?? {},
    have = el.attrs as Record<string, unknown>,
    patch: Record<string, unknown> = {};
  let changed = false;
  for (const key of Object.keys(wantJson)) {
    // Compare in JSON form, so an inline value that is unchanged is not replaced by a fresh copy of itself.
    const now = have[key] === undefined ? undefined : encode(have[key], `${here}attrs.${key}`, w);
    if (now !== undefined && same(now, wantJson[key])) continue;
    patch[key] = want[key];
    changed = true;
  }
  for (const key of Object.keys(have))
    if (have[key] !== undefined && !hasOwn(wantJson, key)) {
      patch[key] = undefined;
      changed = true;
    }
  if (changed) ops.push(() => el.setAttributes(patch));

  const kids = [...el],
    wanted = json.children ?? [];
  if (!Array.isArray(wanted)) fail(181, at(path));
  wanted.forEach((child, i) => {
    const at = `${here}children[${i}]`,
      existing = kids[i];
    if (existing && typeof child === 'object' && child && nameOf(existing.constructor, w.registry, at) === child.type) {
      plan(existing, child, at, w, ops);
      return;
    }
    const fresh = build(child, w.registry, w.refs, at);
    if (existing)
      ops.push(() => {
        existing.before(fresh);
        existing.remove();
      });
    else ops.push(() => el.append(fresh));
  });
  for (let i = wanted.length; i < kids.length; i++) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
    const gone = kids[i]!;
    ops.push(() => gone.remove());
  }
}

/**
 * Change a live tree to match JSON, in place, so state it holds (a zoom, a data source's identity) is kept wherever the JSON
 * does not say otherwise. Nothing is changed unless all of the JSON reads; the root's type has to be the same.
 */
export function applyJSON(element: AnyElement, json: ElementJSON, registry: ElementRegistry, options: SerializeOptions = {}): void {
  const w: Writing = { registry, refs: options.refs, limit: options.inlineLimit ?? 1000 };
  if (json === null || typeof json !== 'object') fail(180);
  checkVersion(json);
  if (nameOf(element.constructor, registry, '') !== json.type) fail(179, element.constructor.name, json.type);
  const ops: (() => void)[] = [];
  plan(element, json, '', w, ops);
  for (const op of ops) op();
}

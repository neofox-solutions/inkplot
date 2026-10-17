/**
 * The element base class: a retained tree with three links per node, typed children, events and tree utilities.
 *
 * How the pieces fit together
 * ───────────────────────────
 * Elements form one tree (Chart → Plane → Axis/Series → data/renderers). Three systems live on top of it:
 *
 * 1. Events. A parent never calls a child's methods to lay it out or draw it; it sends an event (`measureChild`,
 *    `arrangeChild`, or `broadcast` for ATTACH/PAINT/POINTER/HOVER) and the child's `onEvent` answers. One extension
 *    point means subclasses stay small, and the same tree can be driven by tests, by an adapter, or by the real chart.
 * 2. Drawing. Each element draws through its own `Surface` (created lazily, so non-drawing elements cost nothing),
 *    which keeps its platform nodes keyed and skips attribute writes that did not change. Elements do not know where
 *    their nodes sit among the others' — see "Placement" below.
 * 3. Invalidation. Any change calls `invalidate()`, which walks to the root; the chart there schedules a flush that
 *    re-runs layout and paint over the whole tree. Re-running everything is cheap because Surface caches the output.
 *
 * Placement: the document order of SVG nodes must follow tree order (so a later sibling paints over an earlier one),
 * yet elements are mounted, drawn and removed independently. Rather than store positions, each Surface asks the live
 * tree on demand: `container()` (the nearest ancestor wrapper `<g>`, else the platform root) and `end()` (the first
 * node of whatever element draws next). Because the answer is derived from the tree, inserting or removing an element
 * anywhere cannot leave a stale position behind.
 */
import type { Chart } from './chart.ts';
import {
  type ChartEvent,
  type ChartEventInit,
  EVENT_ARRANGE,
  EVENT_ATTACH,
  EVENT_MEASURE,
  EVENT_PAINT,
  type MeasureEvent,
  makeEvent,
} from './events.ts';
import type { LayoutRequest, Rect, Size } from './geometry.ts';
import type { Platform, PlatformNode } from './platform.ts';
import type { Roots, SelectorName, Theme } from './theme.ts';
import { resolveStyle } from './theme.ts';
import { type Counters, Surface } from './surface.ts';
import { type AttrTypesFor, type JsxChild, STRING } from './attrs.ts';

/* oxlint-disable typescript/consistent-type-assertions -- the generic base class: attributes and children are typed by each subclass's type parameters, which the base can reach only by narrowing after construction or a runtime `instanceof` check */

/**
 * Naming for an element, for people who cannot see it. `title` is its accessible name and `description` a longer account
 * of it. `role` overrides the ARIA role the element would have, and `aria` sets any other ARIA attributes by name
 * (`{ 'aria-roledescription': 'sparkline' }`, or `{ roledescription: 'sparkline' }`). See aria.ts.
 */
export interface Meta {
  title?: string;
  description?: string;
  role?: string;
  aria?: Record<string, string | number | boolean>;
}
/** What every element accepts. */
export interface BaseAttributes {
  /** Lets other elements (and JSON/adapter configs) refer to this one by name; see `resolveRef`. */
  id?: string;
  meta?: Meta;
  /** False hides the element and everything inside it without removing it, so toggling is cheap and keeps state. */
  visible?: boolean;
  /**
   * Looks for this element and everything below it, by selector (see theme.ts). Nearer blocks beat farther ones, and every
   * block beats the chart's base theme. The element's own attributes that share a style property's name (`stroke`, `fill`…)
   * are the same thing set directly, and beat any block.
   */
  style?: Theme;
}
/**
 * Any element, whatever its children and attributes. `any` is required here: element types are invariant in their children
 * (they appear in both the constructor and `children`) and in their attributes, so no concrete type, not even `unknown`, accepts every element.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- see the comment above: invariance means only `any` accepts every element
export type AnyElement = ChartElement<any, any, any>;
/**
 * The parameter list of "any constructor". Constructor parameters are contravariant, so `unknown[]` would reject every class with a typed
 * parameter; `never[]` would make the class uncallable. `any[]` is the only list every constructor accepts.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- see the comment above
export type AnyArgs = any[];

/**
 * Attributes first, then the children as declared by the parent. A parent declares them as a tuple type:
 * `[Scale]` is exactly one scale, `[DataNode, ...SeriesRenderer[]]` is one source then any renderers,
 * `Axis[]` is any number. Attributes may be left out when none are required.
 */
export type ElementArgs<A, Children extends readonly AnyElement[]> =
  | [attrs: A, ...children: Children]
  | ({} extends A ? [...children: Children] : never);
export type ElementClass<T extends AnyElement = AnyElement> = abstract new (...args: AnyArgs) => T;
/** A class whose instances are (some of) `T`: for a union, a class of any one member. */
export type ClassFor<T> = T extends unknown ? abstract new (...args: AnyArgs) => T : never;

/** An element, or the id of one. Vanilla code passes the variable; adapters and JSON pass the id. */
export type ElementRef<T extends AnyElement = AnyElement> = T | string;

/** What an attached element needs from the chart: where to draw, and the counters Surface reports into. */
export interface MountContext {
  platform: Platform;
  counters: Counters;
}

/** The answer of an element that did not respond to MEASURE: it wants nothing and can take anything. */
/**
 * Counts every change that can alter what an id means from where it is looked up: a child added or removed, an id set. What a
 * `resolveRef` found is kept with the number it was found at and trusted while the number is the same. A search for an id that is
 * not near can cross the whole tree, and a flush asks for the same few dozen ids over and over; edits are rare next to flushes.
 */
let treeVersion = 0;

const NO_REQUEST: LayoutRequest = { min: { width: 0, height: 0 }, max: { width: Infinity, height: Infinity } };

/**
 * The element type of a parent's variadic tail: the children that may come and go.
 * `[Scale]` has none, `[DataNode, ...SeriesRenderer[]]` has SeriesRenderer, `Axis[]` has Axis.
 */
export type VariadicChild<C extends readonly unknown[]> = C extends readonly [unknown, ...infer Rest]
  ? VariadicChild<Rest>
  : C extends readonly (infer E)[]
    ? E
    : never;
/** The positions of a parent's fixed children, which are always present and can only be replaced. */
export type FixedIndex<C extends readonly unknown[], Seen extends unknown[] = []> = C extends readonly [unknown, ...infer Rest]
  ? Seen['length'] | FixedIndex<Rest, [...Seen, unknown]>
  : never;

/**
 * A node with three links: its parent, its first child, and its next sibling. Nothing else is stored, so
 * finding a predecessor or the tail walks the siblings, which is cheap at the sizes charts have.
 */
export abstract class ChartElement<
  Parent extends AnyElement | null = AnyElement | null,
  Children extends readonly AnyElement[] = [],
  Attrs extends BaseAttributes = BaseAttributes,
> {
  /** How HTML attributes of this element become values; see attrs.ts. Subclasses repeat these by spreading and add their own. */
  static attrTypes = { id: STRING, meta: { title: STRING, description: STRING, role: STRING } } satisfies AttrTypesFor<BaseAttributes>;

  /**
   * Types only, nothing at run time: what a JSX tag for this class accepts (see jsx-runtime.ts): the attributes and children if
   * there are any (hyphenated names such as `meta-title` are not checked: TypeScript lets any through). Which children, and in what
   * order, cannot be checked, because TypeScript gives every JSX tag the same type; the class' documentation says.
   */
  declare readonly $props: Attrs & { children?: [Children[number]] extends [never] ? JsxChild<never> : JsxChild<AnyElement> };

  #attrs: Attrs;
  #parent: AnyElement | null = null;
  #first: AnyElement | null = null;
  #last: AnyElement | null = null;
  #next: AnyElement | null = null;
  #prev: AnyElement | null = null;
  #surface: Surface | null = null;
  #ctx: MountContext | null = null;
  #hidden = false;

  /**
   * `new X(attrs?, ...children)`. The attrs object is recognised by not being an element, and is copied so that
   * the caller's object is never mutated by later `setAttribute` calls.
   */
  constructor(...args: ElementArgs<Attrs, Children>) {
    const list = args as unknown[];
    let i = 0;
    const first = list[0];
    if (first === undefined || (typeof first === 'object' && first !== null && !(first instanceof ChartElement))) {
      this.#attrs = { ...first } as Attrs;
      i = 1;
    } else {
      this.#attrs = {} as Attrs;
    }
    for (; i < list.length; i++) this.link(list[i] as AnyElement, null);
  }

  /** Read-only view; change attributes through `setAttribute(s)` so the chart learns it is stale. */
  get attrs(): Readonly<Attrs> {
    return this.#attrs;
  }
  get parent(): Parent | null {
    return this.#parent as Parent | null;
  }
  get firstChild(): AnyElement | null {
    return this.#first;
  }
  get lastChild(): AnyElement | null {
    return this.#last;
  }
  get nextSibling(): AnyElement | null {
    return this.#next;
  }
  get previousSibling(): AnyElement | null {
    return this.#prev;
  }
  /** For elements that only make sense inside a parent (an axis in a plane): fails loudly rather than returning null. */
  requireParent(): Parent & AnyElement {
    if (!this.#parent) fail(`${this.constructor.name} has no parent`);
    return this.#parent as Parent & AnyElement;
  }
  /** The root chart, if this element is in a tree that has one: found by walking up the parents. */
  get chart(): Chart | null {
    let e: AnyElement | null = this as AnyElement;
    while (e.#parent) e = e.#parent;
    // The root answers for itself (a Chart returns itself); any other root has no chart.
    return e === this ? null : e.chart;
  }
  /** Like `chart`, for code that only runs inside a chart (painting, input): fails loudly rather than returning null. */
  requireChart(): Chart {
    return this.chart ?? fail(`${this.constructor.name} is not in a chart`);
  }
  /** True for an element that takes a pointer press (PanZoom): one that must see the press first (a BoxZoom, a Brush) is placed before it. */
  declare readonly claimsPress?: boolean;
  get isAttached(): boolean {
    return this.#ctx !== null;
  }

  /**
   * The children in order. Convenience only, for code outside the library: it allocates a generator, so prefer a loop over
   * `firstChild` and `nextSibling`. Do not remove the element you are on and the one after it while iterating.
   */
  *[Symbol.iterator](): Generator<Children[number]> {
    for (let c = this.#first; c;) {
      const next = c.#next;
      yield c;
      c = next;
    }
  }
  /**
   * How `console.log`, `util.inspect` and a failing `assert` print an element: its class, id and child count, not the tree, the
   * platform and everything else it can reach. Without this, one failed `assert.equal(thing, null)` on an object that holds an
   * element (a plane in a hit, a cursor state) prints the whole chart and can run a test out of memory.
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    let n = 0;
    for (let c = this.#first; c; c = c.#next) n++;
    const id = (this.#attrs as BaseAttributes).id;
    return `${this.constructor.name}${id ? `#${id}` : ''}${n ? `(${n})` : ''}`;
  }

  /**
   * A fixed child, by position, checked where it is used: it has to be one of `classes` (an instance of any, subclasses
   * included). The classes must be ones the declared child type allows, so a wrong one is a compile error; a wrong or missing child
   * is a run-time error that says what was expected and what was found, wherever the tree was built (`new`, JSX, React, markup).
   */
  child<I extends FixedIndex<Children> & keyof Children>(
    index: I,
    ...classes: [ClassFor<Children[I]>, ...ClassFor<Children[I]>[]]
  ): Children[I] {
    const found = this.nth(index);
    const names = classes.map((k) => k.name || 'a different class').join(' or ');
    if (!found) fail(`${this.constructor.name}: has no child ${index as number} (it needs ${names})`);
    if (!classes.some((k) => found instanceof k))
      fail(`${this.constructor.name}: child ${index as number} should be ${names}, but is ${found.constructor.name}`);
    return found as Children[I];
  }
  private nth(index: number): AnyElement | null {
    let c = this.#first;
    for (let i = 0; c && i < index; i++) c = c.#next;
    return c;
  }
  /** What this element draws with. Created on first use, so an element that draws nothing costs nothing. */
  protected get surface(): Surface {
    const ctx = this.#ctx ?? fail(`${this.constructor.name} is not attached`);
    if (!this.#surface) {
      this.#surface = new Surface(ctx.platform, ctx.counters, {
        container: () => this.container(),
        end: () => this.end(),
        childrenFirst: () => this.firstOfChildren(),
      });
      if (this.#hidden) this.#surface.setHidden(true);
    }
    return this.#surface;
  }
  /** The flush counters if attached, else null: for code that also runs when a node is read outside a chart. */
  protected get countersOrNull(): Counters | null {
    return this.#ctx?.counters ?? null;
  }
  /** The chart's flush counters. Only valid between attach and detach. */
  protected get counters(): Counters {
    return (this.#ctx ?? fail(`${this.constructor.name} is not attached`)).counters;
  }

  /** Setting `undefined` removes the attribute, so defaults apply again. Unchanged values do not invalidate. */
  /**
   * This element's look for a chain of selectors, most specific first, ending in a root: all of that root's properties,
   * settled (see theme.ts for the order). `local` is the element's own attributes that are style properties; `accent` is
   * a default colour from the palette that anything named in a theme beats.
   */
  protected styleFor<R extends keyof Roots>(
    chain: readonly [...SelectorName[], R],
    local?: Partial<Roots[R]>,
    accent?: Partial<Roots[R]>,
  ): Roots[R] {
    const chart = this.chart ?? fail(`${this.constructor.name} is not in a chart`);
    const scopes: (Theme | undefined)[] = [];
    // oxlint-disable-next-line typescript/no-this-alias -- a walk up the parent chain that starts at this element
    for (let e: AnyElement | null = this; e; e = e.#parent) scopes.push(e.#attrs.style);
    return resolveStyle(chain, scopes, chart.attrs.theme, local, accent);
  }

  getAttribute<K extends keyof Attrs>(name: K): Attrs[K] {
    return this.#attrs[name];
  }
  setAttribute<K extends keyof Attrs>(name: K, value: Attrs[K]): this {
    if (this.put(name, value)) this.invalidate();
    return this;
  }
  setAttributes(patch: Partial<Attrs>): this {
    let changed = false;
    for (const name of Object.keys(patch) as (keyof Attrs)[]) changed = this.put(name, patch[name] as Attrs[keyof Attrs]) || changed;
    if (changed) this.invalidate();
    return this;
  }
  /** Write an attribute and say whether it changed, without telling the chart. Subclasses use it where the chart is already laying out. */
  protected put<K extends keyof Attrs>(name: K, value: Attrs[K]): boolean {
    if (this.#attrs[name] === value) return false;
    if (name === 'id') treeVersion++;
    if (value === undefined) delete this.#attrs[name];
    else this.#attrs[name] = value;
    return true;
  }

  /** Put `child` in front of `before` (null: at the end). Constant time: the siblings are linked both ways. */
  private link(child: AnyElement, before: AnyElement | null): void {
    if (child.#parent) fail('element already has a parent');
    if (before && before.#parent !== this) fail('element is not a child of this element');
    const prev = before ? before.#prev : this.#last;
    treeVersion++;
    child.#parent = this;
    child.#next = before;
    child.#prev = prev;
    if (prev) prev.#next = child;
    else this.#first = child;
    if (before) before.#prev = child;
    else this.#last = child;
  }
  private unlink(child: AnyElement): void {
    if (child.#parent !== this) fail('element is not a child of this element');
    treeVersion++;
    const prev = child.#prev;
    const next = child.#next;
    if (prev) prev.#next = next;
    else this.#first = next;
    if (next) next.#prev = prev;
    else this.#last = prev;
    child.#next = child.#prev = child.#parent = null;
  }

  /**
   * Add children that can come and go. Fixed children (an axis' scale, a series' data) are given to the
   * constructor and replaced with `setChild`; the types do not allow adding or removing them.
   */
  append(...children: VariadicChild<Children>[]): this {
    for (const c of children) this.insertBefore(c, null);
    return this;
  }
  /** Exactly `Node.insertBefore`: `before` is one of this element's children, or null to add at the end. */
  insertBefore(child: VariadicChild<Children>, before: Children[number] | null): this {
    this.link(child as AnyElement, before);
    if (this.#ctx) (child as AnyElement).mount(this.#ctx);
    this.invalidate();
    return this;
  }
  remove(child: VariadicChild<Children>): this {
    (child as AnyElement).unmount(true);
    this.unlink(child as AnyElement);
    this.invalidate();
    return this;
  }
  /** Swap one of the fixed children for another of the same kind. */
  setChild<I extends FixedIndex<Children> & keyof Children>(index: I, child: Children[I]): this {
    const old = this.nth(index) ?? fail(`${this.constructor.name}: has no child ${index as number} to replace`);
    this.link(child as AnyElement, old);
    old.unmount(true);
    this.unlink(old);
    if (this.#ctx) (child as AnyElement).mount(this.#ctx);
    this.invalidate();
    return this;
  }
  /**
   * For an element that makes children of its own from data (the series of a `SeriesGroup`): linked and mounted like an
   * appended child, but without invalidating, since it happens while the chart lays out. Such a child is left out of
   * the element's own iteration by the element that adopts it, so saved JSON never holds it.
   */
  protected adopt(child: AnyElement): void {
    this.link(child, null);
    if (this.#ctx) child.mount(this.#ctx);
  }
  /** The other half of `adopt`. */
  protected release(child: AnyElement): void {
    child.unmount(true);
    this.unlink(child);
  }
  /** Convenience for `parent.remove(this)` when the caller holds only the child. */
  detachFromParent(): this {
    this.#parent?.remove(this);
    return this;
  }

  /**
   * Something about this element is stale. The request travels to the root, where a chart on a
   * scheduling platform arranges a flush. Each flush re-runs layout; fills are cached and unchanged
   * attribute writes skipped, which is where the saving is.
   */
  invalidate(): void {
    this.#parent?.invalidate();
  }

  /** The single extension point. Switch on `event.type`; ignore what you don't handle. */
  onEvent(_event: ChartEvent): void {}

  /** Deliver an event to `root` (default: this element) and everything beneath it, parents first. */
  protected broadcast(init: ChartEventInit, root: AnyElement = this): ChartEvent {
    const ev = makeEvent(init, root);
    root.cascade(ev);
    return ev;
  }
  /** Parents are visited before their children, so a parent can set up state its children read in the same event. */
  private cascade(ev: ChartEvent): void {
    this.receive(ev);
    for (let c = this.#first; c;) {
      const next = c.#next;
      c.cascade(ev);
      c = next;
    }
  }

  /** Ask a child how much space it needs. */
  protected measureChild(child: AnyElement, available: Size): LayoutRequest {
    const ev = makeEvent({ type: EVENT_MEASURE, available, request: NO_REQUEST }, child) as MeasureEvent;
    child.receive(ev);
    return ev.request;
  }
  /** Tell a child where it is. */
  protected arrangeChild(child: AnyElement, rect: Rect): void {
    child.receive(makeEvent({ type: EVENT_ARRANGE, rect }, child));
  }

  /** The one entry point for events: the base class handles what every element shares, then the subclass sees it. */
  private receive(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_PAINT: {
        // Visibility is the one thing every element draws, so the base class owns it.
        const hidden = this.isHidden();
        if (hidden !== this.#hidden) {
          this.#hidden = hidden;
          this.#surface?.setHidden(hidden);
        }
        break;
      }
    }
    this.onEvent(ev);
  }
  /** Put this tree on the platform. The root calls it; elements added later are mounted by their parent. */
  protected mount(ctx: MountContext): void {
    this.#ctx = ctx;
    this.receive(makeEvent({ type: EVENT_ATTACH, platform: ctx.platform }, this));
    for (let c = this.#first; c; c = c.#next) c.mount(ctx);
  }
  /**
   * `removeNodes` is false once an ancestor's wrapper is being removed: everything inside goes with it.
   * Without a wrapper, an element's nodes sit in a shared container and have to be taken out one by one.
   */
  protected unmount(removeNodes: boolean): void {
    const ownsWrapper = !!this.#surface?.wrapperRoot;
    for (let c = this.#first; c; c = c.#next) c.unmount(removeNodes && !ownsWrapper);
    if (!this.#ctx) return;
    if (removeNodes) this.#surface?.dispose();
    this.#surface = null;
    this.#ctx = null;
  }

  // ─── Placement: where nodes go, worked out from the live tree (see the class comment) ───

  /** The first node of this element's content, or null if it and everything below it has drawn nothing. */
  private first(): PlatformNode | null {
    const s = this.#surface;
    return s?.wrapperRoot ?? s?.firstBelow ?? this.firstOfChildren() ?? s?.firstAbove ?? null;
  }
  private firstOfChildren(): PlatformNode | null {
    for (let c = this.#first; c; c = c.#next) {
      const node = c.first();
      if (node) return node;
    }
    return null;
  }
  /** The node this element's content ends before: whatever the next element that has drawn starts with. */
  private end(): PlatformNode | null {
    for (let s = this.#next; s; s = s.#next) {
      const node = s.first();
      if (node) return node;
    }
    const p = this.#parent;
    if (!p) return null;
    return p.#surface?.wrapperRoot ? null : p.end();
  }
  /** The node this element's own nodes go into when it has no wrapper. */
  private container(): PlatformNode {
    for (let p = this.#parent; p; p = p.#parent) {
      const wrapper = p.#surface?.wrapperRoot;
      if (wrapper) return wrapper;
    }
    return (this.#ctx ?? fail('element is not attached')).platform.root;
  }
  /** Hidden if it, or an ancestor without a wrapper to hide for it, says `visible: false`. */
  private isHidden(): boolean {
    // oxlint-disable-next-line typescript/no-this-alias -- a walk up the parent chain that starts at this element
    for (let e: AnyElement | null = this; e; e = e.#parent) {
      if (e.#attrs.visible === false) return e === this || !e.#surface?.wrapperRoot;
      if (e !== this && e.#surface?.wrapperRoot) return false;
    }
    return false;
  }
}

// ─── Tree utilities ───
// Plain functions rather than methods so unused ones tree-shake away.

/**
 * Depth-first, parents before children. Returning `false` from `visit` skips that element's subtree. A loop over the links, with
 * no recursion and no allocation. What comes next is read before the visit, so a visitor may take the element it is on out of the
 * tree (its subtree is then skipped).
 */
export function walk(root: AnyElement, visit: (element: AnyElement, depth: number) => boolean | void, depth = 0): void {
  let c: AnyElement = root;
  let d = depth;
  for (;;) {
    let up: AnyElement | null = c.parent;
    let next: AnyElement | null = c.nextSibling;
    // Into the children, unless told to skip them or the visitor took the element out of the tree (its children go with it).
    const skip: boolean = visit(c, d) === false || c.parent !== up;
    const down: AnyElement | null = skip ? null : c.firstChild;
    if (down) {
      c = down;
      d++;
      continue;
    }
    // Along, or up until there is a next sibling, but never past `root`.
    if (c === root) return;
    while (!next) {
      c = up as AnyElement;
      d--;
      if (c === root) return;
      up = c.parent;
      next = c.nextSibling;
    }
    c = next;
  }
}
/**
 * The element nearest to `source` for which `test` holds: `source`, then what is under it, then its parent, then the parent's other
 * children and what is under them, and so on up to the root. Stops at the first match. A loop over the links: no recursion, and
 * the only allocation is the caller's `test`. The one `findById(source, id)`, `findClosestOfType` and `resolveRef` share.
 */
export function findNearest(source: AnyElement, test: (e: AnyElement) => boolean): AnyElement | undefined {
  if (test(source)) return source;
  let at = source;
  let skip: AnyElement | null = null; // the child we came up from, whose subtree has been searched
  for (;;) {
    for (let c = at.firstChild; c;) {
      if (c !== skip) {
        if (test(c)) return c;
        if (c.firstChild) {
          c = c.firstChild;
          continue;
        }
      }
      while (!c.nextSibling) {
        c = c.parent as AnyElement;
        if (c === at) break;
      }
      c = c === at ? null : c.nextSibling;
    }
    const up = at.parent;
    if (!up) return undefined;
    skip = at;
    at = up;
    if (test(at)) return at;
  }
}
/** The element with this id nearest to `source` (see `findNearest`): ids only have to be unique among the elements that can see each other. */
export function findById<T extends AnyElement = AnyElement>(source: AnyElement, id: string): T | undefined {
  return findNearest(source, (e) => e.attrs.id === id) as T | undefined;
}
/** What `resolveRef` found from each element, as of the tree version it was found at. Elements that are let go are let go of. */
const lookups = new WeakMap<AnyElement, { at: number; found: Map<string, AnyElement | undefined> }>();
function lookup(from: AnyElement, id: string): AnyElement | undefined {
  let kept = lookups.get(from);
  if (!kept || kept.at !== treeVersion) {
    kept = { at: treeVersion, found: new Map() };
    lookups.set(from, kept);
  }
  if (kept.found.has(id)) return kept.found.get(id);
  const el = findById(from, id);
  kept.found.set(id, el);
  return el;
}
/** Every element below `root` of a class, in tree order. */
export function descendantsOfType<T extends AnyElement>(root: AnyElement, type: ElementClass<T>): T[] {
  const out: T[] = [];
  walk(root, (e) => {
    if (e !== root && e instanceof type) out.push(e);
  });
  return out;
}
/** The first element below `root` of a class, stopping as soon as it is found. */
export function firstDescendantOfType<T extends AnyElement>(root: AnyElement, type: ElementClass<T>): T | undefined {
  for (let c = root.firstChild; c;) {
    if (c instanceof type) return c;
    if (c.firstChild) {
      c = c.firstChild;
      continue;
    }
    while (c && !c.nextSibling) {
      c = c.parent;
      if (c === root) return undefined;
    }
    c = c ? c.nextSibling : null;
  }
  return undefined;
}
/** The direct children of a class; use it when the parent's children are mixed (an axis next to series). Convenience: it allocates, so in hot code loop over `firstChild` and `nextSibling`. */
export function childrenOfType<T extends AnyElement>(parent: AnyElement, type: ElementClass<T>): T[] {
  const out: T[] = [];
  for (let c = parent.firstChild; c; c = c.nextSibling) if (c instanceof type) out.push(c);
  return out;
}
/** The nearest enclosing element of a class: how a child finds "its" plane or chart without being handed one. */
export function closestAncestorOfType<T extends AnyElement>(from: AnyElement, type: ElementClass<T>): T | undefined {
  for (let e = from.parent as AnyElement | null; e; e = e.parent) if (e instanceof type) return e;
  return undefined;
}
/** The nearest element of a class to `source`, searched like `findNearest`: itself, what is under it, then outwards. */
export function findClosestOfType<T extends AnyElement>(source: AnyElement, type: ElementClass<T>): T | undefined {
  return findNearest(source, (e) => e instanceof type) as T | undefined;
}

/**
 * Turns an `ElementRef` into the element: ids are looked up nearest to `from` (see `findNearest`), elements pass through.
 * With `type`, a mismatch is reported by name, which is the useful error when a config points at the wrong thing.
 */
export function resolveRef<T extends AnyElement>(ref: ElementRef<T>, from: AnyElement, type?: ElementClass<T>): T;
export function resolveRef<T extends AnyElement>(ref: ElementRef<T> | undefined, from: AnyElement, type?: ElementClass<T>): T | undefined;
export function resolveRef<T extends AnyElement>(ref: ElementRef<T> | undefined, from: AnyElement, type?: ElementClass<T>): T | undefined {
  if (ref === undefined) return undefined;
  let el: AnyElement | undefined;
  if (typeof ref === 'string') {
    el = lookup(from, ref);
    if (!el) fail(`no element with id "${ref}"`);
  } else {
    el = ref;
  }
  if (type && !(el instanceof type)) {
    fail(`element "${typeof ref === 'string' ? ref : (ref.attrs.id ?? '?')}" is not a ${type.name}`);
  }
  return el as T;
}

/** `throw` as an expression, so a missing value can be reported inline: `x ?? fail('no x')`. */
export function fail(message: string): never {
  throw new Error(message);
}

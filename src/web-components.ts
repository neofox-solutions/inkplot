/**
 * The Web Components adapter: chart elements as custom HTML elements, so that a chart can be written, or pre-rendered, as markup.
 *
 *     import * as inkplot from 'inkplot';
 *     import { defineElements } from 'inkplot/web-components';
 *     defineElements({ Chart: inkplot.Chart, CartesianPlane: inkplot.CartesianPlane, Axis: inkplot.Axis, … }, { prefix: 'ch' });
 *
 *     <ch-chart style="display:block; height:300px" meta-title="Sales">
 *       <ch-cartesian-plane>
 *         <ch-axis orientation="bottom" meta-title="Month"><ch-linear-scale></ch-linear-scale></ch-axis>
 *         <ch-domain-series name="2024"><ch-flat-data-source data="[1,3,2]" regulardomain-step="1"></ch-flat-data-source> …
 *
 * Only the classes you give are defined, so nothing else is bundled. The tag is the prefix and the key, kebab-cased
 * (`ch-cartesian-plane`).
 *
 * How it follows the DOM:
 * - The element tree is the DOM tree: a wrapper finds its parent wrapper among its ancestors and joins it in document order
 *   when connected, and leaves when disconnected. Moving a node moves the chart element. The outermost wrapper (one with
 *   `attach`, a Chart) draws into a shadow root, so the wrapper elements inside it are never rendered, and the page's CSS does not reach the chart.
 *   Give that element a size; it is `display: block`.
 * - Attributes are the element's attributes. HTML lowercases names, so `regulardomain-step` finds `regularDomain.step` (the
 *   class' `attrTypes` and `STYLE_NAMES` say how the names are spelled). Hyphens nest, as in attrs.ts: `meta-title`, `style-ticklabel-size`.
 *   Text becomes a value by the class' `attrTypes`: `STRING` stays text; otherwise `true`/`false`, numbers, and `[…]`/`{…}` (JSON)
 *   convert, and a present attribute with no value is true. Changing an attribute later updates the element (on the next microtask).
 * - Values HTML cannot carry are set as JavaScript: `element.props = { format: fn, data: new Float64Array(…) }` on the wrapper,
 *   and they win over attributes. `wrapper.element` is the chart element itself, for calling its methods.
 * - Callbacks (`onClick`, `onHover`, `onDrag`, `onFlush`: attributes that are functions) are events: once the page listens, with
 *   `addEventListener('ch-click', …)` or `onch-click=""` (the tag prefix, a hyphen and the name), the wrapper dispatches a bubbling
 *   `CustomEvent` of that name (`ch-click`, `ch-hover`, `ch-drag`, `ch-flush`) with the callback's argument as `detail`. The names are
 *   not the DOM's own, so a listener for a real `click` or `drag` is not called twice. (Until the page listens no callback is set, so
 *   the chart stays serializable.) `on…` attributes are the DOM's own and are not read as chart attributes.
 * - The tags may be defined in any order, before or after the markup is in the page: a tag whose parent is not defined yet waits
 *   for it, and the parent takes it in when it is defined. (A tag with the prefix that is never defined holds back what is inside it.)
 * - `style`, `class` and the other attributes every HTML element has are the page's, not the chart's: set the chart's `style` blocks with `style-…` names.
 */
import { type AttrTypes, type Coerce, AUTO, BOOLEAN, NUMBER, STRING } from './attrs.ts';
import { attributesOf, difference } from './adapt.ts';
import type { Chart } from './chart.ts';
import { DOMPlatform, type DOMPlatformOptions } from './dom-platform.ts';
import type { AnyArgs, AnyElement } from './element.ts';
import { STYLE_NAMES } from './style-names.ts';
import { inkplotError } from './fail.ts';

/* oxlint-disable typescript/consistent-type-assertions -- the bridge between the DOM's custom-element types and the chart elements: the classes are made at registration time and the DOM types cannot describe them */

type Plain = Record<string, unknown>;

const lowerCache = new WeakMap<AttrTypes, Map<string, string>>();
/** The names a spec lists, by lowercase (HTML's spelling). Two names that differ only in case are an error. */
function lowerNames(spec: AttrTypes, where = 'attribute types'): Map<string, string> {
  let map = lowerCache.get(spec);
  if (!map) {
    map = new Map();
    for (const n of Object.keys(spec)) {
      const lower = n.toLowerCase();
      if (map.has(lower) && map.get(lower) !== n) throw inkplotError(237, where, n, map.get(lower));
      map.set(lower, n);
    }
    lowerCache.set(spec, map);
  }
  return map;
}
/** The nested spec for an attribute inside the objects named by `path` (real names), or undefined where none is listed. */
function specAt(types: AttrTypes, path: readonly string[]): AttrTypes | undefined {
  let spec: AttrTypes | undefined = types;
  for (const p of path) {
    const next: AttrTypes[string] | undefined = spec?.[p];
    spec = typeof next === 'object' ? next : undefined;
  }
  return spec;
}
type ElementConstructor = (new (...args: AnyArgs) => AnyElement) & { attrTypes?: AttrTypes };

/** A defined wrapper element, as the page sees it. */
export interface InkplotElement extends HTMLElement {
  /** The chart element behind this tag; null until the tag is connected. */
  readonly element: AnyElement | null;
  /** Attributes set from JavaScript: functions, data and objects. They win over the tag's attributes. */
  props: Plain;
  /** How the chart is drawn, for the outermost element; read when it connects. */
  platformOptions?: DOMPlatformOptions;
}

export interface DefineOptions {
  /** The start of every tag name, which has to be a valid custom element name with the rest: `ch` gives `ch-axis`. */
  prefix: string;
  /** Where to define them. Default: the page's `customElements`. */
  registry?: CustomElementRegistry;
  /** More camelCase names that a `style-…` attribute may contain, for selectors added by augmenting `Selectors`. */
  names?: readonly string[];
}

/** The attributes every HTML element has, or has for the page; none is a chart attribute. */
const PAGE_ATTRIBUTES = new Set([
  'class',
  'style',
  'slot',
  'part',
  'is',
  'hidden',
  'lang',
  'dir',
  'tabindex',
  'contenteditable',
  'draggable',
  'translate',
  'inert',
  'nonce',
]);

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
/** A value from attribute text. `kind` says how; AUTO guesses, and is safe because every attribute that is only text is STRING. */
function convert(text: string, kind: Coerce, name: string): unknown {
  switch (kind) {
    case STRING:
      return text;
    case NUMBER: {
      const n = Number(text);
      if (text.trim() === '' || Number.isNaN(n)) throw inkplotError(236, name, text);
      return n;
    }
    case BOOLEAN:
      return text !== 'false';
    default: {
      if (text === '' || text === 'true') return true;
      if (text === 'false') return false;
      if (NUMERIC.test(text.trim())) return Number(text);
      if (/^\s*[[{]/.test(text)) {
        try {
          return JSON.parse(text);
        } catch (cause) {
          // (The `cause` option of `Error` is a year newer than the rest of what the library uses.)
          const error = inkplotError(235, name, text);
          Object.defineProperty(error, 'cause', { value: cause, writable: true, configurable: true });
          throw error;
        }
      }
      return text;
    }
  }
}

/** Say an error without stopping what is running: the page's `reportError` (its `error` event and console), else thrown from a microtask. */
function report(e: unknown): void {
  if (typeof reportError === 'function') reportError(e);
  else
    queueMicrotask(() => {
      throw e;
    });
}

const kebab = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** The base class of every wrapper, made when `defineElements` first runs because `HTMLElement` may not exist before. */
let Base: (abstract new () => InkplotElement & { sync(): void }) | null = null;

function makeBase() {
  const observer = new MutationObserver((records) => {
    // The page's own attributes (`class`, `style`, `onclick`…) are not the chart's: changing them costs the chart nothing.
    const changed = new Set(
      records.filter((r) => !PAGE_ATTRIBUTES.has(r.attributeName ?? '') && !r.attributeName?.startsWith('on')).map((r) => r.target),
    );
    // One bad attribute is reported, not allowed to stop the others from being read.
    for (const target of changed) {
      try {
        (target as unknown as { refresh(): void }).refresh();
      } catch (e) {
        report(e);
      }
    }
  });
  return class Wrapper extends HTMLElement {
    // Set by defineElements on each defined subclass.
    static cls: ElementConstructor;
    static types: AttrTypes;
    static styleNames: Map<string, string>;
    static prefix: string;
    static registry: CustomElementRegistry;

    #element: AnyElement | null = null;
    #applied: Plain = {};
    #props: Plain = {};
    #handlers = new Map<string, (detail: unknown) => void>();
    #listening = new Set<string>();
    #parent: Wrapper | null = null;
    #joined = false;
    #lastKey = '';
    #propsVersion = 0;
    #platform: DOMPlatform | null = null;
    platformOptions?: DOMPlatformOptions;

    override addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      super.addEventListener(type, listener as EventListenerOrEventListenerObject, options);
      if (!this.#listening.has(type)) {
        this.#listening.add(type);
        this.sync();
      }
    }
    get element(): AnyElement | null {
      return this.#element;
    }
    get props(): Plain {
      return this.#props;
    }
    set props(value: Plain) {
      this.#props = { ...value };
      this.#propsVersion++;
      this.sync();
    }

    /** Read the attributes (and props) and write what differs to the element, making it the first time. */
    sync(): AnyElement | null {
      if (!this.isConnected) return this.#element;
      const ctor = this.constructor as typeof Base & {
        types: AttrTypes;
        names: Map<string, string>;
        styleNames: Map<string, string>;
        cls: ElementConstructor;
        prefix: string;
      };
      const flat: Plain = {};
      let key = `${this.#propsVersion}|${this.#listening.size}`;
      for (const a of Array.from(this.attributes)) {
        const lower = a.name;
        if (lower.startsWith('on')) {
          if (this.#element) key += `|${lower}`; // an inline listener changes which callbacks are set
          continue;
        }
        if (PAGE_ATTRIBUTES.has(lower)) continue;
        flat[lower] = a.value;
        key += `|${lower}=${a.value}`;
      }
      // Nothing the chart reads has changed (a class was toggled, say): no need to parse it all again.
      if (this.#element && key === this.#lastKey) return this.#element;
      const attrs = attributesOf(flat, {
        name: (part, parents) => {
          const spec = specAt(ctor.types, parents);
          return (spec ? lowerNames(spec).get(part) : parents.length ? ctor.styleNames.get(part) : undefined) ?? part;
        },
        value: (path, text) => {
          // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
          const kind = specAt(ctor.types, path.slice(0, -1))?.[path[path.length - 1]!];
          return convert(text as string, typeof kind === 'number' ? kind : AUTO, path.join('-'));
        },
      });
      // A callback that dispatches its event, once the page listens for it (`addEventListener`, or an inline `onclick=""`).
      for (const name of Object.keys(ctor.types)) {
        if (!/^on[A-Z]/.test(name)) continue;
        // Named with the tag's prefix, so it is not mistaken for (or run twice as) a DOM event of the same name.
        const type = `${ctor.prefix}-${name.slice(2).toLowerCase()}`;
        if (!this.#listening.has(type) && !this.hasAttribute('on' + type)) continue;
        let handler = this.#handlers.get(name);
        if (!handler)
          this.#handlers.set(
            name,
            (handler = (detail) => {
              this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
            }),
          );
        attrs[name] = handler;
      }
      for (const k of Object.keys(this.#props))
        if (this.#props[k] === undefined) delete attrs[k];
        else attrs[k] = this.#props[k];
      if (!this.#element) {
        this.#element = new ctor.cls(attrs);
        this.#applied = attrs;
        this.#lastKey = key;
        return this.#element;
      }
      const patch = difference(this.#applied, attrs);
      if (patch) this.#element.setAttributes(patch);
      this.#applied = attrs;
      this.#lastKey = key;
      return this.#element;
    }

    /** Read the attributes again, and take the element into the tree if it could not be made before (a bad attribute that is now fixed). */
    refresh(): void {
      this.sync();
      this.#join();
      this.#adopt();
    }

    connectedCallback(): void {
      observer.observe(this, { attributes: true });
      try {
        this.sync();
      } catch (e) {
        // The tag stays out of the tree until its attributes can be read; fixing one brings it in (see `refresh`).
        report(e);
        return;
      }
      this.#join();
      this.#adopt();
    }

    /** The nearest ancestor wrapper, or `pending` when there is a tag of ours above that is not defined or upgraded yet. */
    #ancestor(): Wrapper | null | 'pending' {
      const ctor = this.constructor as typeof Wrapper;
      for (let a = this.parentElement; a; a = a.parentElement) {
        if (a instanceof Wrapper) return a;
        if (a.localName.startsWith(ctor.prefix + '-')) {
          // Defined but not upgraded yet: upgrade it now, so that it is there before what is inside it.
          if (ctor.registry.get(a.localName)) {
            ctor.registry.upgrade(a);
            if (a instanceof Wrapper) return a;
          }
          return 'pending';
        }
      }
      return null;
    }

    /** Put the element where the markup puts it: in its parent element, in document order; or, for a chart, on the page. */
    #join(): void {
      const element = this.#element;
      if (!element || this.#joined || !this.isConnected) return;
      const ancestor = this.#ancestor();
      if (ancestor === 'pending') return; // its parent takes it in when that is defined
      this.#parent = ancestor;
      if (ancestor) {
        const host = ancestor.element;
        if (!host) return;
        // Before the first later sibling tag that is already in the same parent element, else last.
        let before: AnyElement | null = null;
        for (let s = this.nextElementSibling; s; s = s.nextElementSibling) {
          const other = s instanceof Wrapper ? (s as InkplotElement).element : null;
          if (other && other.parent === host) {
            before = other;
            break;
          }
        }
        host.insertBefore(element, before);
      } else if (typeof (element as unknown as Partial<Chart>).attach === 'function') {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.replaceChildren();
        const style = this.ownerDocument.createElement('style');
        style.textContent = ':host{display:block}div{width:100%;height:100%}';
        const container = this.ownerDocument.createElement('div');
        root.append(style, container);
        this.#platform = new DOMPlatform(container, this.platformOptions);
        (element as Chart).attach(this.#platform);
      }
      this.#joined = true;
    }

    /** What was in the page before this was defined has been waiting for it, and goes in now, in document order. */
    #adopt(): void {
      if (!this.#element) return;
      for (const inner of Array.from(this.querySelectorAll('*'))) if (inner instanceof Wrapper) inner.#join();
    }

    disconnectedCallback(): void {
      const element = this.#element;
      if (!element) return;
      if (this.#platform) {
        (element as Chart).detach();
        this.#platform.dispose();
        this.#platform = null;
      }
      const host = this.#parent?.element;
      if (host && element.parent === host) host.remove(element);
      this.#parent = null;
      this.#joined = false;
    }
  };
}

/**
 * Define a custom element for each class. `classes` maps a name to a class, and the name gives the tag. Returns the tags by name.
 * Does nothing at import, so a module that imports this can be loaded where there is no DOM.
 */
export function defineElements(classes: Readonly<Record<string, ElementConstructor>>, options: DefineOptions): Record<string, string> {
  const registry = options.registry ?? customElements;
  const base = (Base ??= makeBase() as unknown as NonNullable<typeof Base>) as unknown as typeof HTMLElement;
  const styleNames = new Map<string, string>();
  for (const n of [...STYLE_NAMES, ...(options.names ?? [])]) styleNames.set(n.toLowerCase(), n);
  const tags: Record<string, string> = {};
  for (const [key, cls] of Object.entries(classes)) {
    const tag = `${options.prefix}-${kebab(key)}`;
    tags[key] = tag;
    const types = cls.attrTypes ?? {};
    // The lowercase-name maps are made now, so a clash is an error here and not on first use.
    const check = (spec: AttrTypes, where: string): void => {
      lowerNames(spec, where);
      for (const [n, v] of Object.entries(spec)) if (typeof v === 'object') check(v, `${where}.${n}`);
    };
    check(types, key);
    const wrapper = class extends (base as unknown as new () => HTMLElement) {} as unknown as typeof HTMLElement & Record<string, unknown>;
    Object.assign(wrapper, { cls, types, styleNames, prefix: options.prefix, registry });
    const have = registry.get(tag);
    if (have) {
      if ((have as unknown as { cls?: unknown }).cls === cls) continue;
      throw inkplotError(234, tag);
    }
    registry.define(tag, wrapper);
  }
  return tags;
}

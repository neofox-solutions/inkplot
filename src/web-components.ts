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
 *   `addEventListener('click', …)` or `onclick=""`, the wrapper dispatches a bubbling `CustomEvent` named like the DOM's (`click`,
 *   `hover`, `drag`, `flush`) with the callback's argument as `detail`. (Until then no callback is set, so the chart stays serializable.)
 *   `on…` attributes are the DOM's own and are not read as chart attributes.
 * - `style`, `class` and the other attributes every HTML element has are the page's, not the chart's: set the chart's `style` blocks with `style-…` names.
 */
import { type AttrTypes, type Coerce, AUTO, BOOLEAN, NUMBER, STRING } from './attrs.ts';
import { attributesOf, difference } from './adapt.ts';
import type { Chart } from './chart.ts';
import { DOMPlatform, type DOMPlatformOptions } from './dom-platform.ts';
import type { AnyArgs, AnyElement } from './element.ts';
import { STYLE_NAMES } from './style-names.ts';

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
      if (map.has(lower) && map.get(lower) !== n) throw new Error(`${where}: '${n}' and '${map.get(lower)}' differ only in case`);
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
const PAGE_ATTRIBUTES = new Set(['class', 'style', 'slot', 'part', 'is', 'hidden', 'lang', 'dir', 'tabindex', 'contenteditable', 'draggable', 'translate', 'inert', 'nonce']);

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
/** A value from attribute text. `kind` says how; AUTO guesses, and is safe because every attribute that is only text is STRING. */
function convert(text: string, kind: Coerce, name: string): unknown {
  switch (kind) {
    case STRING: return text;
    case NUMBER: {
      const n = Number(text);
      if (text.trim() === '' || Number.isNaN(n)) throw new TypeError(`attribute '${name}': '${text}' is not a number`);
      return n;
    }
    case BOOLEAN: return text !== 'false';
    default: {
      if (text === '' || text === 'true') return true;
      if (text === 'false') return false;
      if (NUMERIC.test(text.trim())) return Number(text);
      if (/^\s*[[{]/.test(text)) {
        try { return JSON.parse(text); } catch (cause) { throw new TypeError(`attribute '${name}': '${text}' is not valid JSON`, { cause }); }
      }
      return text;
    }
  }
}

const kebab = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** The base class of every wrapper, made when `defineElements` first runs because `HTMLElement` may not exist before. */
let Base: (abstract new () => InkplotElement & { sync(): void }) | null = null;

function makeBase() {
  const observer = new MutationObserver((records) => {
    for (const target of new Set(records.map((r) => r.target))) (target as unknown as { sync(): void }).sync();
  });
  return class Wrapper extends HTMLElement {
    // Set by defineElements on each defined subclass.
    static cls: ElementConstructor;
        static types: AttrTypes;
    static styleNames: Map<string, string>;

    #element: AnyElement | null = null;
    #applied: Plain = {};
    #props: Plain = {};
    #handlers = new Map<string, (detail: unknown) => void>();
    #listening = new Set<string>();
    #parent: InkplotElement | null = null;
    #platform: DOMPlatform | null = null;
    platformOptions?: DOMPlatformOptions;

    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
      super.addEventListener(type, listener as EventListenerOrEventListenerObject, options);
      if (!this.#listening.has(type)) { this.#listening.add(type); this.sync(); }
    }
    get element(): AnyElement | null { return this.#element; }
    get props(): Plain { return this.#props; }
    set props(value: Plain) { this.#props = { ...value }; this.sync(); }

    /** Read the attributes (and props) and write what differs to the element, making it the first time. */
    sync(): AnyElement | null {
      if (!this.isConnected) return this.#element;
      const ctor = this.constructor as typeof Base & { types: AttrTypes; names: Map<string, string>; styleNames: Map<string, string>; cls: ElementConstructor };
      const flat: Plain = {};
      for (const a of Array.from(this.attributes)) {
        const lower = a.name;
        if (PAGE_ATTRIBUTES.has(lower) || lower.startsWith('on')) continue;
        flat[lower] = a.value;
      }
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
        const type = name.slice(2).toLowerCase();
        if (!this.#listening.has(type) && !this.hasAttribute('on' + type)) continue;
        let handler = this.#handlers.get(name);
        if (!handler) this.#handlers.set(name, handler = (detail) => { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); });
        attrs[name] = handler;
      }
      for (const k of Object.keys(this.#props)) if (this.#props[k] === undefined) delete attrs[k]; else attrs[k] = this.#props[k];
      if (!this.#element) {
        this.#element = new ctor.cls(attrs);
        this.#applied = attrs;
        return this.#element;
      }
      const patch = difference(this.#applied, attrs);
      if (patch) this.#element.setAttributes(patch);
      this.#applied = attrs;
      return this.#element;
    }

    connectedCallback(): void {
      const element = this.sync();
      if (!element) return;   // only when disconnected, and this is the callback for connecting
      let ancestor = this.parentElement;
      while (ancestor && !(ancestor instanceof Wrapper)) ancestor = ancestor.parentElement;
      this.#parent = ancestor as InkplotElement | null;
      if (this.#parent) {
        const host = this.#parent.element;
        if (!host) return;
        // Before the first later sibling tag that is already in the same parent element, else last.
        let before: AnyElement | null = null;
        for (let s = this.nextElementSibling; s; s = s.nextElementSibling) {
          const other = s instanceof Wrapper ? (s as InkplotElement).element : null;
          if (other && other.parent === host) { before = other; break; }
        }
        host.insertBefore(element, before);
        observer.observe(this, { attributes: true });
      } else if (typeof (element as unknown as Partial<Chart>).attach === 'function') {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.replaceChildren();
        const style = this.ownerDocument.createElement('style');
        style.textContent = ':host{display:block}div{width:100%;height:100%}';
        const container = this.ownerDocument.createElement('div');
        root.append(style, container);
        this.#platform = new DOMPlatform(container, this.platformOptions);
        (element as Chart).attach(this.#platform);
        observer.observe(this, { attributes: true });
      }
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
  for (const n of [...STYLE_NAMES, ...options.names ?? []]) styleNames.set(n.toLowerCase(), n);
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
    Object.assign(wrapper, { cls, types, styleNames });
    const have = registry.get(tag);
    if (have) {
      if ((have as unknown as { cls?: unknown }).cls === cls) continue;
      throw new Error(`<${tag}> is already defined for something else`);
    }
    registry.define(tag, wrapper);
  }
  return tags;
}

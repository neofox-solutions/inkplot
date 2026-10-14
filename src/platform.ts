/**
 * The platform: everything the library needs from the outside world, and a string-backed implementation of it.
 *
 * Why an interface rather than the DOM: the element tree only ever talks to `Surface`, and `Surface` only ever talks to
 * a `Platform`. That keeps the core free of `document`/`window`, so the same chart renders in a browser (DOMPlatform),
 * in node or a serverless function (StringPlatform → SVG text), and in tests. Everything beyond node creation is
 * optional: a platform with nothing to observe simply leaves `schedule`/`onResize`/`onPointer` out.
 */
import type { Size } from './geometry.ts';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export type SvgTag =
  | 'svg'
  | 'g'
  | 'path'
  | 'rect'
  | 'line'
  | 'circle'
  | 'text'
  | 'clipPath'
  | 'defs'
  | 'title'
  | 'desc'
  | 'linearGradient'
  | 'stop'
  | 'style';
export interface PlatformNode {
  readonly __platformNode: unique symbol;
}
export type Unsubscribe = () => void;
export interface FontSpec {
  family: string;
  size: number;
  weight?: number | string;
}
export type TextMeasurer = (text: string, font: FontSpec) => Size;

/** Pointer input boiled down to what charts use, so every platform feeds the same events whatever its native ones look like. */
export interface RawPointer {
  /** `pinch` is a zoom gesture the platform recognised itself (a trackpad pinch in Safari): `scale` is its factor since the last one. */
  kind: 'move' | 'down' | 'up' | 'leave' | 'wheel' | 'pinch';
  x: number;
  y: number;
  buttons: number;
  deltaY: number;
  /** Sideways wheel travel, in pixels. Default 0. */
  deltaX?: number;
  /** For `pinch`: how much the fingers spread since the last event (above 1 spreads, below 1 closes). */
  scale?: number;
  /** Which finger or device, so that several touches can be told apart. Default 0. */
  id?: number;
  /** Default 'mouse'. */
  pointerType?: 'mouse' | 'touch' | 'pen';
  shift: boolean;
  ctrl: boolean;
}

/** A key press or release on a focused node, boiled down like `RawPointer`. */
export interface RawKey {
  kind: 'down' | 'up';
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  repeat: boolean;
}
/** A node gaining or losing focus; `visible` is whether a ring is wanted (the browser's `:focus-visible`). */
export interface RawFocus {
  node: PlatformNode;
  focused: boolean;
  visible: boolean;
}

/** How the nodes of a chart move to what a data change draws: milliseconds, and a CSS timing function (`'ease-out'`, `'cubic-bezier(…)'`). */
export interface TransitionSpec {
  duration: number;
  easing: string;
}

export interface Platform {
  readonly name: string;
  /** The node the chart draws into. */
  readonly root: PlatformNode;
  /** The drawing area in CSS pixels. */
  size(): Size;
  createNode(tag: SvgTag): PlatformNode;
  setAttribute(node: PlatformNode, name: string, value: string | number): void;
  setText(node: PlatformNode, text: string): void;
  /** Exactly `Node.insertBefore`: `before` is a child of `parent`, or null to append. Moves the node if it is already placed. */
  insertBefore(parent: PlatformNode, node: PlatformNode, before: PlatformNode | null): void;
  /** Takes the node, and everything inside it, out of whatever it is in. */
  remove(node: PlatformNode): void;
  /** Present: the chart flushes itself after an invalidation. Absent: call `chart.flush()`. */
  schedule?(callback: () => void): Unsubscribe;
  /** Absent on a platform with nothing to observe. */
  onResize?(callback: (size: Size) => void): Unsubscribe;
  /** The callback returns true when the chart used the input; the platform then withholds the browser's own handling (page scroll on a wheel turn). */
  onPointer?(callback: (pointer: RawPointer) => boolean | void): Unsubscribe;
  /** Keys pressed while one of the chart's nodes has focus. The callback gets the node; true means the chart used the key. */
  onKey?(callback: (key: RawKey, node: PlatformNode) => boolean | void): Unsubscribe;
  /** Focus entering and leaving the chart's nodes. */
  onFocus?(callback: (focus: RawFocus) => void): Unsubscribe;
  /** Say something to a screen reader without showing it, politely (after what it is saying now). Absent on a platform with no one to hear. */
  announce?(text: string): void;
  /** Move focus to a node that has a `tabindex`. */
  focus?(node: PlatformNode): void;
  measureText?: TextMeasurer;
  /** The mouse cursor over the chart, as a CSS cursor name; an empty string for the default. */
  setCursor?(cursor: string): void;
  /**
   * Called at the start of every flush: with a spec, the changes this flush writes should be eased over that time (colour, size and, where
   * the browser can, the shapes of paths); with null, they should be immediate. Absent on a platform that cannot ease, or draws once.
   */
  setTransition?(spec: TransitionSpec | null): void;
  /**
   * What a touch on the chart may do. 'always': the chart takes every touch (the page cannot scroll from it).
   * 'two-finger': a touch with one finger scrolls the page as usual and only two fingers belong to the chart.
   */
  setTouchMode?(mode: 'always' | 'two-finger'): void;
  dispose(): void;
}

/** Errs wide, which costs a little margin and never a clipped label. */
export const estimateTextWidth: TextMeasurer = (text, font) => ({
  width: text.length * font.size * 0.6,
  height: font.size * 1.2,
});

/** One node of the string platform's tree; the opaque `PlatformNode` handed out is really this. */
interface StringNode {
  tag: SvgTag;
  attrs: Map<string, string | number>;
  children: StringNode[];
  text: string | null;
  parent: StringNode | null;
}

/** The library's handle for a node is opaque; here every handle is one of our own `StringNode`s, and these two are the only conversions. */
// oxlint-disable-next-line typescript/consistent-type-assertions -- the one place an opaque handle becomes our own node, and back: every handle on this platform is a `StringNode`
const nodeOf = (node: PlatformNode): StringNode => node as unknown as StringNode;
// oxlint-disable-next-line typescript/consistent-type-assertions -- the one place an opaque handle becomes our own node, and back: every handle on this platform is a `StringNode`
const handleOf = (node: StringNode): PlatformNode => node as unknown as PlatformNode;

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

/**
 * Keeps the SVG as a plain in-memory tree and prints it with `toString()`. This is the platform for node, serverless and
 * tests: no DOM, no timers, no observers, so a chart is flushed explicitly and the output is deterministic.
 */
export class StringPlatform implements Platform {
  readonly name = 'string';
  readonly root: PlatformNode;
  readonly #size: Size;
  readonly #root: StringNode;

  constructor(size: Size = { width: 640, height: 400 }) {
    this.#size = size;
    this.#root = { tag: 'svg', attrs: new Map(), children: [], text: null, parent: null };
    this.#root.attrs.set('xmlns', 'http://www.w3.org/2000/svg');
    this.root = handleOf(this.#root);
  }
  size(): Size {
    return this.#size;
  }
  createNode(tag: SvgTag): PlatformNode {
    return handleOf({ tag, attrs: new Map(), children: [], text: null, parent: null });
  }
  setAttribute(node: PlatformNode, name: string, value: string | number): void {
    nodeOf(node).attrs.set(name, value);
  }
  setText(node: PlatformNode, text: string): void {
    nodeOf(node).text = text;
  }
  insertBefore(parent: PlatformNode, node: PlatformNode, before: PlatformNode | null): void {
    const p = nodeOf(parent),
      n = nodeOf(node);
    if (n.parent) this.remove(node);
    n.parent = p;
    const at = before ? p.children.indexOf(nodeOf(before)) : -1;
    if (at < 0) p.children.push(n);
    else p.children.splice(at, 0, n);
  }
  remove(node: PlatformNode): void {
    const n = nodeOf(node);
    if (!n.parent) return;
    n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = null;
  }
  dispose(): void {}

  /** A standalone SVG document with literal attribute values, safe to embed or rasterize. */
  toString(): string {
    const lines: string[] = [];
    const visit = (n: StringNode, depth: number) => {
      const pad = '  '.repeat(depth);
      let open = `${pad}<${n.tag}`;
      for (const [k, v] of n.attrs) open += ` ${k}="${escapeAttr(String(v))}"`;
      if (n.text !== null) {
        lines.push(`${open}>${escapeText(n.text)}</${n.tag}>`);
        return;
      }
      if (n.children.length === 0) {
        lines.push(`${open}/>`);
        return;
      }
      lines.push(`${open}>`);
      for (const c of n.children) visit(c, depth + 1);
      lines.push(`${pad}</${n.tag}>`);
    };
    visit(this.#root, 0);
    return lines.join('\n') + '\n';
  }
}

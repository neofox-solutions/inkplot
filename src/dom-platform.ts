/** The browser platform: renders into a real SVG element and listens for resize and pointer input. */
import type { Size } from './geometry.ts';
import {
  type Platform,
  type PlatformNode,
  type RawFocus,
  type RawKey,
  type RawPointer,
  SVG_NS,
  estimateTextWidth,
  type SvgTag,
  type TextMeasurer,
  type Unsubscribe,
} from './platform.ts';

/* oxlint-disable typescript/consistent-type-assertions -- the opaque `PlatformNode` handle is a DOM `Element` here, and DOM event targets are loosely typed: the casts sit at this one boundary */

/**
 * A platform node is the library's opaque handle; in this platform it is always a DOM element. These views are the only places the
 * handle is converted (the library's types do not mention DOM types, so they cannot say so themselves).
 */
const element = (node: PlatformNode): Element => node as unknown as Element;
const fromElement = (node: EventTarget | null): PlatformNode => node as unknown as PlatformNode;

/** What `send` reads: pointer events, wheel events (which are mouse events) and Safari's gesture events. */
type PointerLike = MouseEvent & Partial<Pick<PointerEvent, 'pointerId' | 'pointerType'>>;
/** Safari's trackpad pinch events: `scale` is the total since the gesture began. They are not in the DOM typings. */
interface SafariGestureEvent extends MouseEvent {
  readonly scale: number;
}

/** The part of an element the DOM platform needs. A real `HTMLElement` fits. */
export interface DOMContainer {
  readonly ownerDocument: { createElementNS(namespace: string, tag: string): unknown };
  readonly clientWidth: number;
  readonly clientHeight: number;
  appendChild(node: unknown): unknown;
}

/** Choices that differ between pages: a fixed size for static layouts, canvas-free text metrics, and flush timing. */
export interface DOMPlatformOptions {
  /** A fixed size. Default: the container's own size, followed as it changes. */
  size?: Size;
  /** Measure labels with the browser rather than estimating them. Default true. */
  preciseText?: boolean;
  /** When to flush after an invalidation. Default 'frame'. 'manual' leaves it to `chart.flush()`. */
  schedule?: 'frame' | 'microtask' | 'manual' | ((callback: () => void) => Unsubscribe);
}

/**
 * Draws into a live `<svg>` appended to a container, and reports the container's size and pointer input on it.
 * The container needs a height of its own; without one the platform assumes 600 wide by 300 high.
 * Pointer events are captured while a button is down. Once something in the chart listens for the pointer (the chart then
 * subscribes through `onPointer`) the svg sets `touch-action: none`, so a drag or a wheel turn over the chart belongs to the
 * chart (`setTouchMode('two-finger')` lets one finger scroll the page instead); until then it sets none, and the chart is a picture.
 */
export class DOMPlatform implements Platform {
  readonly name = 'dom';
  readonly root: PlatformNode;
  schedule?: (callback: () => void) => Unsubscribe;
  measureText?: TextMeasurer;
  readonly #container: DOMContainer;
  readonly #svg: SVGSVGElement;
  readonly #fixed: Size | null;
  /** The container's document, seen with DOM types (`DOMContainer` keeps them out of the public signature). */
  get #document(): Document {
    return this.#container.ownerDocument as unknown as Document;
  }
  readonly #cleanups = new Set<Unsubscribe>();

  constructor(container: DOMContainer, options: DOMPlatformOptions = {}) {
    this.#container = container;
    this.#fixed = options.size ?? null;
    this.#svg = container.ownerDocument.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.root = fromElement(this.#svg);
    this.#svg.style.display = 'block';
    this.#svg.style.userSelect = 'none';
    container.appendChild(this.#svg);

    switch (options.schedule ?? 'frame') {
      case 'frame':
        this.schedule = (cb) => {
          const id = requestAnimationFrame(() => cb());
          return () => cancelAnimationFrame(id);
        };
        break;
      case 'microtask':
        this.schedule = (cb) => {
          let live = true;
          queueMicrotask(() => live && cb());
          return () => {
            live = false;
          };
        };
        break;
      case 'manual':
        break;
      default:
        this.schedule = options.schedule as (callback: () => void) => Unsubscribe;
    }
    if (options.preciseText !== false) {
      let context: { font: string; measureText(text: string): { width: number } } | null | undefined;
      this.measureText = (text, font) => {
        // One shared canvas context: measuring is the hot path of tick layout, and creating contexts is slow. A page with no
        // canvas to measure on (jsdom, a locked-down browser) gets the estimate rather than a chart that cannot be drawn.
        if (context === undefined) context = this.#document.createElement('canvas').getContext('2d') ?? null;
        if (!context) return estimateTextWidth(text, font);
        context.font = `${font.weight ?? 400} ${font.size}px ${font.family}`;
        return { width: context.measureText(text).width, height: font.size * 1.2 };
      };
    }
  }

  /** `|| 600` / `|| 300`: a container that has not been laid out yet reports 0, which would give an unusable chart. */
  size(): Size {
    return this.#fixed ?? { width: this.#container.clientWidth || 600, height: this.#container.clientHeight || 300 };
  }
  createNode(tag: SvgTag): PlatformNode {
    return fromElement(this.#svg.ownerDocument.createElementNS(SVG_NS, tag));
  }
  setAttribute(node: PlatformNode, name: string, value: string | number): void {
    element(node).setAttribute(name, String(value));
  }
  setText(node: PlatformNode, text: string): void {
    element(node).textContent = text;
  }
  insertBefore(parent: PlatformNode, node: PlatformNode, before: PlatformNode | null): void {
    element(parent).insertBefore(element(node), before && element(before));
  }
  remove(node: PlatformNode): void {
    element(node).remove();
  }
  setCursor(cursor: string): void {
    this.#svg.style.cursor = cursor;
  }
  #touchMode: 'always' | 'two-finger' = 'always';
  #listening = false;
  setTouchMode(mode: 'always' | 'two-finger'): void {
    this.#touchMode = mode;
    this.#applyTouchAction();
  }
  /** A chart that listens for pointer input takes the touches on it; one that does not is a picture, and the page keeps its scrolling. */
  #applyTouchAction(): void {
    this.#svg.style.touchAction = !this.#listening ? '' : this.#touchMode === 'always' ? 'none' : 'pan-x pan-y';
  }

  onResize(callback: (size: Size) => void): Unsubscribe {
    if (this.#fixed) return () => {};
    const observer = new ResizeObserver(() => callback(this.size()));
    observer.observe(this.#container as unknown as Element);
    return this.#track(() => observer.disconnect());
  }

  onPointer(callback: (pointer: RawPointer) => boolean | void): Unsubscribe {
    const svg = this.#svg;
    // Coordinates are made relative to the svg here so no element needs to know where the chart sits on the page.
    const send = (e: PointerLike, kind: RawPointer['kind'], extra: Partial<RawPointer> = {}): boolean | void => {
      const box = svg.getBoundingClientRect();
      return callback({
        kind,
        x: e.clientX - box.left,
        y: e.clientY - box.top,
        buttons: e.buttons,
        deltaY: 0,
        id: e.pointerId ?? 0,
        pointerType: e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse',
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
        ...extra,
      });
    };
    // Safari reports a trackpad pinch as gesture events (not as wheel events with ctrlKey, as other browsers do): each carries the
    // total scale since the gesture began, which is turned here into the factor since the last event.
    let gestureScale = 1;
    // Handlers are typed by the event they are registered for; the table is widened to `Event` at its one point of use, below.
    const listeners: [string, (e: never) => void, AddEventListenerOptions?][] = [
      ['pointermove', (e: PointerEvent) => send(e, 'move')],
      [
        'pointerdown',
        (e: PointerEvent) => {
          svg.setPointerCapture(e.pointerId);
          send(e, 'down');
        },
      ],
      ['pointerup', (e: PointerEvent) => send(e, 'up')],
      ['pointercancel', (e: PointerEvent) => send(e, 'up')],
      ['pointerleave', (e: PointerEvent) => send(e, 'leave')],
      [
        'wheel',
        (e: WheelEvent) => {
          // Wheel deltas arrive in lines or pages on some devices; normalise to pixels so zoom speed is consistent.
          const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.size().height : 1;
          if (send(e, 'wheel', { deltaY: e.deltaY * unit, deltaX: e.deltaX * unit })) e.preventDefault();
        },
        { passive: false },
      ],
      [
        'gesturestart',
        (e: Event) => {
          gestureScale = 1;
          e.preventDefault();
        },
      ],
      [
        'gesturechange',
        (e: SafariGestureEvent) => {
          const scale = e.scale / gestureScale;
          gestureScale = e.scale;
          send(e, 'pinch', { scale });
          e.preventDefault();
        },
        { passive: false },
      ],
      // With one finger the page scrolls (touch-action allows it); a second finger down means the chart has taken the gesture.
      [
        'touchmove',
        (e: TouchEvent) => {
          if (this.#touchMode === 'two-finger' && e.touches.length > 1 && e.cancelable) e.preventDefault();
        },
        { passive: false },
      ],
    ];
    for (const [type, handler, options] of listeners) svg.addEventListener(type, handler as EventListener, options);
    this.#listening = true;
    this.#applyTouchAction();
    return this.#track(() => {
      for (const [type, handler, options] of listeners) svg.removeEventListener(type, handler as EventListener, options);
      this.#listening = false;
      this.#applyTouchAction();
    });
  }

  onKey(callback: (key: RawKey, node: PlatformNode) => boolean | void): Unsubscribe {
    const svg = this.#svg;
    const handler = (kind: RawKey['kind']) => (e: KeyboardEvent) => {
      // The browser's own shortcuts (copy, reload, switch tab) are never the chart's to take.
      if (e.metaKey || (e.ctrlKey && e.key.length === 1)) return;
      const used = callback(
        { kind, key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, repeat: e.repeat },
        fromElement(e.target),
      );
      if (used) e.preventDefault();
    };
    const down = handler('down'),
      up = handler('up');
    svg.addEventListener('keydown', down);
    svg.addEventListener('keyup', up);
    return this.#track(() => {
      svg.removeEventListener('keydown', down);
      svg.removeEventListener('keyup', up);
    });
  }

  onFocus(callback: (focus: RawFocus) => void): Unsubscribe {
    const svg = this.#svg;
    const into = (e: FocusEvent) =>
      callback({ node: fromElement(e.target), focused: true, visible: !!(e.target as Element | null)?.matches?.(':focus-visible') });
    const out = (e: FocusEvent) => callback({ node: fromElement(e.target), focused: false, visible: false });
    svg.addEventListener('focusin', into);
    svg.addEventListener('focusout', out);
    return this.#track(() => {
      svg.removeEventListener('focusin', into);
      svg.removeEventListener('focusout', out);
    });
  }

  /** A visually hidden live region beside the chart: SVG text is not reliably announced when it changes, an HTML status is. */
  announce(text: string): void {
    if (!this.#live) {
      const live = this.#document.createElement('div');
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      live.style.cssText =
        'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
      this.#container.appendChild(live);
      this.#live = live;
    }
    this.#live.textContent = text;
  }
  #live: HTMLElement | null = null;

  focus(node: PlatformNode): void {
    (element(node) as HTMLElement).focus({ focusVisible: true });
  }

  dispose(): void {
    // oxlint-disable-next-line unicorn/no-useless-spread -- a snapshot: each cleanup removes itself from the set while we walk it
    for (const cleanup of [...this.#cleanups]) cleanup();
    this.#svg.remove();
    this.#live?.remove();
    this.#live = null;
  }

  /** Registers a cleanup so `dispose()` releases every listener even if the caller never unsubscribed. */
  #track(cleanup: Unsubscribe): Unsubscribe {
    const once = () => {
      if (this.#cleanups.delete(once)) cleanup();
    };
    this.#cleanups.add(once);
    return once;
  }
}

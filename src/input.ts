/**
 * The input host: how a platform's pointer, key and focus input reaches the elements of a chart.
 *
 * A chart that nothing in it listens to never creates one, so it never subscribes to the platform's input (a browser then
 * leaves the page its touches and wheel: a chart with no interactive element is a picture) and a bundle for it holds none of
 * this code. The elements that do listen (`PanZoom`, `BoxZoom`, `Brush`, `PointerListener`, `Cursor`, `Legend`) ask
 * for the host with `inputOf(chart)` as they attach; the first to ask creates it and it starts listening. `Chart.detach()` stops it.
 *
 * Pointer input goes to one plane, in that plane's own coordinates: the one a button went down on until it comes up, otherwise
 * the one under the pointer (over its plot, or over the strip an axis takes beside it, which is what lets an axis be zoomed
 * alone). A plane the pointer has left is told so. Everything inside the plane sees the event.
 */
import type { AnyElement } from './element.ts';
import { type ChartPointerEvent, EVENT_FOCUS, EVENT_HOVER, EVENT_KEY, EVENT_POINTER, type ChartKeyEvent } from './events.ts';
import { contains } from './geometry.ts';
import type { Chart } from './chart.ts';
import { Plane } from './plane.ts';
import type { PlatformNode, RawFocus, RawKey, RawPointer, Unsubscribe } from './platform.ts';

export class InputHost {
  /** True while the last pointer input came from a finger, which hits use to be more forgiving. */
  coarse = false;
  readonly #chart: Chart;
  readonly #subscriptions: Unsubscribe[] = [];
  // Pointer capture: the plane a drag started on keeps receiving events even when the pointer leaves it.
  #pressed: Plane | null = null;
  #hovered: Plane | null = null;
  // Elements that want HOVER events: the tree walk to deliver one is only made when someone asked.
  readonly #pointerWatchers = new Set<AnyElement>();
  readonly #inputWatchers = new Set<AnyElement>();
  // Which element owns each focusable node, so keys and focus changes reach the right one.
  readonly #focusOwners = new WeakMap<PlatformNode, AnyElement>();

  constructor(chart: Chart) { this.#chart = chart; }

  /** Listen to the chart's platform. Called by `inputOf`; a platform with no input of a kind simply gives none. */
  start(): void {
    const platform = this.#chart.platform;
    if (!platform || this.#subscriptions.length) return;
    for (const u of [
      platform.onPointer?.((p) => this.route(p)),
      platform.onKey?.((k, node) => this.routeKey(k, node)),
      platform.onFocus?.((f) => this.routeFocus(f)),
    ]) if (u) this.#subscriptions.push(u);
  }
  /** Stop listening and forget everything held: `Chart.detach()` calls it. */
  stop(): void {
    for (const u of this.#subscriptions.splice(0)) u();
    this.#pressed = this.#hovered = null;
    this.#pointerWatchers.clear();
    this.#inputWatchers.clear();
  }

  /**
   * Ask for HOVER events (where the pointer is in a plane) for as long as the returned function has not been called.
   * Elements outside the plane that follow the pointer (a tooltip) subscribe when they attach.
   */
  watchPointer(element: AnyElement): Unsubscribe {
    this.#pointerWatchers.add(element);
    return () => { this.#pointerWatchers.delete(element); };
  }

  /**
   * Ask for POINTER events in the chart's own pixels (not a plane's), for elements that are not in a plane and take
   * input of their own: a legend's entries. Set `handled` on one to keep the planes from also acting on it. Returns the
   * way to stop.
   */
  watchInput(element: AnyElement): Unsubscribe {
    this.#inputWatchers.add(element);
    return () => { this.#inputWatchers.delete(element); };
  }

  /**
   * Make a node reachable by keyboard: give it a `tabindex` (0 for a place in the tab order, -1 to be focusable by script
   * only) and say which element it belongs to, which then gets its KEY and FOCUS events. Call again with the same node
   * freely.
   */
  focusable(element: AnyElement, node: PlatformNode): void {
    this.#focusOwners.set(node, element);
  }
  /** Say something to a screen reader, if the platform has one to tell. */
  speak(text: string): void { this.#chart.platform?.announce?.(text); }
  /** Move keyboard focus to a node an element made `focusable`. Does nothing on a platform without focus. */
  focus(node: PlatformNode): void { this.#chart.platform?.focus?.(node); }

  /** One raw pointer: to what listens outside planes first, then to the plane it is over. True when something used it. */
  route(p: RawPointer): boolean {
    const chart = this.#chart;
    if (p.kind !== 'leave' && p.kind !== 'wheel' && p.kind !== 'pinch') this.coarse = p.pointerType === 'touch';
    // Whatever outside a plane listens (a legend) is told first, in the chart's own pixels; an element that uses the input keeps it from the planes.
    let taken = false;
    for (const w of this.#inputWatchers) {
      if (w.chart !== chart) { this.#inputWatchers.delete(w); continue; }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- `deliver` returns the event union; a pointer event comes back as one
      const ev = chart.deliver({
        type: EVENT_POINTER, kind: p.kind, x: p.x, y: p.y, buttons: p.buttons, deltaY: p.deltaY, deltaX: p.deltaX ?? 0, scale: p.scale ?? 1,
        id: p.id ?? 0, pointerType: p.pointerType ?? 'mouse', axis: null, outside: false, shift: p.shift, ctrl: p.ctrl, handled: false,
      }, w) as ChartPointerEvent;
      if (ev.handled) taken = true;
    }
    if (taken) return true;
    let at = this.#pressed;
    // A pointer reaches the plane it is over: its plot, or the strip an axis takes beside it.
    if (!at && p.kind !== 'leave') {
      for (const c of chart) {
        if (!(c instanceof Plane)) continue;
        if (contains(c.rect, p.x, p.y) || c.axisAt(p.x - c.rect.x, p.y - c.rect.y)) { at = c; break; }
      }
    }
    const send = (plane: Plane, kind: RawPointer['kind']) => {
      const r = plane.rect, x = p.x - r.x, y = p.y - r.y;
      // oxlint-disable-next-line typescript/consistent-type-assertions -- `deliver` returns the event union; a pointer event comes back as one
      return (chart.deliver({
        type: EVENT_POINTER, kind, x, y, buttons: p.buttons, deltaY: p.deltaY, deltaX: p.deltaX ?? 0, scale: p.scale ?? 1,
        id: p.id ?? 0, pointerType: p.pointerType ?? 'mouse', axis: kind === 'leave' ? null : plane.axisAt(x, y), outside: kind !== 'leave' && !contains(r, p.x, p.y),
        shift: p.shift, ctrl: p.ctrl, handled: false,
      }, plane) as ChartPointerEvent).handled;
    };
    if (this.#hovered && this.#hovered !== at) { send(this.#hovered, 'leave'); this.#announce(this.#hovered, NaN, NaN, 0); }
    this.#hovered = p.kind === 'leave' ? null : at;
    if (!at) return false;
    if (p.kind === 'down') this.#pressed = at;
    const handled = p.kind === 'leave' ? false : send(at, p.kind);
    if (p.kind === 'move' || p.kind === 'down' || p.kind === 'up') {
      // Over an axis the pointer is not on the plot, so what follows the pointer over the plot (a tooltip) is told it has left.
      const away = !contains(at.rect, p.x, p.y);
      this.#announce(at, away ? NaN : p.x - at.rect.x, away ? NaN : p.y - at.rect.y, away ? 0 : p.buttons);
    }
    if (p.kind === 'up') this.#pressed = null;
    return handled;
  }

  /** A key on a focused node, to the element that made the node focusable. */
  routeKey(k: RawKey, node: PlatformNode): boolean {
    const owner = this.#focusOwners.get(node);
    if (!owner || owner.chart !== this.#chart) return false;
    // oxlint-disable-next-line typescript/consistent-type-assertions -- `deliver` returns the event union; a key event comes back as one
    return (this.#chart.deliver({
      type: EVENT_KEY, kind: k.kind, key: k.key, shift: k.shift, ctrl: k.ctrl, alt: k.alt, repeat: k.repeat, node, handled: false,
    }, owner) as ChartKeyEvent).handled;
  }
  /** Focus entering or leaving a node, to its owner. */
  routeFocus(f: RawFocus): void {
    const owner = this.#focusOwners.get(f.node);
    if (!owner || owner.chart !== this.#chart) return;
    this.#chart.deliver({ type: EVENT_FOCUS, node: f.node, focused: f.focused, visible: f.visible }, owner);
  }

  /** Tell every element where the pointer is in `plane` (NaN: it has gone). */
  #announce(plane: Plane, x: number, y: number, buttons: number): void {
    for (const w of this.#pointerWatchers) if (w.chart !== this.#chart) this.#pointerWatchers.delete(w);   // taken out of the tree
    if (this.#pointerWatchers.size === 0) return;
    this.#chart.deliver({ type: EVENT_HOVER, plane, x, y, buttons });
  }
}

/** The chart's input host, made and started on the first ask. Elements that take input call this as they attach. */
export function inputOf(chart: Chart): InputHost {
  let host = chart.input;
  if (!host) { host = chart.input = new InputHost(chart); host.start(); }
  return host;
}

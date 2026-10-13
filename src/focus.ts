/**
 * Keyboard focus, shared by everything that can be reached with Tab: the ring that shows where focus is, and the keys a
 * button answers to.
 *
 * An element that wants focus does three things: give a node a `tabindex` and tell the chart it owns it
 * (`chart.focusable(this, node)`), draw the ring while it has focus (EVENT_FOCUS says when, and whether a ring is wanted:
 * only for keyboard focus, as the browser's own controls do), and answer EVENT_KEY.
 */
import { type ChartKeyEvent } from './events.ts';
import type { Rect } from './geometry.ts';
import type { PlatformNode } from './platform.ts';
import type { LineProps } from './theme.ts';
import type { Surface } from './surface.ts';

/** Room between the thing and its ring, in pixels. */
const RING_GAP = 2;

/** Draw the focus ring round `rect`, or take it away when `rect` is null. The `look` is the theme's `focusRing`. */
export function drawFocusRing(surface: Surface, key: string, look: LineProps, rect: Rect | null, parent?: PlatformNode): void {
  const ring = surface.node(key, 'rect', { above: true, ...(parent && { parent }) });
  if (!rect) { surface.set(ring, 'display', 'none'); return; }
  surface.set(ring, 'display', 'inline');
  surface.set(ring, 'x', rect.x - RING_GAP);
  surface.set(ring, 'y', rect.y - RING_GAP);
  surface.set(ring, 'width', rect.width + 2 * RING_GAP);
  surface.set(ring, 'height', rect.height + 2 * RING_GAP);
  surface.set(ring, 'rx', 3);
  surface.set(ring, 'fill', 'none');
  surface.set(ring, 'stroke', look.color);
  surface.set(ring, 'stroke-width', look.width);
  surface.set(ring, 'pointer-events', 'none');
}

/** Make a node a tab stop. The browser's own focus outline is turned off because the ring is drawn instead. */
export function makeTabStop(surface: Surface, node: PlatformNode, order = 0): void {
  surface.set(node, 'tabindex', order);
  surface.set(node, 'style', 'outline:none');
}

/**
 * Whether a key event presses a button, as a browser's own button does: Enter on the way down, Space on the way up (so it can
 * be cancelled by moving away, and the page does not scroll). The keys are marked handled, and a held key does not repeat.
 */
export function pressesButton(ev: ChartKeyEvent): boolean {
  if (ev.ctrl || ev.alt) return false;
  if (ev.key === 'Enter') {
    ev.handled = true;
    return ev.kind === 'down' && !ev.repeat;
  }
  if (ev.key === ' ' || ev.key === 'Spacebar') {
    ev.handled = true;
    return ev.kind === 'up';
  }
  return false;
}

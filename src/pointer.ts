/**
 * PointerListener: what a user reaches for to react to the pointer over a plane, without handling raw pointer events.
 *
 * It sits in a plane, like `PanZoom`, and turns the plane's pointer input into three things people actually want:
 * which point the pointer is over (`onHover`), a click on a point or on empty plot (`onClick`), and a point being
 * dragged (`onDrag`). Each callback gets one `PointerInfo`, which carries the hit, where the pointer is in plot pixels
 * and what that is in data terms, so an edit is a line or two:
 *
 *     new PointerListener({ onDrag: ({ hit, first, second }) => { rows[hit.row!].x = first; rows[hit.row!].y = second; source.invalidate(); } })
 *
 * What "over" means is decided by each series' own `hit` setting (see hit.ts); the listener only asks the plane.
 *
 * Sharing the plane with `PanZoom`
 * ────────────────────────────────
 * Both want a press on the plot. A listener claims the press only when it has something to do with it: a drag that starts
 * on a point (when `onDrag` is set). Anything else, including a press on empty plot, goes on to `PanZoom`, so dragging
 * the background still pans. The claim works by order: a plane's children receive input in the order they were added, and
 * `PanZoom` skips what is already handled, so the listener has to come first. Adding it after a `PanZoom` is an error.
 */
import { type AttrTypesFor, AUTO, NUMBER } from './attrs.ts';
import { type BaseAttributes, ChartElement, fail } from './element.ts';
import { InteractiveElement } from './input.ts';
import { type ChartEvent, EVENT_ATTACH, EVENT_POINTER, type Hit } from './events.ts';
import { hitPlane } from './hit.ts';
import type { Plane } from './plane.ts';

/** What every callback is told. */
export interface PointerInfo {
  readonly plane: Plane;
  /** The pointer in plot pixels. */
  readonly x: number;
  readonly y: number;
  /**
   * Where that is in data terms, on the axes of the hit's series, or else the plane's first and second axes. While
   * dragging it is where the grabbed point is to go: the pointer's position carrying the grab's offset, so the point
   * does not jump to be under the pointer's tip.
   */
  readonly first: number;
  readonly second: number;
  /** The point under the pointer (for a drag, the one being dragged, as it was when grabbed); null over nothing. */
  readonly hit: Hit | null;
  readonly shift: boolean;
  readonly ctrl: boolean;
}
/** A drag always has a point. `phase` is 'start' on the first movement past the threshold, 'end' on release. */
export interface DragInfo extends PointerInfo {
  readonly hit: Hit;
  readonly phase: 'start' | 'move' | 'end';
}

export interface PointerListenerAttributes extends BaseAttributes {
  /** The pointer came onto a point, left it, or moved to another: `info.hit` is the new one, null for none. */
  onHover?: (info: PointerInfo) => void;
  /** A press and release in the same place: on a point, or `info.hit` null on empty plot. */
  onClick?: (info: PointerInfo) => void;
  /** A drag that began on a point. The listener claims such presses, so they do not pan. */
  onDrag?: (info: DragInfo) => void;
  /** How far in pixels the pointer must travel before a press is a drag and no longer a click. Default 3. */
  dragThreshold?: number;
}

/** Same point as before? A row is the identity that survives re-sorting; without one the drawn index will do. */
const same = (a: Hit | null, b: Hit | null) =>
  a === b || (!!a && !!b && a.series === b.series && (a.row ?? a.index) === (b.row ?? b.index));

export class PointerListener extends InteractiveElement<Plane, [], PointerListenerAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    dragThreshold: NUMBER,
    onClick: AUTO,
    onDrag: AUTO,
    onHover: AUTO,
  } satisfies AttrTypesFor<PointerListenerAttributes>;
  #hover: Hit | null = null;
  // A press in progress: where it began, the point under it, and the offset from the pointer to that point.
  #press: { x: number; y: number; hit: Hit | null; dx: number; dy: number; claimed: boolean; dragging: boolean } | null = null;

  override onEvent(ev: ChartEvent): void {
    if (ev.type === EVENT_ATTACH) {
      const plane = this.requireParent();
      for (let sibling = plane.firstChild; sibling; sibling = sibling.nextSibling) {
        if (sibling === this) break;
        if (sibling.claimsPress) fail('add a PointerListener before PanZoom in a plane: the listener has to see a press first to claim it');
      }
      return;
    }
    if (ev.type !== EVENT_POINTER) return;
    const a = this.attrs,
      plane = this.requireParent(),
      platform = this.chart?.platform;
    // Over an axis the pointer is not over anything plotted. (A press that began on the plot goes on being ours until it ends.)
    if (ev.outside && !this.#press && ev.kind !== 'leave') {
      if (this.#hover && ev.kind === 'move') {
        this.#hover = null;
        a.onHover?.({ plane, x: ev.x, y: ev.y, first: NaN, second: NaN, hit: null, shift: ev.shift, ctrl: ev.ctrl });
      }
      return;
    }
    if (ev.kind === 'wheel' || ev.kind === 'pinch') return;
    const threshold = a.dragThreshold ?? 3;
    const info = (hit: Hit | null, x: number, y: number, dx = 0, dy = 0): PointerInfo => {
      const first = hit ? hit.series.firstAxis : plane.defaultAxis('first'),
        second = hit ? hit.series.secondAxis : plane.defaultAxis('second');
      const at = first && second ? plane.unplace(x + dx, y + dy, first, second) : ([NaN, NaN] as const);
      // In a stack the pointer reads the stacked height: the layer's own value is that less what it sits on.
      return { plane, x, y, first: at[0], second: at[1] - (hit?.lift ?? 0), hit, shift: ev.shift, ctrl: ev.ctrl };
    };
    switch (ev.kind) {
      case 'down': {
        if (!(ev.buttons & 1)) break;
        const hit = hitPlane(plane, ev.x, ev.y);
        const claimed = !!hit && !!a.onDrag;
        this.#press = { x: ev.x, y: ev.y, hit, dx: hit ? hit.px - ev.x : 0, dy: hit ? hit.py - ev.y : 0, claimed, dragging: false };
        if (claimed) ev.handled = true;
        break;
      }
      case 'move': {
        const press = this.#press;
        if (press) {
          if (!(ev.buttons & 1)) {
            this.#press = null;
            break;
          }
          if (!press.dragging && Math.hypot(ev.x - press.x, ev.y - press.y) < threshold) break;
          const first = !press.dragging;
          press.dragging = true;
          if (press.claimed && press.hit && a.onDrag) {
            a.onDrag({ ...info(press.hit, ev.x, ev.y, press.dx, press.dy), hit: press.hit, phase: first ? 'start' : 'move' });
            platform?.setCursor?.('grabbing');
            ev.handled = true;
          }
          break;
        }
        if (!a.onHover && !a.onDrag && !a.onClick) break;
        const hit = hitPlane(plane, ev.x, ev.y);
        if (!same(hit, this.#hover)) {
          this.#hover = hit;
          a.onHover?.(info(hit, ev.x, ev.y));
        }
        // Over a point the cursor says what it can do. Handled, so that `PanZoom` does not put its own over it.
        if (hit) {
          platform?.setCursor?.(a.onDrag ? 'grab' : 'pointer');
          ev.handled = true;
        } else if (!a.onDrag) platform?.setCursor?.('');
        break;
      }
      case 'up': {
        const press = this.#press;
        this.#press = null;
        if (!press) break;
        if (press.dragging && press.claimed && press.hit && a.onDrag) {
          a.onDrag({ ...info(press.hit, ev.x, ev.y, press.dx, press.dy), hit: press.hit, phase: 'end' });
          ev.handled = true;
        } else if (!press.dragging) {
          a.onClick?.(info(press.hit, ev.x, ev.y));
        }
        break;
      }
      case 'leave':
        this.#press = null;
        if (this.#hover) {
          this.#hover = null;
          a.onHover?.(info(null, ev.x, ev.y));
        }
        break;
    }
  }
}

/** Pan and zoom: pointer input turned into a change of view on a plane's axes. */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, AUTO, NUMBER, BOOLEAN } from './attrs.ts';
import { writeAria } from './aria.ts';
import { Axis } from './axis.ts';
import { type BaseAttributes, ChartElement, type ElementRef, resolveRef } from './element.ts';
import { InteractiveElement, inputOf } from './input.ts';
import {
  type ChartEvent,
  type ChartKeyEvent,
  type ChartPointerEvent,
  EVENT_FOCUS,
  EVENT_KEY,
  EVENT_PAINT,
  EVENT_POINTER,
} from './events.ts';
import { drawFocusRing, makeTabStop } from './focus.ts';
import type { Extent } from './geometry.ts';
import type { Plane } from './plane.ts';
import { moveView, naturalRange } from './viewtween.ts';
import type { PlatformNode } from './platform.ts';

/** What a key can do. */
export type PanZoomAction =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'pageLeft'
  | 'pageRight'
  | 'pageUp'
  | 'pageDown'
  | 'zoomIn'
  | 'zoomOut'
  | 'reset';
/** Keys, by `KeyboardEvent.key`, for each action. An action left out has the default keys; an empty list turns it off. */
export type PanZoomKeys = Partial<Record<PanZoomAction, readonly string[]>>;

/**
 * The keys it answers to unless told otherwise. Arrows move the view a step; with Shift, or the Page keys, a page. `+` and `-`
 * (with the `=` and `_` that share their keys) zoom about the middle, and `0` or Home puts the view back.
 */
export const DEFAULT_PANZOOM_KEYS: Readonly<Record<PanZoomAction, readonly string[]>> = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  pageLeft: [],
  pageRight: [],
  pageUp: ['PageUp'],
  pageDown: ['PageDown'],
  zoomIn: ['+', '='],
  zoomOut: ['-', '_'],
  reset: ['0', 'Home'],
};
/** For each moving action: along a horizontal axis or not, which way along it (+1 towards higher values), and whether it is a page. */
const MOVES: Record<Exclude<PanZoomAction, 'zoomIn' | 'zoomOut' | 'reset'>, readonly [boolean, 1 | -1, boolean]> = {
  left: [true, -1, false],
  right: [true, 1, false],
  up: [false, 1, false],
  down: [false, -1, false],
  pageLeft: [true, -1, true],
  pageRight: [true, 1, true],
  pageUp: [false, 1, true],
  pageDown: [false, -1, true],
};
/** Fractions of the view moved by an arrow, and by a page. */
const KEY_STEP = 0.1;
const KEY_PAGE = 0.5;
const KEY_ZOOM = 1.25;

export interface PanZoomAttributes extends BaseAttributes {
  /** The axes it may move, as elements or ids. Default: all of the plane's that can be dragged along: not the rim of a polar or radar plane. */
  axes?: readonly ElementRef<Axis>[];
  /**
   * Which way things may move. Default 'both'. Along one direction only, the other axes keep fitting what is in view.
   * A radius axis counts as vertical.
   */
  direction?: 'both' | 'horizontal' | 'vertical';
  /** Drag with the primary button to pan. Default true. */
  pan?: boolean;
  /** Turn the wheel to zoom about the pointer. Default true. */
  zoom?: boolean;
  /** Keep the view inside the natural range of each axis, so there is no panning off the data or zooming out past it. Default true. */
  limit?: boolean;
  /** Zoom per wheel pixel, as a natural-log factor. Default 0.002, which is about 20% for one notch of a typical wheel. */
  zoomSpeed?: number;
  /**
   * With the pointer (or both fingers) over an axis, a wheel turn, a pinch or a drag moves that axis alone. Default true. Off,
   * the axes beside the plot take no input and a gesture always moves every axis, about the pointer.
   */
  axisZoom?: boolean;
  /** Zoom per pixel of a pinch on a trackpad, which browsers report as small wheel turns with Ctrl held. Default 0.02, ten times the wheel's step per pixel. */
  pinchSpeed?: number;
  /**
   * What a touch does. 'two-finger' (the default): one finger scrolls the page as usual, and two pinch and pan the chart.
   * 'always': one finger pans the chart too, and the page cannot be scrolled from it.
   */
  touch?: 'two-finger' | 'always';
  /**
   * A finger that lets go while still moving carries the view on, slowing to a stop (a flick). Default true. Only a touch
   * flicks, and only where one finger pans (`touch: 'always'`); a mouse drag stops where it is released.
   */
  inertia?: boolean;
  /** Two quick presses put every axis back to its natural range. Default true. */
  resetOnDoubleClick?: boolean;
  /**
   * The keys, once the plot has keyboard focus. It is a tab stop, so Tab reaches it. Give the keys for the actions to change
   * (`{ zoomIn: ['i'], reset: ['r'] }`; the others keep their defaults, see `DEFAULT_PANZOOM_KEYS`), or `false` for no keyboard
   * control and no tab stop. Name the plot with `meta.title` (on this, or on its plane), which is what a screen reader says
   * on arriving.
   */
  keys?: PanZoomKeys | false;
  /** How far an arrow moves the view, as a fraction of it. Default 0.1. A page is five times that, up to half. */
  keyStep?: number;
  /** The factor of one press of a zoom key. Default 1.25. */
  keyZoom?: number;
}

/** A finger on the plot or an axis. */
type Touch = { x: number; y: number; axis: Axis | null };
/** Least distance in pixels between two fingers along an axis for the pinch to zoom it; closer than that it only pans along. */
const PINCH_MIN_SPAN = 24;
/** Zoom per pixel of a trackpad pinch (a wheel turn with Ctrl held), as a natural-log factor. */
const PINCH_SPEED = 0.02;
/** A flick: it counts if the finger moved within `FLICK_REST` ms of letting go, at least `FLICK_MIN` px/ms measured over the last `FLICK_WINDOW` ms; speed falls by 1/e every `FLICK_TAU` ms down to `FLICK_STOP`. */
const FLICK_REST = 80,
  FLICK_WINDOW = 100,
  FLICK_MIN = 0.15,
  FLICK_TAU = 325,
  FLICK_STOP = 0.02;

/** An axis it can move, how far along it a position in the plot is, and its range when a drag began (`snap`: later maths is relative to it, so a drag cannot drift). */
type Moving = { axis: Axis; at: (x: number, y: number) => number; snap: Extent };
/** A pointer drag in progress: where it began, the axes it moves, and for a touch its recent positions (to find the speed it lets go at). */
type Drag = { id: number; x: number; y: number; moves: Moving[]; samples?: { t: number; x: number; y: number }[] };
/** A change of view as an affine map on the axis' fractions: scale about `anchor`, then shift. A pan is scale 1; a zoom is shift 0. */
type ViewChange = { snap: Extent; scale: number; anchor: number; shift: number };

/**
 * Pan and zoom for the plane it sits in: a plane child that turns pointer input into view ranges on axes.
 * Everything is worked out in the fractions of the scale, so it behaves the same on a linear axis, an inverted one,
 * one on the far side, or one with a different scale: the value under the pointer stays under the pointer.
 *
 * It does not know what a plane looks like. Each axis' `Ruler` says how far along it a plot position is (`fractionAt`),
 * so dragging along a spoke or a rectangle's edge is the same code; an axis whose ruler cannot say (the rim) is left alone.
 */
export class PanZoom extends InteractiveElement<Plane, [], PanZoomAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    keyStep: NUMBER,
    keyZoom: NUMBER,
    pinchSpeed: NUMBER,
    inertia: BOOLEAN,
    axisZoom: BOOLEAN,
    resetOnDoubleClick: BOOLEAN,
    zoomSpeed: NUMBER,
    keys: { pageLeft: AUTO, pageRight: AUTO, pageUp: AUTO, pageDown: AUTO, zoomIn: AUTO, zoomOut: AUTO },
  } satisfies AttrTypesFor<PanZoomAttributes>;
  // The drag in progress, with each axis' range as it was at the start; and the last press, for double-click detection.
  #drag: Drag | null = null;
  /** A flick in progress: stopped by the next touch, wheel or reset. */
  #coast: { cancel: () => void } | null = null;
  readonly #touches = new Map<number, Touch>();
  #pinch: { ids: [number, number]; moves: (Moving & { a1: number; a2: number; length: number })[] } | null = null;
  #lastDown = { time: -Infinity, x: 0, y: 0 };

  /** Put every controlled axis back to the range its data asks for. */
  reset(): void {
    this.#stopCoast();
    for (const { axis } of this.controlled()) moveView(axis, null);
  }

  /** Marks it for `PointerListener`, which must come before it: it takes presses, so what it claims is not ours. */
  override readonly claimsPress = true;

  #focusNode: PlatformNode | null = null;
  #ring = false;
  #lastKeys = '';

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_PAINT:
        this.#paintFocus();
        if (this.attrs.pan !== false || this.attrs.zoom !== false)
          this.chart?.platform?.setTouchMode?.(this.attrs.touch === 'always' ? 'always' : 'two-finger');
        return;
      case EVENT_KEY:
        this.#key(ev);
        return;
      case EVENT_FOCUS:
        if (ev.focused) {
          this.#focusNode = ev.node;
          this.#ring = ev.visible;
        } else if (this.#focusNode === ev.node) {
          this.#focusNode = null;
          this.#ring = false;
        }
        this.invalidate();
        return;
    }
    if (ev.type !== EVENT_POINTER) return;
    const a = this.attrs,
      platform = this.chart?.platform;
    // An element ahead of this one (a `PointerListener`) may already have used a press or claimed the cursor.
    if (ev.handled && (ev.kind === 'down' || ev.kind === 'move') && !this.#drag && !this.#pinch) return;
    // Beside the plot, over an axis, only when asked: with `axisZoom` off the axes are inert.
    if (ev.outside && a.axisZoom === false && !this.#drag && !this.#pinch) return;
    if (ev.pointerType === 'touch' && ev.kind !== 'wheel' && ev.kind !== 'pinch') {
      this.#touch(ev);
      return;
    }
    switch (ev.kind) {
      case 'down': {
        if (!(ev.buttons & 1)) break;
        if (this.#doubleClick(ev)) break;
        if (a.pan === false) break;
        this.#drag = { id: ev.id, x: ev.x, y: ev.y, moves: this.targets(ev.axis) };
        platform?.setCursor?.('grabbing');
        ev.handled = true;
        break;
      }
      case 'move': {
        const drag = this.#drag;
        if (!drag) {
          if (a.pan !== false) platform?.setCursor?.('grab');
          break;
        }
        if (!(ev.buttons & 1)) {
          this.#drag = null;
          platform?.setCursor?.('grab');
          break;
        }
        for (const { axis, at, snap } of drag.moves)
          this.apply(axis, { snap, scale: 1, anchor: 0, shift: at(drag.x, drag.y) - at(ev.x, ev.y) });
        ev.handled = true;
        break;
      }
      case 'up':
        if (this.#drag) {
          this.#drag = null;
          platform?.setCursor?.('grab');
          ev.handled = true;
        }
        break;
      case 'leave':
        platform?.setCursor?.('');
        break;
      case 'wheel': {
        this.#stopCoast();
        const targets = this.targets(ev.axis);
        if (targets.length === 0) break;
        // A turn that is mostly sideways moves the view along (a trackpad's two-finger swipe, or Shift and the wheel).
        if (!ev.ctrl && Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
          if (a.pan === false) break;
          for (const { axis, at, snap } of targets) {
            if (axis.ruler.horizontal) this.apply(axis, { snap, scale: 1, anchor: 0, shift: at(ev.x + ev.deltaX, ev.y) - at(ev.x, ev.y) });
          }
          ev.handled = true;
          break;
        }
        if (a.zoom === false || ev.deltaY === 0) break;
        // A pinch on a trackpad arrives as a wheel turn with Ctrl held, in much smaller steps than a wheel's notch: it gets its own speed.
        const speed = ev.ctrl ? (a.pinchSpeed ?? PINCH_SPEED) : (a.zoomSpeed ?? 0.002);
        const scale = Math.exp(ev.deltaY * speed);
        for (const { axis, at, snap } of targets) this.apply(axis, { snap, scale, anchor: at(ev.x, ev.y), shift: 0 });
        ev.handled = true;
        break;
      }
      case 'pinch': {
        // A gesture the platform recognised (Safari): the fingers spread by `scale`, so the view shrinks by it.
        const targets = this.targets(ev.axis);
        if (a.zoom === false || targets.length === 0 || !(ev.scale > 0)) break;
        for (const { axis, at, snap } of targets) this.apply(axis, { snap, scale: 1 / ev.scale, anchor: at(ev.x, ev.y), shift: 0 });
        ev.handled = true;
        break;
      }
    }
  }

  /** Two presses close together reset the axis under them, or all of them. True when this press was the second. */
  #doubleClick(ev: ChartPointerEvent): boolean {
    const now = performance.now(),
      last = this.#lastDown;
    if (this.attrs.resetOnDoubleClick !== false && now - last.time < 350 && Math.hypot(ev.x - last.x, ev.y - last.y) < 6) {
      this.#lastDown = { time: -Infinity, x: 0, y: 0 };
      for (const { axis } of this.targets(ev.axis)) moveView(axis, null);
      ev.handled = true;
      return true;
    }
    this.#lastDown = { time: now, x: ev.x, y: ev.y };
    return false;
  }

  /**
   * Touch: one finger pans (unless `touch` is 'two-finger', where the page keeps it for scrolling) and two fingers pinch.
   * A pinch keeps the content under each finger under it, so it zooms and pans in the same movement; on an axis along which
   * the fingers are barely apart it only pans, so a level pinch zooms the horizontal axes alone and a plumb one the vertical.
   */
  #touch(ev: ChartPointerEvent): void {
    const a = this.attrs,
      always = a.touch === 'always',
      touches = this.#touches;
    switch (ev.kind) {
      case 'down': {
        this.#stopCoast();
        touches.set(ev.id, { x: ev.x, y: ev.y, axis: ev.axis });
        if (touches.size === 2 && a.zoom !== false) {
          this.#drag = null;
          this.#startPinch();
          ev.handled = true;
        } else if (touches.size === 1) {
          if (this.#doubleClick(ev)) break;
          if (always && a.pan !== false) {
            this.#drag = {
              id: ev.id,
              x: ev.x,
              y: ev.y,
              moves: this.targets(ev.axis),
              samples: [{ t: performance.now(), x: ev.x, y: ev.y }],
            };
            ev.handled = true;
          }
        }
        break;
      }
      case 'move': {
        const t = touches.get(ev.id);
        if (!t) break;
        t.x = ev.x;
        t.y = ev.y;
        if (this.#pinch) {
          this.#movePinch();
          ev.handled = true;
          break;
        }
        const drag = this.#drag;
        if (drag && drag.id === ev.id) {
          for (const { axis, at, snap } of drag.moves)
            this.apply(axis, { snap, scale: 1, anchor: 0, shift: at(drag.x, drag.y) - at(ev.x, ev.y) });
          drag.samples?.push({ t: performance.now(), x: ev.x, y: ev.y });
          if (drag.samples && drag.samples.length > 8) drag.samples.shift();
          ev.handled = true;
        }
        break;
      }
      case 'up': {
        touches.delete(ev.id);
        if (this.#drag?.id === ev.id) {
          const drag = this.#drag;
          this.#drag = null;
          if (a.inertia !== false && !this.#pinch) this.#flick(drag);
        }
        if (this.#pinch) {
          this.#pinch = null;
          // In 'always' the finger that is left carries on as a pan from where it is.
          const [rest] = [...touches];
          if (always && a.pan !== false && rest) {
            this.#drag = { id: rest[0], x: rest[1].x, y: rest[1].y, moves: this.targets(rest[1].axis) };
          }
        }
        ev.handled = true;
        break;
      }
    }
  }

  #stopCoast(): void {
    this.#coast?.cancel();
    this.#coast = null;
  }

  /** The finger left while moving: carry on at its speed, slowing as a flick does, a frame at a time until it is slow enough to stop. */
  #flick(drag: Drag): void {
    const platform = this.chart?.platform,
      samples = drag.samples;
    if (!platform?.schedule || !samples || samples.length < 2) return;
    const now = performance.now(),
      last = samples[samples.length - 1]!;
    if (now - last.t > FLICK_REST) return; // it stopped before it let go
    const first = samples.find((p) => last.t - p.t <= FLICK_WINDOW) ?? last;
    const dt = Math.max(last.t - first.t, 1);
    let vx = (last.x - first.x) / dt,
      vy = (last.y - first.y) / dt;
    if (Math.hypot(vx, vy) < FLICK_MIN) return;
    // Virtual finger position, advanced by the speed each frame; the view follows it the way a drag would.
    let x = last.x,
      y = last.y,
      then = now,
      stop: (() => void) | null = null,
      live = true;
    const tick = (): void => {
      stop = null;
      const p = this.chart?.platform;
      if (!live || !p?.schedule) return;
      const t = performance.now(),
        step = Math.min(t - then, 64);
      then = t;
      x += vx * step;
      y += vy * step;
      const decay = Math.exp(-step / FLICK_TAU);
      vx *= decay;
      vy *= decay;
      for (const { axis, at, snap } of drag.moves) this.apply(axis, { snap, scale: 1, anchor: 0, shift: at(drag.x, drag.y) - at(x, y) });
      if (Math.hypot(vx, vy) < FLICK_STOP) {
        this.#coast = null;
        return;
      }
      stop = p.schedule(tick);
    };
    this.#coast = {
      cancel: () => {
        live = false;
        stop?.();
      },
    };
    stop = platform.schedule(tick);
  }

  #startPinch(): void {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the size of `#touches` was checked as two just above
    const [[id1, p1], [id2, p2]] = [...this.#touches] as [[number, Touch], [number, Touch]];
    // Both fingers on one axis' strip: that axis alone.
    const over = p1.axis && p1.axis === p2.axis && this.attrs.axisZoom !== false ? p1.axis : null;
    const moves = this.targets(over).map((m) => ({ ...m, a1: m.at(p1.x, p1.y), a2: m.at(p2.x, p2.y), length: m.axis.ruler.length }));
    this.#pinch = { ids: [id1, id2], moves };
  }

  #movePinch(): void {
    const pinch = this.#pinch;
    if (!pinch) return;
    const p1 = this.#touches.get(pinch.ids[0]),
      p2 = this.#touches.get(pinch.ids[1]);
    if (!p1 || !p2) return;
    for (const m of pinch.moves) {
      const b1 = m.at(p1.x, p1.y),
        b2 = m.at(p2.x, p2.y),
        span = m.a2 - m.a1,
        now = b2 - b1;
      if (Math.abs(span) * m.length >= PINCH_MIN_SPAN && Math.abs(now) * m.length >= 1) {
        const k = span / now;
        this.apply(m.axis, { snap: m.snap, scale: k, anchor: 0, shift: m.a1 - b1 * k });
      } else {
        this.apply(m.axis, { snap: m.snap, scale: 1, anchor: 0, shift: (m.a1 + m.a2) / 2 - (b1 + b2) / 2 });
      }
    }
  }

  /** The axes a gesture at an axis' strip moves: that axis alone (`axisZoom`), or everything it controls. */
  private targets(over: Axis | null): Moving[] {
    const all = this.controlled();
    return over && this.attrs.axisZoom !== false ? all.filter((m) => m.axis === over) : all;
  }

  /** The keys in force: the defaults with the ones asked for laid over them, or none. */
  get keyMap(): PanZoomKeys | null {
    const k = this.attrs.keys;
    return k === false ? null : { ...DEFAULT_PANZOOM_KEYS, ...k };
  }

  /** The plot as a tab stop with the application role, which is what tells a screen reader to pass the arrow keys on to it. */
  #paintFocus(): void {
    const s = this.surface,
      plane = this.requireParent(),
      map = this.keyMap;
    if (!map) {
      s.removePrefix('focus');
      s.remove('ring');
      this.#lastKeys = '';
      return;
    }
    const r = plane.rect,
      node = s.node('focus', 'rect', { above: true });
    s.set(node, 'x', 0);
    s.set(node, 'y', 0);
    s.set(node, 'width', r.width);
    s.set(node, 'height', r.height);
    s.set(node, 'fill', 'none');
    s.set(node, 'pointer-events', 'none');
    makeTabStop(s, node);
    writeAria(s, node, this.attrs.meta ?? (plane.attrs.meta?.title !== undefined ? { title: plane.attrs.meta.title } : undefined), {
      role: 'application',
    });
    const shortcuts = [...new Set(Object.values(map).flat())].map((k) => (k === '+' ? 'Plus' : k === ' ' ? 'Space' : k)).join(' ');
    if (shortcuts !== this.#lastKeys) {
      this.#lastKeys = shortcuts;
      s.set(node, 'aria-keyshortcuts', shortcuts);
    }
    inputOf(this.requireChart()).focusable(this, node);
    this.#node = node;
    drawFocusRing(
      s,
      'ring',
      this.styleFor(['focusRing', 'line']),
      this.#ring ? { x: 3, y: 3, width: Math.max(0, r.width - 6), height: Math.max(0, r.height - 6) } : null,
    );
  }
  #node: PlatformNode | null = null;

  /** Move the view by a fraction of itself along the way an action points, or zoom it about its middle, or reset it. */
  #key(ev: ChartKeyEvent): void {
    const map = this.keyMap;
    if (!map || ev.kind !== 'down' || ev.node !== this.#node || ev.ctrl || ev.alt) return;
    let action: PanZoomAction | undefined;
    for (const name in map)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- `for…in` gives `string`; the keys of `map` are `PanZoomAction`s
      if (map[name as PanZoomAction]!.includes(ev.key)) {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- as above: the keys of `map` are `PanZoomAction`s
        action = name as PanZoomAction;
        break;
      }
    if (!action) return;
    ev.handled = true;
    const a = this.attrs;
    if (action === 'reset') {
      this.reset();
      return;
    }
    if (action === 'zoomIn' || action === 'zoomOut') {
      const k = a.keyZoom ?? KEY_ZOOM,
        scale = action === 'zoomIn' ? 1 / k : k;
      for (const { axis, snap } of this.controlled()) this.apply(axis, { snap, scale, anchor: 0.5, shift: 0 });
      return;
    }
    const [horizontal, sign, page] = MOVES[action];
    const step = page || ev.shift ? Math.min(KEY_PAGE, 5 * (a.keyStep ?? KEY_STEP)) : (a.keyStep ?? KEY_STEP);
    for (const { axis, snap } of this.controlled()) {
      if (axis.ruler.horizontal === horizontal) this.apply(axis, { snap, scale: 1, anchor: 0, shift: sign * step });
    }
  }

  /** The axes this will move, as of now: the chosen ones (or all the plane's) that can be followed along and fit `direction`. */
  private controlled(): Moving[] {
    const a = this.attrs,
      only = a.direction ?? 'both';
    const axes = a.axes ? a.axes.map((ref) => resolveRef<Axis>(ref, this, Axis)) : this.requireParent().axes;
    const out: Moving[] = [];
    for (const axis of axes) {
      const ruler = axis.ruler;
      if (typeof ruler.fractionAt === 'function' && (only === 'both' || ruler.horizontal === (only === 'horizontal'))) {
        out.push({ axis, at: ruler.fractionAt.bind(ruler), snap: { ...(axis.viewRange ?? axis.range) } });
      }
    }
    return out;
  }

  /**
   * What the limit is measured against: the range all of the data on this axis asks for, not the part in view.
   * (If it were the part in view, zooming one axis would move the limit of the other under your hand.)
   */
  private limitFor(axis: Axis): Extent {
    return naturalRange(axis);
  }

  /** Applies the change and sets the axis' view range; a view that covers the natural range is recorded as no view at all. */
  private apply(axis: Axis, change: ViewChange): void {
    const view = this.viewFor(axis, change);
    if (view !== null) axis.setViewRange(view === 'natural' ? null : view);
  }

  /**
   * The new range, 'natural' if the change ends up covering all of it, or null to leave things as they are.
   * A display fraction `d` along the axis is `u` in the scale's own fractions, flipped when the axis is inverted.
   */
  private viewFor(axis: Axis, { snap, scale: k, anchor, shift }: ViewChange): Extent | 'natural' | null {
    const scale = axis.scale,
      inverted = axis.flipped;
    const map = (u: number) => {
      const d = inverted ? 1 - u : u;
      const moved = anchor + (d - anchor) * k + shift;
      return inverted ? 1 - moved : moved;
    };
    let u0 = map(0),
      u1 = map(1);
    if (this.attrs.limit !== false) {
      const wanted = this.limitFor(axis);
      const natural = new Float64Array([wanted.min, wanted.max]);
      scale.normalize(natural, 2, 1, 0, snap);
      const lo = Math.min(natural[0]!, natural[1]!),
        hi = Math.max(natural[0]!, natural[1]!);
      if (u1 - u0 >= hi - lo) return 'natural';
      if (u0 < lo) {
        u1 += lo - u0;
        u0 = lo;
      } else if (u1 > hi) {
        u0 -= u1 - hi;
        u1 = hi;
      }
    }
    const min = scale.denormalize(u0, snap),
      max = scale.denormalize(u1, snap);
    // Past the precision of a double there is nothing left to zoom into.
    if (!(max - min > 1e-12 * Math.max(1, Math.abs(min), Math.abs(max)))) return null;
    return { min, max };
  }
}

/**
 * The cursor: where the user is pointing in a plane, and what is there. It draws nothing itself. It works out, from the
 * mouse or from the keyboard, a `CursorState`, and the elements inside it (a `Crosshair`, a `ChartTooltip`, anything of
 * your own) draw from that:
 *
 *   new Chart({}, plane, new Cursor({ mode: 'shared' }, new Crosshair({ lines: 'first' }), new ChartTooltip()))
 *
 * Keeping the finding apart from the drawing is what lets them be mixed freely: a crosshair with no tooltip, a tooltip with
 * no crosshair, two tooltips, one at the point and one in the corner, all reading the same cursor.
 *
 * Two ways to move it
 * ───────────────────
 * With the pointer, it is wherever the pointer is over a plane. With the keyboard, the plot is a tab stop: Left and Right step
 * from point to point of a series (skipping gaps), Up and Down move to the previous or next series, Home and End go to
 * the first and last point, PageUp and PageDown jump a tenth of the series, and Escape puts the cursor away. The keys are
 * configurable (`keys`, as for `PanZoom`), and `keys: false` leaves the cursor to the pointer alone and takes it out of the
 * tab order. Whichever moved last has the cursor. Name the plot with `meta.title`: it is what a screen reader says on arriving.
 *
 * What it finds
 * ─────────────
 *  - 'nearest' (the default): the one point nearest the pointer, as the series' `hit` settings measure it (hit.ts); with the
 *    keyboard, the point stepped to.
 *  - 'shared': every series at the cursor's place along the first axis, so a line chart is read across all its lines at once.
 *    It is measured along the axis and not in pixels, so on a polar plane it is every series at the pointer's angle.
 * `interpolate` reads the line between its points where the pointer is, in place of the nearest point.
 *
 * It holds no words: what a tooltip says is the tooltip's, and a screen reader hears the tooltip's text for a cursor moved
 * by keyboard (see `Platform.announce`).
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, AUTO, STRING } from './attrs.ts';
import { writeAria } from './aria.ts';
import type { Chart } from './chart.ts';
import { type BaseAttributes, ChartElement, type ElementRef, resolveRef } from './element.ts';
import { InteractiveElement, inputOf } from './input.ts';
import { type ChartEvent, EVENT_ATTACH, EVENT_FOCUS, EVENT_HOVER, EVENT_KEY, EVENT_PAINT, type Hit } from './events.ts';
import { drawFocusRing, makeTabStop } from './focus.ts';
import { hitAcross, hitPlane, interpolate, interpolateAll, pointHit } from './hit.ts';
import { Plane } from './plane.ts';
import type { PlatformNode } from './platform.ts';
import type { Series } from './series.ts';
import type { ChartTooltip } from './furniture.ts';
import type { Crosshair } from './crosshair.ts';

/** What the keyboard can do to the cursor. */
export type CursorAction = 'next' | 'previous' | 'nextSeries' | 'previousSeries' | 'first' | 'last' | 'jumpNext' | 'jumpPrevious' | 'clear';
/** Keys, by `KeyboardEvent.key`, for each action. An action left out has the default keys; an empty list turns it off. */
export type CursorKeys = Partial<Record<CursorAction, readonly string[]>>;
export const DEFAULT_CURSOR_KEYS: Readonly<Record<CursorAction, readonly string[]>> = {
  next: ['ArrowRight'],
  previous: ['ArrowLeft'],
  nextSeries: ['ArrowDown'],
  previousSeries: ['ArrowUp'],
  first: ['Home'],
  last: ['End'],
  jumpNext: ['PageDown'],
  jumpPrevious: ['PageUp'],
  clear: ['Escape'],
};

export interface CursorAttributes extends BaseAttributes {
  /** What it finds: the 'nearest' point, or every series 'shared' at its place along the first axis. Default 'nearest'. */
  mode?: 'nearest' | 'shared';
  /** Read the line between its two points at the cursor instead of reporting a point. Domain series only; others keep their nearest point. Default false. */
  interpolate?: boolean;
  /** The plane it works in. Default: the plane the pointer is over, and the first plane for the keyboard. */
  plane?: ElementRef<Plane>;
  /** Keys for moving it from the keyboard, or `false` for none (and no tab stop). */
  keys?: CursorKeys | false;
}

/** Where the cursor is and what is there. */
export interface CursorState {
  readonly plane: Plane;
  /** The cursor in the plane's plot pixels: the pointer's place, or the point stepped to with the keyboard. */
  readonly x: number;
  readonly y: number;
  /** Which of the two moved it last. */
  readonly source: 'pointer' | 'keyboard';
  /** What is there under the cursor's mode, topmost series first; none when the pointer is over nothing. */
  readonly hits: readonly Hit[];
}

/** What an element inside a cursor says about itself. */
export interface CursorChild {
  /** True when it is drawn at the pointer's own place, so the cursor must redraw for each movement and not only for a change of hit. */
  readonly follows: boolean;
}

export interface CursorChildMap {
  crosshair: Crosshair;
  tooltip: ChartTooltip;
}
export type CursorChildren = CursorChildMap[keyof CursorChildMap][];

const JUMP = 0.1;

export class Cursor extends InteractiveElement<Chart, CursorChildren, CursorAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    plane: STRING,
    keys: { nextSeries: AUTO, previousSeries: AUTO, jumpNext: AUTO, jumpPrevious: AUTO },
  } satisfies AttrTypesFor<CursorAttributes>;
  #pointer: { plane: Plane; x: number; y: number; buttons: number } | null = null;
  #by: 'pointer' | 'keyboard' = 'pointer';
  #focused = false;
  #ring = false;
  #node: PlatformNode | null = null;
  /** The point the keyboard is on. */
  #at: { series: Series; index: number } | null = null;
  #version = 0;
  #cache: { version: number; flush: number; state: CursorState | null } | null = null;
  #signature = '';
  #lastKeys = '';

  /** The keys in force: the defaults with the ones asked for laid over them, or none. */
  get keyMap(): CursorKeys | null {
    const k = this.attrs.keys;
    return k === false ? null : { ...DEFAULT_CURSOR_KEYS, ...k };
  }

  /**
   * Where the cursor is and what is there, or null when it is nowhere: the pointer is off the plot (or on its corner, for a
   * round plot), a button is held (a drag), or the keyboard has put it away. Worked out afresh after each flush, since
   * the data may have been edited, or the view panned, under a pointer that has not moved.
   */
  get state(): CursorState | null {
    const flush = this.chart?.flushCount ?? 0,
      cache = this.#cache;
    if (cache && cache.version === this.#version && cache.flush === flush) return cache.state;
    const state = this.#compute();
    this.#cache = { version: this.#version, flush, state };
    return state;
  }

  /** The plane the cursor is tied to by `plane`, else the first. */
  get plane(): Plane | null {
    const ref = this.attrs.plane;
    if (ref) return resolveRef<Plane>(ref, this, Plane);
    for (const c of this.requireParent()) if (c instanceof Plane) return c;
    return null;
  }

  /** Put the keyboard cursor on a point of a series, as if stepped to, and show it. */
  select(series: Series, index: number): void {
    this.#at = { series, index };
    this.#by = 'keyboard';
    this.#changed(true);
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        inputOf(this.requireParent()).watchPointer(this);
        break;
      case EVENT_HOVER: {
        const pinned = this.attrs.plane ? this.plane : null;
        if (pinned && ev.plane !== pinned) break;
        this.#pointer = ev.x === ev.x ? { plane: ev.plane, x: ev.x, y: ev.y, buttons: ev.buttons } : null;
        // The pointer leaving ends only what the pointer was doing: a cursor the keyboard put there stays.
        if (this.#pointer) this.#by = 'pointer';
        this.#changed(false);
        break;
      }
      case EVENT_KEY:
        this.#key(ev);
        break;
      case EVENT_FOCUS:
        if (ev.node !== this.#node) break;
        this.#focused = ev.focused;
        this.#ring = ev.focused && ev.visible;
        if (ev.focused) {
          this.#by = 'keyboard';
          this.#begin();
        } else if (this.#by === 'keyboard') this.#by = 'pointer';
        this.#changed(true);
        break;
      case EVENT_PAINT:
        this.#paintFocus();
        break;
    }
  }

  /** The keyboard's point: nothing yet means the first point of the first series. */
  #begin(): void {
    if (this.#at && this.#valid(this.#at)) return;
    const plane = this.plane;
    this.#at = null;
    if (!plane) return;
    for (const series of this.#steppable(plane)) {
      const index = this.#step(series, -1, 1);
      if (index >= 0) {
        this.#at = { series, index };
        return;
      }
    }
  }

  /** Series the keyboard can stop on: shown, drawn, and taking hits. */
  #steppable(plane: Plane): Series[] {
    return plane.series.filter((s) => s.attrs.hit !== false && (s.drawn?.points.count ?? 0) > 0);
  }
  #valid(at: { series: Series; index: number }): boolean {
    const plane = this.plane,
      d = at.series.drawn;
    return !!plane && at.series.shown && at.series.plane === plane && !!d && at.index < d.points.count && this.#real(at.series, at.index);
  }
  /** Whether drawn point `index` is a point and not a gap. */
  #real(series: Series, index: number): boolean {
    const p = series.drawn?.points;
    if (!p) return false;
    return p.data[index * p.stride]! === p.data[index * p.stride]! && p.data[index * p.stride + 1]! === p.data[index * p.stride + 1]!;
  }
  /** The point `by` steps from `from` that is not a gap, or -1 when there is none that way. */
  #step(series: Series, from: number, by: number): number {
    const n = series.drawn?.points.count ?? 0;
    for (let k = from + by; k >= 0 && k < n; k += by) if (this.#real(series, k)) return k;
    return -1;
  }

  #key(ev: import('./events.ts').ChartKeyEvent): void {
    const map = this.keyMap;
    if (!map || ev.kind !== 'down' || ev.node !== this.#node || ev.ctrl || ev.alt || ev.shift) return;
    let action: CursorAction | undefined;
    for (const name in map)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- `for…in` gives `string`; the keys of `map` are `CursorAction`s
      if (map[name as CursorAction]!.includes(ev.key)) {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- as above: the keys of `map` are `CursorAction`s
        action = name as CursorAction;
        break;
      }
    if (!action) return;
    const plane = this.plane;
    if (!plane) return;
    if (action === 'clear') {
      if (this.state) {
        ev.handled = true;
        this.#at = null;
        this.#by = 'keyboard';
        this.#changed(true);
      }
      return;
    }
    ev.handled = true;
    this.#by = 'keyboard';
    if (!this.#at || !this.#valid(this.#at)) this.#begin();
    const at = this.#at;
    if (!at) {
      this.#changed(true);
      return;
    }
    const n = at.series.drawn?.points.count ?? 0;
    const jump = Math.max(1, Math.round(n * JUMP));
    let index = -1;
    switch (action) {
      case 'next':
        index = this.#step(at.series, at.index, 1);
        break;
      case 'previous':
        index = this.#step(at.series, at.index, -1);
        break;
      case 'jumpNext':
        index = this.#reach(at, jump, 1);
        break;
      case 'jumpPrevious':
        index = this.#reach(at, jump, -1);
        break;
      case 'first':
        index = this.#step(at.series, -1, 1);
        break;
      case 'last':
        index = this.#step(at.series, n, -1);
        break;
      case 'nextSeries':
      case 'previousSeries': {
        const list = this.#steppable(plane),
          at0 = list.indexOf(at.series),
          other = list[at0 + (action === 'nextSeries' ? 1 : -1)];
        if (other) this.#at = { series: other, index: this.#alongTo(at, other) };
        this.#changed(true);
        return;
      }
    }
    if (index >= 0) this.#at = { series: at.series, index };
    this.#changed(true);
  }

  /** `count` real points on from a point, or the last one reached before running out. */
  #reach(at: { series: Series; index: number }, count: number, by: number): number {
    let index = at.index;
    for (let k = 0; k < count; k++) {
      const next = this.#step(at.series, index, by);
      if (next < 0) break;
      index = next;
    }
    return index === at.index ? -1 : index;
  }

  /** The point of `to` nearest the point `from` is on, along the first axis, so moving to another series keeps one's place in the domain. */
  #alongTo(from: { series: Series; index: number }, to: Series): number {
    const a = from.series.drawn,
      b = to.drawn;
    if (!a || !b) return this.#step(to, -1, 1);
    const at = from.index * a.stride + a.firstColumn;
    const axis = to.firstAxis,
      target = axis.fractionOf(a.raw[at]!);
    let best = this.#step(to, -1, 1),
      bestD = Infinity;
    for (let k = 0; k < b.points.count; k++) {
      if (!this.#real(to, k)) continue;
      const d = Math.abs(axis.fractionOf(b.raw[k * b.stride + b.firstColumn]!) - target);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  }

  /** The state for the input as it stands. */
  #compute(): CursorState | null {
    const a = this.attrs,
      shared = a.mode === 'shared';
    if (this.#by === 'keyboard') {
      const at = this.#at;
      if (!at || !this.#focused || !this.#valid(at)) return null;
      const hit = pointHit(at.series, at.index);
      if (!hit) return null;
      const plane = at.series.plane;
      const hits = shared ? this.#shared(plane, hit.px, hit.py, hit) : [hit];
      return { plane, x: hit.px, y: hit.py, source: 'keyboard', hits };
    }
    const p = this.#pointer;
    if (!p || p.plane.chart !== this.chart || p.buttons & 1 || !p.plane.covers(p.x, p.y)) return null;
    const { plane, x, y } = p;
    if (shared) return { plane, x, y, source: 'pointer', hits: this.#shared(plane, x, y, null) };
    const hit = hitPlane(plane, x, y);
    // Reading the line under the pointer; the nearest point was only what said it was near.
    const read =
      hit && a.interpolate === true
        ? (interpolate(hit.series, plane.unplace(x, y, hit.series.firstAxis, hit.series.secondAxis)[0]) ?? hit)
        : hit;
    return { plane, x, y, source: 'pointer', hits: read ? [read] : [] };
  }

  /** Every series at a place: the line read there, or the point nearest in the first axis. The keyboard's own point leads for a series it is on. */
  #shared(plane: Plane, x: number, y: number, own: Hit | null): Hit[] {
    const hits = this.attrs.interpolate === true ? interpolateAll(plane, x, y) : hitAcross(plane, x, y);
    if (own) {
      const i = hits.findIndex((h) => h.series === own.series);
      if (i >= 0) hits[i] = own;
    }
    return hits;
  }

  /** Redraw when something that shows changed. `force`: the keyboard moved, which always does. */
  #changed(force: boolean): void {
    this.#version++;
    const state = this.state;
    // oxlint-disable-next-line typescript/consistent-type-assertions -- a type guard in effect: probing a child for the optional `follows`
    const moves = [...this].some((c) => c.attrs.visible !== false && (c as Partial<CursorChild>).follows === true);
    const sig = !state
      ? ''
      : [
          state.source,
          state.hits.map((h) => `${h.series.attrs.name ?? ''}:${h.row ?? h.index}:${h.first}:${h.second}`).join('|'),
          moves || state.hits.length === 0 ? `@${state.x},${state.y}` : '',
        ].join('#');
    if (force || sig !== this.#signature) {
      this.#signature = sig;
      this.invalidate();
    }
  }

  /** The plot as a tab stop, in the chart's pixels, with the ring when keyboard focus is on it. */
  #paintFocus(): void {
    const s = this.surface,
      plane = this.plane,
      map = this.keyMap;
    if (!map || !plane) {
      s.remove('focus');
      s.remove('ring');
      this.#node = null;
      return;
    }
    const r = plane.rect,
      node = s.node('focus', 'rect');
    s.set(node, 'x', r.x);
    s.set(node, 'y', r.y);
    s.set(node, 'width', r.width);
    s.set(node, 'height', r.height);
    s.set(node, 'fill', 'none');
    s.set(node, 'pointer-events', 'none');
    makeTabStop(s, node);
    writeAria(s, node, this.attrs.meta ?? (plane.attrs.meta?.title !== undefined ? { title: plane.attrs.meta.title } : undefined), {
      role: 'application',
    });
    const shortcuts = [...new Set(Object.values(map).flat())].join(' ');
    if (shortcuts !== this.#lastKeys) {
      this.#lastKeys = shortcuts;
      s.set(node, 'aria-keyshortcuts', shortcuts);
    }
    inputOf(this.requireParent()).focusable(this, node);
    this.#node = node;
    drawFocusRing(
      s,
      'ring',
      this.styleFor(['focusRing', 'line']),
      this.#ring ? { x: r.x + 3, y: r.y + 3, width: Math.max(0, r.width - 6), height: Math.max(0, r.height - 6) } : null,
    );
  }
}

/**
 * The events an element can receive, and the hit a pointer query returns.
 *
 * Why events rather than methods: the tree is heterogeneous and open (anyone can subclass an element), so the base class
 * offers one `onEvent` and each subclass switches on what it cares about. Flow of one frame:
 *   ATTACH   once, when the element joins a chart: create wrappers, subscribe.
 *   MEASURE  parent → child, asking for a size range (the answer is written onto the event).
 *   ARRANGE  parent → child, giving it its final rectangle.
 *   PAINT    broadcast to everyone after layout: draw through the surface.
 *   POINTER  platform → chart → elements under the pointer (in their own coordinates); `handled` suppresses browser defaults.
 *   HOVER    chart → elements that asked (`Chart.watchPointer`), after each POINTER move, with the pointer's place in the
 *            plane it is over, or that it has left. For things outside the plane that follow the pointer (a tooltip);
 *            what is under it is theirs to ask (hit.ts), so the chart does no hit testing.
 *   KEY      platform → chart → the element that owns the focused node (see `Chart.focusable`). `handled` keeps the browser
 *            from also acting on the key (scrolling the page on an arrow, say).
 *   FOCUS    chart → the owner of a node that gained or lost focus, and whether a ring should show (keyboard focus does).
 */
import type { Axis } from './axis.ts';
import type { AnyElement } from './element.ts';
import type { LayoutRequest, Rect, Size } from './geometry.ts';
import type { Platform, PlatformNode } from './platform.ts';
import type { Plane } from './plane.ts';
import type { Series } from './series.ts';

/** Numeric (not string) types so dispatch is a cheap `switch` and the event union discriminates on `type`. */
export const EVENT_ATTACH = 1;
export const EVENT_MEASURE = 2;
export const EVENT_ARRANGE = 3;
export const EVENT_PAINT = 4;
export const EVENT_POINTER = 5;
export const EVENT_HOVER = 6;
export const EVENT_KEY = 7;
export const EVENT_FOCUS = 8;

/** What every event has. Concrete events are this plus the fields of their interface, copied on with Object.assign. */
export class EventBase<T extends number = number> {
  declare readonly type: T;
  readonly target: AnyElement;
  constructor(target: AnyElement) { this.target = target; }
}

export interface AttachEvent extends EventBase<typeof EVENT_ATTACH> { readonly platform: Platform }
export interface MeasureEvent extends EventBase<typeof EVENT_MEASURE> {
  readonly available: Size;
  /** The element writes its answer here. Defaults to "needs nothing". */
  request: LayoutRequest;
}
export interface ArrangeEvent extends EventBase<typeof EVENT_ARRANGE> { readonly rect: Rect }
/** An element draws through its own surface, so the event carries nothing. */
export interface PaintEvent extends EventBase<typeof EVENT_PAINT> {}
export interface ChartPointerEvent extends EventBase<typeof EVENT_POINTER> {
  readonly kind: 'move' | 'down' | 'up' | 'leave' | 'wheel' | 'pinch';
  /** Coordinates in the receiving element's own space (a plane receives plot-area pixels). */
  readonly x: number;
  readonly y: number;
  readonly buttons: number;
  readonly deltaY: number;
  /** Sideways wheel travel in pixels. */
  readonly deltaX: number;
  /** For `pinch`: the factor by which the fingers spread since the last event. 1 otherwise. */
  readonly scale: number;
  /** Which finger or device this is: 0 for a mouse. */
  readonly id: number;
  readonly pointerType: 'mouse' | 'touch' | 'pen';
  /** The axis the pointer is over, for a plane: set where it is on the strip an axis takes beside the plot. Null over the plot and everywhere else. */
  readonly axis: Axis | null;
  /** True when the pointer is beside the plot (over an axis) and not on it. Elements that work on what is plotted ignore such events. */
  readonly outside: boolean;
  readonly shift: boolean;
  readonly ctrl: boolean;
  /** An element sets this when it used the input, which keeps the browser from also acting on it. */
  handled: boolean;
}
export interface HoverEvent extends EventBase<typeof EVENT_HOVER> {
  /** The plane the pointer is over (or has just left, when `x` is NaN). */
  readonly plane: Plane;
  /** The pointer in the plane's plot pixels; NaN once it has left. */
  readonly x: number;
  readonly y: number;
  readonly buttons: number;
}

export interface ChartKeyEvent extends EventBase<typeof EVENT_KEY> {
  readonly kind: 'down' | 'up';
  /** The key as the browser names it (`KeyboardEvent.key`): 'ArrowLeft', 'Enter', ' ', '+'. */
  readonly key: string;
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  /** True for the repeats a held key sends after the first. */
  readonly repeat: boolean;
  /** The focused node, which an element with several focus targets tells apart. */
  readonly node: PlatformNode;
  handled: boolean;
}
export interface FocusEvent extends EventBase<typeof EVENT_FOCUS> {
  readonly node: PlatformNode;
  readonly focused: boolean;
  /** True when focus should be shown: it came by keyboard, not by a click. */
  readonly visible: boolean;
}

export type ChartEvent =
  | AttachEvent
  | MeasureEvent | ArrangeEvent | PaintEvent
  | ChartPointerEvent | HoverEvent | ChartKeyEvent | FocusEvent;

/** `Omit` applied to each member of a union, so the init of every event keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
// oxlint-disable-next-line typescript/no-generated-empty-object-type -- an event with no fields of its own has an init of `{}`, which is right
export type ChartEventInit = DistributiveOmit<ChartEvent, keyof EventBase>;

/** One allocation per event: the init fields are copied onto a fresh base, so subclasses add fields without classes. */
export function makeEvent(init: ChartEventInit, target: AnyElement): ChartEvent {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the event is built up from a base and an `init` of the event type's fields, which the event union cannot express generically
  return Object.assign(new EventBase(target), init) as unknown as ChartEvent;
}

// ─── Hits ───

/**
 * What a series reports when the pointer is near it. A hit is always one of the series' drawn points, whatever the
 * `hit` mode measured the distance against: for a line it is the end of the nearest segment that is nearer.
 */
export interface Hit {
  readonly series: Series;
  readonly plane: Plane;
  /** Index in the drawn points (the series' `points`). */
  readonly index: number;
  /**
   * The point's row in the source's own storage, which stays the same when edits re-sort the points: edit by this.
   * Absent when the drawn points are not the source's (a `Decimator` made them), so such a hit can be shown but not edited.
   */
  readonly row?: number;
  /** The point's two coordinates in data terms: what the series' first and second axis read. */
  readonly first: number;
  readonly second: number;
  /** Its bound channels' values, by name. */
  readonly channels: Readonly<Record<string, number>>;
  /** Where the point is drawn, in plot pixels. */
  readonly px: number;
  readonly py: number;
  /**
   * In a stack: how far the point is plotted from its own value (the layers below it), so a pointer's value less this
   * is the layer's own. Absent outside a stack, and where the stack scales the values (normalized), which an edit cannot undo.
   */
  readonly lift?: number;
  /** How far the pointer is, in pixels, by the series' `hit` mode (0 inside an area, and for an interpolated hit, which is on the line by construction). */
  readonly distance: number;
  /**
   * Set on a hit made by `Series.interpolate`: `first` and `second` are a place on the line, not a point of the data,
   * and `index` and `row` are those of the nearer of the two points it lies between.
   */
  readonly interpolated?: boolean;
}

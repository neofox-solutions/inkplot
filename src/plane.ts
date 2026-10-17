/**
 * Planes: a coordinate space that owns axes and series, lays them out and routes pointer input.
 *
 * How a plane, its axes and its series cooperate (the part that is hardest to see from any one file)
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * Sizes depend on ranges (wider tick labels need more margin) and ranges depend on sizes (decimation reads as many
 * points as there are pixels). The plane breaks the circle by working in passes, in `arrange`:
 *   1. Estimate the plot size (the available rectangle less a typical margin) and fit with it: `Plane.fit` has the
 *      series declare their domain, load their data, and contribute value extents, then settles every axis' range.
 *   2. With ranges known, the axes are measured (their tick labels give thickness) and the real plot rectangle is the
 *      available area less those, with `insets` overriding.
 *   3. With the real size known, the axes get their final `Ruler`s and each series is `project`ed: data → fractions
 *      through the axes → pixels through the plane's `place`.
 * The plane alone knows what the two axes *mean* spatially (`place`, and rulers), the axes alone know values ↔ fractions,
 * and the series alone know data. That separation is why a radar chart only needs a new plane and the same series.
 *
 * A `Ruler` is the one thing an axis draws against: a line in plot pixels that maps a fraction 0..1 to a position and
 * a normal. Straight edges, floating axes and radial spokes are all just different rulers, so Axis has no per-shape code.
 */
/* oxlint-disable typescript/no-non-null-assertion -- stride-addressed rows of the placed-point buffers: every index is bounded by the row count */
import { Axis, type AxisOrientation, type CartesianOrientation, type Ruler, type TitleSpot, cartesianSide, isHorizontal } from './axis.ts';
import type { Chart } from './chart.ts';
import type { PointBuffer } from './data.ts';
import { type BaseAttributes, ChartElement, childrenOfType, fail, resolveRef } from './element.ts';
import { writeAria } from './aria.ts';
import { type ChartEvent, EVENT_ARRANGE, EVENT_ATTACH, EVENT_PAINT } from './events.ts';
import type { CalloutAnnotation, LineAnnotation } from './annotation.ts';
import { type Insets, type Rect, type Side, type Size, f2 } from './geometry.ts';
import type { PointAnnotations } from './pointannotations.ts';
import type { BoxZoom } from './boxzoom.ts';
import type { Brush } from './brush.ts';
import type { PanZoom } from './panzoom.ts';
import type { PointerListener } from './pointer.ts';
import type { PlatformNode } from './platform.ts';
import { Series, groupOf, seriesOf } from './series.ts';
import type { SeriesGroup } from './seriesgroup.ts';
import type { Stack } from './stack.ts';
import type { LineProps } from './theme.ts';

export interface PlaneAttributes extends BaseAttributes {
  /** Fixed margins round the plot (room for axes). Any side left out is sized to fit its axes. */
  insets?: Partial<Insets>;
}
/** Open for augmentation: `declare module 'inkplot' { interface PlaneChildMap { mine: MyAnnotation } }`. */
export interface PlaneChildMap {
  axis: Axis;
  series: Series;
  stack: Stack;
  seriesGroup: SeriesGroup;
  lineAnnotation: LineAnnotation;
  calloutAnnotation: CalloutAnnotation;
  pointAnnotations: PointAnnotations;
  panZoom: PanZoom;
  boxZoom: BoxZoom;
  brush: Brush;
  pointerListener: PointerListener;
}
export type PlaneChildren = PlaneChildMap[keyof PlaneChildMap][];

/** What every plane does the same way: owns the axes and series among its children and runs the fit. */
export abstract class Plane<A extends PlaneAttributes = PlaneAttributes> extends ChartElement<Chart, PlaneChildren, A> {
  #rect: Rect = { x: 0, y: 0, width: 1, height: 1 };

  /** The allocated plot area, in the chart's coordinates. Valid after arrange. */
  get rect(): Readonly<Rect> {
    return this.#rect;
  }
  /** Subclasses record the plot area they settle on. */
  protected setRect(rect: Rect): void {
    this.#rect = rect;
  }

  get axes(): readonly Axis[] {
    return childrenOfType(this, Axis);
  }
  /** Every series on the plane, in drawing order, those inside a `Stack` included, whether shown or not: the order that gives each its palette colour. */
  get allSeries(): readonly Series[] {
    const out: Series[] = [];
    for (let c = this.firstChild; c; c = c.nextSibling) out.push(...seriesOf(c));
    return out;
  }
  /** The series that are on show (`visible` is not false): the ones that are drawn, fit the axes and are hit. */
  get series(): readonly Series[] {
    return this.allSeries.filter((s) => s.shown);
  }

  /**
   * The axis a series uses when it does not name one, for the axis its first or its second coordinate rides on. What
   * those are is up to the plane: a Cartesian plane's horizontal and vertical axes, a radial plane's angle and radius.
   */
  abstract defaultAxis(role: 'first' | 'second'): Axis | undefined;
  /**
   * Whether a line that is straight in the plane's own terms (constant value, say) comes out curved. False for a
   * rectangle, true for anything with an angle. Annotations use it to decide how many points to trace a line with.
   */
  abstract get curved(): boolean;
  /**
   * Fractions of `axis` at which a line running along it changes direction, ascending, for planes that are not smooth
   * (a radar's spokes). A line traced through these is exact where sampling evenly would cut the corners. Default none.
   */
  breaks(_axis: Axis): readonly number[] {
    return [];
  }
  /**
   * About how long `axis` will be drawn, in pixels, given the room estimated for the plot, so that a series' reach in
   * pixels can be turned into room in the axis' range. 0 where that has no meaning (the default, and any axis round a circle).
   */
  protected axisLength(_axis: Axis, _estimate: Size): number {
    return 0;
  }
  /** CSS reference to this plane's clip region, for children to clip themselves with. `null` when not clipped. */
  abstract get clipUrl(): string | null;
  /**
   * The first two columns of `points`, normalized (0..1) through `first` and `second`, to plot-area pixels, in place.
   * The plane decides what the two axes mean spatially: a Cartesian plane looks at their sides.
   */
  /**
   * `fit` for planes that share a range with others (a group's `SharedAxis`): their axes begin, contribute and resolve in step, each
   * stage waiting for every plane. `available` is the room the plane's chart was given.
   */
  abstract fitSteps(available: Rect): Generator<void>;
  abstract place(points: PointBuffer, first: Axis, second: Axis): void;
  /**
   * The inverse of `place` for one position: what a spot in plot pixels is in data terms, as the values `first` and
   * `second` read there. It is what turns a dragged pointer into an edit. A position outside the plot gives values
   * outside the axes' ranges; an angle that wraps comes back inside the range.
   */
  abstract unplace(x: number, y: number, first: Axis, second: Axis): readonly [first: number, second: number];

  /** Put every axis of the plane back to the range its data asks for, undoing pan, zoom and box zoom. */
  resetViews(): void {
    for (const axis of this.axes) axis.setViewRange(null);
  }

  /** Whether `axis` comes back round to where it started, so that its two ends are the same place (the angle of a full turn). Default no. */
  cyclic(_axis: Axis): boolean {
    return false;
  }
  /**
   * The axis whose strip beside the plot a position (in plot pixels) is on, or null: the strip is where its line, ticks and labels
   * are. This is what lets a wheel turn or a drag over an axis act on that axis alone. Default: none, so only the plot itself takes input.
   */
  axisAt(_x: number, _y: number): Axis | null {
    return null;
  }
  /** Whether a position in plot pixels is on the plot: inside the rectangle, and for a circular plot inside the circle. Default: inside the rectangle. */
  covers(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x <= this.#rect.width && y <= this.#rect.height;
  }
  /**
   * The line along which the first (or second) coordinate has the data value `value`, across the whole plot, as path data in
   * plot pixels: a vertical line for a horizontal first axis, a spoke for an angle, a circle for a radius. It is what a
   * crosshair draws, and is as the plane draws its own gridlines. Empty when the plane has no such axis.
   */
  guide(role: 'first' | 'second', value: number): string {
    const a = this.defaultAxis('first'),
      b = this.defaultAxis('second');
    if (!a || !b) return '';
    const f = (role === 'first' ? a : b).fractionOf(value);
    if (!Number.isFinite(f)) return '';
    const ends = new Float64Array(role === 'first' ? [f, 0, f, 1] : [0, f, 1, f]);
    this.place({ data: ends, stride: 2, count: 2 }, a, b);
    return `M${f2(ends[0]!)} ${f2(ends[1]!)}L${f2(ends[2]!)} ${f2(ends[3]!)}`;
  }

  /**
   * Give every axis an orientation and a stack slot: its own `orientation` attribute if it has one, else the next of
   * `defaults` in child order. `check` rejects an orientation this kind of plane does not have. The slot counts how
   * many axes share an orientation, so they can be stacked outwards.
   */
  protected assignAxes<O extends AxisOrientation>(defaults: readonly O[], check: (o: AxisOrientation) => O): void {
    const used = new Map<O, number>();
    let next = 0;
    for (const a of this.axes) {
      const o = check(a.attrs.orientation ?? defaults[next++] ?? fail('too many axes without an orientation'));
      const slot = used.get(o) ?? 0;
      used.set(o, slot + 1);
      a.assign(o, slot);
    }
  }

  /** Put a resolved line look on a node of this plane (gridlines, frame). */
  protected strokeWith(node: PlatformNode, look: LineProps): void {
    const s = this.surface;
    s.set(node, 'stroke', look.color);
    s.set(node, 'stroke-width', look.width);
    s.set(node, 'stroke-dasharray', look.dash);
    s.set(node, 'opacity', look.opacity);
  }

  /**
   * The first half of every layout: start the axes, let the series name theirs, agree the domain before any data is
   * read, then fill every series (which gives the value extents) and settle every range. `estimate` is how much room the
   * plot is expected to have, which sizes decimation; the real plot is only known once the axes have been measured.
   */
  protected fit(estimate: Size): void {
    const steps = this.fitStages(estimate);
    while (!steps.next().done);
  }

  /**
   * `fit` as stages, with a `yield` between them where planes that share an axis have to wait for each other: every plane
   * has begun its axes before any contributes, every plane has contributed its domain before any resolves it, and every plane
   * has loaded before any axis is settled. A plane alone runs them one after the other, which is `fit`.
   */
  protected *fitStages(estimate: Size): Generator<void> {
    const axes = this.axes,
      series = this.series;
    for (const a of axes) a.begin(this.axisLength(a, estimate));
    yield;
    for (const s of series) s.resolveAxes(this);
    for (const s of series) s.contributeDomain();
    yield;
    for (const s of series) s.resolveDomain();
    // A group (a stack) loads its own members, since what they contribute depends on all of them.
    for (let c = this.firstChild; c; c = c.nextSibling) {
      if (c instanceof Series) {
        if (c.shown) c.load(estimate);
      } else groupOf(c)?.load(estimate);
    }
    yield;
    for (const a of axes) a.resolve();
  }
}

export interface CartesianPlaneAttributes extends PlaneAttributes {
  /** Lines at the first horizontal and first vertical axis' ticks. Default true. */
  gridlines?: boolean;
  /** Draw a border round the plot area, above the series. */
  frame?: boolean;
  /** Clip series to the plot area. Default true. */
  clip?: boolean;
}

// Module-level so ids stay unique across charts sharing a page (clip ids live in the document's one namespace).
let clipCounter = 0;
/** A fresh id for a plane's clip region, unique within the page. */
export const nextClipId = () => `clip${++clipCounter}`;
/** Where axes go when they do not say, in the order they are added: the familiar x-below, y-left, then the mirrors. */
const DEFAULT_SIDES: CartesianOrientation[] = ['bottom', 'left', 'top', 'right'];
/** The same for a chart that reads right to left: the mirror image. */
const RTL_SIDES: CartesianOrientation[] = ['bottom', 'right', 'top', 'left'];
/** The least room left round a plot, whatever the axes need. */
export const MIN_INSET = 8;

/** A point `offset` pixels outside the middle of an edge of a plot `w` by `h`: where a title there starts. */
function edgeSpot(side: CartesianOrientation, w: number, h: number, offset: number): TitleSpot {
  switch (side) {
    case 'bottom':
      return { x: w / 2, y: h + offset, nx: 0, ny: 1, beyond: false };
    case 'top':
      return { x: w / 2, y: -offset, nx: 0, ny: -1, beyond: false };
    case 'left':
      return { x: -offset, y: h / 2, nx: -1, ny: 0, beyond: false };
    case 'right':
      return { x: w + offset, y: h / 2, nx: 1, ny: 0, beyond: false };
  }
}

/**
 * The ruler for an axis on `side` of a plot `w` by `h`, with its line `pos` pixels across: down for a horizontal axis,
 * right for a vertical one. `title` says where its title goes, given the middle of the line.
 */
function rulerAt(
  side: CartesianOrientation,
  w: number,
  h: number,
  pos: number,
  title: (position: Side | undefined, mid: readonly [x: number, y: number, nx: number, ny: number]) => TitleSpot,
): Ruler {
  const horizontal = isHorizontal(side),
    sign = side === 'top' || side === 'left' ? -1 : 1;
  if (horizontal) {
    const at = (f: number): [number, number, number, number] => [f * w, pos, 0, sign];
    return {
      length: w,
      tickSpacing: 70,
      horizontal,
      line: `M0 ${f2(pos)}H${f2(w)}`,
      at,
      fractionAt: (px) => px / w,
      title: (p) => title(p, at(0.5)),
    };
  }
  const at = (f: number): [number, number, number, number] => [pos, (1 - f) * h, sign, 0];
  return {
    length: h,
    tickSpacing: 36,
    horizontal,
    line: `M${f2(pos)} 0V${f2(h)}`,
    at,
    fractionAt: (_px, py) => 1 - py / h,
    title: (p) => title(p, at(0.5)),
  };
}

/** x/y plane: horizontal and vertical axes on its edges (or floating across it), clipped, with gridlines at the first axes' ticks. */
export class CartesianPlane extends Plane<CartesianPlaneAttributes> {
  private readonly clipId = nextClipId();

  get clipUrl(): string | null {
    return this.attrs.clip === false ? null : `url(#${this.clipId})`;
  }
  get curved(): boolean {
    return false;
  }
  protected override axisLength(axis: Axis, estimate: Size): number {
    return isHorizontal(axis.orientation) ? estimate.width : estimate.height;
  }

  /** The first coordinate is on the horizontal axis, the second on the vertical one. */
  defaultAxis(role: 'first' | 'second'): Axis | undefined {
    return this.axes.find((a) => (role === 'first') === isHorizontal(a.orientation));
  }

  /**
   * Fractions to pixels. The 'first' coordinate goes on whichever axis is horizontal, so a series' first/second
   * columns need no knowledge of orientation (swapping axis sides transposes the plot).
   */
  place(points: PointBuffer, first: Axis, second: Axis): void {
    if (isHorizontal(first.orientation) === isHorizontal(second.orientation)) {
      fail('a series needs one horizontal and one vertical axis');
    }
    const { data, count, stride } = points;
    const w = this.rect.width,
      h = this.rect.height;
    switch (first.orientation) {
      case 'bottom':
      case 'top':
        for (let k = 0, i = 0; k < count; k++, i += stride) {
          data[i] = data[i]! * w;
          data[i + 1] = (1 - data[i + 1]!) * h;
        }
        break;
      case 'left':
      case 'right':
        for (let k = 0, i = 0; k < count; k++, i += stride) {
          const d = data[i]!;
          data[i] = data[i + 1]! * w;
          data[i + 1] = (1 - d) * h;
        }
        break;
      case 'angle':
      case 'radius':
        cartesianSide(first.orientation);
    }
  }

  unplace(x: number, y: number, first: Axis, second: Axis): readonly [number, number] {
    const across = x / this.rect.width,
      up = 1 - y / this.rect.height;
    return isHorizontal(first.orientation)
      ? [first.denormalize(across), second.denormalize(up)]
      : [first.denormalize(up), second.denormalize(across)];
  }

  override axisAt(x: number, y: number): Axis | null {
    const w = this.rect.width,
      h = this.rect.height;
    for (const a of this.axes) {
      if (!this.reserves(a) || a.thickness <= 0) continue;
      const at = a.ruler.at(0),
        horizontal = isHorizontal(a.orientation);
      const pos = horizontal ? at[1] : at[0],
        sign = horizontal ? at[3] : at[2],
        far = pos + sign * a.thickness;
      const lo = Math.min(pos, far),
        hi = Math.max(pos, far);
      if (horizontal ? x >= 0 && x <= w && y >= lo && y <= hi : y >= 0 && y <= h && x >= lo && x <= hi) return a;
    }
    return null;
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper(); // carries the plot offset
        break;
      case EVENT_ARRANGE:
        this.arrange(ev.rect);
        break;
      case EVENT_PAINT:
        this.paint();
        break;
    }
  }

  /**
   * Where a floating axis crosses, as a fraction of the plot across the crossing axis (0 at the left or bottom, 1 at
   * the right or top), or null for an axis fixed to a side. A position out of range is held at the nearest edge.
   */
  private crossing(axis: Axis): number | null {
    const at = axis.attrs.crossesAt;
    if (at === undefined) return null;
    const horizontal = isHorizontal(axis.orientation);
    const cross =
      resolveRef<Axis>(axis.attrs.crossAxis, axis, Axis) ??
      this.axes.find((a) => isHorizontal(a.orientation) !== horizontal) ??
      fail('a floating axis needs an axis on the other orientation to cross');
    return Math.min(1, Math.max(0, cross.fractionOf(at)));
  }

  /** Whether an axis takes room round the plot: one fixed to a side does, and so does one held at the edge it faces. */
  private reserves(axis: Axis): boolean {
    const across = this.crossing(axis);
    if (across === null) return true;
    switch (cartesianSide(axis.orientation)) {
      case 'bottom':
      case 'left':
        return across <= 1e-9;
      case 'top':
      case 'right':
        return across >= 1 - 1e-9;
    }
  }

  /**
   * Every axis gets its place in a plot `w` by `h`: a fixed side, stacked outwards by the axes before it, or across the
   * plot. Titles that are not on an axis line go outside everything else at their edge, one after another.
   */
  private setRulers(w: number, h: number): void {
    const stacked: Record<CartesianOrientation, number> = { top: 0, right: 0, bottom: 0, left: 0 };
    const titleAt = new Map<Axis, number>();
    for (const a of this.axes) {
      const o = cartesianSide(a.orientation),
        across = this.crossing(a),
        reserves = this.reserves(a);
      // A title belongs on the axis line when the axis is fixed there and the title is asked for on its own side.
      const spot = (position: Side | undefined, mid: readonly [number, number, number, number]): TitleSpot =>
        reserves && (position ?? o) === o
          ? { x: mid[0], y: mid[1], nx: mid[2], ny: mid[3], beyond: true }
          : edgeSpot(position ?? o, w, h, titleAt.get(a) ?? 0);
      if (across !== null && !reserves) {
        a.setRuler(rulerAt(o, w, h, isHorizontal(o) ? (1 - across) * h : across * w, spot));
        continue;
      }
      const edge = o === 'bottom' ? h : o === 'right' ? w : 0,
        sign = o === 'top' || o === 'left' ? -1 : 1;
      a.setRuler(rulerAt(o, w, h, edge + sign * stacked[o], spot));
      stacked[o] += a.thickness;
    }
    for (const a of this.axes) {
      if (a.titleThickness === 0) continue;
      titleAt.set(a, stacked[a.titleSide]);
      stacked[a.titleSide] += a.titleThickness;
    }
  }

  /** Engine protocol for a chart group: least room to leave on each side, so that plots in a row or column line up. */
  alignInsets: Partial<Insets> | null = null;
  #fitted = -1;
  /** 80 and 40: roughly a y-axis's labels and an x-axis's labels. Only a guess for decimation; the real plot is set later. */
  private estimateFor(available: Rect): Size {
    return { width: Math.max(1, available.width - 80), height: Math.max(1, available.height - 40) };
  }
  *fitSteps(available: Rect): Generator<void> {
    this.assignAxes(this.chart?.rtl ? RTL_SIDES : DEFAULT_SIDES, cartesianSide);
    const estimate = this.estimateFor(available);
    this.setRulers(estimate.width, estimate.height);
    yield* this.fitStages(estimate);
    this.#fitted = this.chart?.flushCount ?? 0;
  }

  /** Negotiates ranges, lays out the axes, projects every series. */
  measureInsets(available: Rect): Insets {
    const axes = this.axes;
    this.assignAxes(this.chart?.rtl ? RTL_SIDES : DEFAULT_SIDES, cartesianSide);
    const estimate = this.estimateFor(available);
    this.setRulers(estimate.width, estimate.height);
    if (this.#fitted !== (this.chart?.flushCount ?? 0)) this.fit(estimate);
    this.setRulers(estimate.width, estimate.height); // ranges are settled now, which is what tells a floating axis from a fixed one

    // Axes ask for space; what is left is the plot. Overhang is a horizontal axis' end labels poking past the plot sides.
    // (The fixed-side thickness is summed per side, so stacked axes add up.)
    const side: Record<CartesianOrientation, number> = { top: 0, right: 0, bottom: 0, left: 0 };
    let overhang = 0;
    for (const a of axes) {
      this.measureChild(a, estimate);
      if (this.reserves(a)) side[cartesianSide(a.orientation)] += a.thickness;
      side[a.titleSide] += a.titleThickness;
      if (isHorizontal(a.orientation)) overhang = Math.max(overhang, a.labelOverhang);
    }
    const o = this.attrs.insets ?? {};
    const insets: Insets = {
      top: o.top ?? Math.max(MIN_INSET, side.top),
      bottom: o.bottom ?? Math.max(MIN_INSET, side.bottom),
      left: o.left ?? Math.max(MIN_INSET, side.left, Math.ceil(overhang)),
      right: o.right ?? Math.max(MIN_INSET, side.right, Math.ceil(overhang)),
    };
    return insets;
  }

  private arrange(available: Rect): void {
    const insets = this.measureInsets(available),
      o = this.attrs.insets ?? {},
      align = this.alignInsets;
    // A chart group may ask for more room on a side, to line the plot up with its neighbours'; a side fixed by `insets` stays.
    for (const k of ['top', 'right', 'bottom', 'left'] as const)
      if (o[k] === undefined && (align?.[k] ?? 0) > insets[k]) insets[k] = align?.[k] ?? 0;
    this.setRect({
      x: available.x + insets.left,
      y: available.y + insets.top,
      width: Math.max(1, available.width - insets.left - insets.right),
      height: Math.max(1, available.height - insets.top - insets.bottom),
    });

    // Now the plot is known, the axes can be placed along it, and the series projected.
    this.setRulers(this.rect.width, this.rect.height);
    for (const s of this.series) s.project(this);
  }

  /** Clip region, gridlines (from the first horizontal and vertical axis) and frame. */
  private paint(): void {
    const s = this.surface,
      r = this.rect,
      a = this.attrs;
    s.set(s.wrapper(), 'transform', `translate(${f2(r.x)} ${f2(r.y)})`);
    writeAria(s, s.wrapper(), a.meta, { role: 'group' });

    if (a.clip !== false) {
      const clip = s.node('clip', 'clipPath', { parent: s.node('defs', 'defs') });
      s.set(clip, 'id', this.clipId);
      const rect = s.node('clip-rect', 'rect', { parent: clip });
      s.set(rect, 'width', f2(r.width));
      s.set(rect, 'height', f2(r.height));
    }

    if (a.gridlines !== false) {
      let d = '';
      const horizontalAxis = this.axes.find((x) => isHorizontal(x.orientation));
      const verticalAxis = this.axes.find((x) => !isHorizontal(x.orientation));
      if (horizontalAxis) {
        for (const t of horizontalAxis.getTicks(r.width)) {
          const f = horizontalAxis.fractionOf(t.value);
          if (f >= -1e-9 && f <= 1 + 1e-9) d += `M${f2(f * r.width)} 0V${f2(r.height)}`;
        }
      }
      if (verticalAxis) {
        for (const t of verticalAxis.getTicks(r.height)) {
          const f = verticalAxis.fractionOf(t.value);
          if (f >= -1e-9 && f <= 1 + 1e-9) d += `M0 ${f2((1 - f) * r.height)}H${f2(r.width)}`;
        }
      }
      const grid = s.node('grid', 'path');
      s.set(grid, 'd', d);
      s.set(grid, 'fill', 'none');
      this.strokeWith(grid, this.styleFor(['gridline', 'line']));
    } else {
      s.remove('grid');
    }
    if (a.frame) {
      const f = s.node('frame', 'rect', { above: true });
      s.set(f, 'width', f2(r.width));
      s.set(f, 'height', f2(r.height));
      s.set(f, 'fill', 'none');
      this.strokeWith(f, this.styleFor(['frame', 'line']));
    } else {
      s.remove('frame');
    }
  }
}

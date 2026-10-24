/**
 * Radial planes: the domain goes round a circle (the angle axis), the value out from the middle (the radius axis).
 *
 * A radial plane is three decisions. Where a point goes (`locate`), what a line of constant value looks like (`ring`),
 * and what to do once the circle is settled (`prepare`). Everything else, from layout to axes to gridlines to the
 * clip, is shared, and series and renderers know nothing of it. `PolarPlane` is the continuous one: rings are arcs.
 * `RadarPlane` has a spoke at every tick of the angle axis and joins them with chords, rings and data alike.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, NUMBER } from './attrs.ts';
import { Axis, type PolarOrientation, type Ruler, type TitleSpot, polarSide } from './axis.ts';
import type { PointBuffer } from './data.ts';
import { writeAria } from './aria.ts';
import { fail } from './element.ts';
import { type ChartEvent, EVENT_ARRANGE, EVENT_ATTACH, EVENT_PAINT } from './events.ts';
import { type Insets, type Rect, type Size, f2 } from './geometry.ts';
import { walkAligned } from './aligned.ts';
import { sampleAt, sampleSpan } from './sampling.ts';
import { MIN_INSET, Plane, type PlaneAttributes, nextClipId } from './plane.ts';

export interface RadialPlaneAttributes extends PlaneAttributes {
  /** Radians clockwise from twelve o'clock. Default 0. */
  startAngle?: number;
  /** Radians swept by the angle axis, clockwise; negative runs the other way. Default 2π. */
  sweep?: number;
  /** Fraction of the radius left empty in the middle. Default 0. */
  innerRadius?: number;
  /** Rings at the radius axis' ticks and spokes at the angle axis'. Default true. */
  gridlines?: boolean;
  /** Clip series to the plot's outline. Default true. */
  clip?: boolean;
}

const SIDES: PolarOrientation[] = ['angle', 'radius'];
const TAU = 2 * Math.PI;

/** The `A` commands that carry a pen at the start of an arc of a circle round it, in pieces of at most half a turn so that any sweep is drawn the right way round. */
function arcRun(cx: number, cy: number, r: number, start: number, sweep: number): string {
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI - 1e-9)),
    step = sweep / pieces;
  let d = '';
  for (let k = 1; k <= pieces; k++) {
    const a = start + k * step;
    d += `A${f2(r)} ${f2(r)} 0 0 ${sweep > 0 ? 1 : 0} ${f2(cx + r * Math.sin(a))} ${f2(cy - r * Math.cos(a))}`;
  }
  return d;
}
/** An arc of a circle as path data. */
function arc(cx: number, cy: number, r: number, start: number, sweep: number): string {
  return `M${f2(cx + r * Math.sin(start))} ${f2(cy - r * Math.cos(start))}` + arcRun(cx, cy, r, start, sweep);
}

/** About how many pixels long a piece is that a spiral is cut into. */
const CHORD = 6;

/**
 * The shared machinery of radial planes: layout in a circle, rulers for both axes, clip, gridlines, and `place`.
 * Subclasses supply only the geometry (`locate`, `ring`, `outerRadius`, `prepare`).
 */
export abstract class RadialPlane<A extends RadialPlaneAttributes = RadialPlaneAttributes> extends Plane<A> {
  static override attrTypes = { ...Plane.attrTypes, innerRadius: NUMBER, startAngle: NUMBER } satisfies AttrTypesFor<RadialPlaneAttributes>;
  private readonly clipId = nextClipId();
  #cx = 0;
  #cy = 0;
  #radius = 1;
  readonly #xy = new Float64Array(2);
  readonly #rulers = new Map<Axis, Ruler>();

  get clipUrl(): string | null {
    return this.attrs.clip === false ? null : `url(#${this.clipId})`;
  }
  get rectilinear(): boolean {
    return false;
  }
  get startAngle(): number {
    return this.attrs.startAngle ?? 0;
  }
  get sweep(): number {
    return this.attrs.sweep ?? TAU;
  }
  get innerRadius(): number {
    return this.attrs.innerRadius ?? 0;
  }
  /** The outer radius in plot pixels. Valid after arrange. */
  get radius(): number {
    return this.#radius;
  }
  protected get cx(): number {
    return this.#cx;
  }
  protected get cy(): number {
    return this.#cy;
  }

  /** The line of constant value at pixel radius `r`, from the start of the sweep to its end (or back), as path data starting with M. */
  protected abstract ring(r: number, reverse?: boolean): string;
  /** Where a fraction of the way along the angle axis is, at pixel radius `r`. Writes x then y into `out`. */
  protected abstract locate(fraction: number, r: number, out: Float64Array): void;
  /** Distance from the middle to the outer edge of the plot in the direction (dx, dy): where the ray from the middle meets the rim. */
  protected abstract outerRadius(dx: number, dy: number): number;
  /** How far round the angle axis the direction (dx, dy) from the middle is, as a fraction of its sweep (wrapped into 0..1 for a full turn). */
  protected abstract angleFraction(dx: number, dy: number): number;
  /** Called when the circle is settled, before any series is projected. */
  protected prepare(): void {}
  /** The path data that carries the pen from where `from` is on the angle axis to where `to` is, round the circle of pixel radius `r`. */
  protected abstract angleRun(from: number, to: number, r: number): string;

  /** Moves along the angle are arcs (or chords through the spokes, on a radar), along the radius lines, and a diagonal a chord. */
  override alignedPath(coords: ArrayLike<number>, count: number, first: Axis, second: Axis, closed = false): string {
    const angleIsFirst = first.orientation === 'angle';
    if ((first.orientation !== 'angle' && first.orientation !== 'radius') || (second.orientation === 'angle') === angleIsFirst) fail(175);
    const R = this.#radius,
      inner = this.innerRadius,
      xy = this.#xy;
    const radiusOf = (v: number) => R * (inner + (1 - inner) * Math.max(0, v));
    const point = (a: number, b: number): string => {
      this.locate(angleIsFirst ? a : b, radiusOf(angleIsFirst ? b : a), xy);
      return `${f2(xy[0]!)} ${f2(xy[1]!)}`;
    };
    let d = '';
    walkAligned(coords, count, closed, {
      begin: (a, b) => (d += 'M' + point(a, b)),
      to: (pa, pb, a, b, along) => {
        if (along === 2 || (along === 0) !== angleIsFirst) d += 'L' + point(a, b);
        else d += this.angleRun(angleIsFirst ? pa : pb, angleIsFirst ? a : b, radiusOf(angleIsFirst ? b : a));
      },
      finish: (shut) => (d += shut ? 'Z' : ''),
    });
    return d;
  }

  /**
   * Where along a straight move in the plane's own terms (fractions of the angle and of the radius, from (a0, r0) to (a1, r1)) it is cut into pieces
   * to follow the plane: fractions of the move, ascending, the last 1.
   */
  protected abstract diagonalCuts(a0: number, r0: number, a1: number, r1: number): readonly number[];

  /**
   * Every move is exact: a radius move is a line (a spoke), an angle move the arc (or chords through the spokes) its `alignedPath` draws, and a move
   * that changes both is cut into pieces by `diagonalCuts`: short chords on a polar plane, which is as close as straight pieces can be to a spiral;
   * on a radar a vertex wherever the move crosses a spoke.
   */
  override exactPath(coords: ArrayLike<number>, count: number, first: Axis, second: Axis, closed = false): string {
    const angleIsFirst = first.orientation === 'angle';
    if ((first.orientation !== 'angle' && first.orientation !== 'radius') || (second.orientation === 'angle') === angleIsFirst) fail(175);
    const R = this.#radius,
      inner = this.innerRadius,
      xy = this.#xy;
    const radiusOf = (v: number) => R * (inner + (1 - inner) * Math.max(0, v));
    const point = (a: number, r: number): string => {
      this.locate(a, radiusOf(r), xy);
      return `${f2(xy[0]!)} ${f2(xy[1]!)}`;
    };
    let d = '';
    let pa = NaN,
      pr = NaN,
      sa = NaN,
      sr = NaN,
      run = 0;
    const move = (a: number, r: number) => {
      if (a === pa && r === pr) return;
      if (a === pa) d += 'L' + point(a, r);
      else if (r === pr) d += this.angleRun(pa, a, radiusOf(r));
      else
        for (const t of this.diagonalCuts(pa, pr, a, r)) d += 'L' + point(t === 1 ? a : pa + t * (a - pa), t === 1 ? r : pr + t * (r - pr));
      pa = a;
      pr = r;
    };
    for (let i = 0; i <= count; i++) {
      const u = i < count ? coords[2 * i]! : NaN,
        v = i < count ? coords[2 * i + 1]! : NaN;
      if (Number.isFinite(u) && Number.isFinite(v)) {
        const a = angleIsFirst ? u : v,
          r = angleIsFirst ? v : u;
        if (run === 0) {
          d += 'M' + point(a, r);
          pa = sa = a;
          pr = sr = r;
        } else move(a, r);
        run++;
      } else {
        if (run > 0 && closed) {
          move(sa, sr);
          d += 'Z';
        }
        run = 0;
      }
    }
    return d;
  }

  override cyclic(axis: Axis): boolean {
    return axis.orientation === 'angle' && Math.abs(this.sweep) >= TAU - 1e-9;
  }

  /** On the plot when inside the rim in that direction, outside the hole, and (for a part of a turn) within the sweep. */
  override covers(x: number, y: number): boolean {
    const dx = x - this.#cx,
      dy = y - this.#cy,
      len = Math.hypot(dx, dy);
    if (len > this.outerRadius(dx, dy) + 1e-9 || len < this.#radius * this.innerRadius - 1e-9) return false;
    const first = this.defaultAxis('first');
    if (len === 0 || !first || this.cyclic(first)) return true;
    const f = this.angleFraction(dx, dy);
    return f >= 0 && f <= 1;
  }

  /** A radius is a ring (round, or a polygon on a radar); an angle is a spoke, which the plane's own way of placing gives. */
  override guide(role: 'first' | 'second', value: number): string {
    const axis = this.defaultAxis(role);
    if (axis?.orientation !== 'radius') return super.guide(role, value);
    const f = axis.fractionOf(value);
    return Number.isFinite(f) ? this.ring(this.#radius * (this.innerRadius + (1 - this.innerRadius) * Math.max(0, f))) : '';
  }

  /** The first coordinate is the angle, the second the radius. */
  defaultAxis(role: 'first' | 'second'): Axis | undefined {
    return this.axes.find((a) => a.orientation === (role === 'first' ? 'angle' : 'radius'));
  }

  /** Pixels along an axis: what its ticks have to fit into. */
  protected lengthOf(axis: Axis): number {
    return this.#rulers.get(axis)?.length ?? 1;
  }
  /** The fractions 0..1 of an axis' ticks that fall inside its range. */
  protected tickFractions(axis: Axis | undefined): number[] {
    const out: number[] = [];
    if (!axis) return out;
    for (const t of axis.getTicks(this.lengthOf(axis))) {
      const f = axis.fractionOf(t.value);
      if (f >= -1e-9 && f <= 1 + 1e-9) out.push(f);
    }
    return out;
  }

  fractionsAt(x: number, y: number, first: Axis): readonly [number, number] {
    const dx = x - this.#cx,
      dy = y - this.#cy,
      inner = this.innerRadius;
    const around = this.angleFraction(dx, dy);
    const out = (Math.hypot(dx, dy) / this.outerRadius(dx, dy) - inner) / (1 - inner);
    return first.orientation === 'angle' ? [around, out] : [out, around];
  }

  place(points: PointBuffer, first: Axis, second: Axis): void {
    const angleIsDomain = first.orientation === 'angle';
    if ((first.orientation !== 'angle' && first.orientation !== 'radius') || (second.orientation === 'angle') === angleIsDomain) {
      fail(175);
    }
    const { data, count, stride } = points;
    const R = this.#radius,
      inner = this.innerRadius,
      xy = this.#xy;
    const a0 = angleIsDomain ? 0 : 1,
      r0 = 1 - a0;
    for (let k = 0, i = 0; k < count; k++, i += stride) {
      // Below the middle would come out on the far side. Above the edge is left for the clip.
      this.locate(data[i + a0]!, R * (inner + (1 - inner) * Math.max(0, data[i + r0]!)), xy);
      data[i] = xy[0]!;
      data[i + 1] = xy[1]!;
    }
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper();
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
   * Every axis gets the curve it runs along: the rim for the angle, a spoke at the start angle for the radius. The line
   * is worked out when it is drawn, since a radar's depends on ticks that are only settled by then.
   */
  private setRulers(): void {
    const start = this.startAngle,
      sweep = this.sweep,
      R = this.#radius,
      r0 = R * this.innerRadius,
      xy = this.#xy;
    const ring = (r: number) => this.ring(r);
    const at0 = (r: number): string => {
      this.locate(0, r, xy);
      return `${f2(xy[0]!)} ${f2(xy[1]!)}`;
    };
    const angleAt = (f: number): [number, number, number, number] => {
      this.locate(f, R, xy);
      const a = start + f * sweep;
      return [xy[0]!, xy[1]!, Math.sin(a), -Math.cos(a)];
    };
    const radiusAt = (f: number): [number, number, number, number] => {
      this.locate(0, r0 + f * (R - r0), xy);
      return [xy[0]!, xy[1]!, -Math.cos(start), -Math.sin(start)];
    };
    // A radial axis' title is always on its own line, past its labels: there is no edge of a circle to put it at.
    const spot = (mid: readonly [number, number, number, number]): TitleSpot => ({
      x: mid[0],
      y: mid[1],
      nx: mid[2],
      ny: mid[3],
      beyond: true,
    });
    for (const axis of this.axes) {
      const ruler: Ruler =
        axis.orientation === 'angle'
          ? {
              length: Math.max(1, Math.abs(sweep) * R),
              tickSpacing: 70,
              horizontal: false,
              get line() {
                return ring(R);
              },
              at: angleAt,
              title: () => spot(angleAt(0.5)),
            }
          : {
              length: Math.max(1, R - r0),
              tickSpacing: 36,
              horizontal: false,
              get line() {
                return `M${at0(r0)}L${at0(R)}`;
              },
              at: radiusAt,
              title: () => spot(radiusAt(0.5)),
              // However far round the pointer is, it is as far along the radius as it is out from the middle, measured
              // against the edge in its own direction (a radar's edge is nearer between spokes).
              fractionAt: (x, y) => {
                const dx = x - this.#cx,
                  dy = y - this.#cy,
                  inner = this.innerRadius;
                return (Math.hypot(dx, dy) / this.outerRadius(dx, dy) - inner) / (1 - inner);
              },
            };
      this.#rulers.set(axis, ruler);
      axis.setRuler(ruler);
    }
  }

  /**
   * Same three passes as a Cartesian plane (estimate → fit → measure → final size → project), except that the plot is
   * the largest circle in what is left, and the only margin that matters is what the angle axis' labels need around it.
   */
  /** A first guess at the circle, which sizes the fills and the tick counts; the labels then say how much room they take. */
  private guess(available: Rect): Size {
    this.assignAxes(SIDES, polarSide);
    this.#radius = Math.max(1, Math.min(available.width, available.height) / 2 - 24);
    this.#cx = this.#cy = 0;
    this.setRulers();
    return { width: Math.max(1, Math.abs(this.sweep) * this.#radius), height: this.#radius };
  }

  #fitted = -1;
  *fitSteps(available: Rect): Generator<void> {
    yield* this.fitStages(this.guess(available));
    this.#fitted = this.chart?.flushCount ?? 0;
  }

  private arrange(available: Rect): void {
    const axes = this.axes,
      series = this.series;
    const estimate = this.guess(available);
    if (this.#fitted !== (this.chart?.flushCount ?? 0)) this.fit(estimate);
    let margin = 0;
    for (const a of axes) {
      this.measureChild(a, estimate);
      if (a.orientation === 'angle') margin = Math.max(margin, a.thickness, Math.ceil(a.labelOverhang));
    }
    const o: Partial<Insets> = this.attrs.insets ?? {};
    const insets: Insets = {
      top: o.top ?? Math.max(MIN_INSET, margin),
      bottom: o.bottom ?? Math.max(MIN_INSET, margin),
      left: o.left ?? Math.max(MIN_INSET, margin),
      right: o.right ?? Math.max(MIN_INSET, margin),
    };
    const rect: Rect = {
      x: available.x + insets.left,
      y: available.y + insets.top,
      width: Math.max(1, available.width - insets.left - insets.right),
      height: Math.max(1, available.height - insets.top - insets.bottom),
    };
    this.setRect(rect);
    this.#cx = rect.width / 2;
    this.#cy = rect.height / 2;
    this.#radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    this.setRulers();
    this.prepare();

    for (const s of series) s.project(this);
  }

  /** What the plot covers: the whole outline for a full turn (less the hole), a sector for part of one. */
  private region(): string {
    const R = this.#radius,
      r0 = R * this.innerRadius;
    if (Math.abs(this.sweep) >= TAU - 1e-9) return this.ring(R) + 'Z' + (r0 > 0 ? this.ring(r0) + 'Z' : '');
    return this.ring(R) + 'L' + this.ring(r0, true).slice(1) + 'Z';
  }

  /** Clip region, then spokes at the angle axis' ticks and rings at the radius axis' ticks. */
  private paint(): void {
    const s = this.surface,
      r = this.rect,
      a = this.attrs;
    const R = this.#radius,
      inner = this.innerRadius,
      xy = this.#xy;
    s.set(s.wrapper(), 'transform', `translate(${f2(r.x)} ${f2(r.y)})`);
    writeAria(s, s.wrapper(), a.meta, { role: 'group' });

    if (a.clip !== false) {
      const clip = s.node('clip', 'clipPath', { parent: s.node('defs', 'defs') });
      s.set(clip, 'id', this.clipId);
      const shape = s.node('clip-shape', 'path', { parent: clip });
      s.set(shape, 'd', this.region());
      s.set(shape, 'clip-rule', 'evenodd');
    }

    if (a.gridlines !== false) {
      let d = '';
      const angle = this.axes.find((x) => x.orientation === 'angle'),
        radius = this.axes.find((x) => x.orientation === 'radius');
      for (const f of this.tickFractions(angle)) {
        this.locate(f, R * inner, xy);
        d += `M${f2(xy[0]!)} ${f2(xy[1]!)}`;
        this.locate(f, R, xy);
        d += `L${f2(xy[0]!)} ${f2(xy[1]!)}`;
      }
      for (const f of this.tickFractions(radius)) d += this.ring(R * (inner + (1 - inner) * f));
      const grid = s.node('grid', 'path');
      s.set(grid, 'd', d);
      s.set(grid, 'fill', 'none');
      this.strokeWith(grid, this.styleFor(['gridline', 'line']));
    } else {
      s.remove('grid');
    }
  }
}

/** No options of its own beyond the shared radial ones. */
export interface PolarPlaneAttributes extends RadialPlaneAttributes {}

/** A continuous plane: the angle is an angle, so lines of constant value are circles. */
export class PolarPlane extends RadialPlane<PolarPlaneAttributes> {
  protected locate(fraction: number, r: number, out: Float64Array): void {
    const a = this.startAngle + fraction * this.sweep;
    out[0] = this.cx + r * Math.sin(a);
    out[1] = this.cy - r * Math.cos(a);
  }
  protected outerRadius(): number {
    return this.radius;
  }
  protected angleFraction(dx: number, dy: number): number {
    const f = (Math.atan2(dx, -dy) - this.startAngle) / this.sweep;
    return Math.abs(this.sweep) >= TAU - 1e-9 ? f - Math.floor(f) : f;
  }
  protected angleRun(from: number, to: number, r: number): string {
    return arcRun(this.cx, this.cy, r, this.startAngle + from * this.sweep, (to - from) * this.sweep);
  }
  /** Chords about `CHORD` pixels long along the way, which is as close to the spiral as a few pixels' error allows. */
  protected diagonalCuts(a0: number, r0: number, a1: number, r1: number): readonly number[] {
    const R = this.radius,
      mid = R * (this.innerRadius + (1 - this.innerRadius) * Math.max(0, (r0 + r1) / 2));
    const pixels = Math.hypot(Math.abs(a1 - a0) * Math.abs(this.sweep) * mid, Math.abs(r1 - r0) * R * (1 - this.innerRadius));
    const span = sampleSpan({ min: 0, max: 1 }, { min: 0, max: 1 }, pixels, undefined, 1 / CHORD);
    return Array.from({ length: span.n - 1 }, (_, i) => sampleAt(span, i + 1));
  }
  protected ring(r: number, reverse = false): string {
    return reverse
      ? arc(this.cx, this.cy, r, this.startAngle + this.sweep, -this.sweep)
      : arc(this.cx, this.cy, r, this.startAngle, this.sweep);
  }
}

/** No options of its own beyond the shared radial ones. */
export interface RadarPlaneAttributes extends RadialPlaneAttributes {}

/**
 * A plane with a spoke at every tick of the angle axis, the ends of the sweep too, and straight lines between them.
 * Between two spokes a point is on the chord between where its radius is on each, so a ring is a polygon, a line
 * through dense data follows the same chords, and an `AreaPath` fills a polygon without being told it is one.
 *
 * Give the angle axis a fixed `min` and `max` and a `tickCount` that puts a tick on each category (and `nice` off,
 * or on only for integers); auto-ranging works, but the spokes move as the data does. A full turn ends where it began,
 * so a closed shape needs the first point repeated at the end of the domain.
 */
export class RadarPlane extends RadialPlane<RadarPlaneAttributes> {
  /** Fractions of the angle axis that have a spoke, ascending, and the direction of each. */
  #at: number[] = [0, 1];
  #sin: number[] = [0, 0];
  #cos: number[] = [1, 1];

  protected override prepare(): void {
    const set = new Set<number>([0, 1]);
    for (const f of this.tickFractions(this.axes.find((a) => a.orientation === 'angle'))) set.add(Math.round(f * 1e9) / 1e9);
    this.#at = [...set].sort((p, q) => p - q);
    this.#sin = this.#at.map((f) => Math.sin(this.startAngle + f * this.sweep));
    this.#cos = this.#at.map((f) => Math.cos(this.startAngle + f * this.sweep));
  }

  protected locate(fraction: number, r: number, out: Float64Array): void {
    const at = this.#at;
    let k = 0;
    while (k < at.length - 2 && fraction > at[k + 1]!) k++;
    const t = (fraction - at[k]!) / (at[k + 1]! - at[k]!);
    const x0 = r * this.#sin[k]!,
      y0 = -r * this.#cos[k]!;
    out[0] = this.cx + x0 + t * (r * this.#sin[k + 1]! - x0);
    out[1] = this.cy + y0 + t * (-r * this.#cos[k + 1]! - y0);
  }

  /** The wedge between two spokes that the direction (dx, dy) points into: the spoke before it, and how far round the sweep it is. */
  private wedge(dx: number, dy: number): { k: number; f: number } {
    const at = this.#at;
    let f = (Math.atan2(dx, -dy) - this.startAngle) / this.sweep;
    f = Math.abs(this.sweep) >= TAU - 1e-9 ? f - Math.floor(f) : Math.min(1, Math.max(0, f));
    let k = 0;
    while (k < at.length - 2 && f > at[k + 1]!) k++;
    return { k, f };
  }

  protected outerRadius(dx: number, dy: number): number {
    // The chord of the wedge the pointer is in: a ray meets it where the chord's distance from the middle, over the
    // cosine of the angle to the chord's normal, says.
    const { k } = this.wedge(dx, dy);
    const nx = this.#sin[k]! + this.#sin[k + 1]!,
      ny = -(this.#cos[k]! + this.#cos[k + 1]!),
      norm = Math.hypot(nx, ny);
    const chord = (this.#sin[k]! * nx - this.#cos[k]! * ny) / norm,
      along = (dx * nx + dy * ny) / norm / Math.hypot(dx, dy);
    const t = (chord / along) * this.radius;
    return t > 0 && Number.isFinite(t) ? t : this.radius;
  }

  /** Where along the chord the pointer's ray crosses it, mapped to the fractions of the two spokes (not linear in the angle). */
  protected angleFraction(dx: number, dy: number): number {
    const at = this.#at,
      { k, f } = this.wedge(dx, dy),
      R = this.radius;
    const len = Math.hypot(dx, dy);
    if (len === 0) return f;
    const reach = this.outerRadius(dx, dy),
      px = (dx / len) * reach,
      py = (dy / len) * reach;
    const ax = R * this.#sin[k]!,
      ay = -R * this.#cos[k]!,
      sx = R * this.#sin[k + 1]! - ax,
      sy = -R * this.#cos[k + 1]! - ay;
    const t = ((px - ax) * sx + (py - ay) * sy) / (sx * sx + sy * sy);
    return at[k]! + Math.min(1, Math.max(0, t)) * (at[k + 1]! - at[k]!);
  }

  /** A vertex at each spoke the move crosses: between two spokes a move is a chord. */
  protected diagonalCuts(a0: number, _r0: number, a1: number): readonly number[] {
    const out: number[] = [];
    const lo = Math.min(a0, a1),
      hi = Math.max(a0, a1);
    for (const s of this.#at) if (s > lo && s < hi) out.push((s - a0) / (a1 - a0));
    out.sort((p, q) => p - q);
    out.push(1);
    return out;
  }

  /** A chord to each spoke the move passes, then to where it ends. */
  protected angleRun(from: number, to: number, r: number): string {
    const xy = new Float64Array(2);
    let d = '';
    const line = (f: number) => {
      this.locate(f, r, xy);
      d += `L${f2(xy[0]!)} ${f2(xy[1]!)}`;
    };
    const at = this.#at;
    if (to > from) {
      for (const s of at) if (s > from && s < to) line(s);
    } else {
      for (let j = at.length - 1; j >= 0; j--) if (at[j]! < from && at[j]! > to) line(at[j]!);
    }
    line(to);
    return d;
  }

  protected ring(r: number, reverse = false): string {
    let d = '';
    for (let j = 0; j < this.#at.length; j++) {
      const k = reverse ? this.#at.length - 1 - j : j;
      d += (j === 0 ? 'M' : 'L') + f2(this.cx + r * this.#sin[k]!) + ' ' + f2(this.cy - r * this.#cos[k]!);
    }
    return d;
  }
}

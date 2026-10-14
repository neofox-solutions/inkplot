/**
 * Axes: a dimension drawn along one side of a plane.
 *
 * An axis does two jobs. As a `Dimension` it owns a scale and a range, and answers value ↔ fraction. As a drawing it
 * paints a line, ticks, labels and a title along a `Ruler` that its plane supplies, so the same code serves the side of
 * a rectangle, a floating cross-line, a rim and a spoke. The plane tells it where (`assign`, `setRuler`); the axis tells
 * the plane how much room it needs (the MEASURE event → `thickness`, `titleThickness`, `labelOverhang`).
 */
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import { Dimension, type DimensionAttributes } from './dimension.ts';
import { type ElementRef, fail } from './element.ts';
import { hideFromAssistive, writeAria } from './aria.ts';
import { type ChartEvent, EVENT_ATTACH, EVENT_MEASURE, EVENT_PAINT, type MeasureEvent } from './events.ts';
import { type Side, f2 } from './geometry.ts';
import type { Plane } from './plane.ts';
import { type FontSpec, estimateTextWidth } from './platform.ts';
import { applyText } from './text.ts';
import type { TextProps } from './theme.ts';

export type CartesianOrientation = 'top' | 'bottom' | 'left' | 'right';
export type PolarOrientation = 'angle' | 'radius';
export type AxisOrientation = CartesianOrientation | PolarOrientation;
/** Horizontal axes run left-right, so their labels sit above or below; vertical ones put them beside. */
export const isHorizontal = (o: AxisOrientation) => o === 'top' || o === 'bottom';
/** Narrows to the sides a Cartesian plane can draw. Polar sides belong to a PolarPlane. */
export function cartesianSide(o: AxisOrientation): CartesianOrientation {
  return o === 'angle' || o === 'radius' ? fail(`an axis on the "${o}" side needs a PolarPlane`) : o;
}

/** Narrows to the sides a PolarPlane can draw. */
export function polarSide(o: AxisOrientation): PolarOrientation {
  return o === 'angle' || o === 'radius' ? o : fail(`an axis on the "${o}" side needs a CartesianPlane`);
}

/**
 * The curve an axis is drawn along, and what that means for its ticks and labels. Whatever the shape of the plot (a
 * rectangle's side, a rim, a spoke) the plane builds one for each axis, so an axis knows nothing about the plane.
 */
export interface Ruler {
  /** Pixels along it: what the ticks have to fit into. */
  readonly length: number;
  /** About how many pixels each tick needs, labels included. */
  readonly tickSpacing: number;
  /** True when its labels sit above or below it, so only their height counts across it; false when their width does. */
  readonly horizontal: boolean;
  /** The curve as path data. Read when drawn, so it may depend on what the plane settles last. */
  readonly line: string;
  /** The point a fraction 0..1 along it, and the unit vector pointing away from the plot there: x, y, nx, ny. */
  at(fraction: number): readonly [x: number, y: number, nx: number, ny: number];
  /**
   * How far along it a position in the plot is, as a fraction 0..1 (outside that range for positions beyond its ends),
   * so that dragging and zooming can follow the pointer along it. Absent for a curve that cannot be dragged along.
   */
  fractionAt?(x: number, y: number): number;
  /**
   * Where the title goes for an axis whose title asks to be on `position` (default: the axis' own side). Titles sit on
   * the axis line, past its labels, where an axis is fixed to the side it is on; otherwise at the middle of the edge
   * of the plot, past whatever the plane has put there.
   */
  title(position: Side | undefined): TitleSpot;
}

/**
 * A place for a title: a point, the unit vector pointing away from the plot there, and whether the title belongs past
 * the axis' own ticks and labels (the point is on the axis line) or the point is already where the title starts.
 */
export interface TitleSpot {
  x: number;
  y: number;
  nx: number;
  ny: number;
  beyond: boolean;
}

/** What an axis has before its plane has placed it. */
const UNPLACED: Ruler = {
  length: 1,
  tickSpacing: 70,
  horizontal: true,
  line: '',
  at: () => [0, 0, 0, 1],
  title: () => ({ x: 0, y: 0, nx: 0, ny: 1, beyond: true }),
};

export interface AxisAttributes extends DimensionAttributes {
  /**
   * The side of the plot the axis sits on. Default: 'bottom' for the first axis in a plane, then 'left',
   * 'top', 'right'. Axes sharing a side stack outwards from the plot in child order.
   */
  orientation?: AxisOrientation;
  /**
   * The edge of the plot the title sits at: past the axis' labels for an axis fixed to that side, otherwise at the middle of
   * the edge, outside any axes there, which then take the room it needs. Default: the axis' own side. Cartesian planes only.
   */
  titlePosition?: Side;
  /**
   * Whether the title runs along the horizontal or the vertical. Default: horizontal at the top and bottom, vertical at the
   * left and right. Cartesian planes only.
   */
  titleDirection?: 'horizontal' | 'vertical';
  /**
   * Float across the plot at this value of the crossing axis (the other one, or `crossAxis`), instead of sitting on a
   * side. Where that is outside the range, the axis stays at the nearest edge. A floating axis takes no room from the
   * plot, except where it sits at the edge on its own side, which is just where a fixed axis would be. Its labels
   * overlay the plot, so a halo on the labels (`style: { tickLabel: { halo: '#fff' } }`) is worth setting. Its title, unless told otherwise, is at the edge of
   * the plot on the axis' side. Cartesian planes only.
   */
  crossesAt?: number;
  /** The axis `crossesAt` is a value of. Default: the plane's first axis on the other orientation. */
  crossAxis?: ElementRef<Axis>;
}

/** A spatial dimension, drawn along a ruler its plane gives it. Needs one scale child: `new Axis({}, new LinearScale())`. */
export class Axis extends Dimension<Plane, AxisAttributes> {
  static override attrTypes = {
    ...Dimension.attrTypes,
    titlePosition: STRING,
    titleDirection: STRING,
    crossesAt: NUMBER,
    crossAxis: STRING,
  } satisfies AttrTypesFor<AxisAttributes>;

  #orientation: AxisOrientation = 'bottom';
  #slot = 0;
  #thickness = 0;
  #titleThickness = 0;
  #titleAcross = 0;
  #ruler: Ruler = UNPLACED;
  #labelCount = 0;
  #labelWidth = 0;

  get orientation(): AxisOrientation {
    return this.#orientation;
  }
  /** The curve it is drawn along. Valid after arrange. */
  get ruler(): Ruler {
    return this.#ruler;
  }
  /** Position in the stack for its side, 0 being the one nearest the plot. */
  get slot(): number {
    return this.#slot;
  }
  /** Space it needs perpendicular to the plot edge. Valid after it has been measured. */
  get thickness(): number {
    return this.#thickness;
  }
  /** Room a title needs at the edge of the plot, when it is not part of the axis' own thickness. Valid after it has been measured. */
  get titleThickness(): number {
    return this.#titleThickness;
  }
  /** The edge of the plot the title is at. */
  get titleSide(): Side {
    return this.attrs.titlePosition ?? cartesianSide(this.#orientation);
  }
  /** Half the width of the widest label: how far the first or last label may stick out past the plot. */
  get labelOverhang(): number {
    return this.#labelWidth / 2;
  }

  // ─── Engine protocol: the plane says where the axis goes. ───

  /** Which side, and which place in that side's stack. */
  assign(orientation: AxisOrientation, slot: number): void {
    this.#orientation = orientation;
    this.#slot = slot;
    this.mirrored = (this.chart?.rtl ?? false) && isHorizontal(orientation);
  }
  /** The curve to draw along. The plane sets it before measuring, and again once the plot is settled. */
  setRuler(ruler: Ruler): void {
    this.#ruler = ruler;
  }

  protected override tickCountFor(length: number): number {
    return Math.max(2, Math.min(12, Math.floor(length / this.#ruler.tickSpacing)));
  }

  /**
   * Everything the axis draws with, settled in one place so measuring and painting always agree on sizes. The axis' own
   * colour (`style: { axis: { color } }`) reaches its labels, line and ticks alike because all three chains pass through `axis`.
   */
  private look() {
    return {
      metrics: this.styleFor(['axis']),
      labels: this.styleFor(['tickLabel', 'axis', 'text']),
      title: this.styleFor(['axisTitle', 'axis', 'text']),
      line: this.styleFor(['axisLine', 'axis', 'line']),
    };
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper(); // the text style below is inherited by every label
        break;
      case EVENT_MEASURE:
        this.measure(ev);
        break;
      case EVENT_PAINT:
        this.paint();
        break;
    }
  }

  /**
   * Works out `thickness` (room across the plot edge for ticks, labels and a title on the axis line) and
   * `titleThickness` (room for a title that sits at the plot's edge instead), and answers the MEASURE request.
   */
  private measure(ev: MeasureEvent): void {
    const s = this.look(),
      ruler = this.#ruler;
    const chart = this.chart;
    // 'inherit' means whatever the SVG gives; measuring needs a concrete family, so a generic one stands in.
    const font = (r: TextProps): FontSpec => ({ family: r.family === 'inherit' ? 'sans-serif' : r.family, size: r.size, weight: r.weight });
    const measureText = chart ? chart.measureText : estimateTextWidth;
    let widest = 0;
    for (const t of this.getTicks(ruler.length)) widest = Math.max(widest, measureText(t.label, font(s.labels)).width);
    // The plot area is whatever the labels leave, so labels changing width would move the plot under your hand while you
    // zoom. Widths grow at once but only shrink once there is a clear gain (a margin of about a digit and a half).
    if (widest > this.#labelWidth || widest < this.#labelWidth - s.labels.size * 1.5) this.#labelWidth = widest;

    // The title takes room across the edge it is at: its height, or its length when it runs along the way it is stacked.
    const title = this.attrs.title,
      spot = ruler.title(this.attrs.titlePosition);
    let across = 0;
    if (title) {
      across = this.titleRotated(spot) ? measureText(title, font(s.title)).width : s.title.size * 1.2;
      this.#titleAcross = across;
    }
    this.#thickness =
      s.metrics.tickLength +
      s.metrics.labelGap +
      this.labelsAcross(s.labels.size) +
      (title && spot.beyond ? s.metrics.spacing + across : 0) +
      s.metrics.spacing;
    this.#titleThickness = title && !spot.beyond ? across + s.metrics.spacing : 0;
    ev.request = ruler.horizontal
      ? { min: { width: 0, height: this.#thickness }, max: { width: Infinity, height: this.#thickness } }
      : { min: { width: this.#thickness, height: 0 }, max: { width: this.#thickness, height: Infinity } };
  }

  /** Which way the title text runs: as asked, else along the edge it is at. */
  private titleVertical(spot: TitleSpot): boolean {
    const asked = this.attrs.titleDirection;
    return asked ? asked === 'vertical' : Math.abs(spot.nx) > Math.abs(spot.ny);
  }
  /** True when the text runs across the edge it is at, so its length is what takes room there. */
  private titleRotated(spot: TitleSpot): boolean {
    return this.titleVertical(spot) === Math.abs(spot.ny) >= Math.abs(spot.nx);
  }

  /** How much room the labels take in the direction away from the plot. */
  private labelsAcross(fontSize: number): number {
    return this.#ruler.horizontal ? fontSize * 1.15 : this.#labelWidth;
  }

  /** The line, a mark and a label at each tick, each facing away from the plot, then the title. */
  private paint(): void {
    const s = this.look(),
      surface = this.surface,
      ruler = this.#ruler,
      fs = s.labels.size;
    let d = ruler.line;
    const labels: { text: string; x: number; y: number; nx: number }[] = [];
    for (const t of this.getTicks(ruler.length)) {
      const f = this.fractionOf(t.value);
      if (!(f >= -1e-9 && f <= 1 + 1e-9)) continue;
      const [x, y, nx, ny] = ruler.at(f);
      d += `M${f2(x)} ${f2(y)}l${f2(nx * s.metrics.tickLength)} ${f2(ny * s.metrics.tickLength)}`;
      const out = s.metrics.tickLength + s.metrics.labelGap;
      labels.push({ text: t.label, x: x + nx * out, y: y + ny * out + fs * (0.35 + 0.6 * ny), nx });
    }

    applyText(surface, surface.wrapper(), s.labels);
    // The numbers on an axis are read to no use one by one; a screen reader gets the summary, or the axis' own `meta`.
    if (this.attrs.meta) writeAria(surface, surface.wrapper(), this.attrs.meta, { role: 'group' });
    else hideFromAssistive(surface, surface.wrapper());
    const line = surface.node('axis', 'path');
    surface.set(line, 'd', d);
    surface.set(line, 'fill', 'none');
    surface.set(line, 'stroke', s.line.color);
    surface.set(line, 'stroke-width', s.line.width);
    surface.set(line, 'stroke-dasharray', s.line.dash);
    surface.set(line, 'opacity', s.line.opacity);

    labels.forEach((l, i) => {
      const n = surface.node(`label-${i}`, 'text');
      surface.set(n, 'x', f2(l.x));
      surface.set(n, 'y', f2(l.y));
      surface.set(n, 'text-anchor', l.nx > 0.3 ? 'start' : l.nx < -0.3 ? 'end' : 'middle');
      surface.text(n, l.text);
    });
    for (let i = labels.length; i < this.#labelCount; i++) surface.remove(`label-${i}`);
    this.#labelCount = labels.length;

    // The title is centred in the room it has: past the labels beside the axis line, or past whatever else is at the edge.
    const title = this.attrs.title;
    if (!title) {
      surface.remove('title');
      return;
    }
    const spot = ruler.title(this.attrs.titlePosition);
    const distance =
      (spot.beyond ? s.metrics.tickLength + s.metrics.labelGap + this.labelsAcross(fs) + s.metrics.spacing : s.metrics.spacing / 2) +
      this.#titleAcross / 2;
    const cx = spot.x + spot.nx * distance,
      cy = spot.y + spot.ny * distance;
    const n = surface.node('title', 'text');
    applyText(surface, n, s.title, 'middle');
    surface.set(n, 'x', 0);
    surface.set(n, 'y', f2(s.title.size * 0.35));
    // Text that runs up the page reads from the bottom; on the right of the plot it is turned the other way, as is usual.
    const turn = this.titleVertical(spot) ? (spot.nx > 0 ? 90 : -90) : 0;
    surface.set(n, 'transform', `translate(${f2(cx)} ${f2(cy)})${turn ? ` rotate(${turn})` : ''}`);
    surface.text(n, title);
  }
}

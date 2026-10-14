/**
 * Keys: what a mapped dimension means, drawn beside the plots.
 *
 * A key is an element of its own, a child of the chart that refers to the dimension it shows:
 *
 *   new Chart({}, plane, heat, new ColorKey({ dimension: heat, title: 'Pressure' }))
 *
 * The dimension says what the colours are (ramp, scale, range); the key says where and how to draw them (side,
 * orientation, length). Different keys can show one dimension, and a dimension needs none.
 */
import { type AttrTypesFor, STRING } from './attrs.ts';
import type { Chart } from './chart.ts';
import { type BaseAttributes, ChartElement, type ElementRef, resolveRef } from './element.ts';
import { type ChartEvent, EVENT_ARRANGE, EVENT_ATTACH, EVENT_MEASURE, EVENT_PAINT } from './events.ts';
import { type Rect, type Side, circlePath, f2 } from './geometry.ts';
import type { ColorAxis, MappedDimension, SizeAxis } from './mapped.ts';
import type { PlatformNode } from './platform.ts';
import { applyText } from './text.ts';

export type KeyOrientation = 'vertical' | 'horizontal';

/** Options common to all keys. */
export interface KeyAttributes<Dimension extends MappedDimension<unknown>> extends BaseAttributes {
  /** The dimension this key shows, or its id. A colour key takes a colour dimension, a size key a size one. */
  dimension: ElementRef<Dimension>;
  /** The edge of the chart it sits along. Default 'right'. */
  side?: Side;
  /** Which way its scale runs. Default: along its side, so vertical on the left and right, horizontal on the top and bottom. */
  orientation?: KeyOrientation;
  /** Default: the dimension's own title. */
  title?: string;
  /** Length of the scale in pixels. Default 140. */
  length?: number;
  /** Width of a vertical key: the scale and its labels. Default 72. */
  breadth?: number;
}

/** Where things go in a key; passed to the drawing methods so they do not each recompute it. Everything is measured from the key's own top left corner. */
interface Layout {
  vertical: boolean;
  /** Pixels taken by the title. */
  top: number;
  length: number;
  /** Room at the ends of the scale for what is drawn there, such as the biggest circle of a size key. */
  inset: number;
  /** Where a horizontal scale starts, leaving room for the first label to overhang. */
  left: number;
}

// Fixed metrics in pixels: keys are small furniture, so these are constants rather than options.
const TITLE_BLOCK = 18;
const LABEL_OVERHANG = 14;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A tick of a key: its label, how far along the dimension it is, and where that is on the scale. */
interface Tick {
  text: string;
  fraction: number;
  at: number;
}

/**
 * The shared frame of a key: reserves a strip along a chart edge, draws the title, and offers the scale-drawing helpers
 * (`along`, `ticks`, `paintTicks`) that subclasses use. A subclass says only what its scale looks like.
 *
 * Layout: the chart asks the key how big it wants to be (MEASURE answers with `side`), carves a strip for it, and then
 * arranges it into that strip. The key is a *chart* child rather than a plane's so one key can sit beside several planes.
 */
export abstract class Key<
  Dimension extends MappedDimension<unknown>,
  A extends KeyAttributes<Dimension> = KeyAttributes<Dimension>,
> extends ChartElement<Chart, [], A> {
  static override attrTypes = { ...ChartElement.attrTypes, title: STRING } satisfies Partial<
    AttrTypesFor<KeyAttributes<MappedDimension<unknown>>>
  >;
  /** Room the scale needs past its ends. */
  protected get inset(): number {
    return 0;
  }
  /** How thick the drawing is, across the scale: a colour bar, the biggest circle. */
  protected abstract get thickness(): number;
  /** How many ticks suit a scale this long, or undefined to leave it to the dimension. */
  protected ticksFor(_length: number, _vertical: boolean): number | undefined {
    return undefined;
  }
  /** Draw the scale, its ticks and labels. */
  protected abstract paintScale(layout: Layout): void;

  #rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  #labels = 0;

  get dimension(): Dimension {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- `resolveRef` returns an element; the attribute type says it is a dimension
    return resolveRef(this.attrs.dimension, this) as Dimension;
  }
  get side(): Side {
    return this.attrs.side ?? (this.chart?.rtl ? 'left' : 'right');
  }
  get vertical(): boolean {
    return (this.attrs.orientation ?? (this.side === 'left' || this.side === 'right' ? 'vertical' : 'horizontal')) === 'vertical';
  }
  private get title(): string | undefined {
    return this.attrs.title ?? this.dimension.attrs.title;
  }
  protected get length(): number {
    return this.attrs.length ?? 140;
  }
  /** The size of the labels, which the layout is built on. */
  protected get fontSize(): number {
    return this.styleFor(['keyLabel', 'key', 'text']).size;
  }
  /** Put the key's line look (ticks, circles) on a node. */
  protected strokeLine(node: PlatformNode): void {
    const look = this.styleFor(['keyLine', 'key', 'line']),
      s = this.surface;
    s.set(node, 'stroke', look.color);
    s.set(node, 'stroke-width', look.width);
    s.set(node, 'opacity', look.opacity);
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper();
        break;
      case EVENT_MEASURE: {
        const title = this.title ? TITLE_BLOCK : 0,
          length = this.length,
          inset = this.inset;
        const size = this.vertical
          ? { width: this.attrs.breadth ?? 72, height: title + 2 * inset + length + 12 }
          : { width: LABEL_OVERHANG + 2 * inset + length + LABEL_OVERHANG, height: title + this.thickness + 4 + this.fontSize * 1.4 };
        ev.request = { min: size, max: size, side: this.side };
        break;
      }
      case EVENT_ARRANGE:
        this.#rect = ev.rect;
        break;
      case EVENT_PAINT: {
        const s = this.surface,
          root = s.wrapper(),
          vertical = this.vertical,
          title = this.title;
        s.set(root, 'transform', `translate(${f2(this.#rect.x)} ${f2(this.#rect.y)})`);
        applyText(s, root, this.styleFor(['keyLabel', 'key', 'text']), vertical ? 'start' : 'middle');
        if (title) {
          const t = s.node('title', 'text');
          applyText(s, t, this.styleFor(['keyTitle', 'key', 'text']), 'start');
          s.set(t, 'y', this.fontSize);
          s.text(t, title);
        } else {
          s.remove('title');
        }
        this.paintScale({ vertical, top: title ? TITLE_BLOCK : 0, length: this.length, inset: this.inset, left: LABEL_OVERHANG });
        break;
      }
    }
  }

  /** Position along the scale, in key pixels, of a fraction 0..1 of the dimension. Low is at the bottom or the left. */
  protected along(l: Layout, fraction: number): number {
    return l.vertical ? l.top + l.inset + (1 - fraction) * l.length : l.left + l.inset + fraction * l.length;
  }

  /** The dimension's ticks, each with its fraction of the dimension and its place along the scale. Ticks outside the range are left out. */
  protected ticks(l: Layout): Tick[] {
    const dim = this.dimension,
      out: Tick[] = [];
    for (const t of dim.getTicks(l.length, this.ticksFor(l.length, l.vertical))) {
      const fraction = dim.fractionOf(t.value);
      if (fraction >= -1e-9 && fraction <= 1 + 1e-9) out.push({ text: t.label, fraction, at: round2(this.along(l, fraction)) });
    }
    return out;
  }

  /**
   * Labels, and optionally a mark for each tick. `markAt` is the line across the scale the marks start from, and
   * `labelAt` is where the labels go on it: their left edge on a vertical scale, their baseline on a horizontal one.
   */
  protected paintTicks(l: Layout, ticks: readonly Tick[], markAt: number, labelAt: number, marks: boolean): void {
    const s = this.surface;
    if (marks) {
      let d = '';
      for (const t of ticks) d += l.vertical ? `M${markAt} ${t.at}h3` : `M${t.at} ${markAt}v3`;
      const node = s.node('ticks', 'path');
      s.set(node, 'd', d);
      this.strokeLine(node);
      s.set(node, 'fill', 'none');
    }
    ticks.forEach((t, i) => {
      const n = s.node(`label-${i}`, 'text');
      s.set(n, 'x', l.vertical ? labelAt : t.at);
      s.set(n, 'y', l.vertical ? round2(t.at + this.fontSize * 0.35) : labelAt);
      s.text(n, t.text);
    });
    for (let i = ticks.length; i < this.#labels; i++) s.remove(`label-${i}`);
    this.#labels = ticks.length;
  }
}

// ─── Colour ───

export interface ColorKeyAttributes extends KeyAttributes<ColorAxis> {
  /** Thickness of the colour bar in pixels. Default 14. */
  thickness?: number;
}

// Module-level so gradient ids stay unique across keys and charts on one page.
let gradientCounter = 0;

/** A bar of the dimension's colours, low to high, with its ticks. */
export class ColorKey extends Key<ColorAxis, ColorKeyAttributes> {
  static override attrTypes = { ...Key.attrTypes, dimension: STRING } satisfies AttrTypesFor<ColorKeyAttributes>;
  private readonly gradientId = `grad${++gradientCounter}`;
  #stops = 0;

  protected get thickness(): number {
    return this.attrs.thickness ?? 14;
  }

  protected paintScale(l: Layout): void {
    const s = this.surface,
      dim = this.dimension,
      thickness = this.thickness;

    // One rect filled by a gradient. A stepped dimension gets hard stops, so the bands stay bands.
    const grad = s.node('gradient', 'linearGradient', { parent: s.node('defs', 'defs') });
    s.set(grad, 'id', this.gradientId);
    s.set(grad, 'x1', 0);
    s.set(grad, 'y1', l.vertical ? 1 : 0);
    s.set(grad, 'x2', l.vertical ? 0 : 1);
    s.set(grad, 'y2', 0);
    const stops: [number, string][] = [];
    if (dim.attrs.interpolation === 'step') {
      const n = dim.stops.length;
      for (let i = 0; i < n; i++) {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
        const c = dim.stops[i]!;
        stops.push([i / n, c], [(i + 1) / n, c]);
      }
    } else {
      const n = Math.max(2, Math.min(24, dim.stops.length * 2));
      for (let i = 0; i < n; i++) stops.push([i / (n - 1), dim.valueAt(i / (n - 1))]);
    }
    stops.forEach(([offset, color], i) => {
      const n = s.node(`stop-${i}`, 'stop', { parent: grad });
      s.set(n, 'offset', Math.round(offset * 1000) / 1000);
      s.set(n, 'stop-color', color);
    });
    for (let i = stops.length; i < this.#stops; i++) s.remove(`stop-${i}`);
    this.#stops = stops.length;

    const bar = s.node('bar', 'rect');
    s.set(bar, 'x', l.vertical ? 0 : l.left);
    s.set(bar, 'y', l.top);
    s.set(bar, 'width', l.vertical ? thickness : l.length);
    s.set(bar, 'height', l.vertical ? l.length : thickness);
    s.set(bar, 'fill', `url(#${this.gradientId})`);

    this.paintTicks(
      l,
      this.ticks(l),
      l.vertical ? thickness : l.top + thickness,
      l.vertical ? thickness + 6 : l.top + thickness + 3 + this.fontSize,
      true,
    );
  }
}

// ─── Size ───

/** No options of its own beyond the common ones. */
export interface SizeKeyAttributes extends KeyAttributes<SizeAxis> {}

/** Circles at the dimension's tick values, each as big as the size it stands for. */
export class SizeKey extends Key<SizeAxis, SizeKeyAttributes> {
  protected override get inset(): number {
    return this.dimension.output[1];
  }
  protected get thickness(): number {
    return 2 * this.dimension.output[1];
  }
  /** Circles as big as the biggest need room: no more ticks than fit without piling up. */
  protected override ticksFor(length: number): number {
    return Math.max(2, Math.floor(length / (2 * this.dimension.output[1] + 4)));
  }

  protected paintScale(l: Layout): void {
    const s = this.surface,
      dim = this.dimension,
      hi = dim.output[1];
    const ticks = this.ticks(l);
    // The circles sit on a line through their centres: down the key, or along it.
    const centre = hi + 1;
    let d = '';
    for (const t of ticks) {
      const r = dim.valueAt(t.fraction);
      const [cx, cy] = l.vertical ? [centre, t.at] : [t.at, l.top + hi];
      d += circlePath(cx, cy, r);
    }
    const circles = s.node('circles', 'path');
    s.set(circles, 'd', d);
    s.set(circles, 'fill', 'none');
    this.strokeLine(circles);
    this.paintTicks(l, ticks, 0, l.vertical ? centre + hi + 6 : l.top + 2 * hi + 3 + this.fontSize, false);
  }
}

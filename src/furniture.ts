/**
 * Chart furniture: the title (and its subtitle and caption) and the tooltip, which reads a `Cursor`. Annotations, which belong to a plane, are
 * in annotation.ts.
 */
import { type AttrTypesFor, STRING } from './attrs.ts';
import type { Container } from './container.ts';
import type { Cursor, CursorChild } from './cursor.ts';
import type { SampleCache, Series } from './series.ts';
import { type BaseAttributes, ChartElement } from './element.ts';
import { type ChartEvent, EVENT_ARRANGE, EVENT_ATTACH, EVENT_MEASURE, EVENT_PAINT, type Hit } from './events.ts';
import { type Rect, f2 } from './geometry.ts';
import { type CalloutLook, calloutSize, clearCallout, paintCallout } from './callout.ts';
import { applyText, measureBlock, paintLines } from './text.ts';
import type { TextProps } from './theme.ts';

/** What a `ChartTitle` is: the heading, the line under it, or the note at the foot. */
export type TitleRole = 'title' | 'subtitle' | 'caption';
export interface ChartTitleAttributes extends BaseAttributes {
  /** The words. A '\n' starts another line. */
  text: string;
  /** What it is, which decides its look and (unless `side` says) where it goes. Default 'title'. */
  role?: TitleRole;
  /** The edge it spans. Default: the top, except for a caption, which goes at the bottom. */
  side?: 'top' | 'bottom';
}

/** Which selector holds each role's look. */
const ROLE_SELECTOR = { title: 'chartTitle', subtitle: 'chartSubtitle', caption: 'chartCaption' } as const;
/** Room above and below a line of text, so bands do not touch what they sit against. */
const BAND_PADDING = 4;

/**
 * Text across the top or bottom of the chart. One element serves every role: a title, a subtitle, a caption or a
 * footnote differ only in their `role` (and so their look) and `side`. Several on one edge stack outwards from it in the
 * order they were added, so a title followed by a subtitle puts the subtitle underneath.
 *
 * Where the text sits along its band is the style property `align` (`style: { chartTitle: { align: 'middle' } }`).
 */
export class ChartTitle extends ChartElement<Container, [], ChartTitleAttributes> {
  static override attrTypes = { ...ChartElement.attrTypes, text: STRING } satisfies AttrTypesFor<ChartTitleAttributes>;
  #rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  #lines = 0;

  private get role(): TitleRole {
    return this.attrs.role ?? 'title';
  }
  private get side(): 'top' | 'bottom' {
    return this.attrs.side ?? (this.role === 'caption' ? 'bottom' : 'top');
  }
  private get look(): TextProps {
    return this.styleFor([ROLE_SELECTOR[this.role], 'text']);
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper();
        break;
      case EVENT_MEASURE: {
        const size = measureBlock(this.requireChart().measureText, this.attrs.text, this.look);
        const request = { width: size.width, height: size.height + BAND_PADDING };
        ev.request = { min: request, max: request, side: this.side, band: true };
        break;
      }
      case EVENT_ARRANGE:
        this.#rect = ev.rect;
        break;
      case EVENT_PAINT: {
        const s = this.surface,
          r = this.#rect,
          look = this.look;
        s.set(s.wrapper(), 'transform', `translate(${f2(r.x)} ${f2(r.y)})`);
        // The anchor is the text's own: start, middle or end of the band (the start is on the right when the chart reads that way).
        const align = this.chart?.rtl && look.align !== 'middle' ? (look.align === 'start' ? 'end' : 'start') : look.align;
        applyText(s, s.wrapper(), look, align);
        const x = align === 'start' ? 0 : align === 'middle' ? r.width / 2 : r.width;
        this.#lines = paintLines(s, 'line-', this.attrs.text, x, BAND_PADDING / 2, look, this.#lines);
        break;
      }
    }
  }
}

export interface ChartTooltipAttributes extends BaseAttributes {
  /**
   * Whether the box moves with the cursor, with no arm, or is set beside what is read, with an arm to it. Default: moves with
   * the cursor when the cursor is 'shared' (there is no one point to be beside), else set beside the point.
   */
  follow?: boolean;
  /** A sample of the series (its line, box or marker, as drawn on the plot) before its name, or without one before its first line. Default false. */
  swatch?: boolean;
  /** The text for one hit. Default: the series name, then each coordinate (with its axis' title if it has one) and the channels. */
  format?: (hit: Hit) => string;
  /**
   * Tell a screen reader what the box says when the cursor is moved by keyboard (see `Platform.announce`), so it can be read
   * without seeing it. Default true. The text is the box's own, which this element does not translate: `format` words it.
   */
  announce?: boolean;
}

/** The gap between the pointer or point and the box of a tooltip that follows. */
const FOLLOW_OFFSET = 14;
/** Which way the box sits from what it points at, in the order tried: up and right, then the other corners. */
const CORNERS = [
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
] as const;

/** The default words for one hit. */
function describe(hit: Hit): string {
  const { series } = hit,
    lines: string[] = [];
  const name = series.attrs.name;
  if (name) lines.push(name);
  const part = (axis: typeof series.firstAxis, value: number) =>
    `${axis.attrs.title ? axis.attrs.title + ': ' : ''}${axis.formatValue(value)}`;
  lines.push(part(series.firstAxis, hit.first), part(series.secondAxis, hit.second));
  for (const [channel, value] of Object.entries(hit.channels)) lines.push(`${channel}: ${String(+value.toPrecision(5))}`);
  return lines.join('\n');
}

/**
 * Shows what the cursor reads, in a box styled like a callout. It is a child of a `Cursor`, which finds the reading (the
 * nearest point, or every series at the cursor's place) from the pointer or the keyboard; this only draws it, above whatever
 * comes before it in the cursor, so put a `Crosshair` first to have the lines under the box. It takes no room of its own.
 *
 * It looks like a callout (`tooltipBox`, `tooltipText` and `tooltip` metrics, each falling back to the callout's own), so a
 * theme that styles callouts styles tooltips too. Touch has no hover, so it shows while a finger is down. It hides while
 * a button is held, which is when something is being dragged.
 */
export class ChartTooltip extends ChartElement<Cursor, [], ChartTooltipAttributes> implements CursorChild {
  #lines = 0;
  #announced = '';
  readonly #samples: SampleCache = new Map();

  /** Moves with the cursor when it has no arm. */
  get follows(): boolean {
    return this.#follow(this.requireParent().attrs.mode === 'shared');
  }
  #follow(shared: boolean): boolean {
    return this.attrs.follow ?? shared;
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper();
        break;
      case EVENT_PAINT:
        this.paint();
        break;
    }
  }

  private look(): CalloutLook {
    return {
      metrics: this.styleFor(['tooltip', 'callout']),
      text: this.styleFor(['tooltipText', 'calloutText', 'text']),
      box: this.styleFor(['tooltipBox', 'calloutBox', 'shape']),
      arm: this.styleFor(['calloutArm', 'line']),
    };
  }

  private paint(): void {
    const s = this.surface,
      cursor = this.requireParent(),
      state = cursor.state,
      a = this.attrs,
      chart = this.requireChart();
    s.wrapper();
    if (!state || state.hits.length === 0) {
      clearCallout(s, this.#lines, this.#samples);
      this.#lines = 0;
      this.#announced = '';
      return;
    }
    const { plane, hits } = state,
      shared = cursor.attrs.mode === 'shared',
      follow = this.#follow(shared);
    const look = this.look(),
      r = plane.rect,
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      first = hits[0]!;
    const format = a.format ?? describe;
    // The words in blocks: a heading in shared mode, then one block for each hit. A hit's colour dots its block's first line.
    const blocks: { text: string; series: Series | null }[] = [];
    if (shared && !a.format) {
      // The heading says where the reading is: the point the series are read at, or, reading the line between points, the cursor's own place.
      const at =
        cursor.attrs.interpolate === true
          ? plane.unplace(state.x, state.y, first.series.firstAxis, first.series.secondAxis)[0]
          : first.first;
      blocks.push({ text: first.series.firstAxis.formatValue(at), series: null });
      for (const h of hits) {
        const name = h.series.attrs.name;
        blocks.push({ text: `${name ? name + ': ' : ''}${h.series.secondAxis.formatValue(h.second)}`, series: h.series });
      }
    } else {
      for (const h of hits) blocks.push({ text: format(h), series: h.series });
    }
    const text = blocks.map((b) => b.text).join('\n');
    const swatches = a.swatch ? blocks.flatMap((b) => b.text.split('\n').map((_, i) => (i === 0 ? b.series : null))) : undefined;
    const { width: w, height: h } = calloutSize(chart.measureText, text, look, !!swatches);

    // What the box is set beside, in chart pixels: the point, or the cursor; and how far from it.
    const point: [number, number] = [r.x + first.px, r.y + first.py];
    const near: [number, number] = follow ? [r.x + state.x, r.y + state.y] : point;
    const gap = follow ? FOLLOW_OFFSET : look.metrics.offset;
    const size = chart.platform?.size() ?? { width: Infinity, height: Infinity };
    const W = chart.attrs.width ?? size.width,
      H = chart.attrs.height ?? size.height;
    let box: Rect | null = null;
    for (const [ux, uy] of CORNERS) {
      const cx = near[0] + ux * (w / 2 + gap * 0.6),
        cy = near[1] + uy * (h / 2 + gap * 0.6);
      const candidate = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
      if (candidate.x >= 0 && candidate.y >= 0 && candidate.x + w <= W && candidate.y + h <= H) {
        box = candidate;
        break;
      }
    }
    // Nowhere fits whole (a small chart): the first corner, pushed back inside as far as it will go.
    box ??= {
      x: Math.max(0, Math.min(near[0] + gap * 0.6, W - w)),
      y: Math.max(0, Math.min(near[1] - h - gap * 0.6, H - h)),
      width: w,
      height: h,
    };
    this.#lines = paintCallout(s, text, box, follow ? null : point, look, this.#lines, swatches, this.#samples);

    // Someone at the keyboard cannot see the box: say what it says, once for each thing it says.
    if (state.source === 'keyboard' && a.announce !== false) {
      const said = text.split('\n').join('. ');
      if (said !== this.#announced) {
        this.#announced = said;
        chart.input?.speak(said);
      }
    } else {
      this.#announced = '';
    }
  }
}

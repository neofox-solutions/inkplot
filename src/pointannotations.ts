/**
 * Point annotations: a note (text, a box, or a callout with an arm) beside chosen points of a series, such as the value and
 * month on every negative bar of a financial report.
 *
 *   new CartesianPlane({}, x, y, series, new PointAnnotations({ anchor: 'bars', text: (hit) => (hit.second < 0 ? `${hit.second}` : null) }))
 *
 * What it is for: flexible labelling of a few points, with the words and the choice of points in your hands (`text` returns
 * nothing for a point that gets no note). Each note is drawn from nodes of its own with its text measured, so it is meant for tens
 * of points, not thousands: `maxCount` stops it there. It is not a tooltip (a `Cursor` reads one point at a time as the pointer
 * moves) and it does not promise that notes never touch: `placement: 'auto'` looks for a clear place, nothing more.
 *
 * It is a child of the plane, after the series, so its notes are drawn over every series (a later series cannot cover an earlier
 * one's notes) and are not cut off by the series' clip. Where a note goes comes from a renderer of the series, named by
 * `anchor`: the middle of the far end of a bar, the rim of a ring segment, a marker's point.
 */
/* oxlint-disable typescript/no-non-null-assertion -- stride-addressed rows of the point and anchor buffers: every index is bounded by the count */
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import { hideFromAssistive } from './aria.ts';
import { type CalloutLook, DIRECTIONS, boxTrouble, calloutSize, clearCallout, paintCallout } from './callout.ts';
import { type BaseAttributes, ChartElement, type ElementRef, fail, resolveRef } from './element.ts';
import { type ChartEvent, EVENT_ATTACH, EVENT_PAINT, type Hit } from './events.ts';
import type { Rect } from './geometry.ts';
import { pointHit } from './hit.ts';
import type { Plane } from './plane.ts';
import { type AnchorSet, type AnySeriesRenderer, SeriesRenderer } from './renderer.ts';
import type { PointBuffer } from './data.ts';
import { Series } from './series.ts';

/** The words for one point, as the axes of its series would write its two coordinates. */
export interface PointWords {
  /** The coordinate along the domain, formatted by the series' first axis. */
  first: string;
  /** The value, formatted by the series' second axis. */
  second: string;
}

export interface PointAnnotationsAttributes extends BaseAttributes {
  /**
   * What a point's note says, or nothing (`null`, `undefined` or an empty string) for a point that gets none. It is given the point
   * as a tooltip's `format` is (`hit.first`, `hit.second`, `hit.row`, `hit.channels`, `hit.series`) and its two coordinates written
   * by their axes. A '\n' starts another line. Called for every point in the series, so keep it cheap; return the same
   * function each time (memoize it in React).
   */
  text: (hit: Hit, words: PointWords) => string | null | undefined;
  /**
   * The renderer that says where each point is, and so which series the notes are for: its id, or the element. A bar's note goes
   * beyond the far end of the bar; a marker's, beside the marker.
   */
  anchor?: ElementRef<AnySeriesRenderer>;
  /**
   * The series, when there is no `anchor` (the notes then go beside the series' points), or to say which series when the anchor
   * is not enough. Default: the anchor's series, else the plane's first.
   */
  series?: ElementRef<Series>;
  /** Keep every note within the plot. Default true. Without it a note may spill into the chart's padding (room for the labels of a pie's rim, say). */
  contain?: boolean;
  /** What is drawn: just 'text', 'box' (text in a box, the default) or a 'callout' (a box with an arm to the point). */
  shape?: 'text' | 'box' | 'callout';
  /**
   * Where a note goes from its anchor. 'outside' (the default) beyond it, away from what is drawn there (above the end of a bar
   * that grows up, below one that grows down); 'inside' at it, towards the foot; 'center' with the middle of the note on the anchor (for a name on a point, a value in a segment); 'auto' tries the eight directions round the point
   * and takes the spot with the least in the way, as a `CalloutAnnotation` does.
   */
  placement?: 'outside' | 'inside' | 'center' | 'auto';
  /** Pixels between a note and its anchor. Default: the callout's own `offset`. */
  offset?: number;
  /** The most notes drawn; further points that have one are left out (`omitted` says how many). Default 40. */
  maxCount?: number;
  /**
   * Whether assistive technology reads the notes. 'hidden' (the default) when they repeat what the chart's table and summary say;
   * 'text' when `text` carries something they do not, which is for you to judge.
   */
  aria?: 'hidden' | 'text';
}

const DEFAULT_MAX = 40;

export class PointAnnotations extends ChartElement<Plane, [], PointAnnotationsAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    anchor: STRING,
    series: STRING,
    aria: STRING,
    maxCount: NUMBER,
    offset: NUMBER,
    placement: STRING,
    shape: STRING,
  } satisfies AttrTypesFor<PointAnnotationsAttributes>;

  /** The key prefixes of the notes now drawn, with their line counts, so a note that goes away is taken off. */
  #drawn = new Map<number, number>();
  #omitted = 0;
  readonly #boxes: Rect[] = [];

  /** How many points had a note but were left out at the last draw because `maxCount` was reached. 0 means every note was drawn. */
  get omitted(): number {
    return this.#omitted;
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH: {
        const s = this.surface;
        const wrapper = s.wrapper(); // carries the text style that every line inherits
        if ((this.attrs.aria ?? 'hidden') === 'hidden') hideFromAssistive(s, wrapper);
        break;
      }
      case EVENT_PAINT:
        this.paint();
        break;
    }
  }

  /** Every point of the series with a place for its note: x, y and the direction away, from the renderer or else the point. */
  private placeAnchors(renderer: AnySeriesRenderer | undefined, points: Readonly<PointBuffer>, plane: Plane, series: Series): AnchorSet {
    const found = renderer?.anchors();
    if (found && found.count === points.count) return found;
    const out = new Float64Array(points.count * 4);
    // A point has no foot to lead away from, so away is up the page: or, where the value runs along the radius, out from the middle.
    const radial = series.secondAxis.orientation === 'radius',
      cx = plane.rect.width / 2,
      cy = plane.rect.height / 2;
    for (let i = 0; i < points.count; i++) {
      const x = points.data[i * points.stride]!,
        y = points.data[i * points.stride + 1]!;
      out[4 * i] = x;
      out[4 * i + 1] = y;
      const len = radial ? Math.hypot(x - cx, y - cy) : 0;
      out[4 * i + 2] = len > 1e-9 ? (x - cx) / len : 0;
      out[4 * i + 3] = len > 1e-9 ? (y - cy) / len : -1;
    }
    return { data: out, count: points.count };
  }

  private paint(): void {
    const plane = this.requireParent(),
      s = this.surface,
      a = this.attrs;
    const renderer = resolveRef<AnySeriesRenderer>(a.anchor, this, SeriesRenderer);
    const series = resolveRef<Series>(a.series, this, Series) ?? (renderer ? renderer.requireParent() : plane.series[0]) ?? fail(173);
    if (!(series instanceof Series)) fail(172, renderer ? `the renderer "${String(renderer.attrs.id ?? '?')}"` : 'the series');
    const points = series.points;
    if (!series.drawn || !series.shown) {
      for (const [i, lines] of this.#drawn) clearCallout(s, lines, undefined, `n${i}/`);
      this.#drawn = new Map();
      return;
    }
    const base = this.look(),
      shape = a.shape ?? 'box',
      placement = a.placement ?? 'outside',
      offset = a.offset ?? base.metrics.offset,
      max = a.maxCount ?? DEFAULT_MAX,
      room = plane.rect;
    const look: CalloutLook =
      shape === 'text'
        ? { ...base, box: { ...base.box, fill: 'none', stroke: 'none' }, metrics: { ...base.metrics, outline: 'none' } }
        : base;
    const anchors = this.placeAnchors(renderer, points, plane, series);
    const measure = this.requireChart().measureText;
    const first = series.firstAxis,
      second = series.secondAxis;
    const kept = new Map<number, number>();
    this.#boxes.length = 0;
    let skipped = 0;
    for (let i = 0; i < anchors.count; i++) {
      const x = anchors.data[4 * i]!,
        y = anchors.data[4 * i + 1]!;
      if (!(x >= 0 && x <= room.width && y >= 0 && y <= room.height)) continue; // a gap, or panned out of view
      const hit = pointHit(series, i);
      if (!hit) continue;
      const text = a.text(hit, { first: first.formatValue(hit.first), second: second.formatValue(hit.second) });
      if (!text) continue;
      if (kept.size >= max) {
        skipped++;
        continue;
      }
      const { width: w, height: h } = calloutSize(measure, text, look);
      const nx = anchors.data[4 * i + 2]!,
        ny = anchors.data[4 * i + 3]!;
      const place = (cx: number, cy: number): Rect => ({ x: cx - w / 2, y: cy - h / 2, width: w, height: h });
      // How far the middle of the box is from the anchor along (nx, ny) so that its near edge is `offset` away.
      const reach = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2) + offset;
      let box: Rect;
      // A note kept on the plot stays a pixel in from its edge, or the outline would be cut by it.
      const contain = (b: Rect) => {
        if (a.contain === false) return;
        b.x = Math.min(Math.max(b.x, 1), Math.max(1, room.width - w - 1));
        b.y = Math.min(Math.max(b.y, 1), Math.max(1, room.height - h - 1));
      };
      if (placement === 'center') {
        box = place(x, y);
        contain(box);
      } else if (placement === 'auto') {
        let best = Infinity;
        box = place(x, y);
        DIRECTIONS.forEach(([ux, uy], k) => {
          const candidate = place(x + ux * (w / 2 + offset), y + uy * (h / 2 + offset));
          const score = boxTrouble(plane, candidate, k, this.#boxes);
          if (score < best) {
            best = score;
            box = candidate;
          }
        });
      } else {
        const sign = placement === 'inside' ? -1 : 1;
        box = place(x + sign * nx * reach, y + sign * ny * reach);
        // A bar that reaches the edge of the plot leaves no room beyond it: the note stays on the plot, over the bar.
        contain(box);
      }
      this.#boxes.push(box);
      kept.set(
        i,
        paintCallout(s, text, box, shape === 'callout' ? [x, y] : null, look, this.#drawn.get(i) ?? 0, undefined, undefined, `n${i}/`),
      );
    }
    // Notes of earlier draws that are not drawn now (the data or the zoom changed, or the filter says no).
    for (const [i, lines] of this.#drawn) if (!kept.has(i)) clearCallout(s, lines, undefined, `n${i}/`);
    this.#drawn = kept;
    this.#omitted = skipped;
  }

  private look(): CalloutLook {
    return {
      metrics: this.styleFor(['callout']),
      text: this.styleFor(['calloutText', 'text']),
      box: this.styleFor(['calloutBox', 'shape']),
      arm: this.styleFor(['calloutArm', 'line']),
    };
  }
}

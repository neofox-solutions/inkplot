/**
 * The crosshair: guide lines through the cursor, and optionally a dot on each reading.
 *
 *   new Cursor({}, new Crosshair())                                   // both lines, following the pointer
 *   new Cursor({ mode: 'shared' }, new Crosshair({ lines: 'first', dots: true }), new ChartTooltip())
 *
 * The lines are lines of constant value, as the plane draws its own gridlines: a vertical and a horizontal line on a
 * rectangular plane, but a spoke (the angle) and a circle (the radius) on a polar one, and a spoke and a polygon on a radar.
 * `lines` chooses which. They are clipped to the plot.
 *
 * It looks as `crosshair` says (a line look), falling back to `line`.
 */
import { type AttrTypesFor, NUMBER } from './attrs.ts';
import { type BaseAttributes, ChartElement } from './element.ts';
import { type ChartEvent, EVENT_ATTACH, EVENT_PAINT } from './events.ts';
import { circlePath, f2 } from './geometry.ts';
import type { Cursor, CursorChild } from './cursor.ts';

export interface CrosshairAttributes extends BaseAttributes {
  /** Which guide: the line of constant first coordinate (across a line chart: vertical), of the second, or both. Default 'both'. */
  lines?: 'first' | 'second' | 'both';
  /** A dot in the series' colour on each reading under the cursor. Default false. */
  dots?: boolean;
  /** Radius of those dots, in pixels. Default 4. */
  dotSize?: number;
  /** Put the lines through the first reading (a point) rather than through the cursor itself. Default false. */
  snap?: boolean;
}

export class Crosshair extends ChartElement<Cursor, [], CrosshairAttributes> implements CursorChild {
  static override attrTypes = { ...ChartElement.attrTypes, dotSize: NUMBER } satisfies AttrTypesFor<CrosshairAttributes>;
  #dots = 0;

  /** At the pointer's own place unless it is snapped to a reading. */
  get follows(): boolean {
    return this.attrs.snap !== true;
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper();
        break;
      case EVENT_PAINT:
        this.#paint();
        break;
    }
  }

  #paint(): void {
    const s = this.surface,
      root = s.wrapper(),
      state = this.requireParent().state,
      a = this.attrs;
    if (!state) {
      s.remove('guide');
      for (let i = 0; i < this.#dots; i++) s.remove(`dot-${i}`);
      this.#dots = 0;
      return;
    }
    const { plane, hits } = state,
      r = plane.rect;
    s.set(root, 'transform', `translate(${f2(r.x)} ${f2(r.y)})`);
    const clip = plane.clipUrl;
    if (clip) s.set(root, 'clip-path', clip);
    // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
    const snapped = a.snap === true && hits.length > 0 ? hits[0]! : null;
    const x = snapped ? snapped.px : state.x,
      y = snapped ? snapped.py : state.y;
    const first = plane.defaultAxis('first'),
      second = plane.defaultAxis('second');
    let d = '';
    if (first && second) {
      const at = plane.unplace(x, y, first, second),
        which = a.lines ?? 'both';
      if (which !== 'second') d += plane.guide('first', at[0]);
      if (which !== 'first') d += plane.guide('second', at[1]);
    }
    const look = this.styleFor(['crosshair', 'line']);
    const line = s.node('guide', 'path');
    s.set(line, 'd', d);
    s.set(line, 'fill', 'none');
    s.set(line, 'stroke', look.color);
    s.set(line, 'stroke-width', look.width);
    s.set(line, 'stroke-dasharray', look.dash);
    s.set(line, 'opacity', look.opacity);
    const halo = this.styleFor(['calloutBox', 'shape']).fill,
      size = a.dotSize ?? 4,
      shown = a.dots ? hits : [];
    shown.forEach((hit, i) => {
      const dot = s.node(`dot-${i}`, 'path');
      s.set(dot, 'd', circlePath(hit.px, hit.py, size));
      s.set(dot, 'fill', hit.series.color);
      s.set(dot, 'stroke', halo);
      s.set(dot, 'stroke-width', 1.5);
    });
    for (let i = shown.length; i < this.#dots; i++) s.remove(`dot-${i}`);
    this.#dots = shown.length;
  }
}

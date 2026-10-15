/**
 * Several charts in one picture: a grid of items, each laid out like a chart of its own.
 *
 *   new Chart({}, new ChartTitle({ text: 'Dashboard' }),
 *     new ChartGroup({ columns: 2 },
 *       new ChartGroupItem({}, new ChartTitle({ text: 'Sales' }), salesPlane),
 *       new ChartGroupItem({ span: [2, 1] }, trendPlane)))
 *
 * The group is the body of the chart, in place of a plane. It cuts the area it is given into equal cells and gives each
 * item the cells it spans. Items go in child order, along the flow, each after the last: the grid is not packed to fill
 * holes. An item takes the children a chart does: a plane, titles, a legend, a cursor, keys. Its furniture goes round its
 * plane inside its cells, and the chart's own furniture goes round the whole group.
 *
 * A line that is not filled (eight items in three columns leave two in the last row) is placed by `justify`.
 * A grid of one cell puts every item in it, on top of each other: showing one at a time is `visible`.
 */
import { type AttrTypesFor, AUTO, BOOLEAN, NUMBER, STRING } from './attrs.ts';
import { Axis } from './axis.ts';
import { Container, isBody } from './container.ts';
import { type BaseAttributes, ChartElement, fail, resolveRef } from './element.ts';
import { type ChartEvent, EVENT_ARRANGE, EVENT_HOVER } from './events.ts';
import type { Extent, Insets, Rect } from './geometry.ts';
import type { Scale } from './scale.ts';
import { Dimension } from './dimension.ts';
import { CartesianPlane, type Plane } from './plane.ts';
import type { ChartChildren } from './chart.ts';

/** Where the items of a line that is not full sit along the line. */
export type Justify = 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';

export interface ChartGroupAttributes extends BaseAttributes {
  /** How many columns. With `flow: 'row'` (the default) this is how many items make a line; left out it is as many as the items need to make one row, or share out the rows. */
  columns?: number;
  /** How many rows; the counterpart of `columns`. */
  rows?: number;
  /** The direction the items fill the grid in: along a row and then down (`'row'`, the default) or down a column and then along. */
  flow?: 'row' | 'column';
  /** Space between cells in pixels: one number, or one for each direction. Default 8. */
  gap?: number | { row?: number; column?: number };
  /** Where the items of the last line go when it is not full. Default 'start'. */
  justify?: Justify;
  /** Give charts in a column the same room left and right of their plots, and charts in a row the same above and below, so the plots line up whatever their labels need. Default true. */
  align?: boolean;
  /**
   * Show the cursor in every chart that shares an axis with the one the pointer is over, at the same value of it: a crosshair
   * and a tooltip in each chart of a column, all reading one time. Each chart needs a `Cursor` of its own (with `mode: 'shared'`).
   * Default false.
   */
  linkCursor?: boolean;
}

export interface ChartGroupItemAttributes extends BaseAttributes {
  /** How many cells it takes along the flow and across it: one number is columns (rows being 1), or `[columns, rows]`. Default 1. */
  span?: number | readonly [columns: number, rows: number];
}

export interface Edges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/**
 * A range that the charts of a group share: one scale and one fitted range for all of them, so that what is drawn in
 * several charts lines up. It draws nothing. A plane's `SharedAxis` names it and draws it: each chart says where the axis goes
 * and how it looks, and the range is fitted to everything every chart draws against it.
 */
export class SharedRange extends Dimension<ChartGroup> {
  #pass = -1;
  /** `begin` for a range several planes share: the first plane of a pass starts it over, the others only say how long they will draw it, of which the shortest counts. */
  beginShared(pass: number, length: number): void {
    if (pass !== this.#pass) {
      this.#pass = pass;
      this.begin(length);
    } else if (length > 0 && (this.lengthPx === 0 || length < this.lengthPx)) this.lengthPx = length;
  }
}

/**
 * An axis that draws a `SharedRange` of the group its chart is in, in place of a scale of its own (it has none): the range, the scale
 * and the pan and zoom view are the shared range's, so charts that show it line up and move together. Its own attributes say how it is
 * drawn: `orientation`, `title`, `format`, ticks. `edgeOnly` draws it only where its chart is at the edge of the group it faces (one row
 * of labels along the bottom), and takes no room elsewhere. Cartesian planes only.
 */
export class SharedAxis extends Axis {
  /** The range it draws. */
  get shared(): SharedRange {
    const ref = this.attrs.sharedRef;
    return ref === undefined
      ? fail('SharedAxis needs a sharedRef: the id of a SharedRange')
      : resolveRef<SharedRange>(ref, this, SharedRange);
  }
  override get scale(): Scale {
    return this.shared.scale;
  }
  override get range(): Readonly<Extent> {
    return this.shared.range;
  }
  override get isZoomed(): boolean {
    return this.shared.isZoomed;
  }
  override get viewRange(): Readonly<Extent> | null {
    return this.shared.viewRange;
  }
  override begin(lengthInPixels = 0): void {
    this.shared.beginShared(this.chart?.flushCount ?? 0, lengthInPixels);
  }
  override reach(pixels: number, ends: 'both' | 'lo' | 'hi' = 'both'): void {
    this.shared.reach(pixels, ends);
  }
  override contribute(min: number, max: number): void {
    this.shared.contribute(min, max);
  }
  override resolve(): void {
    this.shared.resolve();
  }
  override setViewRange(range: Extent | null): void {
    this.shared.setViewRange(range);
  }
  /** Not with `edgeOnly` when its chart has others between it and the edge it faces. */
  override get drawn(): boolean {
    const item = this.requireParent().parent,
      o = this.orientation;
    if (!this.attrs.edgeOnly || !(item instanceof ChartGroupItem) || o === 'angle' || o === 'radius') return true;
    return item.edges[o];
  }
}

/** One chart in a group: its own plane and furniture, in its cells of the grid. Not shown, it takes no cell and no space. */
export class ChartGroupItem extends Container<ChartGroup, ChartChildren, ChartGroupItemAttributes> {
  static override attrTypes = { ...ChartElement.attrTypes, span: AUTO } satisfies AttrTypesFor<ChartGroupItemAttributes>;

  /** The cells it takes, as columns and rows. */
  get span(): readonly [columns: number, rows: number] {
    const s = this.attrs.span ?? 1;
    const [c, r] = typeof s === 'number' ? [s, 1] : s;
    if (!(Number.isInteger(c) && Number.isInteger(r) && c >= 1 && r >= 1))
      fail(`ChartGroupItem: span ${String(s)} is not a whole number of columns and rows`);
    return [c, r];
  }

  #edges: Edges = { top: true, right: true, bottom: true, left: true };
  /** Which edges of the group this chart is at: nothing of the group lies beyond it that way. An axis with `edgeOnly` is drawn on these. */
  get edges(): Edges {
    return this.#edges;
  }
  setEdges(edges: Edges): void {
    this.#edges = edges;
  }

  #rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** The cells it was given at the last layout. */
  get rect(): Rect {
    return this.#rect;
  }

  /** The room left for the plane in `rect` once this chart's titles and keys have taken theirs. */
  bodyArea(rect: Rect): Rect {
    let out = rect;
    this.layOutFurniture(rect, (area) => {
      out = area;
    });
    return out;
  }

  override onEvent(ev: ChartEvent): void {
    if (ev.type !== EVENT_ARRANGE) return;
    const rect = (this.#rect = ev.rect);
    this.layOutFurniture(rect, (area) => {
      for (const child of this) if (isBody(child)) this.arrangeChild(child, area);
    });
  }
}

interface Placed {
  item: ChartGroupItem;
  /** Along the flow and across it, in cells. */
  line: number;
  at: number;
  along: number;
  across: number;
}

/** A grid of charts. It is the body of a chart, in place of a plane. */
export class ChartGroup extends ChartElement<Container, (ChartGroupItem | SharedRange)[], ChartGroupAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    columns: NUMBER,
    rows: NUMBER,
    flow: STRING,
    gap: AUTO,
    justify: STRING,
    align: BOOLEAN,
    linkCursor: BOOLEAN,
  } satisfies AttrTypesFor<ChartGroupAttributes>;

  get isBody(): true {
    return true;
  }

  /** The items that take part: those that are shown. */
  get items(): readonly ChartGroupItem[] {
    return [...this].filter((c): c is ChartGroupItem => c instanceof ChartGroupItem && c.attrs.visible !== false);
  }

  /** The planes of the items that are shown. */
  get planes(): readonly Plane[] {
    return this.items.flatMap((i) => i.planes);
  }

  override onEvent(ev: ChartEvent): void {
    if (ev.type === EVENT_ARRANGE) this.arrange(ev.rect);
    else if (ev.type === EVENT_HOVER && this.attrs.linkCursor) this.followPointer(ev.plane, ev.x, ev.y, ev.buttons);
  }

  /**
   * The pointer is at (`x`, `y`) in `plane`: tell the other charts of the group that share an axis with it that it is, along that
   * axis, at the same value. Each is told by a hover of its own, sent to that chart alone, so its cursor and nothing else follows.
   */
  private followPointer(plane: Plane, x: number, y: number, buttons: number): void {
    const from = plane.axes.filter((a) => a instanceof SharedAxis);
    if (from.length === 0 || !this.planes.includes(plane)) return;
    for (const item of this.items)
      for (const other of item.planes) {
        if (other === plane) continue;
        let tx = NaN,
          ty = NaN;
        for (const a of from) {
          const b = other.axes.find((o) => o instanceof SharedAxis && o.shared === a.shared);
          if (!b) continue;
          const horizontal = a.orientation === 'top' || a.orientation === 'bottom',
            along = horizontal ? x / plane.rect.width : 1 - y / plane.rect.height;
          if (!(along >= 0 && along <= 1)) continue;
          const mapped = b.fractionOf(a.denormalize(along)) * (horizontal ? other.rect.width : other.rect.height);
          if (horizontal) {
            tx = mapped;
            ty = other.rect.height / 2;
          } else {
            tx = other.rect.width / 2;
            ty = other.rect.height - mapped;
          }
          break;
        }
        this.requireChart().deliver({ type: EVENT_HOVER, plane: other, x: tx, y: ty, buttons: tx === tx ? buttons : 0 }, item);
      }
  }

  /** Where each shown item goes in the grid, in cells, and how many lines the grid has. */
  private place(): { placed: Placed[]; lines: number; perLine: number; taken: Set<number> } {
    const a = this.attrs,
      rowFlow = (a.flow ?? 'row') === 'row',
      items = this.items;
    for (const [name, v] of [
      ['columns', a.columns],
      ['rows', a.rows],
    ] as const)
      if (v !== undefined && !(Number.isInteger(v) && v >= 1)) fail(`ChartGroup: ${name} has to be a whole number of at least 1`);
    // `perLine` cells make a line along the flow; `limit` lines are allowed across it (Infinity when the group does not say).
    const along = rowFlow ? a.columns : a.rows,
      across = rowFlow ? a.rows : a.columns;
    const spans = items.map((i) => {
      const [c, r] = i.span;
      return rowFlow ? { along: c, across: r } : { along: r, across: c };
    });
    const overlay = along === 1 && across === 1;
    let perLine = along ?? 0;
    if (!perLine) {
      // The lines are not given: one line, or as many cells to a line as sharing the items out over the lines asked for takes.
      const area = spans.reduce((n, s) => n + s.along * s.across, 0);
      perLine = across
        ? Math.ceil(area / across)
        : Math.max(
            1,
            ...spans.map((s) => s.along),
            spans.reduce((n, s) => n + s.along, 0),
          );
      perLine = Math.max(perLine, ...spans.map((s) => s.along), 1);
    }
    const limit = across ?? Infinity;
    const taken = new Set<number>(),
      key = (line: number, at: number) => line * (perLine + 1) + at;
    const placed: Placed[] = [];
    let lines = 0,
      line = 0,
      at = 0;
    items.forEach((item, n) => {
      const s = spans[n] ?? { along: 1, across: 1 };
      if (overlay) {
        placed.push({ item, line: 0, at: 0, along: 1, across: 1 });
        lines = 1;
        return;
      }
      if (s.along > perLine) fail(`ChartGroup: an item spans ${s.along} cells along the flow, and a line has ${perLine}`);
      for (;;) {
        if (at + s.along > perLine) {
          line++;
          at = 0;
        }
        let free = true;
        for (let l = 0; l < s.across && free; l++) for (let k = 0; k < s.along; k++) if (taken.has(key(line + l, at + k))) free = false;
        if (free) break;
        at++;
      }
      if (line + s.across > limit)
        fail(`ChartGroup: the ${items.length} items do not fit in ${a.columns ?? '?'} columns and ${a.rows ?? '?'} rows`);
      for (let l = 0; l < s.across; l++) for (let k = 0; k < s.along; k++) taken.add(key(line + l, at + k));
      placed.push({ item, line, at, along: s.along, across: s.across });
      lines = Math.max(lines, line + s.across);
      at += s.along;
    });
    return { placed, lines: Math.max(lines, 1), perLine, taken };
  }

  private arrange(area: Rect): void {
    const a = this.attrs,
      rowFlow = (a.flow ?? 'row') === 'row',
      gap = typeof a.gap === 'number' ? { row: a.gap, column: a.gap } : { row: a.gap?.row ?? 8, column: a.gap?.column ?? 8 };
    const { placed, lines, perLine, taken } = this.place();
    if (placed.length === 0) return;
    // Cells are the same size: the area less the gaps, shared out. `gapAlong` is the gap between cells along the flow.
    const gapAlong = rowFlow ? gap.column : gap.row,
      gapAcross = rowFlow ? gap.row : gap.column;
    const lengthAlong = rowFlow ? area.width : area.height,
      lengthAcross = rowFlow ? area.height : area.width;
    const cellAlong = Math.max(1, (lengthAlong - gapAlong * (perLine - 1)) / perLine),
      cellAcross = Math.max(1, (lengthAcross - gapAcross * (lines - 1)) / lines);
    // The last line, when the items in it do not take all its cells, is shifted by `justify`.
    const lastLine = lines - 1;
    const inLast = placed.filter((p) => p.line + p.across - 1 === lastLine && p.line === lastLine);
    const used = inLast.reduce((n, p) => n + p.along, 0);
    const offsets = new Map<Placed, number>();
    if (inLast.length > 0 && used < perLine && inLast.length === placed.filter((p) => p.line === lastLine).length) {
      const free = (perLine - used) * (cellAlong + gapAlong),
        n = inLast.length;
      const justify = a.justify ?? 'start';
      const lead =
        justify === 'center'
          ? free / 2
          : justify === 'end'
            ? free
            : justify === 'space-around'
              ? free / n / 2
              : justify === 'space-evenly'
                ? free / (n + 1)
                : 0;
      const between =
        justify === 'space-between'
          ? n > 1
            ? free / (n - 1)
            : 0
          : justify === 'space-around'
            ? free / n
            : justify === 'space-evenly'
              ? free / (n + 1)
              : 0;
      inLast.forEach((p, i) => offsets.set(p, lead + between * i));
    }
    const free = (line: number, at: number) => line >= 0 && at >= 0 && !taken.has(line * (perLine + 1) + at);
    const rects = new Map<ChartGroupItem, Rect>();
    for (const p of placed) {
      const start = p.at * (cellAlong + gapAlong) + (offsets.get(p) ?? 0),
        top = p.line * (cellAcross + gapAcross),
        sizeAlong = p.along * cellAlong + (p.along - 1) * gapAlong,
        sizeAcross = p.across * cellAcross + (p.across - 1) * gapAcross;
      rects.set(
        p.item,
        rowFlow
          ? { x: area.x + start, y: area.y + top, width: sizeAlong, height: sizeAcross }
          : { x: area.x + top, y: area.y + start, width: sizeAcross, height: sizeAlong },
      );
      // An edge of the group is one with no chart in the cells beyond this one's.
      const along = Array.from({ length: p.along }, (_, k) => p.at + k),
        across = Array.from({ length: p.across }, (_, l) => p.line + l);
      const before = { across: along.every((at) => free(p.line - 1, at)), along: across.every((l) => free(l, p.at - 1)) },
        after = { across: along.every((at) => free(p.line + p.across, at)), along: across.every((l) => free(l, p.at + p.along)) };
      p.item.setEdges(
        rowFlow
          ? { top: before.across, bottom: after.across, left: before.along, right: after.along }
          : { left: before.across, right: after.across, top: before.along, bottom: after.along },
      );
    }
    this.fitShared(placed, rects);
    this.alignPlots(placed, rects, rowFlow);
    for (const p of placed) this.arrangeChild(p.item, rects.get(p.item) ?? area);
  }

  /**
   * Charts whose cells share an edge leave the same room on that side of their plots, the largest any of them needs, so the
   * plots line up. The sides are keyed by the line of cells they lie on: all charts that start in a column share their left, all that end in it
   * their right, and so on for rows.
   */
  private alignPlots(placed: readonly Placed[], rects: ReadonlyMap<ChartGroupItem, Rect>, rowFlow: boolean): void {
    const need = {
      left: new Map<number, number>(),
      right: new Map<number, number>(),
      top: new Map<number, number>(),
      bottom: new Map<number, number>(),
    };
    const keyed: { plane: CartesianPlane; keys: Insets; own: Insets }[] = [];
    for (const p of placed) {
      const c0 = rowFlow ? p.at : p.line,
        c1 = rowFlow ? p.at + p.along : p.line + p.across,
        r0 = rowFlow ? p.line : p.at,
        r1 = rowFlow ? p.line + p.across : p.at + p.along;
      for (const plane of p.item) {
        if (!(plane instanceof CartesianPlane)) continue;
        plane.alignInsets = null;
        const own = this.attrs.align === false ? null : plane.measureInsets(p.item.bodyArea(rects.get(p.item) ?? p.item.rect));
        if (!own) continue;
        const entry = { plane, keys: { left: c0, right: c1, top: r0, bottom: r1 }, own };
        keyed.push(entry);
        for (const k of ['left', 'right', 'top', 'bottom'] as const)
          need[k].set(entry.keys[k], Math.max(need[k].get(entry.keys[k]) ?? 0, own[k]));
      }
    }
    for (const { plane, keys } of keyed)
      plane.alignInsets = {
        left: need.left.get(keys.left),
        right: need.right.get(keys.right),
        top: need.top.get(keys.top),
        bottom: need.bottom.get(keys.bottom),
      };
  }

  /** Charts that draw a range of this group's are fitted in step, since the range has to cover what all of them draw before any is placed. */
  private fitShared(placed: readonly Placed[], rects: ReadonlyMap<ChartGroupItem, Rect>): void {
    if (![...this].some((c) => c instanceof SharedRange)) return;
    const steps: Generator<void>[] = [];
    for (const { item } of placed)
      for (const plane of item.planes)
        if (plane.axes.some((x) => x instanceof SharedAxis && x.shared.parent === this))
          steps.push(
            (plane instanceof CartesianPlane ? plane : fail('a SharedAxis needs a Cartesian plane')).fitSteps(rects.get(item) ?? item.rect),
          );
    for (let live = steps; live.length > 0;) live = live.filter((g) => !g.next().done);
  }
}

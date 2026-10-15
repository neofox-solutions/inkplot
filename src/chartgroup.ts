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
import { type AttrTypesFor, AUTO, NUMBER, STRING } from './attrs.ts';
import { Container, isBody } from './container.ts';
import { type BaseAttributes, ChartElement, fail } from './element.ts';
import { type ChartEvent, EVENT_ARRANGE } from './events.ts';
import type { Rect } from './geometry.ts';
import type { Plane } from './plane.ts';
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
}

export interface ChartGroupItemAttributes extends BaseAttributes {
  /** How many cells it takes along the flow and across it: one number is columns (rows being 1), or `[columns, rows]`. Default 1. */
  span?: number | readonly [columns: number, rows: number];
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

  #rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** The cells it was given at the last layout. */
  get rect(): Rect {
    return this.#rect;
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
export class ChartGroup extends ChartElement<Container, ChartGroupItem[], ChartGroupAttributes> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    columns: NUMBER,
    rows: NUMBER,
    flow: STRING,
    gap: AUTO,
    justify: STRING,
  } satisfies AttrTypesFor<ChartGroupAttributes>;

  get isBody(): true {
    return true;
  }

  /** The items that take part: those that are shown. */
  get items(): readonly ChartGroupItem[] {
    return [...this].filter((c) => c.attrs.visible !== false);
  }

  /** The planes of the items that are shown. */
  get planes(): readonly Plane[] {
    return this.items.flatMap((i) => i.planes);
  }

  override onEvent(ev: ChartEvent): void {
    if (ev.type === EVENT_ARRANGE) this.arrange(ev.rect);
  }

  /** Where each shown item goes in the grid, in cells, and how many lines the grid has. */
  private place(): { placed: Placed[]; lines: number; perLine: number } {
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
    return { placed, lines: Math.max(lines, 1), perLine };
  }

  private arrange(area: Rect): void {
    const a = this.attrs,
      rowFlow = (a.flow ?? 'row') === 'row',
      gap = typeof a.gap === 'number' ? { row: a.gap, column: a.gap } : { row: a.gap?.row ?? 8, column: a.gap?.column ?? 8 };
    const { placed, lines, perLine } = this.place();
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
    for (const p of placed) {
      const start = p.at * (cellAlong + gapAlong) + (offsets.get(p) ?? 0),
        top = p.line * (cellAcross + gapAcross),
        sizeAlong = p.along * cellAlong + (p.along - 1) * gapAlong,
        sizeAcross = p.across * cellAcross + (p.across - 1) * gapAcross;
      const rect: Rect = rowFlow
        ? { x: area.x + start, y: area.y + top, width: sizeAlong, height: sizeAcross }
        : { x: area.x + top, y: area.y + start, width: sizeAcross, height: sizeAlong };
      this.arrangeChild(p.item, rect);
    }
  }
}

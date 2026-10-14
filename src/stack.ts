/**
 * Stack: series that are drawn on top of each other, or side by side, sharing one domain and one value axis.
 *
 * A stack is a group in the plane, and its members are ordinary series, each with its own source, renderers, name and
 * `hit`. All it adds is where each series' rows sit: for every row a *base* (where it starts) and a *top* (where it is
 * plotted), which the series reads in place of its own value. So nothing downstream is special:
 *  - a line or a marker is drawn at the tops, once for each series;
 *  - an area (or bars) fills from the series' base, which `Series.baseline` now returns row by row;
 *  - a tooltip or an edit still sees the series' own value, since the raw rows are untouched.
 *
 * Modes (`mode`):
 *  - `stack` (default): each row's values are laid one on another in the order of the members, the first at the bottom.
 *    Positive values stack up from zero and negative ones down from it, so mixed signs do not cancel.
 *  - `normalize`: like `stack`, with each row scaled to total 1 (the value axis then runs 0 to 1: give it a format).
 *  - `center`: a streamgraph, the stack of each row centred on zero.
 *  - `group`: nothing is laid on anything; every series is drawn from the baseline, and a bar renderer places the series
 *    side by side, in the order they are listed.
 * A value that is a gap (NaN) leaves its own layer out and adds nothing to the others in that row.
 *
 * The rows of the members have to line up. Normally they do (the same categories, the same table's columns), and the
 * default `align: 'strict'` checks it. Otherwise `align` says how to merge their domains into the union of all of them,
 * a row at every position any member has:
 *  - `gaps`: a member that has no value at a position has a gap there. Right for bars.
 *  - `interpolate`: it has the straight line between its neighbours' values, and a gap beyond its own first and last
 *    position. Right for areas and lines, which then add up exactly. The rows made up this way belong to no source row,
 *    so they cannot be edited, and any channels they bind are gaps. A member with two rows at one position keeps the first.
 *
 * Decimation is per series and would thin each differently, so decimate a stack's sources before it, if at all: members
 * whose rows then differ in domain need `align` as above.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type BaseAttributes, ChartElement, fail } from './element.ts';
import type { Extent, Size } from './geometry.ts';
import type { Plane } from './plane.ts';
import { DomainSeries, type Rows, type SeriesGroup } from './series.ts';

export type StackMode = 'stack' | 'normalize' | 'center' | 'group';
export type StackAlign = 'strict' | 'gaps' | 'interpolate';

export interface StackAttributes extends BaseAttributes {
  /** How the members' values are laid out. Default 'stack'. */
  mode?: StackMode;
  /** How rows are matched up when the members' domains differ. Default 'strict': they must not. */
  align?: StackAlign;
}

/** The first column of each table is its domain and the second its value (a `DomainSeries`' raw layout). */
const sameDomain = (a: Rows, b: Rows) => {
  if (a.count !== b.count) return false;
  for (let i = 0; i < a.count; i++) if (a.raw[i * a.stride] !== b.raw[i * b.stride]) return false;
  return true;
};

/**
 * Tables of rows made to share one domain: the union of all of theirs, each with a row at every position, `gaps` or
 * `interpolate` where it had none. The made-up rows have no source row (`rowOf` negative).
 */
export function alignRows(tables: readonly Rows[], how: 'gaps' | 'interpolate'): Rows[] {
  let total = 0;
  for (const t of tables) total += t.count;
  const all = new Float64Array(total);
  let at = 0;
  for (const t of tables) for (let i = 0; i < t.count; i++) all[at++] = t.raw[i * t.stride]!;
  all.sort();
  let size = 0;
  for (let i = 0; i < all.length; i++) if (i === 0 || all[i] !== all[i - 1]) all[size++] = all[i]!;
  return tables.map((t): Rows => {
    const { raw, count: n, stride: s } = t;
    const out = new Float64Array(size * s).fill(NaN),
      rows = new Int32Array(size).fill(-1);
    for (let u = 0, j = 0; u < size; u++) {
      const x = all[u]!;
      while (j < n && raw[j * s]! < x) j++;
      out[u * s] = x;
      if (j < n && raw[j * s] === x) {
        for (let c = 1; c < s; c++) out[u * s + c] = raw[j * s + c]!;
        rows[u] = t.rowOf ? t.rowOf(j) : -1;
        while (j < n && raw[j * s] === x) j++;
      } else if (how === 'interpolate' && j > 0 && j < n) {
        const x0 = raw[(j - 1) * s]!,
          x1 = raw[j * s]!,
          v0 = raw[(j - 1) * s + 1]!,
          v1 = raw[j * s + 1]!;
        if (Number.isFinite(v0) && Number.isFinite(v1)) out[u * s + 1] = v0 + ((x - x0) / (x1 - x0)) * (v1 - v0);
      }
    }
    return { raw: out, count: size, stride: s, rowOf: (i) => rows[i]! };
  });
}

/** Where every row of every member starts and is plotted, and the extent of it all. */
export interface Layout {
  readonly base: Float64Array[];
  readonly top: Float64Array[];
  readonly extent: Extent | null;
}

/** Lay the values of the (already lined-up) tables out by `mode`. */
export function layOut(tables: readonly Rows[], mode: StackMode): Layout {
  const members = tables.length,
    n = tables[0]?.count ?? 0;
  const base = tables.map(() => new Float64Array(n)),
    top = tables.map(() => new Float64Array(n));
  let min = Infinity,
    max = -Infinity;
  const note = (v: number) => {
    if (v < min) min = v;
    if (v > max) max = v;
  };
  for (let i = 0; i < n; i++) {
    let total = 0,
      sum = 0;
    if (mode === 'normalize' || mode === 'center') {
      for (let m = 0; m < members; m++) {
        const t = tables[m]!,
          v = t.raw[i * t.stride + 1]!;
        if (Number.isFinite(v)) {
          total += Math.abs(v);
          sum += v;
        }
      }
    }
    const scale = mode === 'normalize' ? (total > 0 ? 1 / total : 0) : 1;
    let pos = 0,
      neg = 0,
      run = mode === 'center' ? (-sum * scale) / 2 : 0;
    for (let m = 0; m < members; m++) {
      const t = tables[m]!,
        v = t.raw[i * t.stride + 1]!;
      if (!Number.isFinite(v)) {
        base[m]![i] = top[m]![i] = NaN;
        continue;
      }
      const w = v * scale;
      let from: number, to: number;
      if (mode === 'group') {
        from = 0;
        to = v;
      } else if (mode === 'center') {
        from = run;
        to = run + w;
        run = to;
      } else if (w >= 0) {
        from = pos;
        to = pos + w;
        pos = to;
      } else {
        from = neg;
        to = neg + w;
        neg = to;
      }
      base[m]![i] = from;
      top[m]![i] = to;
      note(from);
      note(to);
    }
  }
  return { base, top, extent: min <= max ? { min, max } : null };
}

export class Stack extends ChartElement<Plane, DomainSeries[], StackAttributes> implements SeriesGroup {
  /** The series in the stack, in the order they stack. */
  get members(): readonly DomainSeries[] {
    return [...this].filter((c): c is DomainSeries => c instanceof DomainSeries);
  }

  /** Engine protocol, called by the plane in place of each member's own `load`: read them all, lay them out, report the extents. */
  load(estimate: Size): void {
    const members = this.members.filter((m) => m.shown); // a member that is not shown leaves the stack: the rest close up
    if (members.length === 0) return;
    const { domainAxis, valueAxis } = members[0]!;
    for (const m of members)
      if (m.domainAxis !== domainAxis || m.valueAxis !== valueAxis)
        fail('the series of a stack have to share their domain axis and their value axis');
    const own = members.map((m) => m.prepare(estimate));
    const how = this.attrs.align ?? 'strict';
    let tables: readonly Rows[] = own,
      made: Rows[] | null = null;
    if (!own.every((t) => sameDomain(own[0]!, t))) {
      if (how === 'strict')
        fail(
          "the series of a stack have to share their domain values: give the stack `align: 'gaps'` (bars) or `align: 'interpolate'` (lines, areas) to merge them",
        );
      tables = made = alignRows(own, how);
    }
    const mode = this.attrs.mode ?? 'stack',
      layout = layOut(tables, mode);
    members.forEach((m, index) => {
      m.join(
        {
          base: layout.base[index]!,
          top: layout.top[index]!,
          additive: mode !== 'normalize',
          extent: layout.extent,
          slot: mode === 'group' ? { index, count: members.length } : { index: 0, count: 1 },
        },
        made ? made[index]! : null,
      );
      m.settle(layout.extent);
    });
  }
}

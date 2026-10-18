/**
 * Slice: a window of rows of a source, as a data transform.
 *
 * `new Series(new Slice({ last: 300 }, source), ...)` draws the final 300 points. Move the window by changing its
 * attributes (`setAttribute('end', n)`): the version rises, so the series refills, and everything beneath is untouched.
 * It sits before a `Decimator` when both are wanted. The extents it reports are those of the rows kept, so axes fit
 * the window and not the whole of the data.
 *
 * Directly on a source (or on another `Slice`) it reads only its window, so moving it over a long source costs what the
 * window costs. Over a transform it has to ask for every row the transform makes and keep some.
 */
/* oxlint-disable typescript/no-non-null-assertion -- stride-addressed rows of a flat buffer: every index is bounded by the row count */
import { type AttrTypesFor, BOOLEAN, NUMBER } from './attrs.ts';
import { type DataNode, DataSource, DataTransform, distinct, type FillPlan, NO_POINTS, type PlanContext, rowRange } from './data.ts';
import { KeyedTransform, type Partition, type PartitionedPlan, rawPlan } from './partition.ts';
import { type BaseAttributes, ChartElement, fail } from './element.ts';
import type { Extent } from './geometry.ts';

/** Which rows to keep, by the rules of `Array.prototype.slice`: a negative `start` or `end` counts from the end. */
export interface SliceAttributes extends BaseAttributes {
  /** The first row kept. Default 0. */
  start?: number;
  /** One past the last row kept. Default all. */
  end?: number;
  /** Keep this many rows ending at `end`, instead of from `start`. */
  last?: number;
  /**
   * In a `SeriesGroup`: window the rows of each series on their own (the default), or, when false, the rows of the data as a
   * whole, as they stand before they are split by key. `last: 300` is then the last 300 rows of the data, which is a few of
   * each series. It has to sit directly on the source to do that. Outside a group it makes no difference.
   */
  keyed?: boolean;
}

const BASE = ['domain', 'value'];

export class Slice extends KeyedTransform<SliceAttributes, [source: DataNode]> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    start: NUMBER,
    end: NUMBER,
    last: NUMBER,
    keyed: BOOLEAN,
  } satisfies AttrTypesFor<SliceAttributes>;

  #version = 0;
  #scratch = new Float64Array(0);
  #cache: { key: string; first: number; count: number; extents: readonly Extent[]; rowOf?: (index: number) => number } | null = null;

  get source(): DataNode {
    return this.child(0, DataSource, DataTransform);
  }
  override get channelNames(): readonly string[] {
    return this.source.channelNames ?? [];
  }
  /** Anything beneath bubbles an invalidation up through here, so one counter covers the source and the attributes. */
  override invalidate(): void {
    this.#version++;
    super.invalidate();
  }
  get version(): number {
    return this.#version;
  }
  get pointCount(): number {
    return this.#rows(BASE).count;
  }
  domain(): Extent | null {
    const e = this.#rows(BASE).extents[0]!;
    return e.min <= e.max ? e : null;
  }
  valueExtent(): Extent | null {
    const e = this.#rows(BASE).extents[1]!;
    return e.min <= e.max ? e : null;
  }
  channelExtent(name: string): Extent | null {
    const i = this.channelNames.indexOf(name);
    if (i < 0) return null;
    // Asked with the domain, as the rows of the sorted source are, so the window is the same as everything else's.
    const columns = distinct(['domain', name]),
      e = this.#rows(columns).extents[columns.indexOf(name)]!;
    return e.min <= e.max ? e : null;
  }

  /**
   * When what is beneath can write just some of its rows (a source can), so does this: it asks for the window and nothing else,
   * and says how big the window is, so what reads it makes room for that and no more. Beneath a transform (the rows of a
   * decimator are the decimated ones) it has to fill every row and keep some.
   */
  plan(context: PlanContext): FillPlan {
    const inner = this.source.plan(context);
    const stride = context.columns.length;
    if (inner.rows !== undefined) {
      const [first, end] = this.#bounds(inner.rows),
        kept = end - first;
      return {
        capacity: kept,
        rows: kept,
        fill: (out, from, to) => {
          const [lo, hi] = rowRange(kept, from, to);
          return inner.fill(out, first + lo, first + hi);
        },
      };
    }
    return {
      capacity: inner.capacity,
      fill: (out) => {
        const r = this.#fillRows(inner, stride, context.columns, context);
        out.set(this.#scratch.subarray(stride * r.first, stride * (r.first + r.count)));
        const { rowOf } = r;
        return { count: r.count, extents: r.extents, rowOf: rowOf && ((i) => rowOf(r.first + i)) };
      },
    };
  }

  /** The rows kept of `n`, by the rules of `Array.prototype.slice`. */
  #bounds(n: number): [first: number, end: number] {
    const a = this.attrs;
    const norm = (v: number | undefined, dflt: number) => {
      if (v === undefined) return dflt;
      const i = Math.trunc(v);
      return Math.min(n, Math.max(0, i < 0 ? n + i : i));
    };
    const end = norm(a.end, n);
    const first = a.last !== undefined ? Math.max(0, end - Math.max(0, Math.trunc(a.last))) : norm(a.start, 0);
    return [first, Math.max(first, end)];
  }

  override keyStage(partition: Partition, slot: number): DataNode | null {
    return this.attrs.keyed === false ? null : super.keyStage(partition, slot);
  }
  /** In a group with `keyed` false, the window is of the rows of the data as a whole and each key gets the part of it that is its own. */
  override planPartitioned(context: PlanContext, partition: Partition): PartitionedPlan {
    if (this.attrs.keyed !== false) return super.planPartitioned(context, partition);
    if (!(this.source instanceof DataSource))
      fail('a Slice with keyed set to false has to sit directly on the source, which is what it windows');
    return rawPlan(partition, context, this.#bounds(partition.view.count));
  }

  /** The kept rows of the whole source, with the extents of those rows: cached against the version and the channels asked for. */
  #rows(columns: readonly string[]): { count: number; extents: readonly Extent[] } {
    const source = this.source;
    const context: PlanContext = { width: 1, height: 1, domainRange: source.domain() ?? NO_POINTS, sorted: true, columns };
    return this.#fillRows(source.plan(context), columns.length, columns, context);
  }

  #fillRows(inner: FillPlan, stride: number, columns: readonly string[], context: PlanContext) {
    // What is beneath may answer differently to a different width or range (a decimator, a function sampled over the view), so
    // the cache is of one request, not of the data: the metadata asks with a width of 1, the plan with the real one.
    const { width, domainRange } = context;
    const key = `${this.source.version}.${this.#version}|${stride}|${columns.join()}|${width}|${domainRange.min}|${domainRange.max}`;
    if (this.#cache?.key === key) return this.#cache;
    if (inner.rows !== undefined) {
      const [from, to] = this.#bounds(inner.rows);
      if (this.#scratch.length < (to - from) * stride) this.#scratch = new Float64Array((to - from) * stride);
      const r = inner.fill(this.#scratch, from, to);
      return (this.#cache = { key, first: 0, count: r.count, extents: r.extents });
    }
    if (this.#scratch.length < inner.capacity * stride) this.#scratch = new Float64Array(inner.capacity * stride);
    const filled = inner.fill(this.#scratch);
    const n = filled.count;
    const [first, end] = this.#bounds(n);
    const count = end - first;
    const extents: Extent[] = [];
    for (let c = 0; c < stride; c++) {
      let min = Infinity,
        max = -Infinity;
      for (let i = first; i < first + count; i++) {
        const v = this.#scratch[i * stride + c]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      extents.push(min <= max ? { min, max } : NO_POINTS);
    }
    return (this.#cache = { key, first, count, extents, rowOf: filled.rowOf });
  }
}

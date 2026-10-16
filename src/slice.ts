/**
 * Slice: a window of rows of a source, as a data transform.
 *
 * `new Series(new Slice({ last: 300 }, source), ...)` draws the final 300 points. Move the window by changing its
 * attributes (`setAttribute('end', n)`): the version rises, so the series refills, and everything beneath is untouched.
 * It sits before a `Decimator` when both are wanted. The extents it reports are those of the rows kept, so axes fit
 * the window and not the whole of the data.
 */
/* oxlint-disable typescript/no-non-null-assertion -- stride-addressed rows of a flat buffer: every index is bounded by the row count */
import { type AttrTypesFor, NUMBER } from './attrs.ts';
import { type DataNode, DataSource, DataTransform, type FillPlan, NO_POINTS, type PlanContext } from './data.ts';
import { type BaseAttributes, ChartElement } from './element.ts';
import type { Extent } from './geometry.ts';

/** Which rows to keep, by the rules of `Array.prototype.slice`: a negative `start` or `end` counts from the end. */
export interface SliceAttributes extends BaseAttributes {
  /** The first row kept. Default 0. */
  start?: number;
  /** One past the last row kept. Default all. */
  end?: number;
  /** Keep this many rows ending at `end`, instead of from `start`. */
  last?: number;
}

export class Slice extends DataTransform<SliceAttributes, [source: DataNode]> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    start: NUMBER,
    end: NUMBER,
    last: NUMBER,
  } satisfies AttrTypesFor<SliceAttributes>;

  #version = 0;
  #scratch = new Float64Array(0);
  #cache: { key: string; first: number; count: number; extents: readonly Extent[] } | null = null;

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
    return this.#rows([]).count;
  }
  domain(): Extent | null {
    const e = this.#rows([]).extents[0]!;
    return e.min <= e.max ? e : null;
  }
  valueExtent(): Extent | null {
    const e = this.#rows([]).extents[1]!;
    return e.min <= e.max ? e : null;
  }
  channelExtent(name: string): Extent | null {
    const i = this.channelNames.indexOf(name);
    if (i < 0) return null;
    const e = this.#rows([name]).extents[2]!;
    return e.min <= e.max ? e : null;
  }

  plan(context: PlanContext): FillPlan {
    const inner = this.source.plan(context);
    const stride = 2 + context.channels.length;
    return {
      capacity: inner.capacity,
      fill: (out) => {
        const r = this.#fillRows(inner, stride, context.channels);
        out.set(this.#scratch.subarray(stride * r.first, stride * (r.first + r.count)));
        return { count: r.count, extents: r.extents };
      },
    };
  }

  /** The kept rows of the whole source, with the extents of those rows: cached against the version and the channels asked for. */
  #rows(channels: readonly string[]): { count: number; extents: readonly Extent[] } {
    const source = this.source;
    const context: PlanContext = { width: 1, height: 1, domainRange: source.domain() ?? NO_POINTS, channels };
    return this.#fillRows(source.plan(context), 2 + channels.length, channels);
  }

  #fillRows(inner: FillPlan, stride: number, channels: readonly string[]) {
    const key = `${this.source.version}.${this.#version}|${stride}|${channels.join()}`;
    if (this.#cache?.key === key) return this.#cache;
    if (this.#scratch.length < inner.capacity * stride) this.#scratch = new Float64Array(inner.capacity * stride);
    const n = inner.fill(this.#scratch).count;
    const a = this.attrs;
    const norm = (v: number | undefined, dflt: number) => {
      if (v === undefined) return dflt;
      const i = Math.trunc(v);
      return Math.min(n, Math.max(0, i < 0 ? n + i : i));
    };
    const end = norm(a.end, n);
    const first = a.last !== undefined ? Math.max(0, end - Math.max(0, Math.trunc(a.last))) : norm(a.start, 0);
    const count = Math.max(0, end - first);
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
    return (this.#cache = { key, first, count, extents });
  }
}

/** The data sources: rows of objects, flat typed arrays, generated points and separate columns. The contract and the base class are in data.ts. */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import { type AttrTypesFor, AUTO, NUMBER } from './attrs.ts';
import { DataSource, type DataSourceAttributes, type FillPlan, type FillResult, NO_POINTS, type PlanContext, type PointView, endsOf, num } from './data.ts';
import { fail } from './element.ts';
import type { Extent } from './geometry.ts';

/* oxlint-disable typescript/consistent-type-assertions -- rows are user data of unknown shape (`Row = any`), read by a field or channel name that the attribute types vouch for */

/** A row's number, by property name or by function. A function also gets the index, which is how a domain can be derived. */
export type Field<Row> = (keyof Row & (string | number)) | ((row: Row, index: number) => number);

export interface ObjectDataSourceAttributes<Row, Channel extends string = string> extends DataSourceAttributes {
  source: readonly Row[];
  /** Where each row is along the domain. Leave it out and it is the row's index: 0, 1, 2 ... in order. */
  domain?: Field<Row>;
  value: Field<Row>;
  /** Extra columns that bindings can address by name: a size, a colour, a category, the x of an XY plot. */
  channels?: Readonly<Record<Channel, Field<Row>>>;
}
/** Rows as objects. Convenient and not the fastest: reading goes through the field accessors, so the numbers are loaded into the managed buffer once per change. */
// oxlint-disable-next-line typescript/no-explicit-any -- the default row type: untyped rows (from JSON, or JSX/React where no type argument can be written) must be accepted, and `unknown` would reject every field accessor
export class ObjectDataSource<Row = any, Channel extends string = string> extends DataSource<ObjectDataSourceAttributes<Row, Channel>, Channel> {
  // oxlint-disable-next-line eslint/no-useless-constructor -- makes the attributes required (the base class accepts none)
  constructor(attrs: ObjectDataSourceAttributes<Row, Channel>) { super(attrs); }

  /** Without a domain the rows are numbered in order, which is ascending by construction. */
  protected override get ordered(): boolean { return this.attrs.domain === undefined || this.attrs.isSorted === true; }

  get pointCount(): number { return this.attrs.source.length; }
  override get channelNames(): readonly string[] { return Object.keys(this.attrs.channels ?? {}); }

  protected scanDomain(): Extent | null {
    const { source, domain } = this.attrs;
    const n = source.length;
    if (domain === undefined) return n > 0 ? { min: 0, max: n - 1 } : null;
    const read = typeof domain === 'function' ? domain : (row: Row) => num((row as Record<string | number, unknown>)[domain]);
    return endsOf(n, (i) => read(source[i]!, i));
  }

  /** Rows are not numbers in an array, so reading them in place means loading them once into the managed buffer. */
  protected override orderedView(): PointView { return this.managedView(); }

  protected fill(out: Float64Array, context: PlanContext): FillResult {
    const { source, domain, value, channels } = this.attrs;
    const xFn = typeof domain === 'function' ? domain : null;
    const yFn = typeof value === 'function' ? value : null;
    const names = context.channels, k = names.length, stride = 2 + k;
    const cFns = names.map((name) => {
      const f = (channels as Readonly<Record<string, Field<Row>>> | undefined)?.[name] ?? fail(`the data has no channel "${name}"`);
      return typeof f === 'function' ? f : (row: Row) => num((row as Record<string | number, unknown>)[f]);
    });
    const cMin = new Float64Array(k).fill(Infinity), cMax = new Float64Array(k).fill(-Infinity);
    const n = source.length;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const row = source[i]!;
      const x = xFn ? xFn(row, i) : domain === undefined ? i : num((row as Record<string | number, unknown>)[domain as string]);
      const y = yFn ? yFn(row, i) : num((row as Record<string | number, unknown>)[value as string]);
      out[stride * i] = x;
      out[stride * i + 1] = y;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      for (let c = 0; c < k; c++) {
        const v = cFns[c]!(row, i);
        out[stride * i + 2 + c] = v;
        if (v < cMin[c]!) cMin[c] = v;
        if (v > cMax[c]!) cMax[c] = v;
      }
    }
    const extents: Extent[] = [{ min: xMin, max: xMax }, { min: yMin, max: yMax }];
    for (let c = 0; c < k; c++) extents.push({ min: cMin[c]!, max: cMax[c]! });
    return { count: n, extents };
  }
}

export interface FlatDataSourceAttributes<Channel extends string = string> extends DataSourceAttributes {
  /** Float64Array, Float32Array, or any numeric array. Read in place; never copied. */
  data: ArrayLike<number>;
  /** Numbers per point. Default 2 (x, y pairs), or 1 when `regularDomain` is set. */
  stride?: number;
  /** Where the domain and the value sit within a point's `stride` numbers. Default 0 and 1 (0 when there is no stored domain). */
  domainOffset?: number;
  /** Where the value sits within a point's `stride` numbers. Default 1 (0 when there is no stored domain). */
  valueOffset?: number;
  /** Number of points. Default: `data.length / stride`. */
  count?: number;
  /** Evenly spaced domain with no stored x values: a y-only array. */
  regularDomain?: { start: number; step: number };
  /** Extra columns that bindings can address by name, as offsets within a point's `stride` numbers. */
  channels?: Readonly<Record<Channel, number>>;
}
/** Numbers in a typed array (or any numeric array), read where they are: the fast path for large data. */
export class FlatDataSource<Channel extends string = string> extends DataSource<FlatDataSourceAttributes<Channel>, Channel> {
  static override attrTypes = { ...DataSource.attrTypes, domainOffset: NUMBER, regularDomain: AUTO, valueOffset: NUMBER } satisfies Partial<AttrTypesFor<FlatDataSourceAttributes>>;
  // oxlint-disable-next-line eslint/no-useless-constructor -- makes the attributes required (the base class accepts none)
  constructor(attrs: FlatDataSourceAttributes<Channel>) { super(attrs); }

  private get stride(): number { return this.attrs.stride ?? (this.attrs.regularDomain ? 1 : 2); }
  get pointCount(): number { return this.attrs.count ?? Math.floor(this.attrs.data.length / this.stride); }
  override get channelNames(): readonly string[] { return Object.keys(this.attrs.channels ?? {}); }
  /** A regular domain ascends by construction (if its step is positive); anything else says so with `isSorted`. */
  protected override get ordered(): boolean {
    const r = this.attrs.regularDomain;
    return r ? r.step > 0 : this.attrs.isSorted === true;
  }

  protected override orderedView(): PointView {
    const a = this.attrs, r = a.regularDomain;
    return {
      data: a.data,
      count: this.pointCount,
      stride: this.stride,
      domainOffset: a.domainOffset ?? 0,
      valueOffset: a.valueOffset ?? (r ? 0 : 1),
      regularDomain: r ?? null,
    };
  }

  protected scanDomain(): Extent | null {
    const { data, regularDomain: r, domainOffset = 0 } = this.attrs;
    const n = this.pointCount;
    if (n === 0) return null;
    if (r) return { min: r.start, max: r.start + r.step * (n - 1) };
    const stride = this.stride;
    return endsOf(n, (i) => data[i * stride + domainOffset]!);
  }

  protected fill(out: Float64Array, context: PlanContext): FillResult {
    const { data, regularDomain: r, domainOffset = 0, channels } = this.attrs;
    const stride = this.stride, n = this.pointCount;
    const valueOffset = this.attrs.valueOffset ?? (r ? 0 : 1);
    const names = context.channels, k = names.length, os = 2 + k;
    const offsets = names.map((name) => (channels as Readonly<Record<string, number>> | undefined)?.[name] ?? fail(`the data has no channel "${name}"`));
    const cMin = new Float64Array(k).fill(Infinity), cMax = new Float64Array(k).fill(-Infinity);
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0, j = 0; i < n; i++, j += stride) {
      const x = r ? r.start + r.step * i : data[j + domainOffset]!;
      const y = data[j + valueOffset]!;
      out[os * i] = x;
      out[os * i + 1] = y;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      for (let c = 0; c < k; c++) {
        const v = data[j + offsets[c]!]!;
        out[os * i + 2 + c] = v;
        if (v < cMin[c]!) cMin[c] = v;
        if (v > cMax[c]!) cMax[c] = v;
      }
    }
    if (n === 0) return { count: 0, extents: [NO_POINTS, NO_POINTS, ...names.map(() => NO_POINTS)] };
    const extents: Extent[] = [{ min: xMin, max: xMax }, { min: yMin, max: yMax }];
    for (let c = 0; c < k; c++) extents.push({ min: cMin[c]!, max: cMax[c]! });
    return { count: n, extents };
  }
}

// ─── Generated and column-wise sources ───

/** Samples when nothing says how many: the plot's width is not known when a source is only asked for its extent. */
const DEFAULT_SAMPLES = 512;

export interface SyntheticDataSourceAttributes extends DataSourceAttributes {
  /** Value at a domain position. NaN is a gap. */
  fn: (x: number) => number;
  /** The span the function is defined over: the data's whole domain. */
  domain: Extent;
  /**
   * Number of samples, evenly spaced across the domain, always. Leave it out and the source samples as finely as the
   * plot needs: one per pixel of width across the part of the domain in view, so zooming in stays smooth and zooming
   * out never draws more than the screen can show.
   */
  count?: number;
}
/**
 * A function of the domain, sampled when drawn. There is no storage, so points are made up, not rows: they carry no
 * `rowOf` and cannot be edited. Samples ascend by construction. It offers no channels.
 */
export class SyntheticDataSource extends DataSource<SyntheticDataSourceAttributes> {
  // oxlint-disable-next-line eslint/no-useless-constructor -- makes the attributes required (the base class accepts none)
  constructor(attrs: SyntheticDataSourceAttributes) { super(attrs); }

  protected override get ordered(): boolean { return true; }
  get pointCount(): number { return this.attrs.count ?? DEFAULT_SAMPLES; }

  protected scanDomain(): Extent | null {
    const d = this.attrs.domain;
    return d.min <= d.max ? d : null;
  }

  /** How many samples, over which part of the domain, for this plot. */
  private span(context: PlanContext): { lo: number; hi: number; n: number } {
    const d = this.attrs.domain, lo = Math.max(d.min, context.domainRange.min), hi = Math.min(d.max, context.domainRange.max);
    if (!(lo <= hi)) return { lo, hi, n: 0 };
    return { lo, hi, n: this.attrs.count ?? (context.width > 0 ? Math.max(2, Math.ceil(context.width)) : DEFAULT_SAMPLES) };
  }

  protected fill(out: Float64Array, context: PlanContext): FillResult {
    if (context.channels.length) fail(`the data has no channel "${context.channels[0]}"`);
    // With a fixed count the span is the whole domain whatever is in view; otherwise only the part in view is sampled.
    const { fn, domain, count } = this.attrs;
    const { lo, hi, n } = count === undefined ? this.span(context) : { lo: domain.min, hi: domain.max, n: count };
    if (n === 0) return { count: 0, extents: [NO_POINTS, NO_POINTS] };
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? lo : i === n - 1 ? hi : lo + ((hi - lo) * i) / (n - 1), y = fn(x);
      out[2 * i] = x;
      out[2 * i + 1] = y;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    return { count: n, extents: [{ min: lo, max: hi }, yMin <= yMax ? { min: yMin, max: yMax } : NO_POINTS] };
  }

  /** Room for the samples this plot asks for, which depends on its width; the points are made up, so there is no `rowOf`. */
  override plan(context: PlanContext): FillPlan {
    if (this.attrs.wrap !== undefined) return super.plan(context);
    return { capacity: this.attrs.count ?? this.span(context).n, fill: (out) => this.fill(out, context) };
  }
}

/** A named column in a composite source: an array (typed or plain), or a function of the row index. */
export type Column = ArrayLike<number> | ((index: number) => number);
export interface CompositeDataSourceAttributes<Channel extends string = string> extends DataSourceAttributes {
  count: number;
  /** Where each row is along the domain: for a made-up domain, `(i) => start + step * i`. */
  domain: Column;
  value: Column;
  /** Extra columns that bindings and tooltips can address by name. */
  channels?: Readonly<Record<Channel, Column>>;
}
const reader = (c: Column): ((i: number) => number) => (typeof c === 'function' ? c : (i) => c[i]!);

/**
 * Each column kept by itself: the shape of column-oriented data (an `x` array and a `y` array, a table by column), and of
 * data whose domain is made up, with any column a function of the row index. Nothing is copied from arrays that are
 * already in order (`isSorted`); otherwise the columns are gathered into the managed buffer once per change.
 */
export class CompositeDataSource<Channel extends string = string> extends DataSource<CompositeDataSourceAttributes<Channel>, Channel> {
  // oxlint-disable-next-line eslint/no-useless-constructor -- makes the attributes required (the base class accepts none)
  constructor(attrs: CompositeDataSourceAttributes<Channel>) { super(attrs); }

  get pointCount(): number { return this.attrs.count; }
  override get channelNames(): readonly string[] { return Object.keys(this.attrs.channels ?? {}); }

  protected scanDomain(): Extent | null {
    const at = reader(this.attrs.domain);
    return endsOf(this.attrs.count, at);
  }

  protected fill(out: Float64Array, context: PlanContext): FillResult {
    const { count: n, channels } = this.attrs;
    const xAt = reader(this.attrs.domain), yAt = reader(this.attrs.value);
    const names = context.channels, k = names.length, stride = 2 + k;
    const cAt = names.map((name) => reader((channels as Readonly<Record<string, Column>> | undefined)?.[name] ?? fail(`the data has no channel "${name}"`)));
    const cMin = new Float64Array(k).fill(Infinity), cMax = new Float64Array(k).fill(-Infinity);
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = num(xAt(i)), y = num(yAt(i));
      out[stride * i] = x;
      out[stride * i + 1] = y;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      for (let c = 0; c < k; c++) {
        const v = num(cAt[c]!(i));
        out[stride * i + 2 + c] = v;
        if (v < cMin[c]!) cMin[c] = v;
        if (v > cMax[c]!) cMax[c] = v;
      }
    }
    const ext = (min: number, max: number): Extent => (min <= max ? { min, max } : NO_POINTS);
    const extents: Extent[] = [ext(xMin, xMax), ext(yMin, yMax)];
    for (let c = 0; c < k; c++) extents.push(ext(cMin[c]!, cMax[c]!));
    return { count: n, extents };
  }
}

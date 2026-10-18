/**
 * Data as a table, outside any chart: `readTable(node)` reads a source or a transform into columns.
 *
 *   const t = readTable(boxStats);                      // domain, value, then every channel it offers
 *   t.rows();                                           // [{ domain: 0, value: 5, min: 1, q1: 3, … }, …]
 *   readTable(trend, { domain: { min: 0, max: 10 }, samples: 11 });   // a trendline or function, sampled where you say
 *
 * A source or transform is a function of nothing but its own attributes, so it needs no chart and no platform: the
 * table is what a series of it would be given to draw, in the same order (ascending in the domain), before any scale,
 * pixel or decimation. For data that is made up rather than stored (a `SyntheticDataSource`, a trendline) the rows are
 * wherever you ask: `domain` is the span to cover and `samples` how many evenly spaced points. A `Decimator` is a
 * transform like any other and reads as its thinned output, so read its source to get all the rows.
 */
import type { DataNode, FillPlan, PlanContext } from './data.ts';
import type { Extent } from './geometry.ts';

export interface TableOptions {
  /** The channels to read, after the domain and the value. Default: every one the node offers (`channelNames`). */
  channels?: readonly string[];
  /** The part of the domain to read. Default: all of it (the node's own `domain()`). For generated data (a function, a trendline) it is the span sampled. */
  domain?: Extent;
  /** For generated data: how many evenly spaced points to make across the span (default: the node's own count, else 512). For a `Decimator`: the width in pixels it reduces to. */
  samples?: number;
  /** What to call the first two columns. Default `domain` and `value`. */
  names?: { domain?: string; value?: string };
}

/** Columns of numbers, all `count` long. NaN is a gap. */
export interface Table {
  readonly columns: readonly string[];
  readonly count: number;
  /** One typed array for each of `columns`, in that order. */
  readonly data: readonly Float64Array[];
  column(name: string): Float64Array;
  /** One object for each row, keyed by column name. */
  rows(): Record<string, number>[];
}

export function readTable(node: DataNode, options: TableOptions = {}): Table {
  const channels = options.channels ?? (node.channelNames ?? []).filter((n) => n !== 'domain' && n !== 'value');
  const context: PlanContext = {
    width: options.samples ?? 0,
    height: 0,
    // A stage that reduces to a width (a decimator) cannot spread columns over an infinite range: it needs the span of the data.
    domainRange: options.domain ?? node.domain() ?? { min: -Infinity, max: Infinity },
    sorted: true,
    columns: ['domain', 'value', ...channels],
  };
  const plan: FillPlan = node.plan(context),
    stride = context.columns.length;
  const buffer = new Float64Array(plan.capacity * stride),
    { count } = plan.fill(buffer);
  const columns = [options.names?.domain ?? 'domain', options.names?.value ?? 'value', ...channels];
  const data = columns.map((_, c) => {
    const out = new Float64Array(count);
    // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
    for (let i = 0, j = c; i < count; i++, j += stride) out[i] = buffer[j]!;
    return out;
  });
  return {
    columns,
    count,
    data,
    column(name) {
      const at = columns.indexOf(name);
      if (at < 0) throw new Error(`readTable: no column "${name}" (have ${columns.join(', ')})`);
      // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
      return data[at]!;
    },
    rows() {
      const rows: Record<string, number>[] = [];
      for (let i = 0; i < count; i++) {
        const row: Record<string, number> = {};
        // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
        for (let c = 0; c < columns.length; c++) row[columns[c]!] = data[c]![i]!;
        rows.push(row);
      }
      return rows;
    },
  };
}

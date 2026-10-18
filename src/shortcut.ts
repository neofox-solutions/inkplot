/** The parts the chart shortcuts (`lineChart`, `barChart`, `pieChart`) share: what they take and how they read a series. */
import type { ChartAttributes, ChartChildren } from './chart.ts';
import type { DataNode } from './data.ts';
import { ChartElement } from './element.ts';

/** What every chart shortcut takes besides the chart's own attributes. */
export interface ChartShortcutOptions extends ChartAttributes {
  /** More children for the chart, after the plane: `[new Legend({}), new ChartTitle({ text: 'Rainfall' })]`. */
  extras?: ChartChildren;
}

/** One series of a chart shortcut: its data, or the data with a name (which the legend shows) and a colour. */
export type SeriesInput = DataNode | { source: DataNode; name?: string; color?: string };

/** The pieces of a `SeriesInput`, whichever form it was given in. */
export function seriesParts(input: SeriesInput): { source: DataNode; name?: string; color?: string } {
  // Not `'source' in input`: a transform (a Slice, a Decimator, a trendline) has a `source` of its own, and is data, not a spec.
  return input instanceof ChartElement ? { source: input } : input;
}

/** A data source is an element and a spec is a plain object, so a list is told apart by being an array. */
export function isMany<T>(value: T | readonly T[]): value is readonly T[] {
  return Array.isArray(value);
}

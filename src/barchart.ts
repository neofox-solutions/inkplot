/**
 * A bar chart in one call: `barChart`, with stacking and a swap of the axes as options. Like the other chart shortcuts (see simple.ts) it only
 * composes public classes and a bundle that never calls it carries none of it.
 */
import { Axis, type AxisAttributes } from './axis.ts';
import { BarPath } from './bars.ts';
import { Chart } from './chart.ts';
import { CartesianPlane } from './plane.ts';
import type { Scale } from './scale.ts';
import { BandScale, LinearScale } from './scales.ts';
import { DomainSeries } from './series.ts';
import { type ChartShortcutOptions, type SeriesInput, isMany, seriesParts } from './shortcut.ts';
import { Stack, type StackMode } from './stack.ts';

export interface BarChartOptions extends ChartShortcutOptions {
  /** The label of each bar, or group of bars: one for each row of the data. Unless `domainScale` is given. */
  categories?: readonly string[];
  /**
   * How several series sit together: 'group' (side by side, the default), 'stack' (one on another), 'normalize' (stacked to 100%) or
   * 'center' (stacked about a middle line). A single series ignores it.
   */
  stack?: StackMode;
  /** Bars that run sideways: the categories go up the left and the values along the bottom. Default false. */
  horizontal?: boolean;
  /** The fraction of each band left empty between neighbours, 0..1. Default 0.2. */
  gap?: number;
  /** Attributes of the axis the categories run along (a `title`, …). */
  domainAxis?: AxisAttributes;
  /** Attributes of the axis the bars' length is read on. */
  valueAxis?: AxisAttributes;
  /** Replaces the band scale of the categories, for bars at positions on a continuous scale (a time axis). */
  domainScale?: Scale;
  valueScale?: Scale;
}

/** A bar chart: one bar for each category per series (a source, or `{ source, name, color }`). Give `categories`, or a `domainScale`. */
export function barChart(series: SeriesInput | readonly SeriesInput[], options: BarChartOptions): Chart {
  const { categories, stack, horizontal, gap, domainAxis, valueAxis, domainScale, valueScale, extras, ...chartAttributes } = options;
  if (!domainScale && !categories) throw new Error('barChart: give the `categories` (one label for each bar), or a `domainScale`');
  // No sides given: the plane puts the first axis below and the second beside the plot (mirrored for a chart that reads right to left).
  const d = new Axis(
    { id: 'domain', ...domainAxis },
    domainScale ?? new BandScale({ categories: categories ?? [], ...(gap !== undefined && { gap }) }),
  );
  const v = new Axis({ id: 'value', ...valueAxis }, valueScale ?? new LinearScale());
  const list = isMany(series) ? series : [series];
  const made = list.map((input) => {
    const { source, name, color } = seriesParts(input);
    return new DomainSeries(
      { domainAxis: d, valueAxis: v, ...(name !== undefined && { name }) },
      source,
      new BarPath(color === undefined ? {} : { fill: color }),
    );
  });
  const body = list.length > 1 || stack ? [new Stack({ mode: stack ?? 'group' }, ...made)] : made;
  return new Chart(chartAttributes, new CartesianPlane({}, horizontal ? v : d, horizontal ? d : v, ...body), ...(extras ?? []));
}

/**
 * Shortcuts for the common charts: `lineChart`, `pieChart` (in pie.ts) and `barChart` (in barchart.ts). Each returns a whole `Chart` and only
 * composes the public classes (a plane, two axes, series, a renderer, optionally a decimator and a marker), so everything it does can be
 * done, and tuned, with the elements themselves; a bundle that never calls one carries none of it.
 *
 * Their options are the `Chart`'s own attributes (`theme` is required, as for a `Chart`) plus a few of theirs. What a shortcut leaves
 * out, such as a legend, a title or a cursor, is given in `extras`: the chart's other children, passed as the elements themselves so that the
 * shortcut refers only to what you use. For anything else build the elements.
 */
import { Curve, LinearCurve } from './curve.ts';
import { fail } from './element.ts';
import { Axis, type AxisAttributes } from './axis.ts';
import { Chart } from './chart.ts';
import { CartesianPlane } from './plane.ts';
import { type DecimationKernel, Decimator } from './decimation.ts';
import { LinePath, type SeriesRenderer } from './renderer.ts';
import type { Scale } from './scale.ts';
import { LinearScale } from './scales.ts';
import { DomainSeries } from './series.ts';
import { type ChartShortcutOptions, type SeriesInput, isMany, seriesParts } from './shortcut.ts';

/** The choices a quick line chart needs, besides the chart's own attributes. */
export interface LineChartOptions extends ChartShortcutOptions {
  /** The line's colour. Default: each series takes the next colour of the theme's palette (a series' own `color` wins). */
  stroke?: string;
  strokeWidth?: number;
  /** Attributes of the horizontal axis (a `title`, a `min`, a `max`, …). */
  domainAxis?: AxisAttributes;
  /** Attributes of the vertical axis. */
  valueAxis?: AxisAttributes;
  /** The horizontal axis' scale. Default `new LinearScale()`: a time axis is `new IntlTimeScale()`. */
  domainScale?: Scale;
  /** The vertical axis' scale. Default `new LinearScale()`. */
  valueScale?: Scale;
  /** Draw a marker of this class at every point: `CircleMarker`. The class, not an instance, so only what you name is bundled. */
  marker?: new (attrs: { stroke?: string }) => SeriesRenderer;
  /** The markers' stroke. Default the line's colour. */
  markerStroke?: string;
  /** Wrap each source in a decimator with a kernel of this class: `MinMaxKernel`, `M4Kernel`. */
  decimate?: new () => DecimationKernel;
  /**
   * How the points are joined: a curve of any kind. Give a function that makes one, `() => new MonotoneCurve()`, so every line has its own
   * (a curve is an element, and an element has one parent); a curve itself will do for a single line. Default straight lines.
   */
  curve?: Curve | (() => Curve);
}

/**
 * A line chart in one call: one line per series (a source, or `{ source, name, color }`), on a plane with the horizontal axis below and the vertical one beside it (on the left, or on the right in a chart that reads right to left).
 * The options are applied to every series.
 */
export function lineChart(series: SeriesInput | readonly SeriesInput[], options: LineChartOptions): Chart {
  const {
    stroke,
    strokeWidth,
    domainAxis,
    valueAxis,
    domainScale,
    valueScale,
    marker,
    markerStroke,
    decimate,
    curve,
    extras,
    ...chartAttributes
  } = options;
  const x = new Axis({ id: 'domain', ...domainAxis }, domainScale ?? new LinearScale());
  const y = new Axis({ id: 'value', ...valueAxis }, valueScale ?? new LinearScale());
  const list = isMany(series) ? series : [series];
  if (curve instanceof Curve && list.length > 1) fail(215);
  const made = list.map((input) => {
    const { source, name, color } = seriesParts(input);
    const colour = color ?? stroke;
    const line = new LinePath(
      { ...(colour !== undefined && { stroke: colour }), ...(strokeWidth !== undefined && { strokeWidth }) },
      typeof curve === 'function' ? curve() : (curve ?? new LinearCurve()),
    );
    const data = decimate ? new Decimator({}, new decimate(), source) : source;
    const mark = markerStroke ?? colour;
    const attrs = { domainAxis: x, valueAxis: y, ...(name !== undefined && { name }) };
    return marker
      ? new DomainSeries(attrs, data, line, new marker(mark === undefined ? {} : { stroke: mark }))
      : new DomainSeries(attrs, data, line);
  });
  return new Chart(chartAttributes, new CartesianPlane({}, x, y, ...made), ...(extras ?? []));
}

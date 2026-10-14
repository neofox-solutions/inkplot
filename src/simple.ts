/**
 * Shortcuts for the common cases. These only compose the public classes (a series, a renderer, optionally a decimator and a
 * marker), so everything they do can be done, and tuned, with the elements themselves.
 */
import { type Curve, LinearCurve } from './curve.ts';
import type { Axis } from './axis.ts';
import type { DataNode } from './data.ts';
import { type DecimationKernel, Decimator } from './decimation.ts';
import type { ElementRef } from './element.ts';
import { LinePath, type SeriesRenderer } from './renderer.ts';
import { DomainSeries, type DomainSeriesAttributes } from './series.ts';

/**
 * The handful of choices a quick line chart needs. A marker and a kernel are given as the classes themselves
 * (`marker: CircleMarker`, `decimate: M4Kernel`), not as names, so that this module only refers to what you pass it: a
 * bundle that never decimates carries no kernel, and one that draws no markers carries no marker. For anything the
 * options do not cover, such as a marker's size or a kernel's settings, build the elements directly.
 */
export interface LineSeriesOptions {
  stroke?: string;
  strokeWidth?: number;
  domainAxis?: ElementRef<Axis>;
  valueAxis?: ElementRef<Axis>;
  /** Draw a marker of this class at every point: `CircleMarker`. */
  marker?: new (attrs: { stroke?: string }) => SeriesRenderer;
  /** The markers' stroke. Default the line's `stroke`, else the series' palette colour. */
  markerStroke?: string;
  /** Wrap the source in a decimator with a kernel of this class: `MinMaxKernel`, `M4Kernel`. */
  decimate?: new () => DecimationKernel;
  /** How the points are joined: a curve of any kind (`new MonotoneCurve()`, `new StepCurve({ mode: 'after' })`). Default straight lines. */
  curve?: Curve;
}
/** A series with a line renderer: the common case in one call. */
export function lineSeries(source: DataNode, options: LineSeriesOptions = {}): DomainSeries {
  const { stroke, strokeWidth, domainAxis, valueAxis, marker, markerStroke, decimate, curve } = options;
  const line = new LinePath(
    { ...(stroke !== undefined && { stroke }), ...(strokeWidth !== undefined && { strokeWidth }) },
    curve ?? new LinearCurve(),
  );
  const attrs: DomainSeriesAttributes = {
    ...(domainAxis !== undefined && { domainAxis }),
    ...(valueAxis !== undefined && { valueAxis }),
  };
  const data = decimate ? new Decimator({}, new decimate(), source) : source;
  const mark = markerStroke ?? stroke;
  return marker
    ? new DomainSeries(attrs, data, line, new marker(mark === undefined ? {} : { stroke: mark }))
    : new DomainSeries(attrs, data, line);
}

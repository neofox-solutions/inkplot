/**
 * A shortcut for a pie or doughnut chart. Like `lineSeries`, it only composes public classes (a polar plane, a normalized
 * stack of one-bar series, and optionally a `PointAnnotations` for each slice), so everything it does can be done, and
 * tuned, with the elements themselves: see the ring-chart recipe. It exists for convenience, not for any ability the
 * elements lack, and a bundle that never calls it carries none of it.
 */
import { Axis } from './axis.ts';
import { BarPath } from './bars.ts';
import { FlatDataSource } from './sources.ts';
import { fail } from './element.ts';
import { PointAnnotations } from './pointannotations.ts';
import { PolarPlane } from './radial.ts';
import { BandScale, LinearScale } from './scales.ts';
import { DomainSeries } from './series.ts';
import { Stack } from './stack.ts';

/** One slice of a pie: its name (shown by the legend), its size, and optionally its colour. */
export interface Slice {
  name: string;
  /** Not negative. The slices are drawn in proportion to their values; a slice of 0 has no area. */
  value: number;
  /** Default: the next colour of the theme's palette. */
  color?: string;
}

export interface PieOptions {
  /** The fraction of the radius left empty in the middle, which makes a doughnut. Default 0. */
  innerRadius?: number;
  /** Radians clockwise from twelve o'clock where the first slice starts. Default 0. */
  startAngle?: number;
  /**
   * The words on a slice, on its rim: a function from the slice and its share of the whole (0 to 1), or `null` or nothing for
   * no label on that slice. Writing the number is yours (the locale, the unit), so nothing here is in one language. The
   * labels sit outside the circle, so the chart needs `padding` for them.
   */
  label?: (slice: Slice, share: number) => string | null | undefined;
}

/**
 * A pie (or, with `innerRadius`, a doughnut) in one call: put it in a `Chart`, with a `Legend` if you want one. It is
 * a `PolarPlane` holding the two hidden axes, a normalized `Stack` of one series per slice, and a `PointAnnotations`
 * for each if there is a `label`.
 */
export function pie(slices: readonly Slice[], options: PieOptions = {}): PolarPlane {
  let total = 0;
  for (const s of slices) {
    if (!(s.value >= 0)) fail(`pie: the value of "${s.name}" must be a number that is not negative, not ${s.value}`);
    total += s.value;
  }
  const { innerRadius, startAngle, label } = options;
  const share = new Axis({ orientation: 'angle', min: 0, max: 1, visible: false }, new LinearScale());
  const ring = new Axis({ orientation: 'radius', visible: false }, new BandScale({ categories: [''] }));
  const parts = slices.map((slice) => ({ slice, bar: new BarPath(slice.color === undefined ? {} : { fill: slice.color }) }));
  const series = parts.map(
    ({ slice, bar }) =>
      new DomainSeries(
        { name: slice.name, domainAxis: ring, valueAxis: share },
        new FlatDataSource({ data: [slice.value], regularDomain: { start: 0, step: 1 } }),
        bar,
      ),
  );
  const notes = label
    ? parts.map(
        ({ slice, bar }) =>
          new PointAnnotations({
            anchor: bar,
            shape: 'text',
            contain: false,
            text: () => label(slice, total > 0 ? slice.value / total : 0),
          }),
      )
    : [];
  return new PolarPlane(
    {
      gridlines: false,
      ...(innerRadius !== undefined && { innerRadius }),
      ...(startAngle !== undefined && { startAngle }),
    },
    share,
    ring,
    new Stack({ mode: 'normalize' }, ...series),
    ...notes,
  );
}

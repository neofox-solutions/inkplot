/**
 * A spoken summary of the chart, for a screen reader: what the chart holds, written out in words.
 *
 *   new Chart({ meta: { title: 'Rates' } }, plane, new ChartSummary())
 *
 * It is a separate, opt-in chart child because the words are language-specific, and the core carries none: leave it out and a
 * chart says only what its `meta` says. This one writes English. For another language, pass `text`, a function from the facts
 * (`ChartFacts`) to the sentence, and `roleDescription` (what the chart is called, "chart" by default). `meta.description`
 * on the chart, when given, is used instead of the summary.
 */
import { type AttrTypesFor, STRING } from './attrs.ts';
import type { Axis } from './axis.ts';
import type { Describer } from './chart.ts';
import type { Container } from './container.ts';
import { type BaseAttributes, ChartElement } from './element.ts';

/** What a summary is made from. Plain data, so a function in any language can word it. */
export interface ChartFacts {
  /** The chart's own name, from `meta.title`. */
  readonly title?: string;
  readonly series: readonly { readonly name: string; readonly points: number; readonly shown: boolean }[];
  /** Each axis with a span: its title, whether it runs across, and its first and last tick labels. */
  readonly axes: readonly { readonly title?: string; readonly horizontal: boolean; readonly from: string; readonly to: string }[];
}

export interface ChartSummaryAttributes extends BaseAttributes {
  /** Words the facts. Default: English sentences. */
  text?: (facts: ChartFacts) => string;
  /** What the chart is, as a screen reader announces it. Default 'chart'. */
  roleDescription?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The English summary: how many series and points, then the span of each axis. */
export function englishSummary(f: ChartFacts): string {
  const parts: string[] = [];
  if (f.series.length > 0) {
    const list = f.series.map((s) => `${s.name}, ${plural(s.points, 'point', 'points')}${s.shown ? '' : ', hidden'}`).join('; ');
    parts.push(`${plural(f.series.length, 'series', 'series')}: ${list}.`);
  }
  for (const a of f.axes)
    parts.push(`${a.horizontal ? 'Horizontal' : 'Vertical'} axis${a.title ? ` ${a.title}` : ''}, from ${a.from} to ${a.to}.`);
  return parts.join(' ');
}

export class ChartSummary extends ChartElement<Container, [], ChartSummaryAttributes> implements Describer {
  static override attrTypes = { ...ChartElement.attrTypes, roleDescription: STRING } satisfies AttrTypesFor<ChartSummaryAttributes>;
  /** What the chart holds as of the last layout. */
  get facts(): ChartFacts {
    const chart = this.requireParent(),
      series: ChartFacts['series'][number][] = [],
      axes: ChartFacts['axes'][number][] = [];
    const seen = new Set<Axis>();
    let n = 0;
    for (const plane of chart.planes) {
      for (const s of plane.allSeries) {
        n++;
        series.push({ name: s.attrs.name ?? s.attrs.meta?.title ?? `${n}`, points: s.points.count, shown: s.shown });
      }
      for (const axis of plane.axes) {
        if (seen.has(axis)) continue;
        seen.add(axis);
        const ticks = axis.getTicks(axis.ruler.length);
        if (ticks.length < 2) continue;
        axes.push({
          ...(axis.attrs.title && { title: axis.attrs.title }),
          horizontal: axis.ruler.horizontal,
          // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
          from: ticks[0]!.label,
          // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
          to: ticks[ticks.length - 1]!.label,
        });
      }
    }
    const title = chart.attrs.meta?.title;
    return { ...(title !== undefined && { title }), series, axes };
  }

  describe(): { description: string; roleDescription: string } {
    const a = this.attrs;
    return { description: (a.text ?? englishSummary)(this.facts), roleDescription: a.roleDescription ?? 'chart' };
  }
}

/**
 * The entrance: when the chart first appears, its series do not just show up. Bars grow from their baseline, lines and areas are drawn on
 * from the left, and anything on a round plane fades in.
 *
 *   new Chart({ transition: {} }, plane, new Entrance({ duration: 600 }))
 *
 * It is a child of the chart, after the planes (it reads where the bars stand once they are laid out). Each series' group is marked with
 * `data-ink-enter` and a rule in a `<style>` inside the svg plays it as a CSS animation, so there is no script running while it plays and
 * `prefers-reduced-motion` switches it off. It plays on the first draw only, and only on a platform that can animate (the DOM's): a drawing
 * to a string, an image or a server has no entrance, and so no markup for one.
 */
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import type { Chart } from './chart.ts';
import { type BaseAttributes, ChartElement } from './element.ts';
import { type ChartEvent, EVENT_PAINT } from './events.ts';
import { f2 } from './geometry.ts';
import { Plane } from './plane.ts';
import { SeriesRenderer } from './renderer.ts';
import type { Series } from './series.ts';

export interface EntranceAttributes extends BaseAttributes {
  /** Milliseconds. Default 400. */
  duration?: number;
  /** A CSS easing: a keyword or `cubic-bezier(…)`. Default 'ease-out'. */
  easing?: string;
}

const KINDS: [string, string][] = [
  // A sweep names both ends: the group is clipped to the plot, which is not a shape that can be animated to.
  ['sweep', 'from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}'],
  ['fade', 'from{opacity:0}'],
  ['grow-y', 'from{transform:scale(1,0)}'],
  ['grow-x', 'from{transform:scale(0,1)}'],
];

export class Entrance extends ChartElement<Chart, [], EntranceAttributes> {
  static override attrTypes = { ...ChartElement.attrTypes, duration: NUMBER, easing: STRING } satisfies AttrTypesFor<EntranceAttributes>;

  override onEvent(ev: ChartEvent): void {
    if (ev.type !== EVENT_PAINT) return;
    const chart = this.requireParent();
    // Only the first draw, and only where there is a browser to play it (`setTransition` is how a platform says it can animate).
    if (chart.flushCount !== 1 || !chart.platform?.setTransition) return;
    const a = this.attrs,
      dur = `${a.duration ?? 400}ms`,
      ease = a.easing ?? 'ease-out',
      css = KINDS.map(
        ([kind, frames]) => `@keyframes ink-${kind}{${frames}}g[data-ink-enter=${kind}]{animation:ink-${kind} ${dur} ${ease} backwards}`,
      ).join('');
    const s = this.surface;
    s.text(s.node('style', 'style'), `@media (prefers-reduced-motion:no-preference){${css}}`);
    for (const plane of chart) if (plane instanceof Plane) for (const series of plane.allSeries) this.#mark(plane, series);
  }

  /** A round plane fades, bars grow from their baseline (they say where it is), anything else is drawn on. */
  #mark(plane: Plane, series: Series): void {
    if (plane.axes.some((axis) => plane.cyclic(axis))) return series.decorate('data-ink-enter', 'fade');
    let grow: ReturnType<NonNullable<SeriesRenderer['enterFrom']>> = null;
    for (const r of series)
      if (r instanceof SeriesRenderer) {
        const from = r.enterFrom?.() ?? null;
        if (!from) {
          grow = null;
          break;
        }
        grow ??= from;
      }
    if (grow) series.decorate('style', `transform-origin:${f2(grow.x)}px ${f2(grow.y)}px`);
    series.decorate('data-ink-enter', grow ? grow.kind : 'sweep');
  }
}

/**
 * The camelCase names a `style-…` attribute can contain: selectors (`tickLabel`) and their properties (`strokeWidth`). HTML
 * lowercases attribute names, and the Web Components adapter finds the real name from this list. A selector added by
 * augmenting `Selectors` is given to `defineElements` as `names`.
 */
import type { Selectors } from './theme.ts';

type SelectorProps = { [S in keyof Selectors]: keyof Selectors[S] }[keyof Selectors];
type Cased<K> = K extends string ? (K extends Lowercase<K> ? never : K) : never;
/** The names that have a capital: those without need no entry. (Every name listed must be a real one; that no real one is missing is held by style-names.test.ts, since a test file's augmentations are part of `Selectors` too.) */
type Needed = Cased<keyof Selectors | SelectorProps>;

export const STYLE_NAMES = [
  // Selectors
  'annotationLabel', 'annotationLine', 'axisLine', 'axisTitle', 'boxLine', 'calloutArm', 'calloutBox', 'calloutText', 'chartCaption', 'chartSubtitle', 'chartTitle', 'dotMarker', 'errorBand', 'errorBar', 'focusRing', 'heatCell', 'keyLabel', 'keyLine', 'keyTitle', 'legendLabel', 'legendTitle', 'lineMarker', 'seriesArea', 'seriesBar', 'seriesBox', 'seriesLine', 'shapeMarker', 'tickLabel', 'tooltipBox', 'tooltipText',
  // Properties
  'haloWidth', 'strokeWidth', 'tickLength', 'labelGap',
] as const satisfies readonly Needed[];

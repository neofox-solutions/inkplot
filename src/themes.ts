/**
 * The built-in themes. Separate from `theme.ts` and from each other's use so that a chart bundles only the one it names:
 * a theme is a plain object, and one that nothing imports is dropped by the bundler.
 */
import { type BaseTheme, extendTheme } from './theme.ts';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Dark text and lines on a light page. The look the library had before themes existed. */
export const lightTheme: BaseTheme = {
  palette: ['#2a6fdb', '#e0483e', '#2e9e5b', '#e0a01b', '#8a56c9', '#1c9aa6'],
  text: { size: 11, color: '#444', family: FONT, weight: 'normal', halo: 'none', haloWidth: 3, align: 'start' },
  line: { color: '#444', width: 1, dash: 'none', opacity: 1 },
  shape: { fill: '#2a6fdb', stroke: 'none', strokeWidth: 1, opacity: 1 },
  axis: { tickLength: 5, labelGap: 3, spacing: 4 },
  marker: { size: 3 },
  callout: { padding: 6, outline: 'box', offset: 22, pointer: 3 },
  axisTitle: { size: 12 },
  chartTitle: { size: 16, weight: 600 },
  chartSubtitle: { size: 12, color: '#666' },
  chartCaption: { size: 10, color: '#777' },
  annotationLine: { color: '#8a5a44', dash: '5 3' },
  calloutBox: { fill: '#fff', stroke: '#999' },
  calloutArm: { color: '#999' },
  calloutText: { color: '#333' },
  keyTitle: { weight: 600 },
  legendTitle: { weight: 600 },
  gridline: { color: '#e6e6e6' },
  frame: { color: '#bbb' },
  crosshair: { color: '#888', dash: '4 3' },
  focusRing: { color: '#0b57d0', width: 2 },
  selection: { fill: '#2a6fdb', stroke: '#2a6fdb', opacity: 0.2 },
  seriesLine: { width: 1.5 },
  seriesArea: { opacity: 0.3, strokeWidth: 1.5 },
  errorBar: { width: 1.5 },
  boxLine: { width: 1.5 },
  seriesBox: { opacity: 0.4, strokeWidth: 1.5 },
  errorBand: { opacity: 0.2 },
  lineMarker: { strokeWidth: 1.5 },
};

/** Light text and lines for a dark page. The chart paints no background unless `chart.background` is set. */
// Marked pure so that a bundle that only uses `lightTheme` leaves this out: a call at the top of a module is otherwise kept.
export const darkTheme: BaseTheme = /* @__PURE__ */ extendTheme(lightTheme, {
  palette: ['#5b9bff', '#ff6b61', '#4fcf85', '#f2bc45', '#b18af0', '#4cc4d1'],
  text: { color: '#d4d4d4' },
  line: { color: '#d4d4d4' },
  gridline: { color: '#333' },
  frame: { color: '#666' },
  crosshair: { color: '#999' },
  focusRing: { color: '#8ab4f8' },
  chartSubtitle: { color: '#aaa' },
  chartCaption: { color: '#999' },
  annotationLine: { color: '#d9a98f' },
  calloutBox: { fill: '#1b252b', stroke: '#778' },
  calloutArm: { color: '#889' },
  calloutText: { color: '#e0e0e0' },
  selection: { fill: '#5b9bff', stroke: '#5b9bff' },
});

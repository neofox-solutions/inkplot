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

const ACCESSIBLE_FONT = `OpenDyslexic, "Atkinson Hyperlegible", Lexend, ${FONT}`;
/**
 * What makes a theme accessible, on top of a light or dark one: larger text in a typeface made to be read (OpenDyslexic if the page
 * has it, then Atkinson Hyperlegible or Lexend, then the system's), text and lines of strong contrast, thicker lines, bigger markers,
 * and a palette whose colours are told apart under the common colour vision differences and each reach 3:1 against the page (WCAG
 * 1.4.11). Colour is still not enough on its own: put a pattern on each series (`HatchPattern`, `DotPattern`) so that it can be told
 * apart without it. The sizes are for a chart seen at its own size: a small chart in this theme has less room for the data.
 */
const ACCESSIBLE = {
  text: { size: 14, family: ACCESSIBLE_FONT },
  axis: { tickLength: 7, labelGap: 5, spacing: 6 },
  marker: { size: 5 },
  callout: { padding: 8 },
  axisTitle: { size: 15 },
  chartTitle: { size: 20 },
  chartSubtitle: { size: 15 },
  chartCaption: { size: 13 },
  line: { width: 2 },
  focusRing: { width: 3 },
  seriesLine: { width: 3 },
  seriesArea: { opacity: 0.45, strokeWidth: 3 },
  errorBar: { width: 2.5 },
  boxLine: { width: 2.5 },
  seriesBox: { opacity: 0.5, strokeWidth: 2.5 },
  errorBand: { opacity: 0.3 },
  lineMarker: { strokeWidth: 2.5 },
  annotationLine: { width: 2 },
  calloutArm: { width: 1.5 },
};

/** `lightTheme` made accessible: see `ACCESSIBLE`. Text is near black on white (over 15:1), and every palette colour is over 4:1. */
export const accessibleTheme: BaseTheme = /* @__PURE__ */ extendTheme(lightTheme, {
  ...ACCESSIBLE,
  palette: ['#0072b2', '#c44e00', '#007f5f', '#a66f00', '#a94f82', '#595959'],
  text: { ...ACCESSIBLE.text, color: '#111' },
  line: { ...ACCESSIBLE.line, color: '#222' },
  gridline: { color: '#cfcfcf', width: 1 },
  frame: { color: '#666' },
  crosshair: { color: '#333' },
  focusRing: { ...ACCESSIBLE.focusRing, color: '#0a3d91' },
  chartSubtitle: { ...ACCESSIBLE.chartSubtitle, color: '#333' },
  chartCaption: { ...ACCESSIBLE.chartCaption, color: '#444' },
  annotationLine: { ...ACCESSIBLE.annotationLine, color: '#7a3b00' },
  calloutBox: { fill: '#fff', stroke: '#444' },
  calloutArm: { ...ACCESSIBLE.calloutArm, color: '#444' },
  calloutText: { color: '#000' },
  shape: { fill: '#0072b2' },
  selection: { fill: '#0072b2', stroke: '#0072b2' },
});

/** `darkTheme` made accessible: the same sizes and type, light text (over 15:1 on a dark page), and a palette over 6:1 on it. */
export const accessibleDarkTheme: BaseTheme = /* @__PURE__ */ extendTheme(darkTheme, {
  ...ACCESSIBLE,
  palette: ['#56b4e9', '#ff8a3d', '#33c79a', '#f0b840', '#d68fc0', '#c8c8c8'],
  text: { ...ACCESSIBLE.text, color: '#f2f2f2' },
  line: { ...ACCESSIBLE.line, color: '#e6e6e6' },
  gridline: { color: '#444', width: 1 },
  frame: { color: '#999' },
  crosshair: { color: '#ddd' },
  focusRing: { ...ACCESSIBLE.focusRing, color: '#8ab4f8' },
  chartSubtitle: { ...ACCESSIBLE.chartSubtitle, color: '#ddd' },
  chartCaption: { ...ACCESSIBLE.chartCaption, color: '#ccc' },
  annotationLine: { ...ACCESSIBLE.annotationLine, color: '#f0b88f' },
  calloutBox: { fill: '#1b252b', stroke: '#bbb' },
  calloutArm: { ...ACCESSIBLE.calloutArm, color: '#bbb' },
  calloutText: { color: '#fff' },
  shape: { fill: '#56b4e9' },
  selection: { fill: '#56b4e9', stroke: '#56b4e9' },
});

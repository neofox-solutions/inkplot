/**
 * Drawing a callout: a box of text, optionally joined by an arm to the point it is about. Shared by the annotation and
 * the tooltip, which differ in where the box goes and when it is there, not in what it looks like.
 */
/* oxlint-disable typescript/no-non-null-assertion -- stride-addressed rows of the series' point buffers: every index is bounded by the row count */
import type { Rect, Size } from './geometry.ts';
import type { Plane } from './plane.ts';
import { circlePath, f2 } from './geometry.ts';
import type { TextMeasurer } from './platform.ts';
import { type SampleCache, type Series, paintSample } from './series.ts';
import type { Surface } from './surface.ts';
import { LINE_HEIGHT, applyText, measureBlock, paintLines } from './text.ts';
import type { CalloutMetrics, LineProps, ShapeProps, TextProps } from './theme.ts';

/**
 * Everything a callout's look takes from the theme, resolved by the element that draws it (whose chains differ).
 * @internal
 */
export interface CalloutLook {
  metrics: CalloutMetrics;
  text: TextProps;
  box: ShapeProps;
  arm: LineProps;
}

/** A sample of a series before a line of text: as wide as a short line, and as tall as the lowercase letters. */
const sampleWidth = (look: CalloutLook) => Math.round(look.text.size * 1.4);
const sampleHeight = (look: CalloutLook) => Math.max(5, Math.round(look.text.size * 0.7));
/** The room a column of samples takes at the start of the text: a sample and the gap after it. */
const swatchIndent = (look: CalloutLook) => sampleWidth(look) + 5;

/**
 * How big the box is for `text`: the text's block and the padding all round, and room for a column of series samples if `swatches`.
 * @internal
 */
export function calloutSize(measure: TextMeasurer, text: string, look: CalloutLook, swatches = false): Size {
  const size = measureBlock(measure, text, look.text),
    pad = 2 * look.metrics.padding;
  return { width: size.width + pad + (swatches ? swatchIndent(look) : 0), height: size.height + pad };
}

/**
 * Draw the box at `box`. With an `anchor`, an arm runs from the middle of the edge the anchor is furthest beyond to it
 * (measured in half-sides, so a wide box does not always pick its top and bottom), and the 'edge' outline draws that
 * edge alone. Needs a surface whose wrapper carries the text style. Returns the lines drawn, to pass back next time.
 *
 * `swatches` gives a series for each line that starts with a sample of it (null for one that does not): its line, box or
 * marker as drawn on the plot. The text then starts after a column the width of a sample, which `calloutSize` must have been
 * told of. `samples` is what is remembered of them between calls (see `paintSample`).
 *
 * `prefix` puts every node under another key (`n3/box`), so one element can hold several callouts and take one away with `clearCallout`
 * and the same prefix.
 * @internal
 */
export function paintCallout(
  s: Surface,
  text: string,
  box: Rect,
  anchor: readonly [number, number] | null,
  look: CalloutLook,
  lines: number,
  swatches?: readonly (Series | null)[],
  samples?: SampleCache,
  prefix = '',
): number {
  const { metrics, box: boxLook, arm } = look,
    w = box.width,
    h = box.height;
  const cx = box.x + w / 2,
    cy = box.y + h / 2;
  const rect = s.node(prefix + 'box', 'path');
  s.set(rect, 'd', `M${f2(box.x)} ${f2(box.y)}h${f2(w)}v${f2(h)}h${f2(-w)}z`);
  s.set(rect, 'fill', boxLook.fill);
  s.set(rect, 'fill-opacity', boxLook.opacity);
  s.set(rect, 'stroke', metrics.outline === 'box' ? boxLook.stroke : 'none');
  s.set(rect, 'stroke-width', boxLook.strokeWidth);

  if (anchor) {
    const [px, py] = anchor;
    const rx = (px - cx) / (w / 2),
      ry = (py - cy) / (h / 2);
    const horizontal = Math.abs(rx) >= Math.abs(ry),
      sign = (horizontal ? rx : ry) < 0 ? -1 : 1;
    const [ex1, ey1, ex2, ey2] = horizontal
      ? [cx + (sign * w) / 2, box.y, cx + (sign * w) / 2, box.y + h]
      : [box.x, cy + (sign * h) / 2, box.x + w, cy + (sign * h) / 2];
    const [ax, ay] = horizontal ? [cx + (sign * w) / 2, cy] : [cx, cy + (sign * h) / 2];
    if (metrics.outline === 'edge') {
      const edge = s.node(prefix + 'edge', 'path');
      s.set(edge, 'd', `M${f2(ex1)} ${f2(ey1)}L${f2(ex2)} ${f2(ey2)}`);
      s.set(edge, 'fill', 'none');
      s.set(edge, 'stroke', boxLook.stroke);
      s.set(edge, 'stroke-width', boxLook.strokeWidth);
    } else {
      s.remove(prefix + 'edge');
    }
    const armNode = s.node(prefix + 'arm', 'path');
    s.set(armNode, 'd', `M${f2(px)} ${f2(py)}L${f2(ax)} ${f2(ay)}`);
    s.set(armNode, 'fill', 'none');
    s.set(armNode, 'stroke', arm.color);
    s.set(armNode, 'stroke-width', arm.width);
    s.set(armNode, 'stroke-dasharray', arm.dash);
    s.set(armNode, 'opacity', arm.opacity);
    if (metrics.pointer > 0) {
      const dot = s.node(prefix + 'dot', 'path');
      s.set(dot, 'd', circlePath(px, py, metrics.pointer));
      s.set(dot, 'fill', arm.color);
      s.set(dot, 'stroke', 'none');
    } else {
      s.remove(prefix + 'dot');
    }
  } else {
    for (const key of ['edge', 'arm', 'dot']) s.remove(prefix + key);
  }

  applyText(s, s.wrapper(), look.text);
  const pad = metrics.padding,
    align = look.text.align,
    indent = swatches ? swatchIndent(look) : 0;
  const x = align === 'start' ? box.x + pad + indent : align === 'middle' ? cx + indent / 2 : box.x + w - pad;
  const drawn = paintLines(s, prefix + 'line-', text, x, box.y + pad, look.text, lines);
  const size = look.text.size,
    sw = sampleWidth(look),
    sh = sampleHeight(look);
  for (let i = 0; i < Math.max(drawn, lines); i++) {
    const series = swatches?.[i];
    if (series && samples && i < drawn) {
      // The middle of the x-height of the line: its baseline is at 0.85 of the size down.
      paintSample(
        s,
        `${prefix}sw-${i}`,
        series,
        box.x + pad,
        box.y + pad + size * (0.85 - 0.32 + LINE_HEIGHT * i) - sh / 2,
        sw,
        sh,
        samples,
      );
    } else {
      s.removePrefix(`${prefix}sw-${i}`);
      samples?.delete(`${prefix}sw-${i}`);
    }
  }
  return drawn;
}

/**
 * Take a callout off the surface (`prefix` as it was drawn with).
 * @internal
 */
export function clearCallout(s: Surface, lines: number, samples?: SampleCache, prefix = ''): void {
  for (const key of ['box', 'edge', 'arm', 'dot']) s.remove(prefix + key);
  for (let i = 0; i < lines; i++) {
    s.remove(`${prefix}line-${i}`);
    s.removePrefix(`${prefix}sw-${i}`);
    samples?.delete(`${prefix}sw-${i}`);
  }
}

/** The eight places an automatically placed box may go, as the direction from the point, in order of preference. */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [0, -1],
  [0, 1],
];
/** The most series points looked at when judging a spot: more are skipped evenly. */
const MAX_PROBES = 2000;

/**
 * How bad a box is as a place for a callout: lower is better. Counts the part of it outside the plot, the series points under
 * it, and (much worse) the `occupied` boxes it would cover; `order` is the box's place in the order of preference.
 */
export function boxTrouble(plane: Plane, box: Rect, order: number, occupied: readonly Rect[]): number {
  const r = plane.rect;
  const inX = Math.max(0, Math.min(box.x + box.width, r.width) - Math.max(box.x, 0));
  const inY = Math.max(0, Math.min(box.y + box.height, r.height) - Math.max(box.y, 0));
  let score = (1 - (inX * inY) / (box.width * box.height)) * 1000;
  for (const s of plane.series) {
    const { data, count, stride } = s.points,
      step = Math.max(1, Math.ceil(count / MAX_PROBES));
    for (let i = 0; i < count; i += step) {
      const x = data[i * stride]!,
        y = data[i * stride + 1]!;
      if (x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y - 2 && y <= box.y + box.height + 2) score += step;
    }
  }
  for (const o of occupied)
    if (box.x < o.x + o.width && box.x + box.width > o.x && box.y < o.y + o.height && box.y + box.height > o.y) score += 500;
  return score + order * 0.01;
}

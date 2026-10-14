/** Putting a resolved text look on a node. The look itself is a theme matter (`TextProps`, see theme.ts). */
import type { PlatformNode, TextMeasurer } from './platform.ts';
import type { Size } from './geometry.ts';
import type { Surface } from './surface.ts';
import type { TextProps } from './theme.ts';

/**
 * Put a style on a node, so that the text inside it, and in nodes below it that say nothing of their own, follows it.
 * The anchor is the style's `align` unless the caller places the text by its own geometry and says so: setting it twice
 * would write it twice every flush.
 */
export function applyText(surface: Surface, node: PlatformNode, t: TextProps, anchor: 'start' | 'middle' | 'end' = t.align): void {
  surface.set(node, 'font-size', t.size);
  surface.set(node, 'fill', t.color);
  surface.set(node, 'text-anchor', anchor);
  surface.set(node, 'font-family', t.family);
  surface.set(node, 'font-weight', t.weight);
  surface.set(node, 'stroke', t.halo);
  surface.set(node, 'stroke-width', t.haloWidth);
  // Paint the halo (the stroke) first, so it sits behind the glyphs instead of eating into them.
  surface.set(node, 'paint-order', 'stroke');
  surface.set(node, 'stroke-linejoin', 'round');
}

/** Line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.25;

/** The size of text that may span several lines (split at '\n'), and how many it has. */
export function measureBlock(measure: TextMeasurer, text: string, t: TextProps): Size & { lines: number } {
  const lines = text.split('\n');
  let width = 0;
  for (const line of lines)
    width = Math.max(
      width,
      measure(line, { family: t.family === 'inherit' ? 'sans-serif' : t.family, size: t.size, weight: t.weight }).width,
    );
  return { width, height: lines.length * t.size * LINE_HEIGHT, lines: lines.length };
}

/**
 * Draw text that may span lines, one node per line since the platform has no tspans. `x` is where each line is anchored
 * (its own `text-anchor` says which end of it), `top` the top of the block. Lines left over from a longer text are
 * removed; `previous` is how many there were, and the new count is returned for the next call.
 */
export function paintLines(
  surface: Surface,
  prefix: string,
  text: string,
  x: number,
  top: number,
  t: TextProps,
  previous: number,
  parent?: PlatformNode,
): number {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const n = surface.node(`${prefix}${i}`, 'text', parent ? { parent } : {});
    surface.set(n, 'x', Math.round(x * 100) / 100);
    surface.set(n, 'y', Math.round((top + t.size * (0.85 + LINE_HEIGHT * i)) * 100) / 100);
    surface.text(n, line);
  });
  for (let i = lines.length; i < previous; i++) surface.remove(`${prefix}${i}`);
  return lines.length;
}

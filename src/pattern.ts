/**
 * Pattern fills: a shape painted with lines or dots instead of a flat colour, so that it can be told apart without colour (print, colour
 * blindness, a grey screen) or just look different.
 *
 *     new Chart({}, plane, new HatchPattern({ id: 'hatch' }))
 *     new BarPath({ fill: 'url(#hatch)' })
 *
 * A pattern is an element of the chart with an `id`, and it is named the way SVG names it, `url(#id)`, wherever a style takes a colour
 * (`fill`, `stroke`, `color`, a `style` block). When the element that asks for it has a colour of its own from the palette (a series),
 * and the pattern was not given a `stroke`, the pattern is drawn in that colour: one `HatchPattern` gives every series a hatch of its
 * own colour, and it follows the theme. A `url(#id)` that names nothing here is left as it is, so patterns you wrote into the SVG
 * yourself work as before.
 *
 * `linePattern` and `dotPattern` do the drawing and are plain functions: a pattern of your own is a subclass of `Pattern` that
 * calls them (once, with the options it wants), or draws anything else into the tile (an image, glyphs, alternating dashes).
 * Put the patterns on the chart, where every plane can see them.
 */
import { type AttrTypesFor, NUMBER, STRING } from './attrs.ts';
import type { Container } from './container.ts';
import { type BaseAttributes, ChartElement } from './element.ts';
import { type ChartEvent, EVENT_PAINT } from './events.ts';
import type { PlatformNode } from './platform.ts';
import type { Surface } from './surface.ts';

export interface PatternAttributes extends BaseAttributes {
  /** What a style names it by: `fill: 'url(#id)'`. */
  id: string;
  /** The colour of the lines or dots. Left out, the colour of the series that asks for the pattern (else the theme's text colour). */
  stroke?: string;
  /** The tile's background. Default none. */
  fill?: string;
  /** Without a `fill`: a background in the pattern's own colour (the series colour, if the pattern has no `stroke`) at this opacity from 0 to 1. A little, 0.15 to 0.3, makes the shape read as a shape and keeps gridlines from showing through. */
  tint?: number;
  /** The thickness of a line, or the width of a dot. */
  strokeWidth?: number;
}

const r = (n: number) => Math.round(n * 1e4) / 1e4;
const DEG = Math.PI / 180;

/** What `linePattern` takes. */
export interface LinePatternOptions {
  /** One angle, or two for a crosshatch, in degrees clockwise from the x axis. A pattern's lines all have to share one tile, so every family is drawn by the one call. Default [45]. */
  angles?: readonly number[];
  /** The distance between neighbouring lines of a family, in pixels. Default 6. */
  spacing?: number;
  /** An SVG dash array in pixels, such as '6 3', or 'none'. Default 'none'. */
  dash?: string;
  stroke: string;
  strokeWidth?: number;
  /** The background of the tile. */
  fill?: string;
  /** The opacity of `fill`. Default 1. */
  fillOpacity?: number;
}

/** The numbers of a dash array, made even in length as SVG reads it; none for a solid line. */
function dashes(text: string | undefined): number[] {
  const d = (text ?? 'none')
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
  const all = d.length % 2 ? [...d, ...d] : d;
  return all.reduce((a, b) => a + b, 0) > 0 ? all : [];
}

/**
 * Draws a pattern of lines into `pattern` (a `<pattern>` node of `s`, keyed `key`). The tile is one cell of the lattice the lines
 * make, laid out by `patternTransform` so that it repeats exactly at any angle: lines along one axis of the tile, and, for a crosshatch,
 * along the other. A dash array is fitted to the tile so that it repeats too (a whole number of cycles, each a little longer or
 * shorter than asked).
 */
export function linePattern(s: Surface, pattern: PlatformNode, key: string, o: LinePatternOptions): void {
  const angles = o.angles?.length ? o.angles : [45],
    spacing = Math.max(1, o.spacing ?? 6),
    width = o.strokeWidth ?? 1,
    dash = dashes(o.dash),
    cycle = dash.reduce((a, b) => a + b, 0);
  const [a, b] = [(angles[0] ?? 45) * DEG, (angles[1] ?? 0) * DEG];
  let matrix: number[], length: number; // the lines' length across the tile, in pixels
  if (angles.length > 1) {
    const sin = Math.sin(b - a);
    if (Math.abs(sin) < 1e-3) throw new Error('linePattern: the two angles must differ');
    length = spacing / Math.abs(sin);
    matrix = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)].map((v) => v * length);
  } else {
    // One family: a tile as long as a dash cycle (or as wide as the spacing, when solid) and one spacing across.
    length = cycle || spacing;
    matrix = [Math.cos(a) * length, Math.sin(a) * length, -Math.sin(a) * spacing, Math.cos(a) * spacing];
  }
  s.set(pattern, 'patternUnits', 'userSpaceOnUse');
  s.set(pattern, 'width', 1);
  s.set(pattern, 'height', 1);
  s.set(pattern, 'patternTransform', `matrix(${matrix.map(r).join(' ')} 0 0)`);
  // Drawn in tile units, where one unit across is `spacing` pixels, and along is `length`.
  const bg = s.node(`${key}/bg`, 'rect', { parent: pattern });
  s.set(bg, 'width', 1);
  s.set(bg, 'height', 1);
  s.set(bg, 'fill', o.fill ?? 'none');
  s.set(bg, 'fill-opacity', o.fillOpacity ?? 1);
  const cycles = cycle ? Math.max(1, Math.round(length / cycle)) : 0;
  const tileDash = cycle ? dash.map((d) => r(d / cycle / cycles)).join(' ') : 'none';
  for (let i = 0; i < 2; i++) {
    const line = s.node(`${key}/line${i}`, 'line', { parent: pattern });
    if (i >= angles.length) {
      s.set(line, 'display', 'none');
      continue;
    }
    s.set(line, 'display', 'inline');
    // The first family runs along the tile's x axis, the second along its y; each in the middle of the tile, so none is cut at an edge.
    s.set(line, i ? 'x1' : 'y1', 0.5);
    s.set(line, i ? 'x2' : 'y2', 0.5);
    s.set(line, i ? 'y1' : 'x1', 0);
    s.set(line, i ? 'y2' : 'x2', 1);
    s.set(line, 'stroke', o.stroke);
    s.set(line, 'stroke-width', r(width / spacing));
    s.set(line, 'stroke-dasharray', tileDash);
  }
}

/** What `dotPattern` takes. */
export interface DotPatternOptions {
  /** The shape of a dot. Default 'round'. */
  cap?: 'round' | 'square';
  /** The room between neighbouring dots in a row, edge to edge. Default 4. */
  gapX?: number;
  /** The room between rows. Default: `gapX`. */
  gapY?: number;
  /** How far every other row is shifted along, in pixels. Default: half a dot and its gap, which staggers the rows. */
  offset?: number;
  stroke: string;
  /** The width of a dot. Default 3. */
  strokeWidth?: number;
  fill?: string;
  /** The opacity of `fill`. Default 1. */
  fillOpacity?: number;
}

/**
 * Draws rows of dots into `pattern`. A dot is a line of no length with a round or a square cap, so its size is `strokeWidth`. Every
 * other row is shifted by `offset`; with square dots and `strokeWidth`, `gapX`, `gapY` and `offset` all equal, the dots make a checkerboard.
 */
export function dotPattern(s: Surface, pattern: PlatformNode, key: string, o: DotPatternOptions): void {
  const size = Math.max(0.5, o.strokeWidth ?? 3),
    gapX = Math.max(0, o.gapX ?? 4),
    gapY = Math.max(0, o.gapY ?? gapX),
    pitchX = size + gapX,
    pitchY = size + gapY,
    shift = (((o.offset ?? pitchX / 2) % pitchX) + pitchX) % pitchX;
  s.set(pattern, 'patternUnits', 'userSpaceOnUse');
  s.set(pattern, 'width', r(pitchX));
  s.set(pattern, 'height', r(2 * pitchY));
  const bg = s.node(`${key}/bg`, 'rect', { parent: pattern });
  s.set(bg, 'width', r(pitchX));
  s.set(bg, 'height', r(2 * pitchY));
  s.set(bg, 'fill', o.fill ?? 'none');
  s.set(bg, 'fill-opacity', o.fillOpacity ?? 1);
  // Two rows to a tile. The shifted row is drawn a pitch to either side as well, since a dot that runs off one edge comes in at the other.
  const spots: [number, number][] = [[pitchX / 2, pitchY / 2]];
  const row2 = pitchX / 2 + shift;
  for (const dx of shift === 0 ? [0] : [-pitchX, 0, pitchX]) spots.push([row2 + dx, pitchY * 1.5]);
  spots.forEach(([x, y], i) => {
    const dot = s.node(`${key}/dot${i}`, 'line', { parent: pattern });
    s.set(dot, 'x1', r(x));
    s.set(dot, 'x2', r(x));
    s.set(dot, 'y1', r(y));
    s.set(dot, 'y2', r(y));
    s.set(dot, 'stroke', o.stroke);
    s.set(dot, 'stroke-width', r(size));
    s.set(dot, 'stroke-linecap', o.cap ?? 'round');
  });
  for (let i = spots.length; i < 4; i++) s.remove(`${key}/dot${i}`);
}

/** The colour to draw in, as a part of an id. */
const slug = (color: string) => color.replace(/[^a-zA-Z0-9]+/g, '_');

/**
 * The base of the pattern elements. A subclass draws one tile (`drawTile`) in a colour it is given; the element keeps one `<pattern>`
 * for each colour asked for, in `<defs>`, and hands out the `url(#…)` of the right one.
 */
export abstract class Pattern<A extends PatternAttributes = PatternAttributes> extends ChartElement<Container, [], A> {
  static override attrTypes = {
    ...ChartElement.attrTypes,
    stroke: STRING,
    fill: STRING,
    tint: NUMBER,
    strokeWidth: NUMBER,
  } satisfies AttrTypesFor<PatternAttributes>;
  /** The tile's background for lines or dots in `color`: its own `fill`, or the colour tinted, or none. */
  protected background(color: string): { fill?: string; fillOpacity?: number } {
    const a = this.attrs;
    return a.fill !== undefined ? { fill: a.fill } : a.tint ? { fill: color, fillOpacity: a.tint } : {};
  }
  /** The colours in use, by the key of their node, with the last flush that asked for each. */
  readonly #variants = new Map<string, { color: string; flush: number }>();

  /** Draw the tile into `pattern` (a `<pattern>` node of `s` whose id is already set), in `color`. `key` starts the keys of any nodes it adds to it. */
  protected abstract drawTile(s: Surface, pattern: PlatformNode, key: string, color: string): void;

  /** The paint for something drawn in `accent` (its own colour from the palette, if it has one): this pattern in that colour, or in its own. */
  provide(accent: string | undefined): string {
    const own = this.attrs.stroke;
    if (own !== undefined || accent === undefined) return `url(#${this.#draw('', own ?? this.#fallback())})`;
    return `url(#${this.#draw(slug(accent), accent)})`;
  }

  #fallback(): string {
    return this.styleFor(['text']).color;
  }

  /** Make or update the pattern for a colour and give its id. */
  #draw(tag: string, color: string, asked = true): string {
    const id = tag ? `${this.attrs.id}-${tag}` : this.attrs.id;
    const key = `p:${tag || '-'}`;
    const s = this.surface;
    const flush = this.requireChart().flushCount;
    if (tag && asked) this.#variants.set(key, { color, flush });
    const node = s.node(key, 'pattern', { parent: s.node('defs', 'defs') });
    s.set(node, 'id', id);
    this.drawTile(s, node, key, color);
    return id;
  }

  override onEvent(ev: ChartEvent): void {
    if (ev.type !== EVENT_PAINT) return;
    const flush = this.requireChart().flushCount;
    this.#draw('', this.attrs.stroke ?? this.#fallback());
    // A colour that nothing asked for in the last flush or this one is let go (a theme changed, a series was removed).
    for (const [key, v] of this.#variants)
      if (v.flush < flush - 1) {
        this.surface.removePrefix(key);
        this.#variants.delete(key);
      } else this.#draw(key.slice(2), v.color, false);
  }
}

export interface LinePatternAttributes extends PatternAttributes {
  /** Degrees clockwise from the x axis. Default 45. */
  angle?: number;
  /** The distance between lines, in pixels. Default 6. */
  spacing?: number;
  /** An SVG dash array in pixels, such as '6 3'. Default none (solid). */
  dash?: string;
}
const lineTypes = { angle: NUMBER, spacing: NUMBER, dash: STRING } as const;

/** Parallel lines. */
export class LinePattern extends Pattern<LinePatternAttributes> {
  static override attrTypes = { ...Pattern.attrTypes, ...lineTypes } satisfies AttrTypesFor<LinePatternAttributes>;
  protected drawTile(s: Surface, pattern: PlatformNode, key: string, color: string): void {
    const a = this.attrs;
    linePattern(s, pattern, key, {
      angles: [a.angle ?? 45],
      spacing: a.spacing,
      dash: a.dash,
      stroke: color,
      strokeWidth: a.strokeWidth,
      ...this.background(color),
    });
  }
}

export interface HatchPatternAttributes extends LinePatternAttributes {
  /** The second family of lines. Default -45, so with the default `angle` the two cross at right angles. */
  crossAngle?: number;
}

/** Two sets of parallel lines that cross. */
export class HatchPattern extends Pattern<HatchPatternAttributes> {
  static override attrTypes = { ...Pattern.attrTypes, ...lineTypes, crossAngle: NUMBER } satisfies AttrTypesFor<HatchPatternAttributes>;
  protected drawTile(s: Surface, pattern: PlatformNode, key: string, color: string): void {
    const a = this.attrs;
    linePattern(s, pattern, key, {
      angles: [a.angle ?? 45, a.crossAngle ?? -45],
      spacing: a.spacing,
      dash: a.dash,
      stroke: color,
      strokeWidth: a.strokeWidth,
      ...this.background(color),
    });
  }
}

export interface DotPatternAttributes extends PatternAttributes {
  cap?: 'round' | 'square';
  gapX?: number;
  gapY?: number;
  offset?: number;
}

/** Rows of dots, round or square. */
export class DotPattern extends Pattern<DotPatternAttributes> {
  static override attrTypes = {
    ...Pattern.attrTypes,
    cap: STRING,
    gapX: NUMBER,
    gapY: NUMBER,
    offset: NUMBER,
  } satisfies AttrTypesFor<DotPatternAttributes>;
  protected drawTile(s: Surface, pattern: PlatformNode, key: string, color: string): void {
    const a = this.attrs;
    dotPattern(s, pattern, key, {
      cap: a.cap,
      gapX: a.gapX,
      gapY: a.gapY,
      offset: a.offset,
      stroke: color,
      strokeWidth: a.strokeWidth,
      ...this.background(color),
    });
  }
}

/** The attributes of a checkerboard of squares `size` pixels across, for a `DotPattern`. */
export function checkerboard(size = 4): Omit<DotPatternAttributes, 'id'> {
  return { cap: 'square', strokeWidth: size, gapX: size, gapY: size, offset: size };
}

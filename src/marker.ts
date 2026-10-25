/**
 * Markers: one small shape per point.
 *
 *   Marker
 *   ├─ DotMarker              a zero-length stroke, round or square capped; its size is a stroke width
 *   ├─ LineMarker             open shapes drawn with a stroke; `size` goes into the path data
 *   │   ├─ CrossMarker        ×
 *   │   └─ PlusMarker         +
 *   └─ ShapeMarker            closed shapes, filled and stroked; `size` goes into the path data
 *       ├─ CircleMarker       a bubble series is a CircleMarker with `size` bound to a channel
 *       └─ SquareMarker
 *
 * To write another, extend `Marker` (or one of the two below it) and say what one shape looks like.
 */
/* oxlint-disable typescript/no-non-null-assertion -- numeric kernels over flat typed-array buffers (stride-addressed rows): every index is bounded by the row count, which `noUncheckedIndexedAccess` cannot see */
import type { PointBuffer } from './data.ts';
import { fractionsOf, lookKey, lookValues, resolveBindings, stepsFor } from './bucket.ts';
import { EVENT_ATTACH, type ChartEvent } from './events.ts';
import { circlePath, f2 } from './geometry.ts';
import { type ResolvedBinding, SeriesRenderer, type SeriesRendererAttributes, type StyleBindable } from './renderer.ts';
import type { PlatformNode } from './platform.ts';
import type { Surface } from './surface.ts';
import type { ShapeProps } from './theme.ts';

/* oxlint-disable typescript/consistent-type-assertions -- marker properties are written by name from the `bind` attribute, and an axis hands back `string | number` for a property the attribute types vouch for */

/** The options shared by all markers; `Bindable` is what this kind of marker lets you bind (so a wrong one fails to compile). */
export interface MarkerAttributes<Bindable extends object> extends SeriesRendererAttributes<Bindable> {
  /** Half the width of a marker in pixels: a radius, or the distance from the centre to an edge. Default 3. */
  size?: number;
  /**
   * Draw all the markers that look alike as one path. Default true.
   *
   * One path per look is what keeps a large scatter cheap. The catch is that markers in one path do not blend where
   * they overlap, so `opacity` darkens nothing. With `false` every marker is a node of its own and they do blend,
   * but a node per point is slow to build, to write and to render: a bad idea for big data. Each marker then also
   * gets exactly the value it binds, rather than the nearest of the `maxNodes`-limited steps.
   */
  merge?: boolean;
}

/** What a marker's node is told to look like: constants and bindings resolved, `size` in pixels. */
export interface MarkerStyle {
  stroke: string;
  strokeWidth: number;
  fill: string;
  opacity: number;
  size: number;
}

/** Points further than this outside the plot are skipped when a bound size cannot say how far a marker reaches. */
const CULL_MARGIN = 16;

/** Writes a bound value onto the style by property name: bindings are keyed by string, the style is a typed record. */
const writeProperty = (v: MarkerStyle, property: string, value: string | number) => {
  (v as unknown as Record<string, string | number>)[property] = value;
};

/**
 * The common work of all markers: cull what is off the plot, work out each point's look from its bindings, and group
 * points that look alike into one path.
 *
 * Why grouping: a scatter of 100k points as 100k nodes is slow to build and to render. Instead each bound style is
 * quantized into a few steps, a point's look is the combination of its steps (the `key`), and every point with the same
 * key joins a single path. The number of nodes is then bounded by `maxNodes`, not by the data. Geometry (a bubble's
 * radius) is not quantized: it goes straight into the path data, which costs the same however it varies.
 */
export abstract class Marker<A extends MarkerAttributes<object>> extends SeriesRenderer<A> {
  /** Path data for one marker centred on (x, y), `r` pixels from the centre to an edge. */
  protected abstract shape(x: number, y: number, r: number): string;
  /** True for a bound property that goes into `shape`, false for one that sets an attribute of the node. Only `size` can be geometric. */
  protected abstract isGeometric(property: string): boolean;
  /** Which theme selector holds this kind of marker's own look, between `marker` and the general `shape`. */
  protected abstract readonly kind: 'dotMarker' | 'lineMarker' | 'shapeMarker';
  /** Where the series' palette colour goes: the stroke for markers that are strokes, the fill for those that are filled. */
  protected abstract accent(color: string): Partial<ShapeProps>;
  /** Write a node's look. Every property that has a value, by constant or binding, is in `v`. */
  protected abstract style(s: Surface, node: PlatformNode, v: MarkerStyle): void;

  /** Its fill (or its stroke, for a marker that is only a stroke), unless that is bound to data. */
  override get swatch(): string | null {
    const a = this.attrs,
      series = this.requireParent(),
      bind = a.bind as Record<string, unknown> | undefined;
    if (bind?.fill || bind?.stroke) return null;
    const look = this.styleFor(
      [this.kind, 'marker', 'shape'],
      { stroke: a.stroke, strokeWidth: a.strokeWidth, fill: a.fill, opacity: a.opacity },
      this.accent(series.accentColor),
    );
    return look.fill && look.fill !== 'none' ? look.fill : look.stroke && look.stroke !== 'none' ? look.stroke : null;
  }

  /**
   * One marker in the middle of the box, as big as it is on the plot (no bigger than the box). What is bound to data takes
   * the value at the middle of its dimension, since a sample stands for no point in particular.
   */
  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const a = this.attrs,
      series = this.requireParent();
    const look = this.styleFor(
      [this.kind, 'marker', 'shape'],
      { stroke: a.stroke, strokeWidth: a.strokeWidth, fill: a.fill, opacity: a.opacity },
      this.accent(series.accentColor),
    );
    const v: MarkerStyle = { ...look, size: this.styleFor([this.kind, 'marker'], { size: a.size }).size };
    for (const b of this.bindings) writeProperty(v, b.property, b.axis.valueAt(0.5) as string | number);
    v.size = Math.min(v.size, width / 2, height / 2);
    const n = s.node(key, 'path', { parent });
    s.set(n, 'd', this.shape(width / 2, height / 2, v.size));
    this.style(s, n, v);
  }

  /** Its size, or the largest a bound size gives, and a pixel for the stroke round it. */
  override get reach(): number {
    const size = this.bindings.find((b) => (!this.isGeometric(b.property) ? false : b.property === 'size'));
    const output = (size?.axis as unknown as { output?: readonly [number, number] } | undefined)?.output;
    const r = output ? Math.max(output[0], output[1]) : this.styleFor([this.kind, 'marker'], { size: this.attrs.size }).size;
    return r + 1;
  }

  // Which grouped nodes (by look key) and how many per-point nodes exist now, so the ones no longer used can be removed.
  #keys = new Set<number>();
  #separate = 0;
  // What the last draw made its paths from, and the paths (merged markers only).
  #memo: {
    projection: number;
    w: number;
    h: number;
    ends: Float64Array | null;
    bind: unknown;
    steps: number;
    size: number;
    count: number;
    paths: Map<number, string>;
    bytes: number;
    styled: { b: ResolvedBinding; f: Float64Array }[];
  } | null = null;

  /** The bound properties with their dimensions resolved. A property is stylistic unless the marker puts it in the path. */
  override get bindings(): readonly ResolvedBinding[] {
    return resolveBindings(this.attrs.bind, this, (p) => this.isGeometric(p));
  }

  /** How many steps each stylistic binding is quantized to, so that the combinations stay within `maxNodes`. 0 when not grouping. */
  override get stepsPerBinding(): number {
    return this.attrs.merge === false ? 0 : stepsFor(this.bindings, this.attrs.maxNodes ?? 1000);
  }

  override onEvent(ev: ChartEvent): void {
    if (ev.type === EVENT_ATTACH) void this.stepsPerBinding; // throws now rather than at the first paint
    super.onEvent(ev);
  }

  /**
   * Three phases: (1) turn each bound channel into a column of 0..1 positions along its dimension; (2) walk the points,
   * dropping gaps and those off the plot, building each marker's path data and choosing its node; (3) write the nodes
   * and remove those that no longer have any marker.
   */
  protected draw(points: Readonly<PointBuffer>): void {
    const series = this.requireParent(),
      plane = series.plane;
    const a = this.attrs,
      s = this.surface,
      counters = this.counters;
    const t0 = performance.now();
    const { data, count, stride } = points;
    const w = plane.rect.width,
      h = plane.rect.height;
    const merge = a.merge !== false;
    const local = { stroke: a.stroke, strokeWidth: a.strokeWidth, fill: a.fill, opacity: a.opacity };
    const look = this.styleFor([this.kind, 'marker', 'shape'], local, this.accent(series.accentColor));
    const base: MarkerStyle = { ...look, size: this.styleFor([this.kind, 'marker'], { size: a.size }).size };

    // Beside bars (a lollipop: a stem and a marker), a marker stands on the end of its bar, which is not at the point when bars share a band.
    let ends: Float64Array | null = null;
    for (let r = series.firstChild; r; r = r.nextSibling) {
      const set = r !== this && r instanceof SeriesRenderer ? r.anchors() : null;
      if (set && set.count === count) ends = set.data;
    }
    const bindings = this.bindings;
    const steps = this.stepsPerBinding;
    // Phases 1 and 2 depend on the points, the plot's size, the bindings and where bars put the ends; while those are as they were (a
    // repaint for a pointer moving) the paths made last time are the ones to write.
    const memo = this.#memo;
    let bytes = 0;
    let paths: Map<number, string>; // look key → the path data of every marker with that look
    let styled: { b: ResolvedBinding; f: Float64Array }[];
    let separate = 0;
    const v: MarkerStyle = { ...base };
    // The style handed to `style()` starts from the constants each time, then has the bound values written over it.
    const reset = () => Object.assign(v, base);
    if (
      merge &&
      memo &&
      memo.projection === series.projection &&
      memo.w === w &&
      memo.h === h &&
      memo.ends === ends &&
      memo.bind === a.bind &&
      memo.steps === steps &&
      memo.size === base.size &&
      memo.count === count
    ) {
      ({ paths, bytes, styled } = memo);
    } else {
      // Each binding becomes a column of positions along its dimension, 0..1.
      const channels = series.channels;
      const fractions = bindings.map((b) => fractionsOf(b, data, 2 + channels.indexOf(b.channel), stride, count));
      styled = bindings.flatMap((b, i) => (b.stylistic ? [{ b, f: fractions[i]! }] : []));
      const geometric = bindings.flatMap((b, i) => (b.stylistic ? [] : [{ b, f: fractions[i]! }]))[0];
      paths = new Map<number, string>();
      for (let i = 0; i < count; i++) {
        let x = data[i * stride]!,
          y = data[i * stride + 1]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (ends && Number.isFinite(ends[i * 4]!) && Number.isFinite(ends[i * 4 + 1]!)) {
          x = ends[i * 4]!;
          y = ends[i * 4 + 1]!;
        }
        const r = geometric ? (geometric.b.axis.valueAt(geometric.f[i]!) as number) : base.size;
        if (!(r >= 0)) continue;
        const reach = geometric || !styled.length ? r : CULL_MARGIN + r;
        if (x < -reach || x > w + reach || y < -reach || y > h + reach) continue;
        const d = this.shape(x, y, r);
        bytes += d.length;

        if (merge) {
          const key = lookKey(styled, i, steps);
          paths.set(key, (paths.get(key) ?? '') + d);
        } else {
          reset();
          for (const { b, f } of styled) writeProperty(v, b.property, b.axis.valueAt(f[i]!) as string | number);
          const node = s.node(`p${separate++}`, 'path');
          s.set(node, 'd', d);
          this.style(s, node, v);
        }
      }
      this.#memo = merge
        ? { projection: series.projection, w, h, ends, bind: a.bind, steps, size: base.size, count, paths, bytes, styled }
        : null;
    }
    counters.stages.path += performance.now() - t0;
    counters.pathBytes += bytes;

    if (merge) {
      for (const key of this.#keys) if (!paths.has(key)) s.remove(`m${key}`);
      for (let i = 0; i < this.#separate; i++) s.remove(`p${i}`);
      this.#separate = 0;
      this.#keys = new Set(paths.keys());
      for (const [key, d] of paths) {
        reset();
        lookValues(key, styled, steps, (property, value) => writeProperty(v, property, value));
        const node = s.node(`m${key}`, 'path');
        s.set(node, 'd', d);
        this.style(s, node, v);
      }
    } else {
      for (const key of this.#keys) s.remove(`m${key}`);
      this.#keys.clear();
      for (let i = separate; i < this.#separate; i++) s.remove(`p${i}`);
      this.#separate = separate;
    }
  }
}

// ─── Dots ───

export interface DotMarkerBindable {
  stroke: string;
  size: number;
  opacity: number;
}
export interface DotMarkerAttributes extends MarkerAttributes<DotMarkerBindable> {
  /** Round caps make circles, square caps make squares. Default 'round'. */
  cap?: 'round' | 'square';
}
/**
 * A dot is a stroke with no length, as wide as the dot is: the cheapest marker, and the one a dense scatter wants.
 * Its stroke is twice `size` wide (`size` is a radius, as on every marker), so a bound `size` is one of the quantized styles, unlike on the other markers.
 */
export class DotMarker extends Marker<DotMarkerAttributes> {
  protected readonly kind = 'dotMarker';
  protected accent(color: string): Partial<ShapeProps> {
    return { stroke: color };
  }
  protected shape(x: number, y: number): string {
    return `M${f2(x)} ${f2(y)}h0`;
  }
  protected isGeometric(): boolean {
    return false;
  }
  protected style(s: Surface, n: PlatformNode, v: MarkerStyle): void {
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', v.stroke);
    s.set(n, 'stroke-width', f2(2 * v.size));
    s.set(n, 'stroke-linecap', this.attrs.cap ?? 'round');
    s.set(n, 'opacity', Math.round(v.opacity * 1000) / 1000);
  }
}

// ─── Open shapes ───

export interface LineMarkerBindable {
  stroke: string;
  strokeWidth: number;
  opacity: number;
  size: number;
}
/** Shapes made of strokes. The size is in the path data, so it varies per point at no cost. */
export abstract class LineMarker<A extends MarkerAttributes<LineMarkerBindable> = MarkerAttributes<LineMarkerBindable>> extends Marker<A> {
  protected readonly kind = 'lineMarker';
  protected accent(color: string): Partial<ShapeProps> {
    return { stroke: color };
  }
  protected isGeometric(property: string): boolean {
    return property === 'size';
  }
  protected style(s: Surface, n: PlatformNode, v: MarkerStyle): void {
    s.set(n, 'fill', 'none');
    s.set(n, 'stroke', v.stroke);
    s.set(n, 'stroke-width', f2(v.strokeWidth));
    s.set(n, 'stroke-linecap', 'round');
    s.set(n, 'opacity', Math.round(v.opacity * 1000) / 1000);
  }
}
/** ×: two diagonals, `size` from the centre to each end. */
export class CrossMarker extends LineMarker {
  protected shape(x: number, y: number, r: number): string {
    return `M${f2(x - r)} ${f2(y - r)}l${f2(2 * r)} ${f2(2 * r)}M${f2(x - r)} ${f2(y + r)}l${f2(2 * r)} ${f2(-2 * r)}`;
  }
}
/** +: a horizontal and a vertical stroke. */
export class PlusMarker extends LineMarker {
  protected shape(x: number, y: number, r: number): string {
    return `M${f2(x - r)} ${f2(y)}h${f2(2 * r)}M${f2(x)} ${f2(y - r)}v${f2(2 * r)}`;
  }
}

// ─── Closed shapes ───

export interface ShapeMarkerBindable extends StyleBindable {
  size: number;
}
/** Closed shapes, filled and stroked. The most flexible markers: stroke, stroke width, fill, opacity and size are all bindable. */
export abstract class ShapeMarker<
  A extends MarkerAttributes<ShapeMarkerBindable> = MarkerAttributes<ShapeMarkerBindable>,
> extends Marker<A> {
  protected readonly kind = 'shapeMarker';
  protected accent(color: string): Partial<ShapeProps> {
    return { fill: color };
  }
  protected isGeometric(property: string): boolean {
    return property === 'size';
  }
  protected style(s: Surface, n: PlatformNode, v: MarkerStyle): void {
    s.set(n, 'fill', v.fill);
    s.set(n, 'stroke', v.stroke);
    s.set(n, 'stroke-width', f2(v.strokeWidth));
    s.set(n, 'opacity', Math.round(v.opacity * 1000) / 1000);
  }
}
/** A filled circle. A bubble series is this with `size` bound to a channel. */
export class CircleMarker extends ShapeMarker {
  protected shape(x: number, y: number, r: number): string {
    return circlePath(x, y, r);
  }
}
/** A square, `size` from the centre to each side. */
export class SquareMarker extends ShapeMarker {
  protected shape(x: number, y: number, r: number): string {
    return `M${f2(x - r)} ${f2(y - r)}h${f2(2 * r)}v${f2(2 * r)}h${f2(-2 * r)}z`;
  }
}

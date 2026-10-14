/**
 * A surface: the platform nodes one element owns, and the counters a flush accumulates.
 *
 * Why this layer exists: every flush re-runs every element's drawing code, so drawing has to be idempotent and cheap.
 * Surface makes it so by (a) handing out the same node for the same key, and (b) remembering the last value written
 * to each attribute and skipping identical writes. Elements therefore just say "this node has these attributes" every
 * time, and only real changes reach the platform (and, in a browser, the DOM).
 */
import type { Platform, PlatformNode, SvgTag } from './platform.ts';

/** The timed phases of producing a series' path, for the chart's diagnostics. */
export type StageName = 'generate' | 'decimate' | 'normalize' | 'place' | 'path';

/** What a flush accumulates. One per chart, shared by every surface and element in it. */
export interface Counters {
  writes: number;
  skipped: number;
  names: Set<string>;
  filled: number;
  cached: number;
  projected: number;
  pointsIn: number;
  pointsDrawn: number;
  pathBytes: number;
  stages: Record<StageName, number>;
}
/** Fresh zeroed counters; the chart resets (rather than replaces) them each flush so surfaces keep a valid reference. */
export const newCounters = (): Counters => ({
  writes: 0,
  skipped: 0,
  names: new Set(),
  filled: 0,
  cached: 0,
  projected: 0,
  pointsIn: 0,
  pointsDrawn: 0,
  pathBytes: 0,
  stages: { generate: 0, decimate: 0, normalize: 0, place: 0, path: 0 },
});

/**
 * Where an element's nodes go, answered from the live element tree each time one is created.
 * Nothing about neighbours is stored, so nothing can go stale when siblings come and go.
 */
export interface Placement {
  /** The node own content goes into when the element has no wrapper: the nearest wrapper above, or the platform root. */
  container(): PlatformNode;
  /** The node this element's whole content must end before. Null means append. */
  end(): PlatformNode | null;
  /** The first node among the element's children, if any of them has drawn. */
  childrenFirst(): PlatformNode | null;
}

export interface NodeOptions {
  /** Put the node inside another of this element's nodes instead of at the top level. */
  parent?: PlatformNode;
  /** Draw after the element's children instead of before them (an axis' labels over the series, say). */
  above?: boolean;
}

/** One keyed node. `parent` set means it lives inside another of the element's nodes, not at the top level. */
interface Entry {
  node: PlatformNode;
  parent: PlatformNode | null;
  above: boolean;
}

/**
 * What an element draws with. Nodes are keyed, created on demand, positioned from the live tree,
 * and written only when a value changed. An element's own content sits below its children (or above, with `above`).
 *
 * An element has no node of its own unless it asks for a wrapper, which it should only do when the wrapper
 * does something: a transform, a clip, or style its content inherits. Otherwise its nodes sit directly
 * in the parent's, in order, with nothing to mark where they start.
 */
export class Surface {
  private readonly platform: Platform;
  private readonly counters: Counters;
  private readonly placement: Placement;
  private wrapperNode: PlatformNode | null = null;
  private hidden = false;
  private readonly nodes = new Map<string, Entry>();
  private readonly cache = new WeakMap<PlatformNode, Map<string, string | number>>();

  constructor(platform: Platform, counters: Counters, placement: Placement) {
    this.platform = platform;
    this.counters = counters;
    this.placement = placement;
  }

  /**
   * The element's own `<g>` (or another tag). Children and own nodes go inside it. Create it before the
   * element draws anything, typically on attach; asking again returns the same node.
   */
  wrapper(tag: SvgTag = 'g'): PlatformNode {
    if (!this.wrapperNode) {
      if (this.nodes.size > 0 || this.placement.childrenFirst()) throw new Error('wrapper() must come before the element draws anything');
      this.wrapperNode = this.platform.createNode(tag);
      this.platform.insertBefore(this.placement.container(), this.wrapperNode, this.placement.end());
      if (this.hidden) this.set(this.wrapperNode, 'display', 'none');
    }
    return this.wrapperNode;
  }
  /** The wrapper, if the element has one. */
  get wrapperRoot(): PlatformNode | null {
    return this.wrapperNode;
  }
  /** First own node below the children, if any. */
  get firstBelow(): PlatformNode | null {
    return this.firstOf(false);
  }
  /** First own node above the children, if any. */
  get firstAbove(): PlatformNode | null {
    return this.firstOf(true);
  }

  /**
   * The node for `key`, created the first time and the same node afterwards. Keys are per element, so two elements
   * can both use 'grid' without clashing.
   */
  node(key: string, tag: SvgTag, options: NodeOptions = {}): PlatformNode {
    let entry = this.nodes.get(key);
    if (entry) return entry.node;
    const node = this.platform.createNode(tag);
    const above = options.above ?? false;
    if (options.parent) {
      this.platform.insertBefore(options.parent, node, null);
      entry = { node, parent: options.parent, above };
    } else {
      // Inside a wrapper the range ends at the wrapper's end; without one it ends where the element does.
      const end = this.wrapperNode ? null : this.placement.end();
      const before = above ? end : (this.placement.childrenFirst() ?? this.firstAbove ?? end);
      this.platform.insertBefore(this.wrapperNode ?? this.placement.container(), node, before);
      entry = { node, parent: null, above };
      if (this.hidden && !this.wrapperNode) this.set(node, 'display', 'none');
    }
    this.nodes.set(key, entry);
    return node;
  }
  /** Set an attribute if (and only if) it differs from what was last written. The platform cannot unset one, so use a neutral value ('none', 0) instead of removing. */
  set(node: PlatformNode, name: string, value: string | number): void {
    this.write(node, name, value, () => this.platform.setAttribute(node, name, value));
  }
  /** Set a text node's content, skipping unchanged writes like `set`. */
  text(node: PlatformNode, content: string): void {
    this.write(node, '#text', content, () => this.platform.setText(node, content));
  }
  /** Drop one keyed node, for content that comes and goes (a title, a clip path). */
  remove(key: string): void {
    const entry = this.nodes.get(key);
    if (!entry) return;
    this.nodes.delete(key);
    this.platform.remove(entry.node);
  }

  /** Drop a keyed node and every node keyed beneath it (`key/…`), for a group made of several. */
  removePrefix(key: string): void {
    this.remove(key);
    const below = key + '/';
    // oxlint-disable-next-line unicorn/no-useless-spread -- a snapshot: `remove` takes nodes out of the map while we walk it
    for (const k of [...this.nodes.keys()]) if (k.startsWith(below)) this.remove(k);
  }

  /** Hide or show everything this element draws (the wrapper, or each top-level node if it has none). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const display = hidden ? 'none' : 'inline';
    if (this.wrapperNode) {
      this.set(this.wrapperNode, 'display', display);
      return;
    }
    for (const e of this.nodes.values()) if (!e.parent) this.set(e.node, 'display', display);
  }

  /** Take this element's nodes out of the platform. */
  dispose(): void {
    if (this.wrapperNode) this.platform.remove(this.wrapperNode);
    else for (const e of this.nodes.values()) if (!e.parent) this.platform.remove(e.node);
    this.nodes.clear();
    this.wrapperNode = null;
  }

  /** The first top-level node of one layer; the layers are what `end()`/`first()` placement is computed from. */
  private firstOf(above: boolean): PlatformNode | null {
    for (const e of this.nodes.values()) if (!e.parent && e.above === above) return e.node;
    return null;
  }
  /** The write cache lives per node (a WeakMap) so a removed node's entries are collected with it. */
  private write(node: PlatformNode, name: string, value: string | number, commit: () => void): void {
    let cached = this.cache.get(node);
    if (!cached) {
      cached = new Map();
      this.cache.set(node, cached);
    }
    if (cached.get(name) === value) {
      this.counters.skipped++;
      return;
    }
    cached.set(name, value);
    commit();
    this.counters.writes++;
    this.counters.names.add(name);
  }
}

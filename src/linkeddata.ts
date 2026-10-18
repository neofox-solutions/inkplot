/**
 * LinkedData: a stage that is another stage, somewhere else. It stands where a series (or a transform) wants its data and
 * answers with the data of the stage it points to, so several charts, or several series, read one source and have one
 * place to change it.
 *
 * `new LinkedData({ source: shared })` forwards the version, the extents, the points and (when there are no `channels`
 * to rename) the very storage of `shared`. A change to `shared` is a change to the `LinkedData` too: it tells the chart
 * it is in, which is what carries a change across charts. What is not shared is everything that depends on the site:
 * wrap it in its own `Decimator` (thinning depends on the width it is drawn at) or `Slice`.
 *
 * The source is an element or, inside one chart, an id. Charts cannot see into each other, so to link across charts give
 * the element. Put the source itself where it can sit, a child of a `Chart` or of a `ChartGroupItem`, and nothing draws it.
 */
import type { AttrTypesFor } from './attrs.ts';
import { AUTO } from './attrs.ts';
import { type DataNode, DataTransform, type FillPlan, type PlanContext, type PointView } from './data.ts';
import { type BaseAttributes, type ElementRef, fail, resolveRef } from './element.ts';
import type { Extent } from './geometry.ts';
import type { MountContext } from './element.ts';

export interface LinkedDataAttributes extends BaseAttributes {
  /** The stage to forward to: a source or a transform, as an element or the id of one in the same chart. */
  source: ElementRef<DataNode>;
  /**
   * Channels this stage calls by other names: `{ trace: 'ch2' }` makes the channel `ch2` of the source `trace` here. A
   * channel not named keeps its name, unless a name here takes it. Nothing is checked until a series asks for it.
   */
  channels?: Readonly<Record<string, string>>;
}

export class LinkedData extends DataTransform<LinkedDataAttributes, []> {
  static override attrTypes = { ...DataTransform.attrTypes, source: AUTO, channels: AUTO } satisfies AttrTypesFor<LinkedDataAttributes>;

  // Two counters make `version`: ours moves with every change to this stage (and by a lot when it is pointed elsewhere, so
  // a version of the new source can never be mistaken for one of the old), and the source's is read when asked.
  #own = 0;
  #hearing = false;
  #source: ElementRef<DataNode> | undefined;
  #renames: LinkedDataAttributes['channels'];
  #watching: { node: DataNode; stop: () => void } | null = null;

  /** The stage this one forwards to. */
  get target(): DataNode {
    return resolveRef<DataNode>(this.attrs.source, this) ?? fail('LinkedData has no source');
  }

  override get version(): number {
    return this.#own + this.target.version;
  }
  override get pointCount(): number {
    return this.target.pointCount;
  }
  /** What a channel of this stage is called in the source. */
  #theirs(name: string): string {
    return this.attrs.channels?.[name] ?? name;
  }
  override get channelNames(): readonly string[] {
    const renamed = this.attrs.channels;
    const theirs = this.target.channelNames ?? [];
    return renamed ? [...Object.keys(renamed), ...theirs.filter((n) => !(n in renamed))] : theirs;
  }
  override domain(): Extent | null {
    return this.target.domain();
  }
  override valueExtent(): Extent | null {
    return this.target.valueExtent();
  }
  override channelExtent(name: string): Extent | null {
    return this.target.channelExtent(this.#theirs(name));
  }
  override plan(context: PlanContext): FillPlan {
    const names = context.columns.map((n) => this.#theirs(n));
    return this.target.plan(this.attrs.channels ? { ...context, columns: names } : context);
  }
  /** The source's own storage, read in place, with the channels under the names they have here. */
  override view(): PointView | null {
    const v = this.target.view?.() ?? null;
    if (!v || !this.attrs.channels || !v.channelOffsets) return v;
    const offsets: Record<string, number> = { ...v.channelOffsets };
    for (const [mine, theirs] of Object.entries(this.attrs.channels)) {
      const at = v.channelOffsets[theirs];
      if (at !== undefined) offsets[mine] = at;
    }
    return { ...v, channelOffsets: offsets };
  }

  /** The source changed, or this stage was changed: either way what is above has to look again. */
  override invalidate(): void {
    const { source, channels } = this.attrs;
    if (source !== this.#source || channels !== this.#renames) {
      // Pointed elsewhere, or renamed: a version of what it is now cannot be mistaken for one of what it was.
      this.#own += 2 ** 40;
      const moved = source !== this.#source;
      this.#source = source;
      this.#renames = channels;
      if (moved && this.#watching) this.#follow();
    }
    this.#own++;
    super.invalidate();
  }

  protected override mount(ctx: MountContext): void {
    super.mount(ctx);
    this.#follow();
  }
  protected override unmount(removeNodes: boolean): void {
    this.#watching?.stop();
    this.#watching = null;
    super.unmount(removeNodes);
  }
  /** Listen to the stage pointed at, if there is one yet: a missing source is reported when something asks for the data. */
  #follow(): void {
    this.#watching?.stop();
    this.#watching = null;
    let node: DataNode;
    try {
      node = this.target;
    } catch {
      return;
    }
    this.#watching = {
      node,
      stop: node.watch(() => {
        if (this.#hearing) return; // two stages that point at each other
        this.#hearing = true;
        try {
          this.chart?.noteDataChange();
          this.invalidate();
        } finally {
          this.#hearing = false;
        }
      }),
    };
  }
}

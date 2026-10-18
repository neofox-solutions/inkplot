/**
 * A boundary that moves part of the data pipeline (decimation first) to a worker.
 *
 *   new WorkerBoundary({ worker, registry: { FlatDataSource, Decimator, MinMaxKernel } },
 *     new Decimator({}, new MinMaxKernel(), new FlatDataSource({ data, stride: 2 })))
 *
 * The boundary is a data stage, and what is inside it is a description: the page sends it to the worker, which builds it
 * and does the work. The answers come back later, so the boundary does what a stage that is always ready cannot: it
 * answers at once with what it has, and replaces it when the worker's answer arrives (stale while revalidating).
 *
 *  - Before the first answer the boundary has no points, no domain and no extents. A chart that shows it draws empty axes.
 *  - `plan` asks for the points of this plot (the width, the domain being shown, the channels). One request is out at a time,
 *    and only the newest waits, so a pan or zoom that asks every frame costs the worker what it can do and no more.
 *  - `fill` copies the newest points that have arrived, whatever they were asked for, so a drag shows the last thinning of the
 *    data until the next one is ready. An answer bumps `version` and invalidates the chart, which flushes by itself.
 *  - A change to the description is sent as an update; the worker changes its tree in place (see `applyJSON`), so a decimator
 *    there keeps its cache. An array that is the same one as before is not sent again.
 *
 * An error in the worker is thrown, with its message, from the next `plan`. The points come back in a buffer the boundary
 * hands back with the next request, so a steady state allocates nothing.
 */
/* oxlint-disable typescript/consistent-type-assertions -- a message from the worker is checked for its shape (an object with a `kind` and this boundary's `id`) and then read as what that says it is */
import { type AttrTypesFor, BOOLEAN } from './attrs.ts';
import {
  type DataNode,
  DataSource,
  DataTransform,
  type FillPlan,
  type FillResult,
  type PlanContext,
  rowRange,
  scanExtents,
} from './data.ts';
import { type BaseAttributes, fail } from './element.ts';
import type { Extent } from './geometry.ts';
import { leafOf, type Partition, type PartitionedPlan } from './partition.ts';
import { Refs, toJSON, type ElementRegistry } from './serialize.ts';
import {
  type Envelope,
  envelopeOf,
  type Enveloping,
  type FromWorker,
  type PartitionMeta,
  type PartitionSpec,
  type ToWorker,
  type WorkerLike,
  type WorkerMeta,
} from './workerproto.ts';

export interface WorkerBoundaryAttributes extends BaseAttributes {
  /** Where the stages inside run. */
  worker: WorkerLike;
  /** The classes the description is made of, by the names the worker's registry knows them under. */
  registry: ElementRegistry;
  /** Move the arrays to the worker instead of copying them: fast and without a second copy, but the page no longer has the rows (a hit has no row, the data cannot be edited here). A `SharedArrayBuffer` is never copied or moved. */
  transfer?: boolean;
  /**
   * Allow arrays that are backed by a `SharedArrayBuffer`, which the worker then reads where they are, with no copy: change them in
   * place and call `refresh()`. Off by default, because it needs a page that is cross-origin isolated, and because the worker reads
   * the array while the page may be writing it, which is the page's to arrange (write between refreshes, or accept a torn frame).
   */
  shared?: boolean;
  /** For a worker that carries other traffic too (see `Envelope`). The worker has to be given the same. */
  envelope?: Envelope;
}

interface Request {
  key: string;
  context: PlanContext;
  byKey: boolean;
}
interface Result {
  key: string;
  count: number;
  stride: number;
  extents: readonly Extent[];
  buffer: ArrayBuffer;
}

/** The points of every key of a partition, as the worker sent them: a block each. */
interface Blocks {
  stride: number;
  buffer: ArrayBuffer;
  /** Where the block of a key is: its place among the blocks. */
  index: Map<number, number>;
  sizes: number[];
  offsets: number[];
  extents: Extent[][];
}

const EMPTY_META: PartitionMeta = { keys: [], omitted: 0, counts: [], domains: [], values: [], channels: {} };
const NO_ROWS: Partition['view'] = { data: new Float64Array(0), count: 0, stride: 2, domainOffset: 0, valueOffset: 1, regularDomain: null };

/** What a group is given for rows that are in a worker: the counts and extents the worker made of them, and no rows. */
function remotePartition(source: DataSource, spec: PartitionSpec, meta: PartitionMeta, version: number): Partition {
  const slots = new Map(meta.keys.map((k, i) => [k, i]));
  const nothing = meta.keys.map(() => null);
  return {
    channel: spec.channel,
    source,
    view: NO_ROWS,
    keyOffset: -1,
    version,
    keys: meta.keys,
    omitted: meta.omitted,
    storageRow: () => -1,
    counts: Int32Array.from(meta.counts),
    firstRows: new Int32Array(0),
    lastRows: new Int32Array(0),
    domains: meta.domains,
    values: meta.values,
    slotOf: (key) => slots.get(key) ?? -1,
    table: new Int32Array(0),
    tableOnly: false,
    rows: () => [],
    alone: () => [],
    gathered: false,
    channelExtents: (name) => meta.channels[name] ?? nothing,
  };
}

let nextId = 1;

export class WorkerBoundary extends DataTransform<WorkerBoundaryAttributes, [source: DataNode]> {
  static override attrTypes = { ...DataTransform.attrTypes, transfer: BOOLEAN } satisfies Partial<AttrTypesFor<WorkerBoundaryAttributes>>;

  readonly #id = nextId++;
  readonly #refs = new Refs({}, { auto: true });
  readonly #sent = new Map<string, unknown>();
  readonly #moved = new WeakSet();
  #wire: Enveloping | null = null;
  #stop: (() => void) | null = null;
  #version = 0;
  #epoch = 0;
  #attached = false;
  #dirty = true;
  #meta: WorkerMeta | null = null;
  #result: Result | null = null;
  #blocks: Blocks | null = null;
  #spec: PartitionSpec | null = null;
  #touch = false;
  #remote: { meta: PartitionMeta; partition: Partition } | null = null;
  #spare: ArrayBuffer | null = null;
  #wanted = '';
  #inflight: Request | null = null;
  #waiting: Request | null = null;
  #error: Error | null = null;
  // While a message is being posted: an answer that comes back at once (a NullWorker) is part of the call that asked.
  #posting = 0;
  #replying = false;
  // Told to the chart until the first points arrive, so an entrance waits for them.
  #release: (() => void) | null = null;
  #unwatch: (() => void) | null = null;

  constructor(...args: ConstructorParameters<typeof DataTransform<WorkerBoundaryAttributes, [source: DataNode]>>) {
    super(...args);
    if (!(this.firstChild instanceof DataSource || this.firstChild instanceof DataTransform))
      fail('WorkerBoundary: what is inside has to be a data source or transform');
  }

  /** Rows shared with the worker (see `shared`) were changed in place: it counts, thins and draws them again. */
  refresh(): void {
    this.#touch = true;
    this.invalidate();
  }

  get source(): DataNode {
    return this.child(0, DataSource, DataTransform);
  }
  /** The worker's side of the data: the points that have arrived, or nothing yet. */
  get arrived(): boolean {
    return this.#result !== null || this.#blocks !== null;
  }
  /** True while a request is out or waiting, or the worker has not yet answered the description: the chart is drawing what it had. */
  get pending(): boolean {
    return this.#error === null && (this.#inflight !== null || this.#waiting !== null || this.#meta === null || this.#dirty);
  }

  override invalidate(): void {
    if (!this.#replying && this.#posting === 0) {
      this.#version++;
      this.#dirty = true;
    }
    super.invalidate();
  }
  get version(): number {
    return this.#version;
  }
  override get channelNames(): readonly string[] {
    this.#sync();
    return this.#meta?.channelNames ?? [];
  }
  get pointCount(): number {
    this.#sync();
    return this.#meta?.pointCount ?? 0;
  }
  domain(): Extent | null {
    this.#sync();
    return this.#meta?.domain ?? null;
  }
  valueExtent(): Extent | null {
    this.#sync();
    return this.#meta?.valueExtent ?? null;
  }
  channelExtent(name: string): Extent | null {
    this.#sync();
    return this.#meta?.channelExtents[name] ?? null;
  }

  plan(context: PlanContext): FillPlan {
    this.#ask(context, false);
    const have = this.#result,
      stride = 2 + context.channels.length;
    // What arrived for other channels is not laid out like this plot's points, and cannot stand in for them.
    if (!have || have.stride !== stride) return { capacity: 0, fill: () => ({ count: 0, extents: [] }) };
    return {
      capacity: have.count,
      rows: have.count,
      fill: (out, from, to): FillResult => {
        const r = this.#result ?? have;
        const [lo, hi] = rowRange(r.count, from, to);
        const part = new Float64Array(r.buffer, 8 * r.stride * lo, r.stride * (hi - lo)).subarray(0, out.length);
        out.set(part);
        const count = Math.min(hi - lo, Math.floor(out.length / r.stride));
        // Rows of the answer that has arrived are not rows of the source, so there is no `rowOf` to offer; extents are the answer's, whole or of the part.
        return { count, extents: lo === 0 && hi === r.count ? r.extents : scanExtents(part, count, r.stride) };
      },
    };
  }

  /** Throw what the worker threw; send the description if it changed; ask for these points unless they are the last ones asked for. */
  #ask(context: PlanContext, byKey: boolean): void {
    if (this.#error) {
      const e = this.#error;
      this.#error = null;
      throw e;
    }
    this.#sync();
    const key = `${this.#epoch}|${byKey ? 'k' : 'p'}|${context.width}|${context.domainRange.min},${context.domainRange.max}|${context.channels.join(',')}|${context.sequence ? 1 : 0}`;
    if (key !== this.#wanted) {
      this.#wanted = key;
      const request: Request = { key, context, byKey };
      if (this.#inflight) this.#waiting = request;
      else this.#send(request);
    }
    if (this.#error) this.#ask(context, byKey);
  }

  // ─── Groups: the worker splits the rows by a channel, and the group asks for each key's points ───

  override partitionable(): boolean {
    const s = this.source;
    return s instanceof DataSource || s.partitionable?.() === true;
  }
  override partitionBy(channel: string, order: 'first' | 'sorted', max: number): Partition | null {
    const held = this.#spec;
    if (!held || held.channel !== channel || held.order !== order || held.max !== max) {
      this.#spec = { channel, order, max };
      this.#remote = null;
      this.#dirty = true;
    }
    this.#sync();
    const meta = this.#meta?.partition;
    if (!meta) {
      // The worker has not counted yet: no keys, so no series, until it has.
      return (this.#remote ??= {
        meta: EMPTY_META,
        partition: remotePartition(leafOf(this.source), this.#spec ?? { channel, order, max }, EMPTY_META, 0),
      }).partition;
    }
    if (this.#remote?.meta !== meta)
      this.#remote = { meta, partition: remotePartition(leafOf(this.source), this.#spec ?? { channel, order, max }, meta, this.#version) };
    return this.#remote.partition;
  }
  override planPartitioned(context: PlanContext, partition: Partition): PartitionedPlan {
    this.#ask(context, true);
    const stride = 2 + context.channels.length;
    const blockOf = (slot: number): number => {
      const b = this.#blocks;
      return b && b.stride === stride ? (b.index.get(partition.keys[slot] ?? NaN) ?? -1) : -1;
    };
    return {
      capacity: (slot) => {
        const at = blockOf(slot);
        return at < 0 ? 0 : (this.#blocks?.sizes[at] ?? 0);
      },
      fill: (slot, out) => {
        const b = this.#blocks,
          at = blockOf(slot);
        if (!b || at < 0) return { count: 0, extents: [] };
        const n = Math.min(b.sizes[at] ?? 0, Math.floor(out.length / stride));
        out.set(new Float64Array(b.buffer, (b.offsets[at] ?? 0) * 8, n * stride));
        return { count: n, extents: b.extents[at] ?? [] };
      },
    };
  }

  /** Stop listening to the worker and let it forget this tree. The worker itself is the app's to end. */
  protected override unmount(removeNodes: boolean): void {
    this.#detach();
    super.unmount(removeNodes);
  }
  #detach(): void {
    if (this.#attached) this.#post({ kind: 'detach', id: this.#id });
    this.#stop?.();
    this.#stop = null;
    this.#release?.();
    this.#release = null;
    this.#unwatch?.();
    this.#unwatch = null;
    this.#attached = false;
    this.#dirty = true;
    this.#meta = null;
    this.#result = null;
    this.#blocks = null;
    this.#remote = null;
    this.#inflight = this.#waiting = null;
    this.#wanted = '';
    this.#sent.clear();
  }

  /** Send the description if it has changed (or was never sent). */
  #sync(): void {
    if (!this.#dirty) return;
    this.#dirty = false;
    const a = this.attrs;
    if (!this.#wire) this.#wire = envelopeOf(a.envelope);
    if (!this.#release && !this.#result && !this.#blocks) this.#release = this.chart?.holdEntrance() ?? null;
    if (!this.#unwatch) this.#unwatch = this.chart?.watchData(() => this.pending) ?? null;
    if (!this.#stop) {
      const wire = this.#wire;
      this.#stop = a.worker.subscribe((data) => {
        const m = wire.unwrap(data) as FromWorker | null;
        if (m && typeof m === 'object' && (m.id === this.#id || (m.kind === 'error' && m.id === 0))) this.#receive(m);
      });
    }
    let tree;
    try {
      tree = toJSON(this.source, a.registry, { refs: this.#refs });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (/detached/.test(text))
        fail(
          'WorkerBoundary: an array of the description was moved to a worker (`transfer`) and is not here any more: ' +
            'give each boundary its own array, or leave `transfer` off to copy it',
        );
      throw e;
    }
    const refs: Record<string, unknown> = {},
      transfer: ArrayBuffer[] = [];
    for (const name of this.#refs.names) {
      const value = this.#refs.get(name);
      if (this.#sent.get(name) === value) continue;
      this.#sent.set(name, value);
      refs[name] = value;
      if (!a.shared && ArrayBuffer.isView(value) && typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer)
        fail(
          `WorkerBoundary: "${name}" is backed by a SharedArrayBuffer: set \`shared\` to share it with the worker (the page has to be cross-origin isolated)`,
        );
      if (a.transfer && ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer && !this.#moved.has(value.buffer)) {
        this.#moved.add(value.buffer);
        transfer.push(value.buffer);
      }
    }
    const touch = this.#touch;
    this.#touch = false;
    this.#epoch++;
    this.#post(
      {
        kind: this.#attached ? 'update' : 'attach',
        id: this.#id,
        epoch: this.#epoch,
        tree,
        refs,
        partition: this.#spec,
        touch: touch || undefined,
      },
      transfer,
    );
    this.#attached = true;
  }

  #send(request: Request): void {
    this.#inflight = request;
    const c = request.context;
    const recycle = this.#spare ?? undefined;
    this.#spare = null;
    this.#post(
      {
        kind: 'fill',
        id: this.#id,
        key: request.key,
        width: c.width,
        height: c.height,
        domainRange: c.domainRange,
        channels: [...c.channels],
        sequence: c.sequence ?? false,
        byKey: request.byKey,
        recycle,
      },
      recycle ? [recycle] : [],
    );
  }

  #post(message: ToWorker, transfer: ArrayBuffer[] = []): void {
    const a = this.attrs;
    this.#posting++;
    try {
      a.worker.post((this.#wire ?? envelopeOf(a.envelope)).wrap(message), transfer);
    } catch (e) {
      this.#error = new Error(
        `WorkerBoundary: the worker could not be sent a ${message.kind}: ${e instanceof Error ? e.message : String(e)}`,
      );
      this.#inflight = null;
    } finally {
      this.#posting--;
    }
  }

  #receive(m: FromWorker): void {
    const sync = this.#posting > 0;
    switch (m.kind) {
      case 'meta':
        this.#meta = m.meta;
        break;
      case 'result': {
        this.#release?.();
        this.#release = null;
        // The buffer of the answer this one replaces goes back with the next request.
        const replaced = m.blocks ? this.#blocks?.buffer : this.#result?.buffer;
        if (replaced) this.#spare = replaced;
        const blocks = m.blocks;
        if (blocks)
          this.#blocks = {
            stride: m.stride,
            buffer: m.buffer,
            index: new Map(blocks.keys.map((k, i) => [k, i])),
            sizes: blocks.sizes,
            offsets: blocks.offsets,
            extents: blocks.extents,
          };
        else this.#result = { key: m.key, count: m.count, stride: m.stride, extents: m.extents, buffer: m.buffer };
        this.#inflight = null;
        const next = this.#waiting;
        this.#waiting = null;
        if (next) this.#send(next);
        break;
      }
      case 'error':
        this.#release?.();
        this.#release = null;
        this.#error ??= new Error(`WorkerBoundary: ${m.message}`);
        this.#inflight = null;
        break;
    }
    // An answer that came back inside the call that asked is part of that call; a later one is a change.
    if (sync) return;
    this.#replying = true;
    try {
      this.#version++;
      this.invalidate();
    } finally {
      this.#replying = false;
    }
  }
}

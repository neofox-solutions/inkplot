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
import { type DataNode, DataSource, DataTransform, type FillPlan, type FillResult, type PlanContext } from './data.ts';
import { type BaseAttributes, fail } from './element.ts';
import type { Extent } from './geometry.ts';
import { Refs, toJSON, type ElementRegistry } from './serialize.ts';
import {
  type Envelope,
  envelopeOf,
  type Enveloping,
  type FromWorker,
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
  /** For a worker that carries other traffic too (see `Envelope`). The worker has to be given the same. */
  envelope?: Envelope;
}

interface Request {
  key: string;
  context: PlanContext;
}
interface Result {
  key: string;
  count: number;
  stride: number;
  extents: readonly Extent[];
  buffer: ArrayBuffer;
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

  constructor(...args: ConstructorParameters<typeof DataTransform<WorkerBoundaryAttributes, [source: DataNode]>>) {
    super(...args);
    if (!(this.firstChild instanceof DataSource || this.firstChild instanceof DataTransform))
      fail('WorkerBoundary: what is inside has to be a data source or transform');
  }

  get source(): DataNode {
    return this.child(0, DataSource, DataTransform);
  }
  /** The worker's side of the data: the points that have arrived, or nothing yet. */
  get arrived(): boolean {
    return this.#result !== null;
  }
  /** True while a request is out or waiting, or the worker has not yet answered the description: the chart is drawing what it had. */
  get pending(): boolean {
    return this.#inflight !== null || this.#waiting !== null || this.#meta === null || this.#dirty;
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
    if (this.#error) {
      const e = this.#error;
      this.#error = null;
      throw e;
    }
    this.#sync();
    const key = `${this.#epoch}|${context.width}|${context.domainRange.min},${context.domainRange.max}|${context.channels.join(',')}|${context.sequence ? 1 : 0}`;
    if (key !== this.#wanted) {
      this.#wanted = key;
      const request: Request = { key, context };
      if (this.#inflight) this.#waiting = request;
      else this.#send(request);
    }
    if (this.#error) return this.plan(context);
    const have = this.#result,
      stride = 2 + context.channels.length;
    // What arrived for other channels is not laid out like this plot's points, and cannot stand in for them.
    if (!have || have.stride !== stride) return { capacity: 0, fill: () => ({ count: 0, extents: [] }) };
    return {
      capacity: have.count,
      fill: (out): FillResult => {
        const r = this.#result ?? have;
        out.set(new Float64Array(r.buffer, 0, r.count * r.stride).subarray(0, out.length));
        return { count: Math.min(r.count, Math.floor(out.length / r.stride)), extents: r.extents };
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
    this.#attached = false;
    this.#dirty = true;
    this.#meta = null;
    this.#result = null;
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
    if (!this.#release && !this.#result) this.#release = this.chart?.holdEntrance() ?? null;
    if (!this.#stop) {
      const wire = this.#wire;
      this.#stop = a.worker.subscribe((data) => {
        const m = wire.unwrap(data) as FromWorker | null;
        if (m && typeof m === 'object' && (m.id === this.#id || (m.kind === 'error' && m.id === 0))) this.#receive(m);
      });
    }
    const tree = toJSON(this.source, a.registry, { refs: this.#refs });
    const refs: Record<string, unknown> = {},
      transfer: ArrayBuffer[] = [];
    for (const name of this.#refs.names) {
      const value = this.#refs.get(name);
      if (this.#sent.get(name) === value) continue;
      this.#sent.set(name, value);
      refs[name] = value;
      if (a.transfer && ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer && !this.#moved.has(value.buffer)) {
        this.#moved.add(value.buffer);
        transfer.push(value.buffer);
      }
    }
    this.#epoch++;
    this.#post({ kind: this.#attached ? 'update' : 'attach', id: this.#id, epoch: this.#epoch, tree, refs }, transfer);
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
        if (this.#result) this.#spare = this.#result.buffer;
        this.#result = { key: m.key, count: m.count, stride: m.stride, extents: m.extents, buffer: m.buffer };
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

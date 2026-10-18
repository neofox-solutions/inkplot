/**
 * The worker side of a `WorkerBoundary`: builds the tree the boundary describes, keeps it in step, and answers for it.
 *
 *   const handler = createHost({ FlatDataSource, Decimator, MinMaxKernel })
 *
 * The registry names only the classes the worker needs, which is what keeps a worker's bundle small. `handler` is called with
 * each message that arrives and the function that sends one back (see `NullWorker` and `LoopbackWorker`; a real worker's
 * entry connects it to `postMessage`).
 */
/* oxlint-disable typescript/consistent-type-assertions -- a message from the page is checked for its shape (an object with a `kind`) and then read as what that says it is */
import { type AnyElement, fail } from './element.ts';
import { canPartition, leafOf, type Partition, partitionOf, planPartitioned } from './partition.ts';
import { DataSource, DataTransform, type DataNode, type PlanContext } from './data.ts';
import type { Extent } from './geometry.ts';
import { applyJSON, fromJSON, Refs, type ElementRegistry } from './serialize.ts';
import {
  type Envelope,
  envelopeOf,
  type FromWorker,
  type PartitionMeta,
  type PartitionSpec,
  type ToWorker,
  type WorkerMeta,
} from './workerproto.ts';
import type { WorkerHandler } from './workers.ts';

export interface HostOptions {
  /** How messages are put in what the worker also carries (see `Envelope`); the boundary has to be given the same. */
  envelope?: Envelope;
  /** Called with a tree that was just built (and when `update` changed it), to edit its data or call `invalidate`. A later update from the page may overwrite what is changed here. */
  onTree?: (root: DataNode, id: number) => void;
}

interface Entry {
  root: DataNode;
  refs: Map<string, unknown>;
  epoch: number;
  spec: PartitionSpec | null;
  /** The spec the partition held was made with. */
  heldSpec: string;
  partition: Partition | null;
}

const isNode = (e: AnyElement): e is DataNode => e instanceof DataSource || e instanceof DataTransform;
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Split the rows by the spec, unless the split that is held is still the one for these rows. */
function partitionFor(entry: Entry): void {
  const spec = entry.spec;
  if (!spec) {
    entry.partition = null;
    return;
  }
  if (!canPartition(entry.root)) fail('the stages inside the boundary cannot be split by a channel: each has to extend KeyedTransform');
  const leaf = leafOf(entry.root),
    held = entry.partition;
  const made = JSON.stringify(spec);
  if (held && held.source === leaf && held.version === leaf.version && entry.heldSpec === made) return;
  entry.heldSpec = made;
  entry.partition = partitionOf(leaf, spec.channel, spec.order, spec.max) ?? fail(`the data has no channel "${spec.channel}"`);
}
function partitionMeta(p: Partition, names: readonly string[]): PartitionMeta {
  const slots = p.keys.map((_, i) => i);
  return {
    keys: [...p.keys],
    omitted: p.omitted,
    counts: slots.map((i) => p.counts[i] ?? 0),
    domains: slots.map((i) => p.domains[i] ?? null),
    values: slots.map((i) => p.values[i] ?? null),
    channels: Object.fromEntries(names.filter((n) => n !== p.channel).map((n) => [n, slots.map((i) => p.channelExtents(n)[i] ?? null)])),
  };
}

function metaOf(root: DataNode, partition: Partition | null): WorkerMeta {
  const channelNames = [...(root.channelNames ?? [])];
  const channelExtents: Record<string, ReturnType<DataNode['channelExtent']>> = {};
  for (const n of channelNames) channelExtents[n] = root.channelExtent(n);
  const meta: WorkerMeta = {
    pointCount: root.pointCount,
    domain: root.domain(),
    valueExtent: root.valueExtent(),
    channelNames,
    channelExtents,
  };
  if (partition) meta.partition = partitionMeta(partition, leafOf(root).channelNames);
  return meta;
}

export function createHost(registry: ElementRegistry, options: HostOptions = {}): WorkerHandler {
  const entries = new Map<number, Entry>();
  const env = envelopeOf(options.envelope);

  return (data, replyRaw) => {
    const message = env.unwrap(data) as ToWorker | null;
    if (message === null || typeof message !== 'object' || typeof message.kind !== 'string') return;
    const reply = (m: FromWorker, transfer?: ArrayBuffer[]): void => replyRaw(env.wrap(m), transfer);
    const id = message.id;
    try {
      switch (message.kind) {
        case 'attach':
        case 'update': {
          let entry = entries.get(id);
          const refs = new Map(entry?.refs);
          for (const [k, v] of Object.entries(message.refs)) refs.set(k, v);
          const live = new Refs(Object.fromEntries(refs), { auto: true });
          if (message.kind === 'attach' || !entry) {
            const root = fromJSON(message.tree, registry, { refs: live });
            if (!isNode(root)) fail('the boundary holds something that is not a data source or transform');
            entry = { root, refs, epoch: message.epoch, spec: null, heldSpec: '', partition: null };
            entries.set(id, entry);
          } else {
            applyJSON(entry.root, message.tree, registry, { refs: live });
            entry.refs = refs;
            entry.epoch = message.epoch;
          }
          if (message.kind === 'update' && message.touch) leafOf(entry.root).invalidate();
          entry.spec = message.partition ?? null;
          partitionFor(entry);
          options.onTree?.(entry.root, id);
          reply({ kind: 'meta', id, epoch: message.epoch, meta: metaOf(entry.root, entry.partition) });
          return;
        }
        case 'fill': {
          const entry = entries.get(id) ?? fail('fill before attach');
          const context: PlanContext = {
            width: message.width,
            height: message.height,
            domainRange: message.domainRange,
            columns: message.columns,
            sequence: message.sequence,
          };
          if (message.byKey) {
            const part = entry.partition ?? fail('a fill by key needs the boundary to have been given a partition'),
              plan = planPartitioned(entry.root, context, part),
              stride = message.columns.length;
            const slots = part.keys.map((_, i) => i),
              capacities = slots.map((i) => plan.capacity(i));
            const need = capacities.reduce((a, c) => a + c, 0) * stride;
            const buffer = message.recycle && message.recycle.byteLength >= need * 8 ? message.recycle : new ArrayBuffer(need * 8);
            const sizes: number[] = [],
              offsets: number[] = [],
              extents: Extent[][] = [];
            let at = 0;
            for (const i of slots) {
              const size = (capacities[i] ?? 0) * stride;
              const r = plan.fill(i, new Float64Array(buffer, at * 8, size));
              sizes.push(r.count);
              offsets.push(at);
              extents.push([...r.extents]);
              at += size;
            }
            reply(
              {
                kind: 'result',
                id,
                key: message.key,
                epoch: entry.epoch,
                count: 0,
                stride,
                extents: [],
                buffer,
                blocks: { keys: [...part.keys], sizes, offsets, extents },
              },
              [buffer],
            );
            return;
          }
          const plan = entry.root.plan(context),
            stride = message.columns.length,
            need = plan.capacity * stride;
          const recycled = message.recycle && message.recycle.byteLength >= need * 8 ? message.recycle : null;
          const buffer = recycled ?? new ArrayBuffer(need * 8);
          const result = plan.fill(new Float64Array(buffer, 0, need));
          reply(
            { kind: 'result', id, key: message.key, epoch: entry.epoch, count: result.count, stride, extents: [...result.extents], buffer },
            [buffer],
          );
          return;
        }
        case 'detach':
          entries.delete(id);
          return;
      }
    } catch (e) {
      reply({ kind: 'error', id, message: messageOf(e) });
    }
  };
}

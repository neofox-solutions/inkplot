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
import { DataSource, DataTransform, type DataNode, type PlanContext } from './data.ts';
import { applyJSON, fromJSON, Refs, type ElementRegistry } from './serialize.ts';
import { type Envelope, envelopeOf, type FromWorker, type ToWorker, type WorkerMeta } from './workerproto.ts';
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
}

const isNode = (e: AnyElement): e is DataNode => e instanceof DataSource || e instanceof DataTransform;
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function metaOf(root: DataNode): WorkerMeta {
  const channelNames = [...(root.channelNames ?? [])];
  const channelExtents: Record<string, ReturnType<DataNode['channelExtent']>> = {};
  for (const n of channelNames) channelExtents[n] = root.channelExtent(n);
  return { pointCount: root.pointCount, domain: root.domain(), valueExtent: root.valueExtent(), channelNames, channelExtents };
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
            entry = { root, refs, epoch: message.epoch };
            entries.set(id, entry);
          } else {
            applyJSON(entry.root, message.tree, registry, { refs: live });
            entry.refs = refs;
            entry.epoch = message.epoch;
          }
          options.onTree?.(entry.root, id);
          reply({ kind: 'meta', id, epoch: message.epoch, meta: metaOf(entry.root) });
          return;
        }
        case 'fill': {
          const entry = entries.get(id) ?? fail('fill before attach');
          const context: PlanContext = {
            width: message.width,
            height: message.height,
            domainRange: message.domainRange,
            channels: message.channels,
            sequence: message.sequence,
          };
          const plan = entry.root.plan(context),
            stride = 2 + message.channels.length,
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

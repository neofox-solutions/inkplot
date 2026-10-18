/**
 * The messages between a `WorkerBoundary` and the worker that holds its data stages, and the small interface a worker
 * implementation has to offer. Nothing here knows how a message travels (a Web Worker, a Node worker, a function call): see
 * workers.ts for the in-process ones, and workerhost.ts for what answers on the other side.
 *
 * A boundary owns an `id`, so many of them can share one worker. Every request after `attach` is applied in order, so a
 * `fill` always sees the `update` sent before it. `epoch` counts the boundary's own changes (an `update` makes a new one),
 * and `meta` and `result` name the epoch they were made from.
 */
import type { Extent } from './geometry.ts';
import type { ElementJSON } from './serialize.ts';

/** How a group over the boundary splits the rows: by the values of a channel, the series in the order the keys first appear or sorted. */
export interface PartitionSpec {
  channel: string;
  order: 'first' | 'sorted';
  max: number;
}

/** What the worker counted when the rows were split by a spec: for each key, in the order of its series. */
export interface PartitionMeta {
  keys: number[];
  omitted: number;
  counts: number[];
  domains: (Extent | null)[];
  values: (Extent | null)[];
  /** The extent of each of the other channels, for each key. */
  channels: Record<string, (Extent | null)[]>;
}

/** What the boundary asks for. */
export type ToWorker =
  /** Build the tree. `refs` is every named array and function-free value the tree refers to. */
  | { kind: 'attach'; id: number; epoch: number; tree: ElementJSON; refs: Record<string, unknown>; partition?: PartitionSpec | null }
  /** Change the tree to match, in place; `refs` holds only those that are new or replaced. */
  | {
      kind: 'update';
      id: number;
      epoch: number;
      tree: ElementJSON;
      refs: Record<string, unknown>;
      /** Names the tree no longer mentions: the worker lets go of what they named. */
      drop?: string[];
      partition?: PartitionSpec | null;
      /** Rows that are shared with the page were changed in place: the worker's caches of them are out of date. */
      touch?: boolean;
    }
  /** Plan and fill with this context; `recycle` is a buffer of an earlier result, to write into again. */
  | {
      kind: 'fill';
      id: number;
      key: string;
      width: number;
      height: number;
      domainRange: Extent;
      columns: string[];
      sorted: boolean;
      /** Fill every key of the partition (the spec of the last attach or update), one block each. */
      byKey?: boolean;
      recycle?: ArrayBuffer;
    }
  | { kind: 'detach'; id: number };

/** What the tree answers for itself, whatever part of it is drawn. */
export interface WorkerMeta {
  pointCount: number;
  domain: Extent | null;
  valueExtent: Extent | null;
  channelNames: string[];
  channelExtents: Record<string, Extent | null>;
  /** Present when the boundary was given a partition spec. */
  partition?: PartitionMeta;
}

/** What the worker answers. */
export type FromWorker =
  | { kind: 'meta'; id: number; epoch: number; meta: WorkerMeta }
  /** `buffer` holds `count` points of `stride` numbers, and comes back with the next `fill` as `recycle`. */
  | {
      kind: 'result';
      id: number;
      key: string;
      epoch: number;
      count: number;
      stride: number;
      extents: Extent[];
      buffer: ArrayBuffer;
      /** For a fill by key: the keys, the points of each (a block each in `buffer`, from the number `offsets` says) and their extents. `count` and `extents` are then empty. */
      blocks?: { keys: number[]; sizes: number[]; offsets: number[]; extents: Extent[][] };
    }
  /** `id` 0 is the worker as a whole (it failed to start, or crashed): every boundary on it takes the error as its own. */
  | { kind: 'error'; id: number; message: string };

/**
 * One end of the channel to a worker. Messages are structured-cloneable; `transfer` lists the buffers that move and are not
 * copied. Several boundaries may listen on one worker, which is why this subscribes and does not have a single `onmessage`.
 */
export interface WorkerLike {
  post(message: unknown, transfer?: ArrayBuffer[]): void;
  /** Call `listener` with every message that arrives. Returns the function that stops it. */
  subscribe(listener: (message: unknown) => void): () => void;
  terminate(): void;
}

/**
 * How messages are put in what the worker is also used for: a property name (every message is `{ [name]: message }`), or
 * `wrap` and `unwrap` yourself, where `unwrap` returns null for traffic that is not ours.
 */
export type Envelope = string | { wrap(message: unknown): unknown; unwrap(data: unknown): unknown };

export interface Enveloping {
  wrap(message: unknown): unknown;
  /** The message inside, or null for something that is not one. */
  unwrap(data: unknown): unknown;
}
const BARE: Enveloping = { wrap: (m) => m, unwrap: (d) => d };
/** Both directions of an envelope, as functions. */
export function envelopeOf(envelope: Envelope | undefined): Enveloping {
  if (envelope === undefined) return BARE;
  if (typeof envelope !== 'string') return envelope;
  return {
    wrap: (m) => ({ [envelope]: m }),
    unwrap: (d) => (d !== null && typeof d === 'object' && envelope in d ? (Reflect.get(d, envelope) ?? null) : null),
  };
}

/**
 * Workers that run in this thread: for server rendering and tests, and as the fallback where there is no worker at all.
 *
 *   const worker = new NullWorker(createHost({ FlatDataSource, Decimator, MinMaxKernel }))
 *
 * `NullWorker` answers inside `post`, so a boundary behaves as if its stages were in the tree. `LoopbackWorker` answers
 * later and copies every message as a real worker does, so what is wrong with a message (a function in it) and what is
 * different about an answer that arrives late show up in tests without a browser.
 */
/* oxlint-disable typescript/consistent-type-assertions -- a message is cloned without knowing its shape: each value is checked at runtime (`typeof`, `instanceof`, the prototype) and then narrowed to what was checked */
import { fail } from './element.ts';
import type { WorkerLike } from './workerproto.ts';

/** What answers on the worker side of a channel: called with each message, and given the function that sends one back. */
export type WorkerHandler = (message: unknown, reply: (message: unknown, transfer?: ArrayBuffer[]) => void) => void;

class Listeners {
  readonly #all = new Set<(message: unknown) => void>();
  add(listener: (message: unknown) => void): () => void {
    this.#all.add(listener);
    return () => void this.#all.delete(listener);
  }
  send(message: unknown): void {
    for (const l of Array.from(this.#all)) l(message);
  }
  clear(): void {
    this.#all.clear();
  }
}

/** Runs the handler in the caller's thread, in `post`; nothing is copied. */
export class NullWorker implements WorkerLike {
  readonly #handler: WorkerHandler;
  readonly #listeners = new Listeners();
  #stopped = false;
  constructor(handler: WorkerHandler) {
    this.#handler = handler;
  }
  post(message: unknown): void {
    if (this.#stopped) return;
    this.#handler(message, (m) => this.#listeners.send(m));
  }
  subscribe(listener: (message: unknown) => void): () => void {
    return this.#listeners.add(listener);
  }
  terminate(): void {
    this.#stopped = true;
    this.#listeners.clear();
  }
}

/**
 * Copy a message as `structuredClone` would for what the protocol holds; a buffer in `transfer` moves and is not copied.
 *
 * @internal
 */
export function cloneMessage(value: unknown, transfer: readonly ArrayBuffer[] = []): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') fail(`DataCloneError: a ${typeof value} cannot be sent to a worker`);
    return value;
  }
  if (value instanceof ArrayBuffer) return transfer.includes(value) ? value : value.slice(0);
  if (ArrayBuffer.isView(value)) {
    const shared = typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer;
    // oxlint-disable-next-line typescript/consistent-type-assertions -- a typed array's constructor builds one of its own kind from a buffer or from another array
    const Ctor = value.constructor as new (a: ArrayBufferLike | ArrayLike<number>, o?: number, l?: number) => ArrayBufferView;
    if (shared || transfer.includes(value.buffer as ArrayBuffer))
      return new Ctor(value.buffer, value.byteOffset, (value as unknown as ArrayLike<number>).length);
    return new Ctor(value as unknown as ArrayLike<number>);
  }
  if (Array.isArray(value)) return value.map((x) => cloneMessage(x, transfer));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    fail(
      `DataCloneError: ${value.constructor?.name ?? 'an object'} cannot be sent to a worker: only plain objects, arrays and typed arrays can`,
    );
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = cloneMessage(v, transfer);
  return out;
}

export interface LoopbackOptions {
  /** Deliver nothing until `step` or `drain` is called, so a test can say what has arrived when. Default false: messages are delivered in a microtask. */
  manual?: boolean;
}

/** Runs the handler in this thread, later, with every message copied each way. */
export class LoopbackWorker implements WorkerLike {
  readonly #handler: WorkerHandler;
  readonly #listeners = new Listeners();
  readonly #queue: (() => void)[] = [];
  readonly #manual: boolean;
  #scheduled = false;
  #stopped = false;
  /** How many messages have been posted to the worker, for tests. */
  posted = 0;

  constructor(handler: WorkerHandler, options: LoopbackOptions = {}) {
    this.#handler = handler;
    this.#manual = options.manual ?? false;
  }
  /** Messages (in either direction) waiting to be delivered. */
  get pending(): number {
    return this.#queue.length;
  }
  post(message: unknown, transfer: ArrayBuffer[] = []): void {
    if (this.#stopped) return;
    this.posted++;
    const copy = cloneMessage(message, transfer);
    this.#enqueue(() =>
      this.#handler(copy, (m, t = []) => {
        if (this.#stopped) return;
        const back = cloneMessage(m, t);
        this.#enqueue(() => this.#listeners.send(back));
      }),
    );
  }
  subscribe(listener: (message: unknown) => void): () => void {
    return this.#listeners.add(listener);
  }
  terminate(): void {
    this.#stopped = true;
    this.#queue.length = 0;
    this.#listeners.clear();
  }
  /** Deliver the next `n` messages (default one). */
  step(n = 1): void {
    for (let i = 0; i < n; i++) this.#queue.shift()?.();
  }
  /** Deliver messages until none are left, including the ones they cause. */
  drain(): void {
    while (this.#queue.length) this.#queue.shift()?.();
  }
  /** Resolves once everything posted, and everything it caused, has been delivered (automatic delivery only). */
  idle(): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => (this.#queue.length || this.#scheduled ? void Promise.resolve().then(check) : resolve());
      check();
    });
  }
  #enqueue(task: () => void): void {
    this.#queue.push(task);
    if (this.#manual || this.#scheduled) return;
    this.#scheduled = true;
    void Promise.resolve().then(() => {
      this.#scheduled = false;
      this.drain();
    });
  }
}

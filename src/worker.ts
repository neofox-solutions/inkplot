/**
 * `inkplot/worker`: the entry of a worker that holds the stages of a `WorkerBoundary`.
 *
 *   // data-worker.ts
 *   import { FlatDataSource, Decimator, MinMaxKernel } from 'inkplot';
 *   import { serveWorker } from 'inkplot/worker';
 *   serveWorker({ FlatDataSource, Decimator, MinMaxKernel });
 *
 * The registry names only the classes the worker needs, which is what keeps the worker's bundle small: it holds those
 * classes, the tree reader and this file, and no chart, no axes and no renderers.
 */
import { createHost, type HostOptions } from './workerhost.ts';
import type { ElementRegistry } from './serialize.ts';
import { inkplotError } from './fail.ts';

export { createHost, type HostOptions } from './workerhost.ts';
export type { Envelope } from './workerproto.ts';

/** What a worker listens on and answers through: the worker's own scope (the default), a `MessagePort`, or a Node `parentPort`. */
export interface WorkerPort {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  /** A browser `MessagePort` delivers nothing to `addEventListener` until it is started. */
  start?(): void;
  addEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
  on?(type: 'message', listener: (data: unknown) => void): unknown;
  off?(type: 'message', listener: (data: unknown) => void): unknown;
}
export interface ServeOptions extends HostOptions {
  /** Default: the worker's global scope. */
  port?: WorkerPort;
}

/** Answer the page's `WorkerBoundary`s from now on. Returns the function that stops listening. */
export function serveWorker(registry: ElementRegistry, options: ServeOptions = {}): () => void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- in a worker, the global scope is a port: it posts and listens for messages
  const port = options.port ?? (globalThis as unknown as WorkerPort);
  const handler = createHost(registry, options);
  const reply = (message: unknown, transfer?: ArrayBuffer[]) => port.postMessage(message, transfer);
  const on = (data: unknown) => handler(data, reply);
  if (port.addEventListener) {
    const listener = (e: { data: unknown }) => on(e.data);
    port.addEventListener('message', listener);
    port.start?.();
    return () => port.removeEventListener?.('message', listener);
  }
  if (port.on) {
    port.on('message', on);
    return () => void port.off?.('message', on);
  }
  throw inkplotError(239);
}

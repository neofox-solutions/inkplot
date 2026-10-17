/**
 * `inkplot/node-worker`: a `WorkerLike` over a Node `worker_threads` Worker, for a `WorkerBoundary` on a server (a report, an
 * export, a service drawing many charts of big data). Not in the main entry, which has no Node modules in it.
 *
 *   import { NodeWorker } from 'inkplot/node-worker';
 *   const worker = new NodeWorker(new URL('./data-worker.js', import.meta.url));
 *
 * The worker's file calls `serveWorker(registry, { port: parentPort })` (`parentPort` is from `node:worker_threads`).
 */
import { Worker, type WorkerOptions } from 'node:worker_threads';
import type { WorkerLike } from './workerproto.ts';

export interface NodeWorkerOptions {
  /** Passed to `new Worker` when given a file. */
  worker?: WorkerOptions;
  /** Keep the process running while the worker lives. Default false: a finished script is not held up by its worker. */
  keepAlive?: boolean;
}

export class NodeWorker implements WorkerLike {
  readonly worker: Worker;
  readonly #listeners = new Set<(message: unknown) => void>();
  readonly #owned: boolean;
  #failed: { kind: 'error'; id: 0; message: string } | null = null;

  /** A file to start a worker from, or a `Worker` that is already running (which `terminate` then leaves alone). */
  constructor(worker: string | URL | Worker, options: NodeWorkerOptions = {}) {
    this.#owned = !(worker instanceof Worker);
    this.worker = worker instanceof Worker ? worker : new Worker(worker, options.worker);
    if (!options.keepAlive) this.worker.unref();
    this.worker.on('message', (data: unknown) => {
      for (const l of Array.from(this.#listeners)) l(data);
    });
    const fail = (message: string) => {
      this.#failed = { kind: 'error', id: 0, message };
      for (const l of Array.from(this.#listeners)) l(this.#failed);
    };
    this.worker.on('error', (e: Error) => fail(`the worker failed: ${e.message}`));
    this.worker.on('exit', (code: number) => code !== 0 && fail(`the worker exited with code ${code}`));
  }
  post(message: unknown, transfer: ArrayBuffer[] = []): void {
    this.worker.postMessage(message, transfer);
  }
  subscribe(listener: (message: unknown) => void): () => void {
    this.#listeners.add(listener);
    const failed = this.#failed;
    if (failed) void Promise.resolve().then(() => this.#listeners.has(listener) && listener(failed));
    return () => void this.#listeners.delete(listener);
  }
  terminate(): void {
    this.#listeners.clear();
    if (this.#owned) void this.worker.terminate();
  }
}

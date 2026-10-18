/**
 * A `WorkerLike` over a Web Worker: what a `WorkerBoundary` is given in a page.
 *
 *   const worker = new WebWorker(new URL('./data-worker.ts', import.meta.url))
 *   new WorkerBoundary({ worker, registry: { FlatDataSource, Decimator, MinMaxKernel } }, ...)
 *
 * The worker's entry calls `serveWorker` (from `inkplot/worker`). Finding the file is the bundler's job, which is why the
 * address is written as `new URL(…, import.meta.url)`, the form Vite, webpack and esbuild all follow. A worker that fails
 * (its script is missing, or throws on load) is told to every boundary on it as an error, and not covered up.
 */
import type { WorkerLike } from './workerproto.ts';
import { errorText } from './fail.ts';

export interface WebWorkerOptions {
  /** Passed to `new Worker`, which is only done when given an address. Default `{ type: 'module' }`. */
  worker?: WorkerOptions;
}

export class WebWorker implements WorkerLike {
  readonly worker: Worker;
  readonly #listeners = new Set<(message: unknown) => void>();
  readonly #owned: boolean;
  // A worker that has failed stays failed: a boundary that starts listening later is told too.
  #failed: { kind: 'error'; id: 0; message: string } | null = null;

  /** An address to start a worker from, or a `Worker` that is already running (which `terminate` then leaves alone). */
  constructor(worker: string | URL | Worker, options: WebWorkerOptions = {}) {
    this.#owned = !(worker instanceof Worker);
    this.worker = worker instanceof Worker ? worker : new Worker(worker, options.worker ?? { type: 'module' });
    this.worker.addEventListener('message', (e: MessageEvent) => {
      for (const l of Array.from(this.#listeners)) l(e.data);
    });
    // Id 0 is every boundary: they are told, and the next `plan` of each throws it.
    const fail = (message: string) => () => {
      this.#failed = { kind: 'error', id: 0, message };
      for (const l of Array.from(this.#listeners)) l(this.#failed);
    };
    this.worker.addEventListener('error', (e: ErrorEvent) => fail(errorText(257, e.message || 'it could not be started'))());
    this.worker.addEventListener('messageerror', fail(errorText(259)));
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
    if (this.#owned) this.worker.terminate();
  }
}

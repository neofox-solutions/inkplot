// The worker boundary: the protocol, stale-while-revalidate, and the same chart with and without the worker.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  CartesianPlane,
  Chart,
  createHost,
  Decimator,
  Entrance,
  DomainSeries,
  FlatDataSource,
  LinearCurve,
  LinearScale,
  LinePath,
  lightTheme,
  LoopbackWorker,
  MinMaxKernel,
  NullWorker,
  StringPlatform,
  WorkerBoundary,
  type PlanContext,
  type ToWorker,
  type WorkerLike,
} from './index.ts';
import { serveWorker } from './worker.ts';

const registry = { FlatDataSource, Decimator, MinMaxKernel };
const W = 400,
  H = 300;
const wave = (n: number) => {
  const data = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) data.set([i, Math.sin(i / 50) * 10 + Math.cos(i / 7)], 2 * i);
  return data;
};
const stages = (data: Float64Array) => new Decimator({}, new MinMaxKernel(), new FlatDataSource({ data, stride: 2, isSorted: true }));
const context = (min = 0, max = 1e5, width = W): PlanContext => ({ width, height: H, domainRange: { min, max }, channels: [] });

/** A worker that records what was posted to it (the messages inside any envelope are as the boundary made them). */
function spy(inner: WorkerLike) {
  const posted: { message: ToWorker; transfer: ArrayBuffer[] }[] = [];
  const worker: WorkerLike = {
    post: (message, transfer = []) => {
      posted.push({ message: message as ToWorker, transfer });
      inner.post(message, transfer);
    },
    subscribe: (l) => inner.subscribe(l),
    terminate: () => inner.terminate(),
  };
  return { worker, posted, kinds: () => posted.map((p) => p.message.kind) };
}
function chartOf(source: WorkerBoundary | Decimator) {
  const series = new DomainSeries({}, source, new LinePath(new LinearCurve()));
  const plane = new CartesianPlane({}, new Axis({}, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()), series);
  const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane);
  chart.attach(new StringPlatform({ width: W, height: H })).flush();
  return { chart, plane, series: plane.series[0]! };
}
const pointsOf = (s: { points: { data: Float64Array; count: number; stride: number } }) =>
  Array.from(s.points.data.subarray(0, s.points.count * s.points.stride));

test('worker boundary: with a NullWorker the chart is the chart without it', () => {
  const data = wave(100_000);
  const plain = chartOf(stages(data));
  const worker = new NullWorker(createHost(registry));
  const bounded = chartOf(new WorkerBoundary({ worker, registry }, stages(data)));
  assert.ok(plain.series.points.count > 100);
  assert.equal(bounded.series.points.count, plain.series.points.count);
  assert.deepEqual(pointsOf(bounded.series), pointsOf(plain.series));
});

test('worker boundary: nothing at first, then the points when they arrive', async () => {
  const data = wave(100_000);
  const plain = chartOf(stages(data));
  const worker = new LoopbackWorker(createHost(registry));
  const boundary = new WorkerBoundary({ worker, registry }, stages(data));
  assert.equal(boundary.arrived, false);
  const { chart, series } = chartOf(boundary);
  assert.equal(series.points.count, 0, 'empty axes on the first paint');
  assert.equal(boundary.pending, true);
  for (let i = 0; i < 6 && boundary.pending; i++) {
    await worker.idle();
    chart.flush();
  }
  assert.equal(boundary.pending, false, `settled (posted ${worker.posted})`);
  assert.equal(boundary.pointCount, 100_000);
  assert.deepEqual(boundary.domain(), { min: 0, max: 99_999 });
  // Same points. (Their x positions can differ a little: the y axis measured the empty chart's labels, and gives room back only for a clear gain.)
  assert.equal(series.points.count, plain.series.points.count);
  assert.deepEqual(
    pointsOf(series).filter((_, i) => i % 2 === 1),
    pointsOf(plain.series).filter((_, i) => i % 2 === 1),
  );
});

test('worker boundary: one request out, the newest waits, and the last answer shown stands in until the next', () => {
  const worker = new LoopbackWorker(createHost(registry), { manual: true });
  const s = spy(worker);
  const boundary = new WorkerBoundary({ worker: s.worker, registry }, stages(wave(50_000)));
  const out = new Float64Array(4000);
  boundary.plan(context(0, 50_000));
  assert.deepEqual(s.kinds(), ['attach', 'fill']);
  // The worker has them, and nothing has been delivered back to the page: five asks while the first is out make one waiting request.
  worker.step(2);
  const first = boundary.plan(context(0, 50_000));
  assert.equal(first.capacity, 0, 'no points yet');
  for (let i = 1; i <= 5; i++) boundary.plan(context(i * 100, 50_000));
  assert.deepEqual(s.kinds(), ['attach', 'fill'], 'one request is out: the rest only wait');
  worker.step(2);
  // The first answer is in; the newest ask (and only that) went out after it.
  assert.deepEqual(s.kinds(), ['attach', 'fill', 'fill']);
  assert.equal((s.posted[2]!.message as Extract<ToWorker, { kind: 'fill' }>).domainRange.min, 500);
  // The answer for 0..50000 stands in for the ask for 500..50000 until its own arrives.
  const stale = boundary.plan(context(500, 50_000));
  assert.ok(stale.capacity > 0);
  const r = stale.fill(out);
  assert.ok(r.count > 0 && r.count <= stale.capacity);
  assert.equal(r.extents[0]!.min, 0, 'the stale answer is the one for the whole domain');
  worker.step(2);
  const fresh = boundary.plan(context(500, 50_000)).fill(out);
  assert.ok(fresh.extents[0]!.min >= 400, 'now the one that was asked for');
  assert.deepEqual(s.kinds(), ['attach', 'fill', 'fill'], 'asking for what is already there asks for nothing');
});

test('worker boundary: a change is an update, arrays that did not change are not sent again, and answers are for the new tree', () => {
  const worker = new LoopbackWorker(createHost(registry), { manual: true });
  const s = spy(worker);
  const dec = stages(wave(50_000));
  const boundary = new WorkerBoundary({ worker: s.worker, registry }, dec);
  boundary.plan(context());
  worker.drain();
  const attach = s.posted[0]!.message as Extract<ToWorker, { kind: 'attach' }>;
  assert.deepEqual(Object.keys(attach.refs), ['data']);
  const small = boundary.plan(context()).capacity;
  assert.ok(small > 0 && small < 2000);
  dec.setAttributes({ enabled: false });
  const out = new Float64Array(2 * 50_000);
  boundary.plan(context());
  worker.drain();
  const update = s.posted.find((p) => p.message.kind === 'update')!.message as Extract<ToWorker, { kind: 'update' }>;
  assert.deepEqual(update.refs, {}, 'the data was not sent again');
  assert.equal(boundary.pointCount, 50_000);
  const plan = boundary.plan(context());
  assert.equal(plan.capacity, 50_000, 'undecimated now');
  assert.equal(plan.fill(out).count, 50_000);
});

test('worker boundary: a transferred array moves once; the extents come with the first answer', () => {
  const worker = new LoopbackWorker(createHost(registry), { manual: true });
  const s = spy(worker);
  const data = wave(20_000);
  const boundary = new WorkerBoundary({ worker: s.worker, registry, transfer: true }, stages(data));
  assert.equal(boundary.valueExtent(), null, 'unknown before the worker has answered');
  worker.drain();
  assert.deepEqual(s.posted[0]!.transfer, [data.buffer]);
  const extent = boundary.valueExtent();
  assert.ok(extent && extent.min < -9 && extent.max > 9);
  boundary.setAttributes({ transfer: true });
  boundary.source.invalidate();
  boundary.domain();
  assert.deepEqual(s.posted[1]!.transfer, [], 'the same buffer is not moved a second time');
});

test('worker boundary: an error in the worker is thrown from the next plan, with the boundary named', () => {
  const worker = new LoopbackWorker(createHost({ FlatDataSource }), { manual: true });
  const boundary = new WorkerBoundary({ worker, registry }, stages(wave(1000)));
  boundary.plan(context());
  worker.drain();
  assert.throws(() => boundary.plan(context()), /WorkerBoundary: .*unknown type "Decimator"/);
  // Said once: the next ask is a fresh one.
  assert.doesNotThrow(() => boundary.plan(context(1, 2)));
});

test('worker boundary: what a worker cannot be sent is an error that says so', () => {
  const worker = new LoopbackWorker(createHost(registry));
  const kernel = new MinMaxKernel();
  const bad = new Decimator({ onChange: () => 1 } as never, kernel, new FlatDataSource({ data: wave(10), stride: 2 }));
  const boundary = new WorkerBoundary({ worker, registry }, bad);
  assert.throws(() => boundary.plan(context()), /could not be sent/);
});

test('worker boundary: detach on removal, and an envelope shares the worker with other traffic', async () => {
  const handler = createHost(registry, { envelope: 'ink' });
  const worker = new LoopbackWorker(handler);
  const s = spy(worker);
  const traffic: unknown[] = [];
  s.worker.subscribe((m) => traffic.push(m));
  const boundary = new WorkerBoundary({ worker: s.worker, registry, envelope: 'ink' }, stages(wave(10_000)));
  const { chart, plane, series } = chartOf(boundary);
  await worker.idle();
  chart.flush();
  assert.ok(series.points.count > 0);
  assert.ok((s.posted[0]!.message as unknown as Record<string, unknown>).ink, 'messages are wrapped');
  // Traffic that is not ours is ignored, both ways.
  worker.post({ hello: 'world' });
  await worker.idle();
  plane.remove(series);
  chart.flush();
  assert.equal(s.kinds().length, s.posted.length);
  assert.ok(traffic.length >= 2);
});

test('worker boundary: the entrance waits for the first points, and plays then', async () => {
  const worker = new LoopbackWorker(createHost(registry));
  const boundary = new WorkerBoundary({ worker, registry }, stages(wave(10_000)));
  const series = new DomainSeries({}, boundary, new LinePath(new LinearCurve()));
  const plane = new CartesianPlane({}, new Axis({}, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()), series);
  const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane, new Entrance({}));
  const platform = new StringPlatform({ width: W, height: H });
  Object.assign(platform, { setTransition: () => {} });
  chart.attach(platform).flush();
  assert.equal(chart.awaitingData, true);
  assert.doesNotMatch(platform.toString(), /data-ink-enter/, 'empty axes: nothing to enter yet');
  for (let i = 0; i < 4 && chart.awaitingData; i++) {
    await worker.idle();
    chart.flush();
  }
  assert.equal(chart.awaitingData, false);
  await worker.idle();
  chart.flush();
  assert.match(platform.toString(), /data-ink-enter="sweep"/);
});

test('serveWorker: answers on a port, whichever way the port listens', () => {
  const tree = { type: 'FlatDataSource', attrs: { data: { $ref: 'data' }, stride: 2, isSorted: true } };
  const attach = { kind: 'attach', id: 7, epoch: 1, tree, refs: { data: wave(100) } };
  const fill = { kind: 'fill', id: 7, key: 'k', width: 300, height: 100, domainRange: { min: 0, max: 99 }, channels: [], sequence: false };
  for (const style of ['events', 'emitter']) {
    const sent: { kind: string; count?: number; pointCount?: number }[] = [];
    const hook: { listener: ((data: unknown) => void) | null } = { listener: null };
    const post = (m: unknown) => void sent.push(m as (typeof sent)[number]);
    const port =
      style === 'events'
        ? {
            postMessage: post,
            addEventListener: (_: 'message', l: (e: { data: unknown }) => void) => (hook.listener = (d) => l({ data: d })),
          }
        : { postMessage: post, on: (_: 'message', l: (d: unknown) => void) => (hook.listener = l) };
    const stop = serveWorker({ FlatDataSource }, { port });
    const listener = hook.listener ?? assert.fail(style);
    listener(attach);
    listener(fill);
    listener({ somebody: 'else' });
    assert.deepEqual(
      sent.map((m) => m.kind),
      ['meta', 'result'],
      style,
    );
    assert.equal((sent[1] as { count: number }).count, 100);
    stop();
  }
  assert.throws(() => serveWorker({}, { port: { postMessage() {} } }), /no worker scope/);
});

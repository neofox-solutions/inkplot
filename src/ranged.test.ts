// Ranged fills: a plan that can write some of its rows writes the same rows a full fill would, with the extents and `rowOf` of
// those rows; a `Slice` uses that to read its window and nothing else, and says how big the window is.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  CompositeDataSource,
  createHost,
  Decimator,
  FlatDataSource,
  LinkedData,
  LoopbackWorker,
  MinMaxKernel,
  ObjectDataSource,
  Slice,
  SyntheticDataSource,
  WorkerBoundary,
  type FillPlan,
  type PlanContext,
} from './index.ts';
import { rowRange, type DataNode } from './data.ts';

const ctx = (channels: string[] = [], width = 64): PlanContext => ({
  width,
  height: 10,
  domainRange: { min: -1e9, max: 1e9 },
  columns: ['domain', 'value', ...channels],
});
const full = (plan: FillPlan, stride: number) => {
  const out = new Float64Array(plan.capacity * stride);
  const r = plan.fill(out);
  return { rows: Array.from({ length: r.count }, (_, i) => Array.from(out.subarray(stride * i, stride * (i + 1)))), r };
};
const part = (plan: FillPlan, stride: number, from?: number, to?: number) => {
  const out = new Float64Array(plan.capacity * stride + 3).fill(-7);
  const r = plan.fill(out, from, to);
  return { rows: Array.from({ length: r.count }, (_, i) => Array.from(out.subarray(stride * i, stride * (i + 1)))), r, out };
};
const extentsOfRows = (rows: number[][], stride: number) =>
  Array.from({ length: stride }, (_, c) => {
    const v = rows.map((r) => r[c]!).filter((x) => !Number.isNaN(x));
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : { min: Infinity, max: -Infinity };
  });

/** Every range of a plan gives the rows `slice` of the full fill gives, their extents, and the `rowOf` of the full fill. */
function agrees(name: string, make: () => DataNode, channels: string[] = []) {
  const stride = 2 + channels.length;
  const whole = make().plan(ctx(channels));
  assert.equal(typeof whole.rows, 'number', `${name}: can be ranged`);
  const all = full(whole, stride);
  assert.equal(all.rows.length, whole.rows);
  for (const [from, to] of [
    [0, undefined],
    [3, 9],
    [0, 1],
    [5, 5],
    [7, 2],
    [-4, 3],
    [2, 1e9],
    [whole.rows! - 1, undefined],
    [1e9, undefined],
  ] as const) {
    const [lo, hi] = rowRange(all.rows.length, from, to);
    const got = part(make().plan(ctx(channels)), stride, from, to);
    assert.deepEqual(got.rows, all.rows.slice(lo, hi), `${name}: rows ${from}..${to}`);
    assert.deepEqual(
      got.r.extents,
      hi > lo ? extentsOfRows(all.rows.slice(lo, hi), stride) : got.r.extents.map(() => ({ min: Infinity, max: -Infinity })),
      `${name}: extents ${from}..${to}`,
    );
    if (got.r.rowOf && all.r.rowOf)
      for (let i = 0; i < hi - lo; i++) assert.equal(got.r.rowOf(i), all.r.rowOf(lo + i), `${name}: rowOf ${i} of ${from}..${to}`);
    assert.equal(got.out[stride * (hi - lo)], -7, `${name}: nothing written past the rows`);
  }
}

test('ranged fill: every source writes the rows a full fill has', () => {
  const xs = Float64Array.from({ length: 40 }, (_, i) => i * 0.5);
  const ys = Float64Array.from({ length: 40 }, (_, i) => Math.sin(i));
  const zs = Float64Array.from({ length: 40 }, (_, i) => i % 7);
  const pairs = Float64Array.from({ length: 80 }, (_, i) => (i % 2 ? Math.cos(i) : i / 2));
  agrees('flat, stored domain, in order', () => new FlatDataSource({ data: pairs, stride: 2, isSorted: true }));
  agrees('flat, regular domain', () => new FlatDataSource({ data: ys, regularDomain: { start: 5, step: 2 } }));
  agrees('flat, channels', () => new FlatDataSource({ data: pairs, stride: 2, isSorted: true }), ['x', 'y']);
  const shuffled = Float64Array.from({ length: 80 }, (_, i) => (i % 2 ? Math.cos(i) : ((i / 2) * 7) % 40));
  agrees('flat, sorted into the managed copy', () => new FlatDataSource({ data: shuffled, stride: 2 }));
  agrees(
    'flat, regrouped channels from the managed copy',
    () => new FlatDataSource({ data: shuffled, stride: 2, channels: { x: 0, y: 1 } }),
    ['y', 'x'],
  );
  const rows = Array.from({ length: 40 }, (_, i) => ({ k: i, v: ys[i]!, w: zs[i]! }));
  agrees('object', () => new ObjectDataSource({ source: rows, domain: 'k', value: 'v', isSorted: true, channels: { w: 'w' } }), ['w']);
  agrees('object, wrapped', () => new ObjectDataSource({ source: rows, domain: 'k', value: 'v', isSorted: true, wrap: 50 }));
  agrees('composite', () => new CompositeDataSource({ count: 40, domain: (i) => i, value: ys, channels: { z: zs, a: (i) => i * i } }), [
    'a',
    'z',
  ]);
  agrees('composite, unsorted', () => new CompositeDataSource({ count: 40, domain: (i) => (i * 7) % 40, value: ys, channels: { z: zs } }), [
    'z',
  ]);
  agrees(
    'composite, NaN gaps',
    () => new CompositeDataSource({ count: 40, domain: xs, value: (i) => (i % 5 ? ys[i]! : NaN), isSorted: true }),
  );
  agrees('synthetic, fixed count', () => new SyntheticDataSource({ fn: Math.sin, domain: { min: 0, max: 6 }, count: 33 }));
  agrees('synthetic, by width', () => new SyntheticDataSource({ fn: Math.cos, domain: { min: 0, max: 6 } }));
  agrees('synthetic, one sample', () => new SyntheticDataSource({ fn: Math.cos, domain: { min: 2, max: 6 }, count: 1 }));
  // A slice of a slice is still ranged, and agrees with itself.
  agrees(
    'slice of a slice',
    () => new Slice({ start: 4, end: 30 }, new Slice({ last: 35 }, new FlatDataSource({ data: pairs, stride: 2, isSorted: true }))),
  );
});

test('ranged fill: a Slice reads its window and says how big it is', () => {
  const N = 100_000;
  let called = 0;
  const mk = () =>
    new CompositeDataSource({
      count: N,
      domain: (i) => (called++, i),
      value: (i) => i * 2,
      channels: { z: (i) => i + 0.5 },
      isSorted: true,
    });
  const slice = new Slice({ last: 50, end: 1000 }, mk());
  const plan = slice.plan(ctx(['z']));
  assert.equal(plan.capacity, 50, 'room for the window and no more');
  assert.equal(plan.rows, 50);
  called = 0;
  const { rows, r } = part(plan, 3);
  assert.deepEqual(rows[0], [950, 1900, 950.5]);
  assert.equal(r.count, 50);
  assert.ok(called <= 50, `the domain was computed for the window (${called} rows), not the source`);
  // Everything it reports about itself is the window's too, and costs the window's.
  called = 0;
  assert.equal(slice.pointCount, 50);
  assert.deepEqual(slice.domain(), { min: 950, max: 999 });
  assert.deepEqual(slice.valueExtent(), { min: 1900, max: 1998 });
  assert.deepEqual(slice.channelExtent('z'), { min: 950.5, max: 999.5 });
  assert.ok(called <= 150, `${called} rows for the extents of a 50-row window`);
  // Moving the window moves what is read, with the source untouched.
  slice.setAttribute('end', 60_000);
  assert.deepEqual(part(slice.plan(ctx(['z'])), 3).rows[0], [59_950, 119_900, 59_950.5]);
  // A window bigger than the source is the source; past its end is nothing.
  assert.equal(new Slice({ start: N - 3 }, mk()).plan(ctx()).rows, 3);
  assert.equal(new Slice({ start: N + 5 }, mk()).plan(ctx()).rows, 0);
});

test('ranged fill: rowOf says which stored row each kept point is, through a Slice and a LinkedData', () => {
  // Stored out of order: the points are sorted, and rowOf is the way back to the row a point came from.
  const data = Float64Array.from([5, 50, 3, 30, 4, 40, 1, 10, 2, 20, 0, 0]);
  const flat = new FlatDataSource({ data, stride: 2, id: 'f' });
  const slice = new Slice({ start: 2, end: 5 }, flat);
  const { rows, r } = part(slice.plan(ctx()), 2);
  assert.deepEqual(rows, [
    [2, 20],
    [3, 30],
    [4, 40],
  ]);
  assert.deepEqual(
    [0, 1, 2].map((i) => r.rowOf!(i)),
    [4, 1, 2],
    'storage rows of the sorted points 2, 3, 4',
  );
  const linked = part(new LinkedData({ source: flat }).plan(ctx()), 2, 1, 3);
  assert.deepEqual(
    [0, 1].map((i) => linked.r.rowOf!(i)),
    [3, 4],
  );
  // Below a Decimator the rows are made up: a Slice over one fills it all, keeps some, and says nothing it cannot know.
  const wave = () =>
    new FlatDataSource({ data: Float64Array.from({ length: 2000 }, (_, i) => (i % 2 ? Math.sin(i) : i / 2)), stride: 2, isSorted: true });
  const dec = new Decimator({}, new MinMaxKernel(), wave());
  const dec2 = new Decimator({}, new MinMaxKernel(), wave());
  const over = new Slice({ last: 10 }, dec2).plan(ctx([], 50));
  assert.equal(over.rows, undefined, 'a window of decimated rows is made the long way');
  const decimated = full(dec.plan(ctx([], 50)), 2).rows;
  assert.deepEqual(part(over, 2).rows, decimated.slice(-10));
  // A Slice of a slice of a decimator is the same, and a decimator above a ranged slice sees only the window.
  assert.deepEqual(
    part(new Slice({ last: 4 }, new Slice({ last: 10 }, new Decimator({}, new MinMaxKernel(), wave()))).plan(ctx([], 50)), 2).rows,
    decimated.slice(-4),
  );
  const above = new Decimator({}, new MinMaxKernel(), new Slice({ start: 100, end: 200 }, wave()));
  const seen = full(above.plan(ctx([], 1000)), 2).rows;
  assert.ok(seen.length > 0 && seen.every(([x]) => x! >= 100 && x! < 200));
});

test('ranged fill: through a WorkerBoundary', async () => {
  const N = 20_000;
  const data = Float64Array.from({ length: 2 * N }, (_, i) => (i % 2 ? Math.sin(i / 100) : i / 2));
  const yAt = (k: number) => Math.sin((2 * k + 1) / 100);
  const registry = { FlatDataSource, Slice };
  const worker = new LoopbackWorker(createHost(registry));
  const settle = async (b: WorkerBoundary, c: PlanContext) => {
    for (let i = 0; i < 50; i++) {
      b.plan(c);
      if (!b.pending) return b.plan(c);
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('the worker did not answer');
  };

  // A Slice below the boundary is run in the worker: only the window crosses, and the page gets room for the window.
  const win = new Slice({ last: 100, end: 5000 }, new FlatDataSource({ data, stride: 2, isSorted: true }));
  const inside = new WorkerBoundary({ worker, registry }, win);
  const c = ctx();
  const plan = await settle(inside, c);
  assert.equal(plan.capacity, 100);
  assert.equal(inside.pointCount, 100);
  assert.deepEqual(inside.domain(), { min: 4900, max: 4999 });
  assert.deepEqual(part(plan, 2).rows[0], [4900, yAt(4900)]);
  // Moving the window changes the description the worker is given, and the answer follows.
  win.setAttribute('end', 9000);
  assert.deepEqual(part(await settle(inside, c), 2).rows[0], [8900, yAt(8900)]);

  // A Slice above the boundary windows what arrived, with the right rows, extents and count.
  const outside = new WorkerBoundary({ worker, registry }, new FlatDataSource({ data, stride: 2, isSorted: true }));
  const slice = new Slice({ start: 1000, end: 1010 }, outside);
  await settle(outside, c);
  const sp = slice.plan(c);
  assert.equal(sp.rows, 10);
  const got = part(sp, 2);
  assert.deepEqual(
    got.rows.map((r) => r[0]),
    Array.from({ length: 10 }, (_, i) => 1000 + i),
  );
  assert.deepEqual(got.r.extents[0], { min: 1000, max: 1009 });
  assert.deepEqual(got.r.extents[1], extentsOfRows(got.rows, 2)[1]);
  worker.terminate();
});

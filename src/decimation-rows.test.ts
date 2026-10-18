// A Decimator keeps rows of its source as they are, so it can carry channels and say which row each point is.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  CompositeDataSource,
  Decimator,
  FlatDataSource,
  LttbKernel,
  M4Kernel,
  MinMaxKernel,
  Slice,
  StrideKernel,
  type DataNode,
  type DecimationKernel,
  type PlanContext,
} from './index.ts';
import { partitionOf, planPartitioned } from './partition.ts';

const N = 5000;
/** The domain is a permutation of 0..N-1, so the source has to be sorted and a point's storage row is not its place. */
const domainAt = (i: number) => (i * 37) % N;
const valueAt = (i: number) => (i % 97 === 0 ? NaN : Math.sin(i / 40) * 5);
const weightAt = (i: number) => 3 * i + 1;
const source = () => new CompositeDataSource({ count: N, domain: domainAt, value: valueAt, channels: { w: weightAt } });
const context = (width: number, range = { min: 0, max: N }, columns = ['domain', 'value', 'w']): PlanContext => ({
  width,
  height: 100,
  domainRange: range,
  sorted: true,
  columns,
});
const kernels: [string, () => DecimationKernel][] = [
  ['MinMax', () => new MinMaxKernel()],
  ['M4', () => new M4Kernel()],
  ['Lttb', () => new LttbKernel()],
  ['Stride', () => new StrideKernel()],
];

function read(node: DataNode, ctx: PlanContext) {
  const plan = node.plan(ctx),
    k = ctx.columns.length,
    out = new Float64Array(plan.capacity * k);
  const r = plan.fill(out);
  return { r, out, k };
}
const same = (a: number, b: number) => Object.is(a, b) || (a !== a && b !== b);

for (const [name, kernel] of kernels) {
  test(`decimator rows: ${name} carries channels, and rowOf says which row of the source each point is`, () => {
    for (const range of [
      { min: 0, max: N },
      { min: 1200, max: 2600 },
    ]) {
      const { r, out, k } = read(new Decimator({}, kernel(), source()), context(100, range));
      assert.ok(r.count > 10 && r.count < 1000, `${r.count} points`);
      assert.ok(r.rowOf, 'it says which rows');
      for (let m = 0; m < r.count; m++) {
        const row: number = r.rowOf(m);
        const at = `${name} point ${m} of ${range.min}..${range.max}`;
        assert.equal(out[k * m], domainAt(row), `${at}: domain`);
        assert.ok(same(out[k * m + 1]!, valueAt(row)), `${at}: value`);
        assert.equal(out[k * m + 2], weightAt(row), `${at}: the channel is the row's`);
      }
      // The extents of a carried channel are those of the rows kept.
      const ws = Array.from({ length: r.count }, (_, m) => out[k * m + 2]!);
      assert.deepEqual(r.extents[2], { min: Math.min(...ws), max: Math.max(...ws) });
    }
  });
}

test('decimator rows: without channels it still says which rows, and the answer outlives the next fill', () => {
  const dec = new Decimator({}, new MinMaxKernel(), source());
  const first = read(dec, context(100, { min: 0, max: N }, ['domain', 'value']));
  const kept = Array.from({ length: first.r.count }, (_, m) => first.r.rowOf!(m));
  read(dec, context(100, { min: 2000, max: 2500 }, ['domain', 'value']));
  assert.deepEqual(
    Array.from({ length: first.r.count }, (_, m) => first.r.rowOf!(m)),
    kept,
  );
});

test('decimator rows: over a Slice the channels and rows come from what the Slice delivers', () => {
  const dec = new Decimator({}, new MinMaxKernel(), new Slice({ start: 500, end: 4500 }, source()));
  const { r, out, k } = read(dec, context(80));
  assert.ok(r.count > 10 && r.rowOf);
  for (let m = 0; m < r.count; m++) {
    const row: number = r.rowOf(m);
    assert.equal(out[k * m], domainAt(row));
    assert.equal(out[k * m + 2], weightAt(row));
  }
});

test('decimator rows: a kernel that does not say which rows it kept cannot carry channels', () => {
  class Unaware extends MinMaxKernel {
    override get tracksRows(): boolean {
      return false;
    }
  }
  const dec = new Decimator({}, new Unaware(), source());
  assert.throws(() => dec.plan(context(100)), /cannot carry channels with Unaware/);
  const plain = read(dec, context(100, { min: 0, max: N }, ['domain', 'value']));
  assert.equal(plain.r.rowOf, undefined, 'and gives no rows either');
});

test('decimator rows: in a partition each key carries its channels and rows', () => {
  const n = 6000;
  const data = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) data.set([i, Math.sin(i / 30) * 4 + (i % 3), i % 3, 7 * i], 4 * i);
  const make = () => new FlatDataSource({ data, stride: 4, channels: { k: 2, w: 3 }, isSorted: true });
  const dec = new Decimator({}, new MinMaxKernel(), make());
  const part = partitionOf(dec.source as FlatDataSource, 'k', 'first', 10)!;
  const ctx = context(60, { min: 0, max: n }, ['domain', 'value', 'w']);
  const plan = planPartitioned(dec, ctx, part);
  part.keys.forEach((key, slot) => {
    const out = new Float64Array(plan.capacity(slot) * 3);
    const g = plan.fill(slot, out);
    assert.ok(g.count > 10 && g.count < 600, `key ${key}: ${g.count} points`);
    assert.ok(g.rowOf);
    for (let m = 0; m < g.count; m++) {
      const row: number = g.rowOf(m);
      assert.equal(row % 3, key, 'a row of this key');
      assert.equal(out[3 * m], row);
      assert.equal(out[3 * m + 2], 7 * row);
    }
  });
});

for (const [name, kernel] of kernels.slice(0, 2)) {
  test(`decimator rows: ${name} over a partition says the source row, in the pass over all keys and after it`, () => {
    const n = 6000;
    const data = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) data.set([i, Math.sin(i / 30) * 4 + (i % 3), i % 3], 3 * i);
    const dec = new Decimator({}, kernel(), new FlatDataSource({ data, stride: 3, channels: { k: 2 }, isSorted: true }));
    const part = partitionOf(dec.source as FlatDataSource, 'k', 'first', 10)!;
    for (const range of [
      { min: 0, max: n },
      { min: 2000, max: 3500 },
      { min: 0, max: n },
    ]) {
      // The first pass runs the keys together; later ones run each key alone. Both say which rows.
      const plan = planPartitioned(dec, context(60, range, ['domain', 'value']), part);
      part.keys.forEach((key, slot) => {
        const out = new Float64Array(plan.capacity(slot) * 2);
        const g = plan.fill(slot, out);
        assert.ok(g.count > 10 && g.rowOf, `key ${key}: ${g.count} points`);
        for (let m = 0; m < g.count; m++) {
          const row: number = g.rowOf(m);
          assert.equal(row % 3, key, 'a row of this key');
          assert.equal(out[2 * m], row);
          assert.equal(out[2 * m + 1], data[3 * row + 1]);
        }
      });
    }
  });
}

test('decimation: a line with more gaps than the output has room for still reaches the end of the data', () => {
  // Each stretch of NaN can cost a gap point and a run of its own, so a column with several can want more than the 2 points a
  // column is given: the columns after it used to find the buffer full, and the right of the line was cut off.
  const N = 100000,
    W = 100;
  const patterns: [string, (i: number) => number][] = [
    ['ten isolated gaps', (i) => (i % 10007 === 5 ? NaN : Math.sin(i / 300))],
    ['alternating', (i) => (i % 2 ? NaN : Math.sin(i / 300))],
    ['gaps in every column', (i) => (i % 400 < 3 ? NaN : Math.sin(i / 300))],
    ['a wide gap and scattered ones', (i) => (i > 30000 && i < 36000 ? NaN : i % 997 === 0 ? NaN : Math.cos(i / 200))],
  ];
  for (const [name, f] of patterns) {
    for (const kernel of [new MinMaxKernel(), new M4Kernel()]) {
      const data = Float64Array.from({ length: N }, (_, i) => f(i));
      const plan = new Decimator({}, kernel, new FlatDataSource({ data, regularDomain: { start: 0, step: 1 }, count: N })).plan({
        width: W,
        height: 50,
        domainRange: { min: 0, max: N - 1 },
        sorted: true,
        columns: ['domain', 'value'],
      });
      const out = new Float64Array(plan.capacity * 2);
      const r = plan.fill(out);
      const label = `${name}, ${kernel.constructor.name}`;
      assert.ok(r.count <= plan.capacity, `${label}: ${r.count} of ${plan.capacity}`);
      let lastX = -1,
        lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < r.count; i++) {
        const y = out[2 * i + 1]!;
        if (y === y) {
          lastX = out[2 * i]!;
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
      assert.ok(lastX >= N - (2 * N) / W, `${label}: the line ends at ${lastX} of ${N - 1}`);
      let want = [Infinity, -Infinity];
      for (let i = 0; i < N; i++) if (data[i]! === data[i]!) want = [Math.min(want[0]!, data[i]!), Math.max(want[1]!, data[i]!)];
      assert.deepEqual([lo, hi], want, `${label}: the extremes survive`);
    }
  }
});

test('decimation: LTTB over fewer rows than pixel columns keeps each row once', () => {
  // A large source, zoomed in until the window holds a handful of rows: the kernel runs on them and must not repeat or invent any.
  const N = 5000;
  const data = Float64Array.from({ length: N }, (_, i) => i * 2);
  for (const [min, max] of [
    [500, 500.5],
    [500, 501.5],
    [500, 502.5],
    [500, 504.5],
    [-100, 0.5],
  ] as const) {
    const plan = new Decimator({}, new LttbKernel(), new FlatDataSource({ data, regularDomain: { start: 0, step: 1 }, count: N })).plan({
      width: 10,
      height: 50,
      domainRange: { min, max },
      sorted: true,
      columns: ['domain', 'value'],
    });
    const out = new Float64Array(plan.capacity * 2);
    const r = plan.fill(out);
    const xs = Array.from({ length: r.count }, (_, i) => out[2 * i]!);
    assert.deepEqual(
      xs,
      [...new Set(xs)].sort((a, b) => a - b),
      `${min}..${max}: ascending, none repeated: ${xs.join()}`,
    );
    assert.ok(
      xs.every((x) => Number.isFinite(x) && out[2 * xs.indexOf(x) + 1] === x * 2),
      `${min}..${max}: real rows: ${xs.join()}`,
    );
  }
});

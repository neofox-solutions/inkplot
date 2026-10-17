// Partitions: the rows of a source split by a channel, and the keyed reduction, against decimating each key's rows alone.
import assert from 'node:assert/strict';
import { Decimator, FlatDataSource, LttbKernel, M4Kernel, MinMaxKernel, StrideKernel, type DecimationKernel } from './index.ts';
import { partitionOf, planPartitioned } from './partition.ts';
import { test } from 'vite-plus/test';

function check(keysList: number[], sparse: number, tableOnly: boolean) {
  // Keys woven through the domain at different rates: one that is sparse, and one with gaps.
  const rows: { x: number; y: number; k: number }[] = [];
  let x = 0;
  for (let i = 0; i < 24000; i++) {
    x += 0.01;
    const k = keysList[i % 6]!;
    if (k === sparse && i % 120 !== 4) continue; // sparse: few enough rows to pass through undecimated
    let y = Math.sin(x * (1 + (i % 6))) * 3 + ((i * 7919) % 13) / 13;
    if (k === 7 && (i / 6) % 50 === 3) y = NaN;
    rows.push({ x, y, k });
  }
  const data = new Float64Array(rows.length * 3);
  rows.forEach((r, i) => data.set([r.x, r.y, r.k], 3 * i));
  const make = () => new FlatDataSource({ data, stride: 3, channels: { k: 2 }, isSorted: true });
  const source = make();
  const partition = partitionOf(source, 'k', 'first', 100)!;
  assert.ok(partition);
  assert.equal(partition.tableOnly, tableOnly);
  assert.deepEqual(
    partition.keys,
    keysList.filter((k) => rows.some((r) => r.k === k)),
    'keys in the order they first appear',
  );
  partition.keys.forEach((k, slot) => {
    assert.equal(partition.counts[slot], rows.filter((r) => r.k === k).length);
    assert.equal(partition.slotOf(k), slot);
  });
  assert.equal(partition.slotOf(42), -1);
  assert.equal(partition.omitted, 0);
  assert.deepEqual(
    partitionOf(make(), 'k', 'sorted', 100)!.keys,
    [...keysList].sort((a, b) => a - b),
  );
  assert.deepEqual(partitionOf(make(), 'k', (a, b) => b - a, 3)!.keys, [...keysList].sort((a, b) => b - a).slice(0, 3));
  assert.equal(partitionOf(make(), 'k', 'first', 4)!.omitted, 2);
  assert.equal(partitionOf(make(), 'nope', 'first', 4), null, 'a channel the data lacks');

  const kernels: [string, () => DecimationKernel][] = [
    ['MinMax', () => new MinMaxKernel()],
    ['M4', () => new M4Kernel()],
    ['Lttb', () => new LttbKernel()],
    ['Stride', () => new StrideKernel()],
  ];
  const last = rows[rows.length - 1]!.x;
  const ranges = [
    { min: rows[0]!.x, max: last },
    { min: last * 0.3, max: last * 0.45 },
    { min: -50, max: last * 0.02 },
    { min: last * 0.97, max: last + 50 },
  ];
  for (const [name, kernel] of kernels) {
    // The first pass over some rows goes through the keys together; later ones (a pan, a zoom) through each key's rows alone. Both must agree.
    for (const reuse of [false, true]) {
      const shared = new Decimator({}, kernel(), make());
      const sharedPart = partitionOf(shared.source as FlatDataSource, 'k', 'first', 100)!;
      for (const range of ranges) {
        for (const width of [120, 600]) {
          const ctx = { width, height: 100, domainRange: range, channels: [] as string[] };
          const keyed = reuse ? shared : new Decimator({}, kernel(), make());
          const part = reuse ? sharedPart : partitionOf(keyed.source as FlatDataSource, 'k', 'first', 100)!;
          const plan = planPartitioned(keyed, ctx, part);
          part.keys.forEach((k, slot) => {
            const mine = rows.filter((r) => r.k === k);
            const pairs = new Float64Array(mine.length * 2);
            mine.forEach((r, i) => pairs.set([r.x, r.y], 2 * i));
            const alone = new Decimator({}, kernel(), new FlatDataSource({ data: pairs, stride: 2, isSorted: true })).plan(ctx);
            const want = new Float64Array(alone.capacity * 2);
            const w = alone.fill(want);
            const got = new Float64Array(plan.capacity(slot) * 2);
            const g = plan.fill(slot, got);
            const label = `${name}${reuse ? ' again' : ''} key ${k} width ${width} range ${range.min.toFixed(1)}..${range.max.toFixed(1)}`;
            assert.equal(g.count, w.count, `${label}: count`);
            assert.deepEqual(Array.from(got.subarray(0, 2 * g.count)), Array.from(want.subarray(0, 2 * w.count)), `${label}: points`);
            assert.deepEqual(g.extents, w.extents, `${label}: extents`);
          });
        }
      }
    }
  }
}

test('partition: keyed reduction equals reducing each key alone', () => {
  // A negative key, a fractional one and a large one, which a table of whole numbers cannot hold.
  check([3, -3, 2.5, 7, 100000, 0], 100000, false);
  // Whole numbers only, which are read from the table.
  check([3, 1, 4, 7, 5, 0], 5, true);
});

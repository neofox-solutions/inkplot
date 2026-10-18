// The data source contract: points are always delivered ascending in the domain. `isSorted` only says whether
// the source has to arrange that itself.
import assert from 'node:assert/strict';
import { endsOf } from './data.ts';
import {
  CompositeDataSource,
  SyntheticDataSource,
  FlatDataSource,
  ObjectDataSource,
  Decimator,
  MinMaxKernel,
  type PointView,
  type PlanContext,
} from './index.ts';
import { test } from 'vite-plus/test';

test('data', () => {
  const ctx: PlanContext = { width: 600, height: 300, domainRange: { min: 0, max: 100 }, sorted: true, columns: ['domain', 'value'] };
  const points = (src: FlatDataSource | ObjectDataSource | CompositeDataSource | SyntheticDataSource): number[] => {
    const plan = src.plan(ctx),
      out = new Float64Array(plan.capacity * 2),
      r = plan.fill(out);
    return Array.from(out.subarray(0, 2 * r.count));
  };
  const viewPoints = (v: PointView): number[] => {
    const out: number[] = [];
    for (let i = 0; i < v.count; i++) {
      out.push(
        v.regularDomain ? v.regularDomain.start + v.regularDomain.step * i : v.data[i * v.stride + v.domainOffset]!,
        v.data[i * v.stride + v.valueOffset]!,
      );
    }
    return out;
  };

  // ── Unflagged data comes out sorted, stably, with NaN-domain points dropped and gaps (NaN values) kept.
  const shuffled = new Float64Array([5, 50, 1, 10, 3, NaN, NaN, 99, 3, 31, 2, 20]);
  const loose = new FlatDataSource({ data: shuffled });
  const expected = [1, 10, 2, 20, 3, NaN, 3, 31, 5, 50];
  assert.deepEqual(points(loose), expected);
  assert.deepEqual(viewPoints(loose.view()!), expected, 'view() agrees with plan()');
  assert.deepEqual(loose.domain(), { min: 1, max: 5 });
  const r = loose.plan(ctx).fill(new Float64Array(20));
  assert.deepEqual(
    r.extents,
    [
      { min: 1, max: 5 },
      { min: 10, max: 50 },
    ],
    'extents describe what was delivered',
  );
  assert.deepEqual(Array.from(shuffled.subarray(0, 4)), [5, 50, 1, 10], "the caller's array is never touched");
  assert.notEqual(loose.view()!.data, shuffled, "the view is the source's own buffer");

  // ── Flagged data is read where it is: the view is the caller's array.
  const ordered = new Float64Array([1, 10, 2, 20, 3, 30]);
  const tight = new FlatDataSource({ data: ordered, isSorted: true });
  assert.equal(tight.view()!.data, ordered, 'no copy');
  assert.deepEqual(points(tight), [1, 10, 2, 20, 3, 30]);
  assert.deepEqual(tight.domain(), { min: 1, max: 3 });

  // ── Already-ordered data without the flag is copied but not sorted: same answer either way.
  assert.deepEqual(points(new FlatDataSource({ data: ordered })), points(tight));
  assert.notEqual(new FlatDataSource({ data: ordered }).view()!.data, ordered);

  // ── A regular domain is ordered by construction, and read in place; a descending one is arranged.
  const ys = new Float64Array([1, 2, 3, 4]);
  const up = new FlatDataSource({ data: ys, regularDomain: { start: 10, step: 2 } });
  assert.equal(up.view()!.data, ys);
  assert.deepEqual(points(up), [10, 1, 12, 2, 14, 3, 16, 4]);
  const down = new FlatDataSource({ data: ys, regularDomain: { start: 10, step: -2 } });
  assert.deepEqual(points(down), [4, 4, 6, 3, 8, 2, 10, 1]);
  assert.deepEqual(down.domain(), { min: 4, max: 10 });
  assert.notEqual(down.view()!.data, ys);

  // ── Changes rebuild the managed buffer, and only then.
  const a = loose.view()!;
  assert.equal(loose.view()!.data, a.data, 'unchanged: same buffer, no rebuild');
  loose.setAttribute('data', new Float64Array([9, 1, 4, 2]));
  assert.deepEqual(viewPoints(loose.view()!), [4, 2, 9, 1]);
  assert.deepEqual(loose.domain(), { min: 4, max: 9 });
  loose.setAttribute('isSorted', true); // now trusted, now read in place
  assert.equal(loose.view()!.data, loose.attrs.data);

  // ── Objects: the same contract. Flagged rows are loaded once into numbers; unflagged rows are sorted as well.
  const rows = [
    { t: 3, v: 30 },
    { t: 1, v: 10 },
    { t: 2, v: 20 },
    { t: NaN, v: 0 },
  ];
  const objects = new ObjectDataSource({ source: rows, domain: 't', value: 'v' });
  assert.deepEqual(points(objects), [1, 10, 2, 20, 3, 30]);
  assert.deepEqual(viewPoints(objects.view()!), [1, 10, 2, 20, 3, 30]);
  assert.deepEqual(objects.domain(), { min: 1, max: 3 });
  const sortedRows = new ObjectDataSource({
    source: [
      { t: 1, v: 10 },
      { t: 2, v: 20 },
    ],
    domain: 't',
    value: 'v',
    isSorted: true,
  });
  assert.deepEqual(viewPoints(sortedRows.view()!), [1, 10, 2, 20]);
  assert.deepEqual(points(sortedRows), [1, 10, 2, 20]);

  // ── Empty data is fine.
  const none = new FlatDataSource({ data: new Float64Array(0) });
  assert.equal(none.domain(), null);
  assert.equal(none.view()!.count, 0);
  assert.deepEqual(points(none), []);

  // ── Timing for the record: the cost of not flagging a million shuffled points, once per change.
  {
    const n = 1_000_000,
      d = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      d[2 * i] = (i * 2654435761) % 1000003;
      d[2 * i + 1] = i;
    }
    const src = new FlatDataSource({ data: d });
    const t0 = performance.now();
    src.view();
    const sortMs = performance.now() - t0;
    const t1 = performance.now();
    src.view();
    const cachedMs = performance.now() - t1;
    const v = src.view()!;
    for (let i = 1; i < v.count; i++) assert(v.data[2 * i]! >= v.data[2 * i - 2]!);
    console.log('ok data', { shuffledMillionSortMs: Math.round(sortMs), cachedViewMs: +cachedMs.toFixed(3) });
  }

  // ── valueExtent: NaN skipped, cached per version, refreshed on change.
  {
    const src = new FlatDataSource({ data: new Float64Array([3, NaN, -2, 8]), regularDomain: { start: 0, step: 1 } });
    assert.deepEqual({ ...src.valueExtent() }, { min: -2, max: 8 });
    assert.equal(src.valueExtent(), src.valueExtent(), 'cached');
    src.setAttribute('data', new Float64Array([1, 2]));
    assert.deepEqual({ ...src.valueExtent() }, { min: 1, max: 2 });
  }

  // ── Channels: extra columns after the domain and the value, carried through sorting, selection and extents.
  {
    const wide = (names: string[]): PlanContext => ({ ...ctx, columns: ['domain', 'value', ...names] });
    const rowsOf = (out: Float64Array, count: number, stride: number) =>
      Array.from({ length: count }, (_, i) => Array.from(out.subarray(stride * i, stride * (i + 1))));

    // Unsorted rows: the channels travel with their points through the sort, and NaN-domain rows take theirs with them.
    const shuffled = [5, 1, 4, NaN, 2, 3].map((x) => ({ x, y: x * 2, k: x * 10, m: -x }));
    const src = new ObjectDataSource({ source: shuffled, domain: 'x', value: 'y', channels: { k: 'k', m: 'm' } });
    for (const [names, expect] of [
      [['k', 'm'], (x: number) => [x, 2 * x, 10 * x, -x]],
      [['m'], (x: number) => [x, 2 * x, -x]],
      [['m', 'k'], (x: number) => [x, 2 * x, -x, 10 * x]],
      [[], (x: number) => [x, 2 * x]],
    ] as const) {
      const plan = src.plan(wide([...names])),
        out = new Float64Array(plan.capacity * (2 + names.length)),
        r = plan.fill(out);
      assert.equal(r.count, 5);
      assert.deepEqual(rowsOf(out, r.count, 2 + names.length), [1, 2, 3, 4, 5].map(expect), `channels ${names.join() || '(none)'}`);
      assert.equal(r.extents.length, 2 + names.length);
    }
    const ext = src.plan(wide(['m'])).fill(new Float64Array(15)).extents;
    assert.deepEqual(
      ext.map((e) => ({ ...e })),
      [
        { min: 1, max: 5 },
        { min: 2, max: 10 },
        { min: -5, max: -1 },
      ],
    );
    assert.throws(() => src.plan(wide(['nope'])).fill(new Float64Array(30)), /no channel "nope"/);

    // Sorted rows are read straight into the requested layout.
    const sorted = new ObjectDataSource<{ x: number; y: number; k: number }>({
      source: [
        { x: 0, y: 1, k: 7 },
        { x: 1, y: 2, k: 9 },
      ],
      domain: 'x',
      value: 'y',
      isSorted: true,
      channels: { k: (r) => r.k * 2 },
    });
    const o = new Float64Array(6);
    assert.equal(sorted.plan(wide(['k'])).fill(o).count, 2);
    assert.deepEqual(Array.from(o), [0, 1, 14, 1, 2, 18]);
    assert.throws(() => sorted.plan(wide(['z'])).fill(o), /no channel "z"/);

    // Flat storage: channels are offsets into each point.
    const flat = new FlatDataSource({
      data: new Float64Array([0, 10, 0.5, 1, 20, NaN, 2, 5, 0.9]),
      stride: 3,
      isSorted: true,
      channels: { w: 2 },
    });
    const f = new Float64Array(9),
      fr = flat.plan(wide(['w'])).fill(f);
    assert.deepEqual(Array.from(f.subarray(0, 3)), [0, 10, 0.5]);
    assert.deepEqual({ ...fr.extents[2] }, { min: 0.5, max: 0.9 }, 'NaN is not part of a channel extent');
    assert.deepEqual({ ...flat.channelExtent('w') }, { min: 0.5, max: 0.9 });
    assert.equal(flat.channelExtent('w'), flat.channelExtent('w'), 'cached');
    flat.setAttribute('data', new Float64Array([0, 1, 100, 1, 2, 200]));
    assert.deepEqual({ ...flat.channelExtent('w') }, { min: 100, max: 200 }, 'refreshed when the data changes');
    assert.equal(new FlatDataSource({ data: new Float64Array(0), stride: 3, channels: { w: 2 } }).channelExtent('w'), null);

    // Unsorted storage keeps the extent too, and a sorted view still has the right stride.
    assert.deepEqual({ ...src.channelExtent('k') }, { min: 10, max: 50 });
    const v = src.view()!;
    assert.equal(v.stride, 4);
    assert.equal(v.count, 5);

    // A kernel that does not say which rows it kept cannot have channels carried through it, and says so rather than misaligning them.
    const big = new FlatDataSource({
      data: new Float64Array(5000).map((_, i) => i % 7),
      regularDomain: { start: 0, step: 1 },
      channels: {},
    });
    class Unaware extends MinMaxKernel {
      override get tracksRows(): boolean {
        return false;
      }
    }
    const dec = new Decimator({}, new Unaware(), big);
    assert.throws(() => dec.plan({ ...ctx, columns: ['domain', 'value', 'w'] }), /cannot carry channels/);
    dec.plan(ctx); // no channels asked for: fine
    new Decimator(
      { enabled: false },
      new MinMaxKernel(),
      new FlatDataSource({ data: new Float64Array([1, 2, 3, 4, 5, 6]), stride: 3, isSorted: true, channels: { w: 2 } }),
    ).plan({ ...ctx, columns: ['domain', 'value', 'w'] }); // switched off: passes straight through
    console.log('ok data channels');
  }

  // ── Wrap: the first point comes round again one period on, however the data is stored, and everything downstream sees it.
  {
    const rows = [
      { k: 0, v: 3, w: 7 },
      { k: 1, v: 8, w: 8 },
      { k: 2, v: 5, w: 9 },
    ];
    const wrapped = new ObjectDataSource({ source: rows, domain: 'k', value: 'v', isSorted: true, wrap: 3, channels: { w: 'w' } });
    assert.deepEqual(points(wrapped), [0, 3, 1, 8, 2, 5, 3, 3], 'the first point again at 0 + 3');
    assert.deepEqual(wrapped.domain(), { min: 0, max: 3 }, 'the domain reaches the copy');
    assert.deepEqual(wrapped.valueExtent(), { min: 3, max: 8 });
    assert.deepEqual(wrapped.channelExtent('w'), { min: 7, max: 9 });
    const withChannel = wrapped.plan({ ...ctx, columns: ['domain', 'value', 'w'] }),
      out = new Float64Array(withChannel.capacity * 3);
    withChannel.fill(out);
    assert.deepEqual(Array.from(out.subarray(9, 12)), [3, 3, 7], 'channels are copied with it');

    const shuffled = new ObjectDataSource({ source: [rows[2]!, rows[0]!, rows[1]!], domain: 'k', value: 'v', wrap: 3 });
    assert.deepEqual(points(shuffled), [0, 3, 1, 8, 2, 5, 3, 3], 'sorted first, then wrapped');
    const flat = new FlatDataSource({ data: new Float64Array([4, 6, 5]), regularDomain: { start: 10, step: 1 }, isSorted: true, wrap: 3 });
    assert.deepEqual(points(flat), [10, 4, 11, 6, 12, 5, 13, 4], 'a regular domain too');
    assert.deepEqual(flat.view()?.count, 4);

    wrapped.setAttribute('wrap', 5);
    assert.deepEqual(points(wrapped).slice(-2), [5, 3], 'changing the period rebuilds it');
    assert.throws(() => points(new ObjectDataSource({ source: rows, domain: 'k', value: 'v', wrap: 1 })), /shorter than the domain/);
    assert.deepEqual(
      points(new ObjectDataSource({ source: [] as typeof rows, domain: 'k', value: 'v', wrap: 3 })),
      [],
      'nothing to repeat',
    );
    console.log('ok data wrap');
  }

  // ── Composite: columns kept apart; any of them may be a function of the row index.
  {
    const xs = new Float64Array([3, 1, 2]),
      ys = new Float64Array([30, 10, 20]),
      ws = [7, 8, 9];
    const cols = new CompositeDataSource({ count: 3, domain: xs, value: ys, channels: { w: ws } });
    assert.deepEqual(points(cols), [1, 10, 2, 20, 3, 30], 'unsorted columns come out sorted');
    assert.deepEqual(cols.domain(), { min: 1, max: 3 });
    assert.deepEqual(cols.valueExtent(), { min: 10, max: 30 });
    assert.deepEqual(cols.channelExtent('w'), { min: 7, max: 9 });
    const withW = cols.plan({ ...ctx, columns: ['domain', 'value', 'w'] }),
      o = new Float64Array(withW.capacity * 3),
      rw = withW.fill(o);
    assert.deepEqual(Array.from(o.subarray(0, 9)), [1, 10, 8, 2, 20, 9, 3, 30, 7], 'the channel travels with its row');
    assert.deepEqual([0, 1, 2].map(rw.rowOf!), [1, 2, 0], 'rowOf names the storage row');
    assert.throws(() => cols.plan({ ...ctx, columns: ['domain', 'value', 'nope'] }).fill(new Float64Array(9)), /no channel "nope"/);

    // A made-up domain with arbitrary values: in order by construction, so it is read where it is.
    const made = new CompositeDataSource({ count: 4, domain: (i) => 100 + 5 * i, value: new Float32Array([2, 4, NaN, 8]), isSorted: true });
    assert.deepEqual(points(made), [100, 2, 105, 4, 110, NaN, 115, 8], 'a gap stays a gap');
    assert.deepEqual(made.domain(), { min: 100, max: 115 });
    assert.deepEqual(made.valueExtent(), { min: 2, max: 8 });
    assert.equal(made.view(), null, 'columns have no single array to offer');
    // Values from a function too, and a change is noticed.
    let k = 1;
    const live = new CompositeDataSource({ count: 3, domain: (i) => i, value: (i) => i * k, isSorted: true });
    assert.deepEqual(points(live), [0, 0, 1, 1, 2, 2]);
    k = 2;
    live.invalidate();
    assert.deepEqual(points(live), [0, 0, 1, 2, 2, 4]);
    assert.deepEqual(points(new CompositeDataSource({ count: 0, domain: [], value: [] })), []);
    console.log('ok data composite');
  }

  // ── Synthetic: a function sampled when drawn.
  {
    const fn = (x: number) => x * x;
    const fixed = new SyntheticDataSource({ fn, domain: { min: 0, max: 4 }, count: 5 });
    assert.deepEqual(points(fixed), [0, 0, 1, 1, 2, 4, 3, 9, 4, 16], 'evenly spaced, ends included');
    assert.deepEqual(fixed.domain(), { min: 0, max: 4 });
    assert.deepEqual(fixed.valueExtent(), { min: 0, max: 16 });
    assert.equal(fixed.plan(ctx).fill(new Float64Array(10)).rowOf, undefined, 'made-up points are not rows');

    // Without a count: a sample per pixel of the part in view.
    const fine = new SyntheticDataSource({ fn, domain: { min: 0, max: 100 } });
    const whole = fine.plan({ ...ctx, width: 200, domainRange: { min: -50, max: 500 } });
    const o = new Float64Array(whole.capacity * 2),
      r = whole.fill(o);
    assert.equal(r.count, 200);
    assert.deepEqual([o[0], o[2 * 199]], [0, 100], 'clamped to the domain');
    const zoomed = fine.plan({ ...ctx, width: 100, domainRange: { min: 10, max: 20 } }),
      o2 = new Float64Array(zoomed.capacity * 2),
      r2 = zoomed.fill(o2);
    assert.deepEqual([r2.count, o2[0], o2[2 * 99]], [100, 10, 20], 'zooming resamples the part in view');
    assert.deepEqual(r2.extents[1], { min: 100, max: 400 });
    assert.equal(fine.plan({ ...ctx, domainRange: { min: 200, max: 300 } }).fill(new Float64Array(2000)).count, 0, 'out of range: nothing');
    assert.deepEqual(fine.valueExtent(), { min: 0, max: 10000 }, 'the whole function, not the view');
    assert.throws(() => fine.plan({ ...ctx, columns: ['domain', 'value', 'w'] }).fill(new Float64Array(3000)), /no channel/);
    assert.deepEqual(
      points(new SyntheticDataSource({ fn: (x) => (x === 1 ? NaN : x), domain: { min: 0, max: 2 }, count: 3 })),
      [0, 0, 1, NaN, 2, 2],
      'NaN is a gap',
    );
    // Through a decimator, and wrapped.
    const dec = new Decimator(
      {},
      new MinMaxKernel(),
      new SyntheticDataSource({ fn: Math.sin, domain: { min: 0, max: 100 }, count: 100000 }),
    );
    assert(dec.plan({ ...ctx, width: 300, domainRange: { min: 0, max: 100 } }).capacity < 3000);
    assert.deepEqual(
      points(new SyntheticDataSource({ fn: (x) => x + 1, domain: { min: 0, max: 2 }, count: 3, wrap: 3 })),
      [0, 1, 1, 2, 2, 3, 3, 1],
      'wrapped like any source',
    );
    console.log('ok data synthetic');
  }

  // ── An infinite domain value is a gap like a NaN one: it is dropped, and never becomes the end of the domain.
  {
    const wide: PlanContext = { ...ctx, domainRange: { min: -Infinity, max: Infinity } };
    const src = new FlatDataSource({ data: new Float64Array([Infinity, 9, 1, 10, 2, 20, -Infinity, 8, 3, 30, Infinity, 7]) });
    const plan = src.plan(wide),
      out = new Float64Array(plan.capacity * 2),
      r = plan.fill(out);
    assert.deepEqual(Array.from(out.subarray(0, 2 * r.count)), [1, 10, 2, 20, 3, 30], 'infinite domains are dropped with the NaN ones');
    assert.deepEqual(src.domain(), { min: 1, max: 3 });
    assert.deepEqual(
      endsOf(4, (i) => [-Infinity, 1, 2, Infinity][i]!),
      { min: 1, max: 2 },
      'the ends of an ordered run skip infinities',
    );
    assert.equal(
      endsOf(2, () => Infinity),
      null,
      'nothing finite: no domain',
    );
  }
});

test('data: a null from an accessor function is a missing value, as it is from a property', () => {
  type R = { t: number; v: number | null };
  const rows: R[] = [
    { t: 0, v: 1 },
    { t: 1, v: null },
    { t: 2, v: 3 },
  ];
  const byName = new ObjectDataSource<R>({ source: rows, domain: 't', value: 'v' });
  const byFunction = new ObjectDataSource<R>({ source: rows, domain: (r) => r.t, value: (r) => r.v as number });
  const read = (s: ObjectDataSource<R>) => {
    const plan = s.plan({
      width: 0,
      height: 0,
      domainRange: { min: -Infinity, max: Infinity },
      sorted: true,
      columns: ['domain', 'value'],
    });
    const out = new Float64Array(plan.capacity * 2);
    const r = plan.fill(out);
    return { values: Array.from({ length: r.count }, (_, i) => out[2 * i + 1]!), extent: r.extents[1] };
  };
  assert.deepEqual(read(byFunction).values.map(Number.isNaN), [false, true, false], 'the null is a gap, not a 0');
  assert.deepEqual(read(byFunction).extent, read(byName).extent);
  assert.deepEqual(byFunction.valueExtent(), { min: 1, max: 3 });
});

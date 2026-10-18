// Density: points binned into counts, sums and means over any number of dimensions, with the bin size set per dimension.
import assert from 'node:assert/strict';
import { lightTheme } from './themes.ts';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  DomainSeries,
  BarPath,
  ObjectDataSource,
  Density,
  readTable,
  registry,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';
import { test } from 'vite-plus/test';

test('density', () => {
  const near = (a: number, b: number, what: string, tol = 1e-9) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
  const sum = (a: ArrayLike<number>) => Array.from(a).reduce((p, q) => p + q, 0);
  const xs = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4];
  const rowsOf = (): Row[] => xs.map((x, i) => ({ x, y: i, w: x * 10, z: i % 2 }));
  type Row = Record<string, number>;
  const source = (rows: Row[] = rowsOf()) => new ObjectDataSource({ source: rows, domain: 'x', value: 'y', channels: { w: 'w', z: 'z' } });

  {
    // One dimension, width 1: a bin for each whole number, the count as the value.
    const t = readTable(new Density({ width: 1 }, source()));
    assert.deepEqual(Array.from(t.column('domain')), [1.5, 2.5, 3.5, 4.5], 'centres of [1,2) [2,3) [3,4) [4,5)');
    assert.deepEqual(Array.from(t.column('value')), [1, 2, 3, 4], 'counts');
    assert.deepEqual(Array.from(t.column('width')), [1, 1, 1, 1]);
    near(sum(t.column('fraction')), 1, 'fractions add to 1');
    near(sum(t.column('density')), 1, 'density times width (1) adds to 1');
    assert.deepEqual(t.columns.slice(0, 2), ['domain', 'value']);
  }
  {
    // `bins` over the extent, the top edge in the last bin; `origin` moves the edges; `extent` replaces the data's.
    assert.deepEqual(Array.from(readTable(new Density({ bins: 3 }, source())).column('value')), [1, 2, 7], '[1,2) [2,3) [3,4]');
    assert.deepEqual(
      Array.from(readTable(new Density({ width: 2, origin: 1 }, source())).column('value')),
      [3, 7],
      'edges at 1, 3, 5: [1,3) [3,5)',
    );
    const clipped = readTable(new Density({ width: 1, extent: { min: 2, max: 4 } }, source()));
    assert.deepEqual(Array.from(clipped.column('value')), [2, 3, 4], 'points outside the extent are left out, the top edge is in');
    assert.deepEqual(Array.from(clipped.column('domain')), [2.5, 3.5, 4.5], 'edges at whole numbers from the extent');
  }
  {
    // A weight: `sum` and `mean` are of it; the default stat follows.
    const t = readTable(new Density({ width: 1, weight: 'w' }, source()));
    assert.deepEqual(Array.from(t.column('value')), [10, 40, 90, 160], 'the default stat with a weight is the sum');
    assert.deepEqual(Array.from(t.column('count')), [1, 2, 3, 4]);
    assert.deepEqual(Array.from(t.column('mean')), [10, 20, 30, 40]);
    assert.deepEqual(
      Array.from(readTable(new Density({ width: 1, weight: 'w', stat: 'mean' }, source())).column('value')),
      [10, 20, 30, 40],
    );
    near(sum(t.column('fraction')), 1, 'weighted fractions add to 1');
  }
  {
    // Two dimensions, a size for each: bins are cells, empty ones are left out, ascending in the first then the second.
    const rows = [
      { x: 0.5, y: 0.5 },
      { x: 0.6, y: 0.4 },
      { x: 1.5, y: 0.5 },
      { x: 0.2, y: 2.2 },
      { x: 5, y: 5 },
    ];
    const t = readTable(
      new Density({ by: ['domain', 'value'], width: [1, 2] }, new ObjectDataSource({ source: rows, domain: 'x', value: 'y' })),
    );
    assert.deepEqual(
      t.rows().map((r) => [r.domain, r.value, r.count]),
      [
        [0.5, 1, 2],
        [0.5, 3, 1],
        [1.5, 1, 1],
        [5.5, 5, 1],
      ],
      'cells with points, in order',
    );
    assert.deepEqual(
      t.rows().map((r) => [r.width, r.height]),
      Array(4).fill([1, 2]),
    );
    assert.equal(
      readTable(
        new Density(
          { by: ['domain', 'value'], width: [1, 2], empty: 'keep' },
          new ObjectDataSource({ source: rows, domain: 'x', value: 'y' }),
        ),
      ).count,
      6 * 3,
      'the whole grid with empty: keep',
    );
    // The same two dimensions with the size given as a count, and a third as a channel.
    const three = readTable(new Density({ by: ['domain', 'value', 'z'], width: 1 }, source()));
    assert.deepEqual(three.columns.slice(0, 3), ['domain', 'value', 'z']);
    assert(
      three.rows().every((r) => r.z === 0.5 || r.z === 1.5),
      'the third dimension is a channel of the bin centres',
    );
  }
  {
    // The rule for the size: a spread of points gets a sensible number of bins; no spread, or one point, still bins.
    const spread = Array.from({ length: 1000 }, (_, i) => ({ x: Math.sin(i * 12.9898) * 10 }));
    const n = readTable(new Density({}, new ObjectDataSource({ source: spread, domain: 'x', value: 'x' }))).count;
    assert(n >= 5 && n <= 200, `Freedman-Diaconis: ${n}`);
    assert.equal(
      readTable(new Density({ maxBins: 7 }, new ObjectDataSource({ source: spread, domain: 'x', value: 'x' }))).count <= 7,
      true,
      'maxBins',
    );
    const flat = readTable(new Density({}, new ObjectDataSource({ source: [{ x: 3 }, { x: 3 }, { x: 3 }], domain: 'x', value: 'x' })));
    assert.deepEqual([flat.count, flat.rows()[0]!.value], [1, 3], 'all alike: one bin');
    assert.equal(
      readTable(new Density({}, new ObjectDataSource({ source: [], domain: 'x', value: 'x' }))).count,
      0,
      'nothing in, nothing out',
    );
    const gaps = readTable(
      new Density({ width: 1 }, new ObjectDataSource({ source: [{ x: 1 }, { x: NaN }, { x: 2 }], domain: 'x', value: 'x' })),
    );
    near(sum(gaps.column('value')), 2, 'a gap is not counted');
  }
  {
    // Errors say what to change; a change of the source is seen.
    const d = (a: object) => () => readTable(new Density(a, source()));
    assert.throws(d({ width: 0 }), /width must be above 0/);
    assert.throws(d({ bins: 0 }), /bins must be at least 1/);
    assert.throws(d({ stat: 'nope' }), /stat is one of/);
    assert.throws(d({ by: ['domain', 'domain'] }), /twice/);
    assert.throws(d({ by: [] }), /at least one/);
    assert.throws(d({ width: 1e-9 }), /too many|use a wider bin/);
    assert.throws(() => readTable(new Density({ width: 1 }, source()), { channels: ['nope'] }), /no channel "nope"/);
    const src = source(),
      density = new Density({ width: 1 }, src);
    assert.equal(readTable(density).count, 4);
    src.setAttribute('source', [{ x: 10, y: 0, w: 0, z: 0 }]);
    assert.equal(readTable(density).count, 1, 'the new data is binned');
    density.setAttribute('width', 5);
    assert.deepEqual(readTable(density).rows()[0]!.domain, 12.5);
  }
  {
    // A histogram: Density and BarPath in a chart, and the axis reaches the counts.
    const y = new Axis({ orientation: 'left' }, new LinearScale());
    const series = new DomainSeries({}, new Density({ width: 1 }, source()), new BarPath({ width: 1 }));
    const chart = new Chart(
      { theme: lightTheme },
      new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), y, series),
    );
    const platform = new FakePlatform({ width: 400, height: 300 });
    chart.attach(platform).flush();
    assert(y.range.max >= 4, `the value axis reaches the biggest count: ${JSON.stringify(y.range)}`);
    assert(!/NaN/.test(platform.toString()));
    assert.equal(series.points.count, 4);
  }
  {
    // A half life: the last point counts in full, and one half-life before it half, so a trail fades behind the newest.
    const trail = new ObjectDataSource({ source: [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })), domain: 'x', value: 'y' });
    const t = readTable(new Density({ width: 1, halfLife: 2 }, trail));
    assert.deepEqual(
      Array.from(t.column('value')).map((v) => +v.toFixed(3)),
      [0.25, 0.354, 0.5, Math.SQRT1_2, 1].map((v) => +v.toFixed(3)),
    );
  }
  assert(registry.Density);
});

test('density: every sample lands in a bin, the maximum included, for any bin count', () => {
  // `lo + bins * (span / bins)` is rarely exactly the maximum, so the top edge has to be recognised to within rounding.
  let seed = 12345;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let trial = 0; trial < 400; trial++) {
    const n = 2 + Math.floor(random() * 40),
      bins = 1 + Math.floor(random() * 12),
      offset = (random() - 0.5) * 3,
      scale = 10 ** (Math.floor(random() * 8) - 4);
    const rows = Array.from({ length: n }, () => ({ x: offset + random() * scale, y: 0 }));
    const t = readTable(new Density({ bins }, new ObjectDataSource({ source: rows, domain: 'x', value: 'y' })));
    const total = Array.from(t.column('value')).reduce((p, q) => p + q, 0);
    assert.equal(total, n, `trial ${trial}: ${n} samples in ${bins} bins`);
  }
});

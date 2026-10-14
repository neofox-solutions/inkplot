// readTable: data read outside a chart, in the order a series would be given it, for every kind of node.
import assert from 'node:assert/strict';
import { lightTheme } from './themes.ts';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  DomainSeries,
  LinePath,
  LinearCurve,
  Series,
  descendantsOfType,
  ObjectDataSource,
  FlatDataSource,
  CompositeDataSource,
  SyntheticDataSource,
  BoxStats,
  Decimator,
  MinMaxKernel,
  readTable,
} from './index.ts';
import { test } from 'vite-plus/test';

test('table', () => {
  const rows = [
    { g: 1, x: 2, w: 10 },
    { g: 0, x: 5, w: 20 },
    { g: 0, x: 1, w: 30 },
    { g: 1, x: 8, w: 40 },
  ];

  {
    // A source with channels: unsorted input comes out ascending, every channel by default.
    const t = readTable(new ObjectDataSource({ source: rows, domain: 'g', value: 'x', channels: { w: 'w' } }));
    assert.deepEqual(t.columns, ['domain', 'value', 'w']);
    assert.equal(t.count, 4);
    assert.deepEqual(Array.from(t.column('domain')), [0, 0, 1, 1]);
    assert.deepEqual(t.rows()[0], { domain: 0, value: 5, w: 20 });
    assert.deepEqual(
      readTable(new ObjectDataSource({ source: rows, domain: 'g', value: 'x', channels: { w: 'w' } }), { channels: [] }).columns,
      ['domain', 'value'],
    );
    const named = readTable(new ObjectDataSource({ source: rows, domain: 'g', value: 'x' }), { names: { domain: 'group', value: 'x' } });
    assert.deepEqual(named.columns, ['group', 'x']);
    assert.throws(() => t.column('nope'), /no column "nope"/);
  }
  {
    // Flat and composite, with a regular domain and a function column.
    const f = readTable(new FlatDataSource({ data: [4, 5, 6], regularDomain: { start: 10, step: 2 } }));
    assert.deepEqual(f.rows(), [
      { domain: 10, value: 4 },
      { domain: 12, value: 5 },
      { domain: 14, value: 6 },
    ]);
    const c = readTable(new CompositeDataSource({ count: 3, domain: (i) => i, value: [7, 8, 9], channels: { sq: (i) => i * i } }));
    assert.deepEqual(
      c.rows().map((r) => r.sq),
      [0, 1, 4],
    );
  }
  {
    // Generated data is sampled where asked.
    const s = new SyntheticDataSource({ fn: (x) => x * x, domain: { min: 0, max: 10 } });
    const t = readTable(s, { domain: { min: 0, max: 4 }, samples: 5 });
    assert.deepEqual(Array.from(t.column('domain')), [0, 1, 2, 3, 4]);
    assert.deepEqual(Array.from(t.column('value')), [0, 1, 4, 9, 16]);
    assert.equal(readTable(s).count, 512, 'its own default when nothing is said');
    assert.equal(readTable(new SyntheticDataSource({ fn: (x) => x, domain: { min: 0, max: 1 }, count: 7 })).count, 7);
  }
  {
    // A transform reads like a source, with the channels it makes; a decimator passes its source's channels on.
    const src = () => new ObjectDataSource({ source: rows, domain: 'g', value: 'x' });
    const t = readTable(new BoxStats({}, src()));
    assert.deepEqual(t.columns, ['domain', 'value', 'min', 'q1', 'median', 'q3', 'max', 'mean', 'sd', 'sem', 'n']);
    assert.equal(t.count, 2);
    assert.equal(t.rows()[1]!.n, 2);
    assert.deepEqual(readTable(new BoxStats({ output: 'outliers' }, src())).columns, ['domain', 'value']);
    const big = new FlatDataSource({
      data: Float64Array.from({ length: 5000 }, (_, i) => Math.sin(i / 50)),
      regularDomain: { start: 0, step: 1 },
    });
    const d = readTable(new Decimator({}, new MinMaxKernel({}), big), { samples: 100 });
    assert(d.count > 0 && d.count < 5000, `thinned: ${d.count}`);
    assert.equal(readTable(big).count, 5000, 'its source has every row');
  }
  {
    // The recipe's chart-wide export: every series' data, named.
    const chart = new Chart(
      { theme: lightTheme },
      new CartesianPlane(
        {},
        new Axis({}, new LinearScale()),
        new Axis({}, new LinearScale()),
        new DomainSeries(
          { name: 'Load' },
          new FlatDataSource({ data: [3, 5], regularDomain: { start: 0, step: 1 } }),
          new LinePath({}, new LinearCurve()),
        ),
      ),
    );
    const blocks: string[] = [];
    for (const series of descendantsOfType(chart, Series)) {
      const table = readTable(series.data);
      blocks.push(
        `# ${series.attrs.name}\n${[table.columns.join(','), ...Array.from({ length: table.count }, (_, i) => table.data.map((c) => c[i]).join(','))].join('\n')}`,
      );
    }
    assert.equal(blocks.join('\n\n'), '# Load\ndomain,value\n0,3\n1,5');
  }
});

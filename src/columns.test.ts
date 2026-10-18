// Columns are asked of the data by name: the domain and the value are among them, and bind like any other.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  CartesianPlane,
  Chart,
  ColorAxis,
  CompositeDataSource,
  Decimator,
  type DataNode,
  MinMaxKernel,
  DomainSeries,
  FlatDataSource,
  GradientLinePath,
  LinearCurve,
  LinearScale,
  StringPlatform,
} from './index.ts';
import { lightTheme } from './themes.ts';

const lin = () => new LinearScale();
function draw(channel: string, channels: Record<string, (i: number) => number> = { c: (i) => i }) {
  const source = new CompositeDataSource({ count: 5, domain: (i) => i, value: (i) => i * i, channels, isSorted: true });
  const series = new DomainSeries({}, source, new GradientLinePath({ bind: { stroke: { axis: 'heat', channel } } }, new LinearCurve()));
  const chart = new Chart(
    { theme: lightTheme, width: 300, height: 150 },
    new CartesianPlane({}, new Axis({}, lin()), new Axis({ orientation: 'left' }, lin()), series),
    new ColorAxis({ id: 'heat', ramp: ['#000000', '#ff0000'] }, lin()),
  );
  const platform = new StringPlatform({ width: 300, height: 150 });
  chart.attach(platform);
  chart.flush();
  return { series, svg: platform.toString() };
}
const stops = (svg: string) => [...svg.matchAll(/<stop [^>]*stop-color="([^"]*)"/g)].map((m) => m[1]);

test('the domain binds like a channel of the same numbers', () => {
  const byName = draw('domain'),
    byChannel = draw('c');
  assert.deepEqual(stops(byName.svg), stops(byChannel.svg));
  assert.ok(stops(byName.svg).length >= 2);
  // Column 0 is also the first coordinate: it is asked of the data once.
  assert.deepEqual(byName.series.columns, ['domain', 'value']);
});

test('the value binds, and a channel bound alongside is asked for once', () => {
  const byName = draw('value'),
    byChannel = draw('c', { c: (i) => i * i });
  assert.deepEqual(stops(byName.svg), stops(byChannel.svg));
  assert.deepEqual(byName.series.columns, ['domain', 'value']);
  assert.deepEqual(byChannel.series.columns, ['domain', 'value', 'c']);
});

test('a flat source answers for any column index, 0 included', () => {
  const data = new Float64Array([3, 30, 7, 1, 70, 8, 2, 20, 9]);
  const source = new FlatDataSource({ data, stride: 3, domainOffset: 1, valueOffset: 2, channels: { k: 0 } });
  const plan = source.plan({
    width: 10,
    height: 10,
    domainRange: { min: -Infinity, max: Infinity },
    sorted: true,
    columns: ['k', 'value', 'domain', 'k'],
  });
  const out = new Float64Array(plan.capacity * 4);
  const r = plan.fill(out);
  assert.equal(r.count, 3);
  // Ascending in the domain (the second stored number): rows 3, 1 and 2 of the data.
  assert.deepEqual(Array.from(out), [2, 9, 20, 2, 3, 7, 30, 3, 1, 8, 70, 1]);
});

const wide = { width: 10, height: 10, domainRange: { min: -Infinity, max: Infinity } };

test('sorted or not: the order along the first column asked for', () => {
  const data = new Float64Array([3, 30, 1, 10, 2, 20]);
  const make = (isSorted?: boolean) => new FlatDataSource({ data, ...(isSorted ? { isSorted } : {}) });
  const rows = (plan: ReturnType<FlatDataSource['plan']>, width: number) => {
    const out = new Float64Array(plan.capacity * width);
    return Array.from(out.subarray(0, plan.fill(out).count * width));
  };
  const asked = (sorted: boolean, columns: string[]) => ({ ...wide, sorted, columns });
  assert.deepEqual(rows(make().plan(asked(true, ['domain', 'value'])), 2), [1, 10, 2, 20, 3, 30]);
  assert.deepEqual(rows(make().plan(asked(false, ['domain', 'value'])), 2), [3, 30, 1, 10, 2, 20], 'storage order');
  assert.deepEqual(rows(make().plan(asked(false, ['y', 'x'])), 2), [30, 3, 10, 1, 20, 2]);
});

test('sorted data asked for along something other than the domain is a mismatch', () => {
  const source = new FlatDataSource({ data: new Float64Array([1, 10, 2, 20]), isSorted: true });
  assert.throws(
    () => source.plan({ ...wide, sorted: true, columns: ['value', 'domain'] }),
    /sorted along the domain.*first column asked of it is "value"/,
  );
  // Storage order along x is fine; so is sorted along the domain.
  source.plan({ ...wide, sorted: false, columns: ['x', 'y'] });
  source.plan({ ...wide, sorted: true, columns: ['domain', 'value'] });
});

test('a Decimator says what it needs of the series it sits under', () => {
  const dec = (data: DataNode) => new Decimator({}, new MinMaxKernel(), data);
  const source = () => new FlatDataSource({ data: new Float64Array(20), regularDomain: { start: 0, step: 1 } });
  assert.throws(
    () => dec(source()).plan({ ...wide, sorted: false, columns: ['x', 'y'] }),
    /Expected 'domain' and 'value' as the first requested channels but got 'x' and 'y'; a Decimator must be attached to a DomainSeries or compatible/,
  );
  assert.throws(() => dec(source()).plan({ ...wide, sorted: false, columns: ['domain', 'value'] }), /ascending in the domain/);
  dec(source()).plan({ ...wide, sorted: true, columns: ['domain', 'value'] });
});

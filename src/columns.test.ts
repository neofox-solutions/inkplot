// Columns are asked of the data by name: the domain and the value are among them, and bind like any other.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  CartesianPlane,
  Chart,
  ColorAxis,
  CompositeDataSource,
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
    columns: ['k', 'value', 'domain', 'k'],
  });
  const out = new Float64Array(plan.capacity * 4);
  const r = plan.fill(out);
  assert.equal(r.count, 3);
  // Ascending in the domain (the second stored number): rows 3, 1 and 2 of the data.
  assert.deepEqual(Array.from(out), [2, 9, 20, 2, 3, 7, 30, 3, 1, 8, 70, 1]);
});

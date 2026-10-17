// LinkedData: one source read from several charts, with a change heard by all of them.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  CartesianPlane,
  Chart,
  type DataNode,
  DomainSeries,
  FlatDataSource,
  LinePath,
  LinearCurve,
  LinearScale,
  LinkedData,
  Slice,
  StringPlatform,
  XYSeries,
} from './index.ts';
import { lightTheme } from './themes.ts';

test('linked data', () => {
  const ys = Float64Array.from({ length: 100 }, (_, i) => i);
  const shared = new FlatDataSource({ data: ys, regularDomain: { start: 0, step: 1 } });

  // The source sits in one chart; another reads it through a link, and a slice of its own.
  const chart = (width: number, ...children: ConstructorParameters<typeof Chart>[1][]) => {
    const c = new Chart({ theme: lightTheme, width, height: 100 }, ...children);
    c.attach(new StringPlatform({ width, height: 100 }));
    return c;
  };
  const plane = (...series: DomainSeries[]) =>
    new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      ...series,
    );
  const line = (data: DataNode) => new DomainSeries({}, data, new LinePath({}, new LinearCurve()));

  const a = chart(300, shared, plane(line(new LinkedData({ source: shared }))));
  const linked = new LinkedData({ source: shared });
  const b = chart(200, plane(line(new Slice({ last: 10 }, linked))));
  assert.equal(a.flush().pointsIn, 100);
  assert.equal(b.flush().pointsIn, 10, 'a slice of its own, over the same rows');
  assert.deepEqual(linked.domain(), { min: 0, max: 99 });
  assert.deepEqual(linked.valueExtent(), { min: 0, max: 99 });
  assert.equal(linked.pointCount, 100);
  assert.equal(linked.view()?.data, ys, 'the very storage, read in place');

  // A change to the source is heard by the other chart, and refills what it draws.
  let heard = 0;
  const invalidate = b.invalidate.bind(b);
  b.invalidate = () => {
    heard++;
    invalidate();
  };
  const v0 = linked.version;
  shared.setAttribute(
    'data',
    Float64Array.from({ length: 50 }, (_, i) => i * 2),
  );
  assert.ok(heard > 0, 'the chart that links to it is told');
  assert.ok(linked.version > v0);
  assert.equal(b.flush().filled > 0, true);
  assert.deepEqual(linked.valueExtent(), { min: 0, max: 98 });
  assert.equal(a.flush().pointsIn, 50);

  // Detached, it stops listening.
  b.detach();
  heard = 0;
  shared.setAttribute('data', Float64Array.from({ length: 5 }));
  assert.equal(heard, 0);

  // Channels under other names.
  const pairs = new FlatDataSource({
    data: new Float64Array([1, 2, 3, 4, 5, 6]),
    stride: 2,
    regularDomain: { start: 0, step: 1 },
    channels: { a: 0, b: 1 },
  });
  const renamed = new LinkedData({ source: pairs, channels: { x: 'a', y: 'b' } });
  assert.deepEqual(renamed.channelNames, ['x', 'y', 'a', 'b']);
  assert.deepEqual(renamed.channelExtent('y'), { min: 2, max: 6 });
  assert.deepEqual(renamed.view()?.channelOffsets, { a: 0, b: 1, x: 0, y: 1 });
  const xy = new XYSeries({}, renamed);
  const c = chart(
    200,
    new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      xy,
    ),
  );
  c.flush();
  assert.equal(xy.points.count, 3);
  assert.equal(xy.points.data[0] !== undefined, true);

  // Two links in a loop do not run away, and an unknown source says so when it is asked.
  const l1 = new LinkedData({ source: shared });
  const l2 = new LinkedData({ source: l1 });
  l1.setAttribute('source', l2);
  assert.throws(() => new LinkedData({ source: 'nowhere' }).pointCount, /no element with id "nowhere"/);
});

// Series groups: one series for each value of a channel, made from the data and drawn with copies of the renderers it holds.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  BandScale,
  BarPath,
  BoxPath,
  BoxStats,
  CartesianPlane,
  Chart,
  ColorAxis,
  Decimator,
  Density,
  HeatMap,
  MinMaxKernel,
  ObjectDataSource,
  XYSeries,
  FlatDataSource,
  LinePath,
  LinearCurve,
  LinearScale,
  Legend,
  DomainSeries,
  AreaPath,
  Stack,
  CircleMarker,
  PointAnnotations,
  SeriesGroup,
  StringPlatform,
  fromJSON,
  lightTheme,
  registry,
  toJSON,
} from './index.ts';
import type { SeriesGroupAttributes } from './index.ts';

const W = 400,
  H = 300;

// Rows of (x, y, group): three groups of different lengths, interleaved the way tidy data comes.
const ROWS = [
  [0, 1, 7],
  [0, 5, 3],
  [1, 2, 7],
  [1, 6, 3],
  [2, 3, 7],
  [2, 8, 9],
  [3, 4, 7],
];
const flatRows = () => new FlatDataSource({ data: Float64Array.from(ROWS.flat()), stride: 3, channels: { group: 2 }, isSorted: true });

function chartOf(options: Partial<SeriesGroupAttributes> = {}) {
  const group = new SeriesGroup({ channel: 'group', ...options }, flatRows(), new LinePath({ id: 'lines' }, new LinearCurve()));
  const plane = new CartesianPlane(
    {},
    new Axis({ orientation: 'bottom' }, new LinearScale()),
    new Axis({ orientation: 'left' }, new LinearScale()),
    group,
  );
  const chart = new Chart(
    { theme: lightTheme, width: W, height: H },
    new ColorAxis({ id: 'heat', ramp: ['#000000', '#ffffff'] }, new LinearScale()),
    plane,
  );
  const platform = new StringPlatform({ width: W, height: H });
  chart.attach(platform).flush();
  return { chart, plane, group, platform, svg: () => platform.toString() };
}

test('seriesgroup', () => {
  // One series for each key, in the order the keys first appear, named from the key, each with the rows of its key.
  {
    const { plane, group } = chartOf({ name: (k) => `Group ${k}` });
    assert.deepEqual(group.keys, [7, 3, 9]);
    assert.deepEqual(
      plane.series.map((s) => s.attrs.name),
      ['Group 7', 'Group 3', 'Group 9'],
      'the plane sees the series of the group',
    );
    assert.deepEqual(
      plane.series.map((s) => s.data.pointCount),
      [4, 2, 1],
    );
    assert.equal(group.omitted, 0);
  }

  // Each series is drawn: a path for each, in its own palette colour.
  {
    const { svg, plane } = chartOf();
    const strokes = [...svg().matchAll(/<path d="M[^"]*" fill="none"[^>]*stroke="(#[0-9a-f]{3,6})"/g)].map((m) => m[1]);
    const palette = new Set(plane.series.map((s) => s.accentColor));
    assert.equal(palette.size, 3, 'three colours');
    for (const c of palette) assert.ok(strokes.includes(c) || svg().includes(c), `${c} is drawn`);
  }

  // The group's own renderers draw nothing, and the series are not children: the tree and its JSON hold the group as written.
  {
    const { group, chart } = chartOf();
    assert.equal([...group].length, 2, 'the source and the renderer');
    const json = toJSON(chart, registry);
    const text = JSON.stringify(json);
    assert.ok(!text.includes('lines/7'), 'the copies are not saved');
    assert.equal((text.match(/"SeriesGroup"/g) ?? []).length, 1);
    const again = fromJSON(json, registry);
    assert.ok(again);
  }

  // The renderers are copied for each series with the key added to the id.
  {
    const { plane } = chartOf();
    const ids = plane.series.map((s) => [...s].map((c) => c.attrs.id).filter(Boolean));
    assert.deepEqual(ids, [['lines/7'], ['lines/3'], ['lines/9']]);
  }

  // order and maxGroups.
  {
    assert.deepEqual(chartOf({ order: 'sorted' }).group.keys, [3, 7, 9]);
    assert.deepEqual(chartOf({ order: (a, b) => b - a }).group.keys, [9, 7, 3]);
    const { group } = chartOf({ maxGroups: 2 });
    assert.deepEqual(group.keys, [7, 3]);
    assert.equal(group.omitted, 1);
  }

  // A key that has no rows any more goes, the others stay; a new one comes.
  {
    const { group, plane, chart } = chartOf();
    const before = plane.series[0];
    const source = group.data as FlatDataSource;
    source.setAttribute(
      'data',
      Float64Array.from(
        [
          [0, 1, 7],
          [1, 2, 7],
          [0, 4, 5],
        ].flat(),
      ),
    );
    chart.flush();
    assert.deepEqual(group.keys, [7, 5]);
    assert.equal(plane.series[0], before, 'the series of a key that stays is the same one');
  }

  // A series toggled off in the legend stays off when the data changes.
  {
    const { group, plane, chart } = chartOf();
    plane.series[1]!.setAttribute('visible', false);
    chart.flush();
    assert.equal(plane.series.length, 2);
    (group.data as FlatDataSource).setAttribute('data', Float64Array.from([...ROWS.flat(), 4, 4, 3]));
    chart.flush();
    assert.equal(plane.series.length, 2, 'still hidden');
  }

  // A group `bind` gives each series' renderer an attribute from an axis, by key: black to white over 3 to 9.
  {
    const { svg, plane } = chartOf({ bind: { stroke: { axis: 'heat' } } });
    const strokeOf = (series: Iterable<{ attrs: object }>) => [...series].map((r) => (r.attrs as { stroke?: string }).stroke).find(Boolean);
    const stroke = (i: number) => strokeOf(plane.series[i]!);
    assert.equal(stroke(1), '#000000', 'key 3 is the low end');
    assert.equal(stroke(2), '#ffffff', 'key 9 is the high end');
    assert.match(String(stroke(0)), /^#[0-9a-f]{6}$/);
    assert.ok(svg().includes('#000000'));
    const mapped = chartOf({ bind: { stroke: { axis: 'heat', value: (k) => (k === 7 ? 100 : 0) } } });
    assert.equal(strokeOf(mapped.plane.series[0]!), '#ffffff', 'value decides what the axis is read at');
  }

  // The legend lists each series.
  {
    const group = new SeriesGroup({ channel: 'group', name: (k) => `G${k}` }, flatRows(), new LinePath(new LinearCurve()));
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      group,
    );
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane, new Legend({}));
    const platform = new StringPlatform({ width: W, height: H });
    chart.attach(platform).flush();
    const svg = platform.toString();
    for (const name of ['G7', 'G3', 'G9']) assert.ok(svg.includes(`>${name}<`), `${name} is in the legend`);
  }

  // The axes fit all the series, and a channel the data does not have says so.
  {
    const { plane } = chartOf();
    assert.deepEqual(
      [...plane.axes].map((a) => a.range.max).sort((a, b) => a - b),
      [3, 8],
    );
    assert.throws(() => chartOf({ channel: 'nope' }), /no channel "nope"/);
  }

  // Bars work the same way (a renderer that reads the whole series), drawn for each key.
  {
    const group = new SeriesGroup({ channel: 'group' }, flatRows(), new BarPath({ id: 'bars' }));
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      group,
    );
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane);
    const platform = new StringPlatform({ width: W, height: H });
    chart.attach(platform).flush();
    assert.equal(plane.series.length, 3);
    assert.ok((platform.toString().match(/<path/g) ?? []).length >= 3);
  }

  // A data transform in the group works on each series' own rows: a box plot of each facet's samples.
  {
    const samples = [
      ...[2, 4, 4, 5, 5, 6, 7, 30].map((x) => ({ g: 0, x, facet: 1 })),
      ...[10, 11, 12, 13, 14].map((x) => ({ g: 1, x, facet: 1 })),
      ...[1, 2, 3, 4, 100, -50].map((x) => ({ g: 2, x, facet: 2 })),
      ...[8, 9, 10, 11].map((x) => ({ g: 0, x, facet: 2 })),
    ];
    const group = new SeriesGroup(
      { channel: 'facet', domainAxis: 'cat', valueAxis: 'val' },
      new BoxStats({}, new ObjectDataSource({ source: samples, domain: 'g', value: 'x', channels: { facet: 'facet' } })),
      new BoxPath({}),
    );
    const plane = new CartesianPlane(
      {},
      new Axis({ id: 'cat', orientation: 'bottom' }, new BandScale({ categories: ['a', 'b', 'c'] })),
      new Axis({ id: 'val', orientation: 'left' }, new LinearScale()),
      group,
    );
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane);
    const platform = new StringPlatform({ width: W, height: H });
    chart.attach(platform).flush();
    assert.deepEqual(group.keys, [1, 2]);
    assert.deepEqual(
      plane.series.map((s) => s.points.count),
      [2, 2],
      'the five numbers for each group of samples, for each facet',
    );
    assert.ok(!/NaN|undefined/.test(platform.toString()));
  }

  // XY members: a heat map of each facet (the transform is a density, the renderer a heat map).
  {
    const rows = [
      { x: 0.5, y: 0.5, f: 1 },
      { x: 0.6, y: 0.4, f: 1 },
      { x: 1.5, y: 0.5, f: 1 },
      { x: 2.5, y: 2.5, f: 2 },
      { x: 2.6, y: 2.4, f: 2 },
    ];
    const heat = new ColorAxis({ id: 'heat', ramp: ['#ffffff', '#ff0000'] }, new LinearScale());
    const group = new SeriesGroup(
      { channel: 'f', x: 'domain', y: 'value' },
      new Density(
        { by: ['domain', 'value'], width: 1 },
        new ObjectDataSource({ source: rows, domain: 'x', value: 'y', channels: { f: 'f' } }),
      ),
      new HeatMap({ bind: { fill: { axis: 'heat', channel: 'count' } } }),
    );
    const plane = new CartesianPlane({}, new Axis({}, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()), group);
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane, heat);
    const platform = new StringPlatform({ width: W, height: H });
    chart.attach(platform).flush();
    assert.ok(plane.series.every((s) => s instanceof XYSeries));
    assert.deepEqual(
      plane.series.map((s) => s.points.count),
      [2, 1],
      'occupied bins of each facet',
    );
    assert.ok(!/NaN|undefined/.test(platform.toString()));
  }

  // A decimator in the group thins each series on its own, to the width of the plot.
  {
    const n = 5000;
    const data = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      data[3 * i] = i;
      data[3 * i + 1] = Math.sin(i / 50);
      data[3 * i + 2] = i % 2;
    }
    const group = new SeriesGroup(
      { channel: 'k' },
      new Decimator({}, new MinMaxKernel(), new FlatDataSource({ data, stride: 3, channels: { k: 2 }, isSorted: true })),
      new LinePath(new LinearCurve()),
    );
    const plane = new CartesianPlane({}, new Axis({}, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()), group);
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane);
    chart.attach(new StringPlatform({ width: W, height: H })).flush();
    assert.equal(plane.series.length, 2);
    for (const s of plane.series) assert.ok(s.points.count > 0 && s.points.count < 2500, `${s.points.count} points after thinning 2500`);
  }

  // A change to the group's renderers reaches every series, except what a binding sets.
  {
    const { group, plane, chart } = chartOf({ bind: { stroke: { axis: 'heat' } } });
    const lines = [...group].find((c) => c.attrs.id === 'lines')!;
    lines.setAttributes({ strokeWidth: 4, stroke: '#123456' } as never);
    chart.flush();
    for (const s of plane.series) {
      const r = [...s][1] as unknown as { attrs: { strokeWidth?: number; stroke?: string } };
      assert.equal(r.attrs.strokeWidth, 4, 'the width came from the group');
      assert.notEqual(r.attrs.stroke, '#123456', "the colour is still the binding's");
    }
  }

  // `map` gives the attribute directly, and is read again whenever the group is invalidated: what it reads from outside (a
  // playback year) takes effect, with nothing refilled and only the attribute that changed written.
  {
    let year = 7;
    const stats: { filled: number; attributesWritten: readonly string[] }[] = [];
    const group = new SeriesGroup(
      { channel: 'group', bind: { opacity: { map: (k) => (k <= year ? 0.9 : 0.1) } } },
      flatRows(),
      new LinePath(new LinearCurve()),
    );
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      group,
    );
    const chart = new Chart({ theme: lightTheme, width: W, height: H, onFlush: (f) => stats.push(f) }, plane);
    chart.attach(new StringPlatform({ width: W, height: H })).flush();
    const opacity = () =>
      plane.series.map((s) => [...s].map((r) => (r.attrs as { opacity?: number }).opacity).find((o) => o !== undefined));
    assert.deepEqual(opacity(), [0.9, 0.9, 0.1], 'keys 7 and 3 are on, 9 is not');
    year = 3;
    group.invalidate();
    chart.flush();
    assert.deepEqual(opacity(), [0.1, 0.9, 0.1], 'now only 3');
    const last = stats[stats.length - 1]!;
    assert.equal(last.filled, 0, 'nothing was refilled');
    assert.deepEqual(last.attributesWritten, ['opacity'], 'only the opacity was written');
  }

  // Copies follow the group: an edit made to a copy itself is put back, since what the group holds is what counts.
  {
    const { group, plane, chart } = chartOf();
    const copy = [...plane.series[0]!][1] as unknown as { attrs: { strokeWidth?: number }; setAttribute(n: string, v: number): void };
    copy.setAttribute('strokeWidth', 9);
    chart.flush();
    assert.notEqual(copy.attrs.strokeWidth, 9, 'the copy is as the group has it');
    void group;
  }

  // Notes cannot anchor to a renderer of a group: that says so, rather than drawing nothing.
  {
    const group = new SeriesGroup({ channel: 'group' }, flatRows(), new CircleMarker({ id: 'dots' }));
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      group,
      new PointAnnotations({ anchor: 'dots', text: () => 'x' }),
    );
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane);
    assert.throws(() => chart.attach(new StringPlatform({ width: W, height: H })).flush(), /is in a SeriesGroup/);
  }
});

// A group in a stack is several series in it: the same layers as when each is written out, and it mixes with plain series.
test('a group in a stack stands for its series', () => {
  const flat = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys.flatMap((y, i) => [i, y])), stride: 2 });
  // Rows (domain, value, part): part 1 is 1,2,3 and part 2 is 5,6,7.
  const rows = Float64Array.from([0, 1, 1, 0, 5, 2, 1, 2, 1, 1, 6, 2, 2, 3, 1, 2, 7, 2]);
  const source = () => new FlatDataSource({ data: rows, stride: 3, channels: { part: 2 }, isSorted: true });
  const area = () => new AreaPath(new LinearCurve());
  const build = (children: (DomainSeries | SeriesGroup)[]) => {
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      new Stack({}, ...children),
    );
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane);
    chart.attach(new StringPlatform({ width: W, height: H })).flush();
    return { chart, plane };
  };
  const grouped = build([
    new DomainSeries({ name: 'A' }, flat([4, 4, 4]), area()),
    new SeriesGroup({ channel: 'part', name: (k) => `P${k}` }, source(), area()),
    new DomainSeries({ name: 'D' }, flat([2, 2, 2]), area()),
  ]);
  const written = build([
    new DomainSeries({ name: 'A' }, flat([4, 4, 4]), area()),
    new DomainSeries({ name: 'P1' }, flat([1, 2, 3]), area()),
    new DomainSeries({ name: 'P2' }, flat([5, 6, 7]), area()),
    new DomainSeries({ name: 'D' }, flat([2, 2, 2]), area()),
  ]);
  const layers = (p: CartesianPlane) => p.allSeries.map((s) => [s.attrs.name, [...(s.layer?.top ?? [])], [...(s.layer?.base ?? [])]]);
  assert.deepEqual(layers(grouped.plane), layers(written.plane));
  assert.equal(grouped.plane.allSeries.length, 4);
  assert.deepEqual(
    grouped.plane.allSeries.map((s) => s.accentColor),
    written.plane.allSeries.map((s) => s.accentColor),
    'the palette runs on through the stack as it would',
  );

  // `visible` on a member is the one thing a group leaves alone: a hidden member closes up the stack, and stays hidden through a refresh.
  const group = grouped.plane.allSeries[1]!.requireParent() as SeriesGroup;
  grouped.plane.allSeries[1]!.setAttribute('visible', false);
  group.invalidate();
  grouped.chart.flush();
  assert.equal(grouped.plane.allSeries[1]!.attrs.visible, false);
  assert.deepEqual(layers(grouped.plane).filter((l) => l[0] === 'D')[0]?.[1], [4 + 5 + 2, 4 + 6 + 2, 4 + 7 + 2]);
});

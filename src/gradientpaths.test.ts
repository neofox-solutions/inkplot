// Gradient paths: a line or an area whose colour runs along it with a channel of the data.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  AreaPath,
  Axis,
  CartesianPlane,
  Chart,
  ColorAxis,
  CompositeDataSource,
  DomainSeries,
  GradientAreaPath,
  GradientLinePath,
  Legend,
  LinePath,
  LinearCurve,
  LinearScale,
  PolarPlane,
  StringPlatform,
  XYSeries,
  toSvgString,
} from './index.ts';
import { lightTheme } from './themes.ts';

const RAMP = ['#000000', '#ff0000'];
const lin = () => new LinearScale();

/** A chart with one series of `n` points: x is the index, y a wave, `c` the channel the colour follows. */
function make(
  renderer: GradientLinePath | GradientAreaPath | LinePath | AreaPath,
  c: (i: number) => number,
  n = 3,
  options: { ramp?: ColorAxis; value?: (i: number) => number; plane?: 'polar'; legend?: boolean } = {},
) {
  const source = new CompositeDataSource({
    count: n,
    domain: (i) => i,
    value: options.value ?? ((i) => Math.sin(i / 3)),
    channels: { c },
    isSorted: true,
  });
  const series = new DomainSeries({ name: 'speed' }, source, renderer);
  const plane =
    options.plane === 'polar'
      ? new PolarPlane({}, new Axis({ orientation: 'angle' }, lin()), new Axis({ orientation: 'radius' }, lin()), series)
      : new CartesianPlane({}, new Axis({}, lin()), new Axis({ orientation: 'left' }, lin()), series);
  const ramp = options.ramp ?? new ColorAxis({ id: 'heat', ramp: RAMP }, lin());
  const chart = options.legend
    ? new Chart({ theme: lightTheme, width: 400, height: 200 }, plane, ramp, new Legend({}))
    : new Chart({ theme: lightTheme, width: 400, height: 200 }, plane, ramp);
  return { chart, series, plane };
}
function build(...args: Parameters<typeof make>) {
  const made = make(...args);
  const platform = new StringPlatform({ width: 400, height: 200 });
  made.chart.attach(platform);
  made.chart.flush();
  return { ...made, svg: () => platform.toString() };
}
const line = () => new GradientLinePath({ bind: { stroke: { axis: 'heat', channel: 'c' } } }, new LinearCurve());
const gradients = (svg: string) =>
  [...svg.matchAll(/<linearGradient ([^>]*)>([\s\S]*?)<\/linearGradient>/g)].map((m) => ({
    attrs: m[1]!,
    num: (name: string) => Number(new RegExp(`${name}="([^"]*)"`).exec(m[1]!)?.[1]),
    stops: [...m[2]!.matchAll(/<stop ([^>]*)\/>/g)].map((s) => ({
      offset: Number(/offset="([^"]*)"/.exec(s[1]!)?.[1]),
      color: /stop-color="([^"]*)"/.exec(s[1]!)?.[1] ?? '',
    })),
  }));

test('gradient line: a colour stop for each point, along the axis', () => {
  const { svg } = build(line(), (i) => i / 2);
  const out = svg();
  assert(!/NaN|undefined/.test(out));
  const [g] = gradients(out);
  assert.ok(g, 'a gradient');
  assert.match(g.attrs, /gradientUnits="userSpaceOnUse"/);
  assert.ok(g.num('x2') > g.num('x1'), 'from the first point to the last, left to right');
  assert.equal(g.num('y1'), 0);
  assert.equal(g.num('y2'), 0);
  assert.deepEqual(
    g.stops.map((s) => s.offset),
    [0, 0.5, 1],
  );
  assert.deepEqual(
    g.stops.map((s) => s.color),
    ['#000000', '#800000', '#ff0000'],
  );
  const id = /id="(inkgrad\d+)"/.exec(g.attrs)![1];
  assert.match(out, new RegExp(`<path d="[^"]*" fill="none" stroke="url\\(#${id}\\)"`), 'the line is painted with it');
});

test('gradient line: without a binding it is a plain line, and the series colour is its swatch', () => {
  const plain = build(new GradientLinePath(new LinearCurve()), () => 0);
  assert.equal(gradients(plain.svg()).length, 0);
  assert.equal(plain.series.color, lightTheme.palette[0]);
  const renderer = line();
  const bound = build(renderer, (i) => i);
  assert.equal(bound.series.color, lightTheme.palette[0], 'a bound colour is not one colour: the key falls back to the palette');
  assert.equal(renderer.swatch, null);
});

test('gradient line: gaps, runs of one colour, and a line of one point', () => {
  // A gap in the data leaves no stop and no line, and the colours either side go on from where they were.
  const gap = build(line(), (i) => i / 4, 5, { value: (i) => (i === 2 ? NaN : i) });
  const [g] = gradients(gap.svg());
  assert.deepEqual(
    g!.stops.map((s) => s.offset),
    [0, 0.25, 0.75, 1],
  );
  // The same colour all along needs only its two ends.
  const flat = gradients(build(line(), () => 0.5, 50).svg())[0]!;
  assert.equal(flat.stops.length, 2);
  assert.deepEqual([flat.stops[0]!.offset, flat.stops[1]!.offset], [0, 1]);
  // One point has no direction to run a gradient in: it is the colour of that point.
  const one = build(line(), () => 1, 1);
  assert.equal(gradients(one.svg()).length, 0);
});

test('gradient line: more points than stops are averaged, and a step ramp gives bands', () => {
  const many = build(
    new GradientLinePath({ maxStops: 10, bind: { stroke: { axis: 'heat', channel: 'c' } } }, new LinearCurve()),
    (i) => (i % 100) / 100,
    1000,
  );
  const [g] = gradients(many.svg());
  assert.ok(g!.stops.length <= 10, `${g!.stops.length} stops`);
  assert.equal(g!.stops[0]!.offset, 0);
  assert.equal(g!.stops[g!.stops.length - 1]!.offset, 1);
  assert.ok(
    g!.stops.every((s, i) => i === 0 || s.offset >= g!.stops[i - 1]!.offset),
    'in order',
  );

  const step = new ColorAxis({ id: 'heat', ramp: ['#ff0000', '#00ff00', '#0000ff'], interpolation: 'step' }, lin());
  const [b] = gradients(build(line(), (i) => i, 3, { ramp: step }).svg());
  assert.deepEqual(
    b!.stops.map((s) => [s.offset, s.color]),
    [
      [0, '#ff0000'],
      [0.25, '#ff0000'],
      [0.25, '#00ff00'],
      [0.75, '#00ff00'],
      [0.75, '#0000ff'],
      [1, '#0000ff'],
    ],
    'each colour holds halfway to its neighbours',
  );
});

test('gradient line: reversed axes, a vertical domain, and a plane it cannot run along', () => {
  // A reversed horizontal axis runs the other way: the gradient does too.
  const source = new CompositeDataSource({ count: 3, domain: (i) => i, value: (i) => i, channels: { c: (i) => i / 2 }, isSorted: true });
  const series = new DomainSeries({}, source, line());
  const plane = new CartesianPlane({}, new Axis({ inverted: true }, lin()), new Axis({ orientation: 'left' }, lin()), series);
  const chart = new Chart({ theme: lightTheme, width: 400, height: 200 }, plane, new ColorAxis({ id: 'heat', ramp: RAMP }, lin()));
  const platform = new StringPlatform({ width: 400, height: 200 });
  chart.attach(platform).flush();
  const [r] = gradients(platform.toString());
  assert.ok(r!.num('x1') > r!.num('x2'), 'right to left');
  assert.deepEqual(
    r!.stops.map((s) => s.color),
    ['#000000', '#800000', '#ff0000'],
    'still first point to last',
  );

  // A domain that runs up the plot has its gradient run up it.
  const up = new CompositeDataSource({ count: 3, domain: (i) => i, value: (i) => i, channels: { c: (i) => i / 2 }, isSorted: true });
  const vertical = new DomainSeries({ domainAxis: 'v', valueAxis: 'h' }, up, line());
  const vp = new CartesianPlane({}, new Axis({ id: 'h' }, lin()), new Axis({ id: 'v', orientation: 'left' }, lin()), vertical);
  const vc = new Chart({ theme: lightTheme, width: 400, height: 200 }, vp, new ColorAxis({ id: 'heat', ramp: RAMP }, lin()));
  const vplatform = new StringPlatform({ width: 400, height: 200 });
  vc.attach(vplatform).flush();
  const [v] = gradients(vplatform.toString());
  assert.equal(v!.num('x1'), 0);
  assert.equal(v!.num('x2'), 0);
  assert.notEqual(v!.num('y1'), v!.num('y2'));

  // A polar plane has no straight axis: say so, rather than drawing something wrong.
  assert.throws(() => build(line(), (i) => i, 3, { plane: 'polar' }), /rectangular plane/);
});

test('gradient area: the fill, and the outline when it is bound too', () => {
  const area = new GradientAreaPath(
    { bind: { fill: { axis: 'heat', channel: 'c' }, stroke: { axis: 'heat', channel: 'c' } }, strokeWidth: 2 },
    new LinearCurve(),
  );
  const out = build(area, (i) => i / 2).svg();
  assert(!/NaN|undefined/.test(out));
  const gs = gradients(out);
  assert.equal(gs.length, 2, 'one for the fill and one for the outline');
  const [fill, outline] = [/ fill="url\(#(inkgrad\d+)\)"/.exec(out)![1], /stroke="url\(#(inkgrad\d+)\)"/.exec(out)![1]];
  assert.notEqual(fill, outline);
  assert.ok(gs.every((g) => g.stops.length === 3));
  const plain = build(new GradientAreaPath({ bind: { fill: { axis: 'heat', channel: 'c' } } }, new LinearCurve()), (i) => i / 2).svg();
  assert.equal(gradients(plain).length, 1);
  assert.match(plain, /stroke="none"|stroke="transparent"|stroke-width="0"/, 'no outline unless one is given');
});

test('gradient paths: the ids are scoped with the chart, and a plain LinePath says where to go', () => {
  const chart = make(line(), (i) => i).chart;
  const svg = toSvgString(chart, { idPrefix: 'zz' });
  const [g] = gradients(svg);
  const id = /id="([^"]*)"/.exec(g!.attrs)![1]!;
  assert.match(id, /^zz/);
  assert.ok(svg.includes(`url(#${id})`));
  assert.throws(
    () => build(new LinePath({ bind: { stroke: { axis: 'heat', channel: 'c' } } }, new LinearCurve()), (i) => i),
    /GradientLinePath/,
  );
  assert.throws(
    () => build(new AreaPath({ bind: { fill: { axis: 'heat', channel: 'c' } } }, new LinearCurve()), (i) => i),
    /GradientAreaPath/,
  );
});

test('gradient line: an XYSeries runs the gradient along x', () => {
  const source = new CompositeDataSource({ count: 4, domain: (i) => i, channels: { x: (i) => i * 10, y: (i) => i % 2, c: (i) => i / 3 } });
  const series = new XYSeries({}, source, line());
  const plane = new CartesianPlane({}, new Axis({}, lin()), new Axis({ orientation: 'left' }, lin()), series);
  const chart = new Chart({ theme: lightTheme, width: 400, height: 200 }, plane, new ColorAxis({ id: 'heat', ramp: RAMP }, lin()));
  const platform = new StringPlatform({ width: 400, height: 200 });
  chart.attach(platform).flush();
  const [g] = gradients(platform.toString());
  assert.equal(g!.stops.length, 4);
  assert.ok(g!.num('x2') > g!.num('x1'));
});

test('gradient paths: a legend sample shows the ramp', () => {
  const area = new GradientAreaPath({ bind: { fill: { axis: 'heat', channel: 'c' } } }, new LinearCurve());
  for (const renderer of [line(), area]) {
    const gs = gradients(build(renderer, (i) => i, 3, { legend: true }).svg());
    assert.equal(gs.length, 2, "the series' own and the legend's");
    const sample = gs.find((g) => /s"/.test(g.attrs.split(' ')[0]!))!;
    assert.deepEqual([sample.stops[0]!.color, sample.stops[sample.stops.length - 1]!.color], ['#000000', '#ff0000'], 'low to high');
  }
});

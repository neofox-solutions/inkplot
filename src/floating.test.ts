// Floating bars: `from` names the channel that holds where each bar starts (waterfall steps, candlestick bodies and wicks).
import assert from 'node:assert/strict';
import { shapeCorners } from './fake-platform.ts';
import { test } from 'vite-plus/test';
import {
  Axis,
  BandScale,
  StemPath,
  BarPath,
  CartesianPlane,
  Chart,
  DomainSeries,
  LinearScale,
  ObjectDataSource,
  StringPlatform,
  barShapes,
} from './index.ts';
import { lightTheme } from './themes.ts';

const rows = [
  { x: 0, end: 5, start: -3 }, // crosses zero
  { x: 1, end: 2, start: 8 }, // runs down
  { x: 2, end: NaN, start: 1 }, // a gap
];

function build(from: string | undefined) {
  const bars = new BarPath(from ? { from } : {});
  const series = new DomainSeries(
    {},
    new ObjectDataSource({ source: rows, domain: 'x', value: 'end', isSorted: true, channels: { start: 'start' } }),
    bars,
  );
  const value = new Axis({ orientation: 'left' }, new LinearScale());
  const chart = new Chart(
    { theme: lightTheme, width: 400, height: 300 },
    new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['a', 'b', 'c'] })), value, series),
  );
  const platform = new StringPlatform({ width: 400, height: 300 });
  chart.attach(platform);
  chart.flush();
  return { series, value, platform };
}

test('floating bars start at their channel', () => {
  const { series, value } = build('start');
  const s = barShapes(series, { from: 'start' })!;
  // Corner 0 of a bar is on its foot (its start) and corner 3 on its far end (its value).
  const top = (i: number) => shapeCorners(series, s, i).y[3]!,
    foot = (i: number) => shapeCorners(series, s, i).y[0]!;
  assert(foot(0) > top(0), 'the first bar rises from below zero (pixel y falls as the value rises)');
  assert(foot(1) < top(1), 'the second runs down from 8 to 2');
  assert(Number.isNaN(foot(2)), 'a gap has no bar');
  // The axis reaches both ends of every bar, even the ones below the first value.
  const range = value.range;
  assert(range.min <= -3 && range.max >= 8, `axis ${JSON.stringify(range)} reaches -3 and 8`);
});

test('without from, bars grow from the baseline and the axis does not reach the channel', () => {
  const plain = build(undefined);
  assert(plain.value.range.min >= 0, 'the channel is ignored');
  const floating = build('start');
  assert.notEqual(plain.platform.toString(), floating.platform.toString(), 'from changes the drawing');
});

test('stems can float too', () => {
  const stems = new StemPath({ from: 'start' });
  assert.equal(stems.attrs.from, 'start');
  assert.deepEqual(stems.channelNames, ['start']);
});

// ── Bindings on bars: a colour (or width, opacity) taken from a channel, by a dimension or by a function.
import { ColorAxis, Density } from './index.ts';

test('bars take bound looks from a function of a channel', () => {
  const data = [
    { x: 0, v: 4, chg: 4 },
    { x: 1, v: -2, chg: -2 },
    { x: 2, v: 5, chg: 3 },
    { x: 3, v: NaN, chg: 0 },
  ];
  const draw = (bind: NonNullable<ConstructorParameters<typeof BarPath>[0]>) => {
    const series = new DomainSeries(
      {},
      new ObjectDataSource({ source: data, domain: 'x', value: 'v', isSorted: true, channels: { chg: 'chg' } }),
      new BarPath(bind),
    );
    const chart = new Chart(
      { theme: lightTheme, width: 400, height: 300 },
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom' }, new LinearScale()),
        new Axis({ orientation: 'left' }, new LinearScale()),
        series,
      ),
    );
    const platform = new StringPlatform({ width: 400, height: 300 });
    chart.attach(platform);
    chart.flush();
    return platform.toString().replace(/clip\d+/g, 'clip'); // the ids count up across charts
  };
  const plain = draw({});
  const mapped = draw({ bind: { fill: { channel: 'chg', map: (v: number) => (v < 0 ? '#d1495b' : '#3a9d6e') } } });
  assert.notEqual(plain, mapped, 'binding changes the drawing');
  assert(mapped.includes('#d1495b') && mapped.includes('#3a9d6e'), 'each result is a colour of its own');
  assert.equal(mapped.match(/#d1495b/g)!.length, 1, 'the one negative bar is in a path of its own');
  const paths = mapped.match(/<path[^>]*fill="#(?:d1495b|3a9d6e)"[^>]*>/g)!;
  assert.equal(paths.length, 2, 'two looks, two paths, however many bars');
  // A dimension does the same by position along its range.
  const axis = new ColorAxis({ ramp: ['#d1495b', '#3a9d6e'], interpolation: 'step', min: -1, max: 1 }, new LinearScale());
  assert.equal(axis.valueAt(0.25), '#d1495b');
  // Switching the binding off again restores the plain drawing, with no node left behind.
  assert.equal(draw({}), plain);
});

test('stems take bound strokes, and a bound fill is a compile error there', () => {
  const stems = new StemPath({ bind: { stroke: { channel: 'chg', map: (v: number) => (v < 0 ? 'red' : 'green') } } });
  assert.equal(stems.swatch, null, 'a bound colour has no one swatch');
  // @ts-expect-error -- stems have no fill to bind
  new StemPath({ bind: { fill: { channel: 'chg', map: () => 'red' } } });
});

test('histogram bars can be coloured by their bin', () => {
  const pts = Array.from({ length: 40 }, (_, i) => ({ v: (i * 7) % 30 }));
  const series = new DomainSeries(
    {},
    new Density({ width: 5 }, new ObjectDataSource({ source: pts, domain: 'v', value: 'v' })),
    new BarPath({ bind: { fill: { channel: 'domain', map: (x: number) => (x > 15 ? '#d1495b' : '#4c78a8') } } }),
  );
  const chart = new Chart(
    { theme: lightTheme, width: 400, height: 300 },
    new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      series,
    ),
  );
  const platform = new StringPlatform({ width: 400, height: 300 });
  chart.attach(platform);
  chart.flush();
  const svg = platform.toString();
  assert(svg.includes('#d1495b') && svg.includes('#4c78a8'), 'both looks are drawn');
});

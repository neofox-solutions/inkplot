// Floating bars: `from` names the channel that holds where each bar starts (waterfall steps, candlestick bodies and wicks).
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  BandScale,
  BarLinePath,
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
  const y = (i: number, corner: number) => s.data[(i * s.perShape + corner) * 2 + 1]!;
  // A bar's outline runs along its foot (its start) and back along its far end (its value).
  const top = (i: number) => y(i, s.perShape - 1),
    foot = (i: number) => y(i, 0);
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
  const stems = new BarLinePath({ from: 'start' });
  assert.equal(stems.attrs.from, 'start');
  assert.deepEqual(stems.channelNames, ['start']);
});

// Mapped dimensions: colour ramps and sizes, ranges taken from the series that bind them, and the keys.
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart, CartesianPlane, Axis, LinearScale, DomainSeries, ObjectDataSource, ColorAxis, SizeAxis, CircleMarker, StringPlatform,
} from './index.ts';

const lin = () => new LinearScale();

// ── Colour: ends of a ramp, interpolation between stops, steps, and what has no value.
{
  const viridis = new ColorAxis({}, lin());
  assert.equal(viridis.valueAt(0), '#440154');
  assert.equal(viridis.valueAt(1), '#fde725');
  assert.match(viridis.valueAt(0.5), /^#[0-9a-f]{6}$/);
  assert.equal(viridis.valueAt(NaN), '#bbb');
  assert.equal(viridis.valueAt(1.5), '#bbb', 'outside the range is missing too');
  assert.equal(viridis.valueAt(-0.2), '#bbb');
  assert.equal(new ColorAxis({ missing: 'hotpink' }, lin()).valueAt(NaN), 'hotpink');

  const gray = new ColorAxis({ ramp: ['#000', '#fff'] }, lin());
  assert.equal(gray.valueAt(0), '#000000', 'three-digit colours are accepted');
  assert.equal(gray.valueAt(0.5), '#808080');
  assert.equal(gray.valueAt(1), '#ffffff');
  // A channel that rounds up to 16 (15.5 here) is still two digits: it was once written as three, which no renderer accepts.
  assert.equal(new ColorAxis({ ramp: ['#000000', '#1f1f1f'] }, lin()).valueAt(0.5), '#101010', 'every channel is two hex digits');
  assert.match(new ColorAxis({ ramp: ['#000000', '#1f1f1f'] }, lin()).valueAt(0.49), /^#[0-9a-f]{6}$/);
  const three = new ColorAxis({ ramp: ['#ff0000', '#00ff00', '#0000ff'] }, lin());
  assert.equal(three.valueAt(0.5), '#00ff00', 'stops are spread evenly');
  assert.equal(three.valueAt(0.25), '#808000');

  const steps = new ColorAxis({ ramp: ['red', 'green', 'blue'], interpolation: 'step' }, lin());
  assert.deepEqual([0, 0.2, 0.34, 0.5, 0.67, 1].map((f) => steps.valueAt(f)), ['red', 'red', 'green', 'green', 'blue', 'blue'], 'any CSS colour will do for steps');
  assert.throws(() => new ColorAxis({ ramp: ['red', 'blue'] }, lin()).valueAt(0.5), /#rgb or #rrggbb/);
  for (const name of ['viridis', 'magma', 'turbo', 'blues', 'greys', 'diverging'] as const) {
    const a = new ColorAxis({ ramp: name }, lin());
    assert.notEqual(a.valueAt(0), a.valueAt(1), name);
  }
}

// ── Size: linear between the ends of its output.
{
  const s = new SizeAxis({ output: [2, 12] }, lin());
  assert.equal(s.valueAt(0), 2);
  assert.equal(s.valueAt(0.5), 7);
  assert.equal(s.valueAt(1), 12);
  assert.equal(s.valueAt(NaN), 2, 'by default the low end stands in for no value');
  assert.equal(new SizeAxis({ output: [2, 12], missing: 0 }, lin()).valueAt(NaN), 0);
  assert.equal(new SizeAxis({}, lin()).valueAt(1), 12, 'default output is 2 to 12');
  assert(Math.abs(new SizeAxis({ output: [0.2, 1] }, lin()).valueAt(0.5) - 0.6) < 1e-12, 'also how to bind an opacity');
}

// ── In a chart.
type Row = { x: number; y: number; c: number };
const build = (rows: Row[], colour: ColorAxis | null, extra: object[] = [], plane: { x?: object } = {}, size?: SizeAxis) => {
  const xAxis = new Axis({ orientation: 'bottom', ...plane.x }, lin());
  const source = new ObjectDataSource({ source: rows, domain: 'x', value: 'y', isSorted: true, channels: { c: 'c' } });
  const marker = colour || size
    ? new CircleMarker({ bind: { ...(colour && { fill: { axis: colour, channel: 'c' } }), ...(size && { size: { axis: size, channel: 'c' } }) } })
    : new CircleMarker();
  const cartesian = new CartesianPlane({}, xAxis, new Axis({ orientation: 'left' }, lin()), new DomainSeries(source, marker));
  const chart = new Chart({ theme: lightTheme, width: 600, height: 300 }, cartesian, ...(colour ? [colour] : []), ...(extra as never[]));
  const platform = new StringPlatform({ width: 600, height: 300 });
  chart.attach(platform);
  chart.flush();
  return { chart, platform, xAxis, plane: cartesian, source };
};
const rows = Array.from({ length: 200 }, (_, i): Row => ({ x: i, y: Math.sin(i / 20) * 5, c: i < 150 ? 0 : 100 }));

// The range is every value of the channel, not only the part in view: colours do not move while you zoom.
{
  const heat = new ColorAxis({}, lin());
  const { chart, xAxis } = build(rows, heat);
  assert.deepEqual({ ...heat.range }, { min: 0, max: 100 });
  xAxis.setViewRange({ min: 0, max: 50 });   // nothing in view has a channel value above 0
  chart.flush();
  assert.deepEqual({ ...heat.range }, { min: 0, max: 100 }, 'zoomed to points that are all 0, the range is still 0 to 100');
  const fixed = new ColorAxis({ min: 0, max: 10 }, lin());
  build(rows, fixed);
  assert.deepEqual({ ...fixed.range }, { min: 0, max: 10 }, 'fixed ends win, as on any dimension');
}

// A dimension that nothing binds has the default range, and one that is bound follows its data from flush to flush.
{
  const idle = new SizeAxis({}, lin());
  const { chart, source } = build(rows, new ColorAxis({}, lin()), [idle]);
  assert.deepEqual({ ...idle.range }, { min: 0, max: 1 }, 'nothing contributes, so the default');
  const heat = new ColorAxis({}, lin());
  const built = build(rows, heat);
  assert.deepEqual({ ...heat.range }, { min: 0, max: 100 });
  built.source.setAttribute('source', rows.map((r) => ({ ...r, c: r.c * 2 })));
  built.chart.flush();
  assert.deepEqual({ ...heat.range }, { min: 0, max: 200 }, 'a new flush starts the range over');
  built.chart.flush();
  assert.deepEqual({ ...heat.range }, { min: 0, max: 200 }, 'and a flush with nothing new keeps it');
  void chart; void source;
}

// An inverted dimension swaps its ends.
{
  const two: Row[] = [{ x: 0, y: 1, c: 0 }, { x: 1, y: 2, c: 1 }];
  const fills = (inverted: boolean) => {
    const heat = new ColorAxis({ ramp: ['#000', '#fff'], inverted }, lin());
    const svg = build(two, heat).platform.toString();
    return [...svg.matchAll(/<path d="M[^"]*a[^"]*" fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  };
  assert.deepEqual(fills(false), ['#000000', '#ffffff']);
  assert.deepEqual(fills(true), ['#ffffff', '#000000']);
}

console.log('ok mapped');

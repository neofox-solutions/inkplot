// What a repaint costs: a pointer moving over a chart changes nothing the geometry depends on, so the series keeps its points
// (and its `projection` number), and everything made from them (path text, traces, bars, stacks, markers) is the same object.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  AreaPath,
  Axis,
  BarPath,
  CardinalCurve,
  CartesianPlane,
  Chart,
  CircleMarker,
  DomainSeries,
  FlatDataSource,
  LinePath,
  LinearCurve,
  LinearScale,
  Stack,
  barShapes,
  lightTheme,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';

const flat = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start: 0, step: 1 } });
function mount(...kids: (DomainSeries | Stack)[]) {
  const x = new Axis({ orientation: 'bottom' }, new LinearScale()),
    y = new Axis({ orientation: 'left' }, new LinearScale());
  const plane = new CartesianPlane({}, x, y, ...kids);
  const chart = new Chart({ theme: lightTheme }, plane);
  const platform = new FakePlatform({ width: 400, height: 300 });
  chart.attach(platform).flush();
  const repaint = () => {
    chart.invalidate();
    chart.flush();
  };
  return { x, y, plane, chart, platform, repaint };
}

test('a repaint keeps the projection, and a change to anything it depends on does not', () => {
  const data = flat([1, 3, 2, 5, 4]);
  const series = new DomainSeries({}, data, new LinePath(new LinearCurve()));
  const { x, plane, chart, platform, repaint } = mount(series);
  const at = series.projection;
  const text = platform.toString();
  repaint();
  repaint();
  assert.equal(series.projection, at, 'nothing changed');
  assert.equal(platform.toString(), text);

  data.setAttribute('data', Float64Array.from([1, 3, 2, 5, 9]));
  chart.flush();
  assert.ok(series.projection > at, 'new data');
  const afterData = series.projection;

  x.setAttributes({ min: 1, max: 3 });
  chart.flush();
  assert.ok(series.projection > afterData, 'a zoom');
  const afterZoom = series.projection;

  const size = platform.size();
  platform.current = { width: size.width - 50, height: size.height };
  platform.resize!(platform.current);
  platform.pending?.();
  assert.ok(series.projection > afterZoom, 'a resize');
  assert.ok(plane.rect.width > 0);
});

test('path text and traces follow the projection and the curve, and are not made again for a repaint', () => {
  const curve = new CardinalCurve({ tension: 0 });
  const series = new DomainSeries({}, flat([1, 3, 2, 5, 4]), new LinePath(curve));
  const { repaint, platform } = mount(series);
  const text = platform.toString();
  const trace = series.trace();
  repaint();
  assert.equal(series.trace(), trace, 'the same trace object');
  curve.setAttribute('tension', 1);
  const stiff = platform.toString();
  repaint();
  assert.notEqual(platform.toString(), text, 'the curve changed, so does the path');
  assert.notEqual(series.trace(), trace);
  assert.notEqual(stiff, platform.toString());
});

test('bars: the same shapes for every reader until the series is projected again', () => {
  const series = new DomainSeries({}, flat([1, 3, 2]), new BarPath({}));
  const { x, repaint, chart } = mount(series);
  const shapes = barShapes(series, {});
  assert.ok(shapes);
  repaint();
  assert.equal(barShapes(series, {}), shapes, 'shared and kept');
  assert.equal(series.shapes(), shapes);
  x.setAttributes({ min: 0, max: 1.5 });
  chart.flush();
  assert.notEqual(barShapes(series, {}), shapes);
});

test('a stack keeps its layout while nothing it is made from changes, and lays out again when something does', () => {
  const a = new DomainSeries({ name: 'a' }, flat([1, 2, 3]), new AreaPath(new LinearCurve())),
    b = new DomainSeries({ name: 'b' }, flat([3, 2, 1]), new AreaPath(new LinearCurve()));
  const { repaint, chart } = mount(new Stack({}, a, b));
  const layer = b.layer;
  const at = b.projection;
  repaint();
  assert.equal(b.layer, layer, 'the same layer object');
  assert.equal(b.projection, at);
  a.setAttribute('visible', false);
  chart.flush();
  assert.notEqual(b.layer, layer, 'a member left, the rest closed up');
  assert.deepEqual(Array.from(b.layer!.base), [0, 0, 0]);
});

test('markers: the same picture from a repaint, a new one when the points move', () => {
  const data = flat([1, 3, 2]);
  const series = new DomainSeries({}, data, new CircleMarker({}));
  const { repaint, platform, chart } = mount(series);
  const text = platform.toString();
  repaint();
  assert.equal(platform.toString(), text);
  data.setAttribute('data', Float64Array.from([3, 1, 2]));
  chart.flush();
  assert.notEqual(platform.toString(), text);
});

// Edge cases of input: a pointer taken back, hidden things that take no input, brushes and cursors set from code.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  ChartGroup,
  ChartGroupItem,
  SharedAxis,
  SharedRange,
  StringPlatform,
  Brush,
  CartesianPlane,
  Chart,
  Cursor,
  DomainSeries,
  FlatDataSource,
  Legend,
  LinePath,
  LinearCurve,
  LinearScale,
  PanZoom,
  type BrushSelection,
  type RawPointer,
  lightTheme,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';

function setup(opts: { live?: boolean; legendVisible?: boolean } = {}) {
  const heard: (BrushSelection | null)[] = [];
  const x = new Axis({ orientation: 'bottom' }, new LinearScale()),
    y = new Axis({ orientation: 'left' }, new LinearScale());
  const series = new DomainSeries(
    { name: 'A' },
    new FlatDataSource({ data: Array.from({ length: 11 }, (_, i) => i), regularDomain: { start: 0, step: 1 } }),
    new LinePath(new LinearCurve()),
  );
  const brush = new Brush({ live: opts.live, onBrush: (s) => heard.push(s) });
  const cursor = new Cursor({});
  const plane = new CartesianPlane({}, x, y, series, brush, new PanZoom({}));
  const legend = new Legend({ visible: opts.legendVisible, side: 'top' });
  const chart = new Chart({ theme: lightTheme }, plane, cursor, legend);
  const platform = new FakePlatform({ width: 400, height: 300 });
  chart.attach(platform).flush();
  const send = (kind: RawPointer['kind'], px: number, py: number, extra: Partial<RawPointer> = {}) => {
    const handled = platform.pointer!({ kind, x: px, y: py, buttons: 0, deltaY: 0, shift: false, ctrl: false, ...extra });
    chart.flush();
    return handled;
  };
  const inPlane = (fx: number, fy: number) => [plane.rect.x + fx * plane.rect.width, plane.rect.y + fy * plane.rect.height] as const;
  return { x, y, series, brush, cursor, plane, legend, chart, platform, send, inPlane, heard };
}

test('a cancelled pointer abandons a drag and a press', () => {
  const { brush, send, inPlane, heard, x } = setup();
  send('down', ...inPlane(0.2, 0.2), { buttons: 1 });
  send('move', ...inPlane(0.6, 0.6), { buttons: 1 });
  assert.equal(brush.selecting, true);
  send('cancel', ...inPlane(0.6, 0.6));
  assert.equal(brush.selecting, false);
  assert.equal(brush.selection, null);
  assert.deepEqual(heard, []);
  assert.equal(x.isZoomed, false);
});

test('a cancelled live brush puts the app back to the committed selection', () => {
  const { brush, send, inPlane, heard } = setup({ live: true });
  brush.select([{ axis: brush.requireParent().axes[0]!, min: 2, max: 4 }]);
  heard.length = 0;
  send('down', ...inPlane(0.5, 0.2), { buttons: 1 });
  send('move', ...inPlane(0.9, 0.8), { buttons: 1 });
  assert.ok(heard.length > 0, 'the app saw the box');
  send('cancel', ...inPlane(0.9, 0.8));
  const last = heard[heard.length - 1];
  assert.deepEqual(last?.x && [last.x.min, last.x.max], [2, 4], 'and is told the selection is the committed one');
  assert.deepEqual(brush.selection?.x && [brush.selection.x.min, brush.selection.x.max], [2, 4]);
});

test('select is silent on request, and quiet when nothing changes; an empty list clears', () => {
  const { brush, heard } = setup();
  const axis = brush.requireParent().axes[0]!;
  brush.select([{ axis, min: 1, max: 3 }], { silent: true });
  assert.equal(heard.length, 0);
  assert.ok(brush.selection);
  brush.select([{ axis, min: 3, max: 1 }]);
  assert.equal(heard.length, 0, 'the same range, either way round');
  brush.select([{ axis, min: 1, max: 5 }]);
  assert.equal(heard.length, 1);
  brush.select([]);
  assert.equal(brush.selection, null);
  assert.equal(heard[heard.length - 1], null);
  brush.select([{ axis, min: 1, max: 5 }], { silent: true });
  brush.clear({ silent: true });
  assert.equal(brush.selection, null);
  assert.equal(heard.length, 2, 'silent clear says nothing');
});

test('a hidden legend takes no input', () => {
  const { legend, series, send, chart } = setup({ legendVisible: false });
  chart.flush();
  const r = legend.entryRect(series);
  const [px, py] = r ? [r.x + 2, r.y + 2] : [5, 5];
  send('down', px, py, { buttons: 1 });
  send('up', px, py);
  assert.equal(series.shown, true);
});

test('a legend press is abandoned when the pointer is cancelled', () => {
  const { legend, series, send } = setup();
  const r = legend.entryRect(series)!;
  const [px, py] = [r.x + 2, r.y + 2];
  send('down', px, py, { buttons: 1 });
  send('cancel', px, py);
  send('up', px, py);
  assert.equal(series.shown, true);
  send('down', px, py, { buttons: 1 });
  send('up', px, py);
  assert.equal(series.shown, false);
});

test('a cursor put there by select shows without focus, survives blur, and clear takes it away', () => {
  const { cursor, series, platform, send, inPlane } = setup();
  const state = () => cursor.state as { hits: { index: number }[]; source: string } | null;
  assert.equal(state(), null);
  cursor.select(series, 3);
  assert.ok(state(), 'shown without the plot having focus');
  assert.equal(state()?.hits[0]?.index, 3);
  assert.equal(state()?.source, 'keyboard');
  platform.focusHandler?.({ focused: false } as never);
  assert.ok(state(), 'still there');
  cursor.clear();
  assert.equal(state(), null);
  cursor.select(series, 2);
  send('move', ...inPlane(0.5, 0.5));
  assert.equal(state()?.source, 'pointer', 'the pointer takes over');
});

test('a shared range has one natural range, the data of every chart that shares it', () => {
  const rows = (xs: number[]) => new FlatDataSource({ data: Float64Array.from(xs.flatMap((v) => [v, v])), stride: 2 });
  const cell = (xs: number[]) =>
    new ChartGroupItem(
      {},
      new CartesianPlane(
        {},
        new SharedAxis({ orientation: 'bottom', sharedRef: 'time' }),
        new Axis({ orientation: 'left' }, new LinearScale()),
        new DomainSeries({}, rows(xs), new LinePath(new LinearCurve())),
      ),
    );
  const a = cell([0, 1, 2]),
    b = cell([5, 6, 10]);
  const group = new ChartGroup({ columns: 2 }, new SharedRange({ id: 'time' }, new LinearScale()), a, b);
  new Chart({ theme: lightTheme, width: 420, height: 320 }, group).attach(new StringPlatform({ width: 420, height: 320 })).flush();
  const [xa, xb] = [a.planes[0]!.axes[0]!, b.planes[0]!.axes[0]!];
  const natural = xa.naturalRange();
  assert.deepEqual([natural.min, natural.max], [0, 10], 'the short chart is limited by all the data, not its own');
  assert.deepEqual(xb.naturalRange(), natural);
});

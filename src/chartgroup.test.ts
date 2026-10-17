// Chart groups: a grid of charts in one picture.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  Crosshair,
  Cursor,
  PanZoom,
  PolarPlane,
  RadarPlane,
  CartesianPlane,
  Chart,
  ChartGroup,
  ChartGroupItem,
  ChartTitle,
  SharedAxis,
  SharedRange,
  DomainSeries,
  FlatDataSource,
  Legend,
  LinePath,
  LinearCurve,
  LinearScale,
  StringPlatform,
  fromJSON,
  lightTheme,
  registry,
  toJSON,
} from './index.ts';
import { FakePlatform } from './fake-platform.ts';
import type { ChartGroupAttributes, ChartGroupItemAttributes } from './index.ts';

const W = 420,
  H = 320;
const plane = (name = '') =>
  new CartesianPlane(
    {},
    new Axis({ orientation: 'bottom' }, new LinearScale()),
    new Axis({ orientation: 'left' }, new LinearScale()),
    new DomainSeries(
      { name },
      new FlatDataSource({ data: Float64Array.from([0, 1, 1, 3, 2, 2]), stride: 2 }),
      new LinePath(new LinearCurve()),
    ),
  );
const item = (attrs: ChartGroupItemAttributes = {}) => new ChartGroupItem(attrs, plane());

function lay(attrs: ChartGroupAttributes, items: ChartGroupItem[], ...rest: ConstructorParameters<typeof Chart>[1][]) {
  const group = new ChartGroup(attrs, ...items);
  const chart = new Chart({ theme: lightTheme, width: W, height: H, padding: 0 }, group, ...rest);
  chart.attach(new StringPlatform({ width: W, height: H })).flush();
  return { chart, group };
}
const boxes = (items: ChartGroupItem[]) =>
  items.map((i) => [i.rect.x, i.rect.y, i.rect.width, i.rect.height].map((v) => Math.round(v * 100) / 100));

test('chart group', () => {
  // Equal cells, row flow, a gap between them.
  {
    const items = [item(), item(), item(), item()];
    lay({ columns: 2, gap: 20 }, items);
    assert.deepEqual(boxes(items), [
      [0, 0, 200, 150],
      [220, 0, 200, 150],
      [0, 170, 200, 150],
      [220, 170, 200, 150],
    ]);
  }
  // Gaps by direction, and the default of 8.
  {
    const items = [item(), item()];
    lay({ columns: 2, gap: { column: 0 } }, items);
    assert.deepEqual(boxes(items), [
      [0, 0, 210, 320],
      [210, 0, 210, 320],
    ]);
    const d = [item(), item()];
    lay({ columns: 2 }, d);
    assert.equal(d[1]!.rect.x, 214);
  }
  // Column flow fills down first.
  {
    const items = [item(), item(), item()];
    lay({ rows: 2, flow: 'column', gap: 0 }, items);
    assert.deepEqual(boxes(items), [
      [0, 0, 210, 160],
      [0, 160, 210, 160],
      [210, 0, 210, 160],
    ]);
  }
  // Rows given alone share the items out; neither given makes a square, rounded up.
  {
    const items = [item(), item(), item(), item()];
    lay({ rows: 2, gap: 0 }, items);
    assert.deepEqual(
      boxes(items).map((b) => b[0]),
      [0, 210, 0, 210],
    );
    const one = [item(), item(), item()];
    lay({ gap: 0 }, one);
    assert.deepEqual(
      boxes(one).map((b) => [b[0], b[1]]),
      [
        [0, 0],
        [210, 0],
        [0, 160],
      ],
    );
  }
  // Spans: an item takes several cells, and the grid goes on after it.
  {
    const items = [item({ span: [2, 1] }), item(), item(), item({ span: [1, 2] }), item()];
    lay({ columns: 3, gap: 0 }, items);
    // Three lines: the tall item reaches into the third.
    assert.deepEqual(boxes(items), [
      [0, 0, 280, 106.67],
      [280, 0, 140, 106.67],
      [0, 106.67, 140, 106.67],
      [140, 106.67, 140, 213.33],
      [280, 106.67, 140, 106.67],
    ]);
    assert.throws(() => lay({ columns: 2 }, [item({ span: 3 })]), /spans 3 cells/);
    assert.throws(() => lay({ columns: 2, rows: 1 }, [item(), item(), item()]), /do not fit/);
    assert.throws(() => lay({ columns: 2 }, [item({ span: 1.5 })]), /span/);
  }
  // A last line that is not full: justify.
  {
    const rects = (justify: ChartGroupAttributes['justify']) => {
      const items = Array.from({ length: 8 }, () => item());
      lay({ columns: 3, gap: 0, justify }, items);
      return items.slice(6).map((i) => Math.round(i.rect.x));
    };
    assert.deepEqual(rects(undefined), [0, 140]);
    assert.deepEqual(rects('start'), [0, 140]);
    assert.deepEqual(rects('center'), [70, 210]);
    assert.deepEqual(rects('end'), [140, 280]);
    assert.deepEqual(rects('space-between'), [0, 280]);
    assert.deepEqual(rects('space-around'), [35, 245]);
    assert.deepEqual(rects('space-evenly'), [47, 233]);
    // The full lines are where they were.
    const items = Array.from({ length: 8 }, () => item());
    lay({ columns: 3, gap: 0, justify: 'end' }, items);
    assert.deepEqual(
      items.slice(0, 3).map((i) => Math.round(i.rect.x)),
      [0, 140, 280],
    );
  }
  // Not shown: no cell and no space; the rest close up.
  {
    const items = [item(), item({ visible: false }), item()];
    lay({ columns: 2, gap: 0 }, items);
    assert.deepEqual(boxes([items[0]!, items[2]!]), [
      [0, 0, 210, 320],
      [210, 0, 210, 320],
    ]);
  }
  // A grid of one cell lays its items on one another, whatever their number.
  {
    const items = [item(), item({ visible: false }), item()];
    lay({ columns: 1, rows: 1 }, items);
    assert.deepEqual(boxes([items[0]!, items[2]!]), [
      [0, 0, 420, 320],
      [0, 0, 420, 320],
    ]);
  }
  // An item's furniture goes round its own plane, inside its cells; the chart's goes round the whole group.
  {
    const title = new ChartTitle({ text: 'Whole' });
    const own = new ChartTitle({ text: 'Part' });
    const a = new ChartGroupItem({}, own, plane()),
      b = item();
    const { chart } = lay({ columns: 2, gap: 0 }, [a, b], title);
    assert(a.rect.y > 0 && b.rect.y === a.rect.y, 'the chart title takes the top, and the items start under it');
    const planeA = a.planes[0]!,
      planeB = b.planes[0]!;
    assert(planeA.rect.y > planeB.rect.y, "an item's title pushes its plot down");
    assert(planeA.rect.x >= a.rect.x && planeA.rect.x + planeA.rect.width <= a.rect.x + a.rect.width, 'and its plot stays in its cells');
    assert.equal(chart.planes.length, 2);
  }
  // Several planes in a chart need a group; a group may hold a group.
  {
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane(), plane());
    assert.throws(() => chart.attach(new StringPlatform({ width: W, height: H })).flush(), /ChartGroup/);
    const inner = new ChartGroup({ columns: 2, gap: 0 }, item(), item());
    const outer = new ChartGroupItem({}, inner);
    const sibling = item();
    const { chart: c2 } = lay({ rows: 2, flow: 'column', gap: 0 }, [outer, sibling]);
    assert.equal(c2.planes.length, 3);
    assert.deepEqual(boxes(inner.items.slice()), [
      [0, 0, 210, 160],
      [210, 0, 210, 160],
    ]);
  }
  // Legends: the chart's lists every series of every chart, an item's its own.
  {
    const own = new Legend({ side: 'bottom' }),
      a = new ChartGroupItem({}, plane('A'), own),
      b = new ChartGroupItem({}, plane('B'));
    const all = new Legend({ side: 'right' });
    lay({ columns: 2 }, [a, b], all);
    assert.deepEqual(
      all.entries.map((s) => s.attrs.name),
      ['A', 'B'],
    );
    assert.deepEqual(
      own.entries.map((s) => s.attrs.name),
      ['A'],
    );
  }
  // Saved and restored with the registry.
  {
    const { chart } = lay({ columns: 2, justify: 'center' }, [item({ span: [2, 1] }), item()]);
    const json = toJSON(chart, registry);
    const back = fromJSON<Chart>(JSON.parse(JSON.stringify(json)), registry);
    back.attach(new StringPlatform({ width: W, height: H })).flush();
    assert.equal(back.planes.length, 2);
    assert.deepEqual(toJSON(back, registry), json);
  }
});

// Shared axes: one range for the charts of a group, fitted to what all of them draw.
test('shared ranges', () => {
  const rows = (xs: number[], ys: number[]) =>
    new FlatDataSource({ data: Float64Array.from(xs.flatMap((x, i) => [x, ys[i]!])), stride: 2 });
  const cell = (
    xs: number[],
    ys: number[],
    x: Record<string, unknown> = {},
    y: Record<string, unknown> = {},
    own: ChartGroupItemAttributes = {},
  ) =>
    new ChartGroupItem(
      own,
      new CartesianPlane(
        {},
        new SharedAxis({ orientation: 'bottom', sharedRef: 'time', ...x }),
        new Axis({ orientation: 'left', ...y }, new LinearScale()),
        new DomainSeries({}, rows(xs, ys), new LinePath(new LinearCurve())),
      ),
    );
  const rangeOf = (g: ChartGroup) => [...g].find((c): c is SharedRange => c instanceof SharedRange)!;
  const build = (items: ChartGroupItem[], attrs: ChartGroupAttributes = { columns: 2 }) => {
    const group = new ChartGroup(attrs, new SharedRange({ id: 'time' }, new LinearScale()), ...items);
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, group);
    chart.attach(new StringPlatform({ width: W, height: H })).flush();
    return { chart, group };
  };

  // The range covers every chart's data, and every chart draws it the same way.
  {
    const a = cell([0, 1, 2], [1, 2, 3]),
      b = cell([5, 6, 10], [4, 3, 2]);
    const { group } = build([a, b]);
    const range = rangeOf(group).range;
    assert.deepEqual([range.min, range.max], [0, 10]);
    const [pa, pb] = [a.planes[0]!, b.planes[0]!];
    assert.deepEqual(pa.axes[0]!.range, pb.axes[0]!.range);
    assert.equal(pa.axes[0]!.scale, rangeOf(group).scale);
    // Value axes stay each chart's own.
    assert.notDeepEqual(pa.axes[1]!.range, pb.axes[1]!.range);
  }
  // Pan/zoom on one chart's axis is the range's view, and moves all.
  {
    const a = cell([0, 1, 2], [1, 2, 3]),
      b = cell([0, 1, 4], [4, 3, 2]);
    const { chart, group } = build([a, b]);
    a.planes[0]!.axes[0]!.setViewRange({ min: 1, max: 2 });
    chart.flush();
    assert.deepEqual(rangeOf(group).range, { min: 1, max: 2 });
    assert.deepEqual(b.planes[0]!.axes[0]!.range, { min: 1, max: 2 });
    assert(b.planes[0]!.axes[0]!.isZoomed);
    chart.resetViews();
    chart.flush();
    assert.equal(rangeOf(group).range.max, 4);
  }
  // edgeOnly: labels on the bottom row only, and the others give the room back.
  {
    const items = [0, 1, 2, 3].map(() => cell([0, 1, 2], [1, 2, 3], { edgeOnly: true }));
    build(items);
    const top = items[0]!.planes[0]!,
      bottom = items[2]!.planes[0]!;
    assert.equal(top.axes[0]!.drawn, false);
    assert.equal(top.axes[0]!.thickness, 0);
    assert.equal(bottom.axes[0]!.drawn, true);
    assert(bottom.axes[0]!.thickness > 0);
    assert(top.rect.height > bottom.rect.height, 'the plot above keeps the room');
    assert.deepEqual(
      items.map((i) => i.edges.bottom),
      [false, false, true, true],
    );
    assert.deepEqual(
      items.map((i) => i.edges.right),
      [false, true, false, true],
    );
  }
  // A partly empty last row: the chart above the gap is on the bottom edge too.
  {
    const items = [0, 1, 2, 3, 4].map(() => cell([0, 1], [0, 1], { edgeOnly: true }));
    build(items, { columns: 2 });
    assert.deepEqual(
      items.map((i) => i.edges.bottom),
      [false, false, false, true, true],
    );
    const three = [0, 1, 2].map(() => cell([0, 1], [0, 1], { edgeOnly: true }));
    build(three, { columns: 2 });
    assert.deepEqual(
      three.map((i) => i.edges.bottom),
      [false, true, true],
    );
  }
  // Hidden charts take no part in the range.
  {
    const a = cell([0, 1], [0, 1]),
      b = cell([0, 100], [0, 1], {}, {}, { visible: false });
    const { group } = build([a, b]);
    assert.equal(rangeOf(group).range.max, 1);
  }
  // Errors and JSON.
  {
    const lone = new Chart(
      { theme: lightTheme, width: W, height: H },
      new CartesianPlane({}, new SharedAxis({ orientation: 'bottom', sharedRef: 'x' })),
    );
    assert.throws(() => lone.attach(new StringPlatform({ width: W, height: H })).flush(), /no element with id "x"/);
    assert.throws(() => new Axis({}).scale, /has no child 0/);
    const { chart } = build([cell([0, 1], [0, 1]), cell([0, 4], [1, 2])]);
    const json = toJSON(chart, registry);
    const back = fromJSON<Chart>(JSON.parse(JSON.stringify(json)), registry);
    back.attach(new StringPlatform({ width: W, height: H })).flush();
    assert.deepEqual(toJSON(back, registry), json);
    assert.equal(back.planes[1]!.axes[0]!.range.max, 4);
  }
});

// Aligned plots: charts in a column share the room left and right of their plots, charts in a row the room above and below.
test('aligned plots', () => {
  const plane = (top: number, insets = {}) =>
    new CartesianPlane(
      { insets },
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      new DomainSeries({}, new FlatDataSource({ data: Float64Array.from([0, 0, 1, top]), stride: 2 }), new LinePath(new LinearCurve())),
    );
  const run = (attrs: ChartGroupAttributes, tops: number[], insets: object[] = []) => {
    const items = tops.map((t, i) => new ChartGroupItem({}, plane(t, insets[i])));
    const chart = new Chart({ theme: lightTheme, width: W, height: H, padding: 0 }, new ChartGroup({ gap: 0, ...attrs }, ...items));
    chart.attach(new StringPlatform({ width: W, height: H })).flush();
    return items.map((i) => i.planes[0]!.rect);
  };
  // One column: the long labels of the second chart take room, and the first leaves the same, so the plots are one above the other.
  const on = run({ columns: 1 }, [1, 1234567]),
    off = run({ columns: 1, align: false }, [1, 1234567]);
  assert.notEqual(off[0]!.x, off[1]!.x);
  assert.equal(on[0]!.x, on[1]!.x);
  assert.equal(on[0]!.width, on[1]!.width);
  assert.equal(on[0]!.x, off[1]!.x, 'the larger need wins');
  // Two columns: each column is settled on its own, and a row shares its top and bottom.
  const grid = run({ columns: 2 }, [1, 1234567, 2, 3]);
  assert.equal(grid[0]!.x, grid[2]!.x);
  assert.equal(grid[1]!.x, grid[3]!.x);
  assert.equal(grid[0]!.width, grid[2]!.width);
  assert.notEqual(grid[0]!.x, grid[1]!.x - W / 2, 'the other column has its own need');
  assert.equal(grid[0]!.y, grid[1]!.y);
  assert.equal(grid[0]!.height, grid[1]!.height);
  // A side fixed with `insets` is left alone.
  const fixed = run({ columns: 1 }, [1, 1234567], [{ left: 5 }]);
  assert.equal(fixed[0]!.x, 5);
  assert.notEqual(fixed[1]!.x, 5);
});

// Input in a group: the pointer reaches the chart under it, a cursor follows it in its own chart, and shared axes link them.
test('group interaction', () => {
  const cell = (cursor: boolean, pan = false) => {
    const plane = new CartesianPlane(
      {},
      new SharedAxis({ orientation: 'bottom', sharedRef: 'time' }),
      new Axis({ orientation: 'left' }, new LinearScale()),
      new DomainSeries(
        { name: 's' },
        new FlatDataSource({ data: Float64Array.from([0, 1, 5, 3, 10, 2]), stride: 2 }),
        new LinePath(new LinearCurve()),
      ),
      ...(pan ? [new PanZoom({ direction: 'horizontal' })] : []),
    );
    const own = cursor ? new Cursor({ mode: 'shared' }, new Crosshair()) : null;
    return { plane, cursor: own, item: new ChartGroupItem({}, plane, ...(own ? [own] : [])) };
  };
  const build = (cells: ReturnType<typeof cell>[], attrs: ChartGroupAttributes = {}) => {
    const group = new ChartGroup({ columns: 1, ...attrs }, new SharedRange({ id: 'time' }, new LinearScale()), ...cells.map((c) => c.item));
    const chart = new Chart({ theme: lightTheme, width: W, height: 2 * H }, group);
    const platform = new FakePlatform({ width: W, height: 2 * H });
    chart.attach(platform).flush();
    const at = (c: ReturnType<typeof cell>, fx: number, fy: number, kind: 'move' | 'wheel' = 'move', deltaY = 0) => {
      const r = c.plane.rect;
      platform.pointer!({ kind, x: r.x + fx * r.width, y: r.y + fy * r.height, buttons: 0, deltaY, shift: false, ctrl: false });
      chart.flush();
    };
    const leave = () => {
      platform.pointer!({ kind: 'leave', x: 0, y: 0, buttons: 0, deltaY: 0, shift: false, ctrl: false });
      chart.flush();
    };
    return { chart, group, platform, at, leave };
  };

  // A cursor in a chart follows the pointer in that chart, and not the one in the next.
  {
    const a = cell(true),
      b = cell(true);
    const { at, leave } = build([a, b]);
    at(a, 0.5, 0.5);
    assert(a.cursor!.state, 'over its own chart');
    assert.equal(b.cursor!.state, null, 'not over the other');
    at(b, 0.5, 0.5);
    assert.equal(a.cursor!.state, null);
    assert(b.cursor!.state);
    leave();
    assert.equal(b.cursor!.state, null);
  }
  // Linked: the other chart's cursor is at the same value of the shared axis.
  {
    const a = cell(true),
      b = cell(true),
      c = cell(true);
    const { at, leave } = build([a, b, c], { linkCursor: true });
    at(a, 0.3, 0.5);
    const xa = a.cursor!.state!;
    const value = a.plane.axes[0]!.denormalize(xa.x / a.plane.rect.width);
    for (const other of [b, c]) {
      const s = other.cursor!.state;
      assert(s, 'the linked chart has a cursor');
      assert(Math.abs(other.plane.axes[0]!.denormalize(s.x / other.plane.rect.width) - value) < 1e-6, 'at the same value');
    }
    leave();
    assert.deepEqual(
      [a, b, c].map((x) => x.cursor!.state),
      [null, null, null],
    );
    // Off by default.
    const x = cell(true),
      y = cell(true);
    const plain = build([x, y]);
    plain.at(x, 0.3, 0.5);
    assert.equal(y.cursor!.state, null);
  }
  // A cursor of the whole chart (not in an item) goes with the pointer into any chart, and is never moved by a link.
  {
    const a = cell(false),
      b = cell(false);
    const top = new Cursor({ mode: 'shared' }, new Crosshair());
    const group = new ChartGroup({ columns: 1, linkCursor: true }, new SharedRange({ id: 'time' }, new LinearScale()), a.item, b.item);
    const chart = new Chart({ theme: lightTheme, width: W, height: 2 * H }, group, top);
    const platform = new FakePlatform({ width: W, height: 2 * H });
    chart.attach(platform).flush();
    platform.pointer!({ kind: 'move', x: b.plane.rect.x + 40, y: b.plane.rect.y + 40, buttons: 0, deltaY: 0, shift: false, ctrl: false });
    chart.flush();
    assert.equal(top.state?.plane, b.plane);
  }
  // Pan and zoom in one chart moves the shared range, and with it the others.
  {
    const a = cell(false, true),
      b = cell(false);
    const { at, group } = build([a, b]);
    const range = [...group].find((c): c is SharedRange => c instanceof SharedRange)!;
    const before = { ...range.range };
    at(a, 0.5, 0.5, 'wheel', -400);
    assert.notDeepEqual(range.range, before);
    assert(range.isZoomed);
    assert.deepEqual(b.plane.axes[0]!.range, range.range);
  }
});

test('chart group directions, new lines and empty items', () => {
  const xs = (items: ChartGroupItem[]) => items.map((i) => Math.round(i.rect.x));
  const ys = (items: ChartGroupItem[]) => items.map((i) => Math.round(i.rect.y));

  // `newLine` ends a line early; `justify` centres the short one: 3 + 2 + 3.
  {
    const items = [item(), item(), item(), item(), item(), item({ newLine: true }), item(), item()];
    lay({ columns: 3, gap: 0, justify: 'center' }, items);
    assert.deepEqual(xs(items), [0, 140, 280, 70, 210, 0, 140, 280]);
    assert.deepEqual(ys(items), [0, 0, 0, 107, 107, 213, 213, 213]);
    // At the start of a line it changes nothing.
    const first = [item({ newLine: true }), item(), item(), item({ newLine: true })];
    lay({ columns: 3, gap: 0 }, first);
    assert.deepEqual(ys(first), [0, 0, 0, 160]);
    // A line that an item too wide for the rest of it cut short is justified too.
    const wide = [item({ span: 2 }), item({ span: 2 })];
    lay({ columns: 3, gap: 0, justify: 'end' }, wide);
    assert.deepEqual(
      [xs(wide), ys(wide)],
      [
        [140, 140],
        [0, 160],
      ],
    );
  }

  // `reverse` runs each line the other way; `reverseLines` stacks them from the other end; both leave the cells where they are counted.
  {
    const four = () => [item(), item(), item(), item()];
    let items = four();
    lay({ columns: 3, gap: 0, reverse: true }, items);
    assert.deepEqual(
      [xs(items), ys(items)],
      [
        [280, 140, 0, 280],
        [0, 0, 0, 160],
      ],
    );
    items = four();
    lay({ columns: 3, gap: 0, reverseLines: true }, items);
    assert.deepEqual(
      [xs(items), ys(items)],
      [
        [0, 140, 280, 0],
        [160, 160, 160, 0],
      ],
    );
    items = four();
    lay({ columns: 3, gap: 0, reverse: true, reverseLines: true, justify: 'end' }, items);
    assert.deepEqual(
      [xs(items), ys(items)],
      [
        [280, 140, 0, 0],
        [160, 160, 160, 0],
      ],
    );
    // Down columns: `reverse` is the way up each column, `reverseLines` the way along.
    items = four();
    lay({ rows: 2, flow: 'column', gap: 0, reverse: true }, items);
    assert.deepEqual(
      [xs(items), ys(items)],
      [
        [0, 0, 210, 210],
        [160, 0, 160, 0],
      ],
    );
    items = four();
    lay({ rows: 2, flow: 'column', gap: 0, reverseLines: true }, items);
    assert.deepEqual(
      [xs(items), ys(items)],
      [
        [210, 210, 0, 0],
        [0, 160, 0, 160],
      ],
    );
    // Edges follow the cells: the first item of a reversed row is at the right of the group.
    items = four();
    lay({ columns: 2, gap: 0 }, items);
    assert.deepEqual(
      items.map((i) => i.edges),
      [
        { top: true, left: true, right: false, bottom: false },
        { top: true, left: false, right: true, bottom: false },
        { top: false, left: true, right: false, bottom: true },
        { top: false, left: false, right: true, bottom: true },
      ],
    );
    items = four();
    lay({ columns: 2, gap: 0, reverse: true, reverseLines: true }, items);
    assert.deepEqual(
      items.map((i) => i.edges),
      [
        { top: false, left: false, right: true, bottom: true },
        { top: false, left: true, right: false, bottom: true },
        { top: true, left: false, right: true, bottom: false },
        { top: true, left: true, right: false, bottom: false },
      ],
    );
  }

  // A right-to-left chart starts its rows at the right, and `reverse` turns them back.
  {
    const run = (attrs: ChartGroupAttributes) => {
      const items = [item(), item(), item()];
      const chart = new Chart({ theme: lightTheme, width: W, height: H, padding: 0, direction: 'rtl' }, new ChartGroup(attrs, ...items));
      chart.attach(new StringPlatform({ width: W, height: H })).flush();
      return xs(items);
    };
    assert.deepEqual(run({ columns: 3, gap: 0 }), [280, 140, 0]);
    assert.deepEqual(run({ columns: 3, gap: 0, reverse: true }), [0, 140, 280]);
  }

  // An empty item keeps its cells and draws nothing, and does not make the chart above it a chart that is not at the edge.
  {
    const items = [item(), item(), new ChartGroupItem({}), item()];
    const { chart } = lay({ columns: 2, gap: 0 }, items);
    assert.deepEqual(boxes([items[2]!]), [[0, 160, 210, 160]]);
    assert.equal(items[2]!.isEmpty, true);
    assert.equal(items[0]!.edges.bottom, true, 'only an empty item beneath it: it is at the bottom');
    assert.equal(items[1]!.edges.bottom, false, 'a chart beneath it: it is not');
    const gap = [item(), new ChartGroupItem({}), item(), item()];
    lay({ columns: 2, gap: 0 }, gap);
    assert.equal(gap[0]!.edges.right, true, 'only an empty item beside it');
    // Nothing of it is drawn: the chart has as many planes as the others.
    assert.equal(chart.planes.length, 3);
  }

  // And all of it as JSON.
  {
    const items = [item({ newLine: true }), new ChartGroupItem({})];
    const { chart } = lay({ columns: 3, reverse: true, reverseLines: true, justify: 'center' }, items);
    const json = JSON.parse(JSON.stringify(toJSON(chart, registry)));
    const copy = fromJSON(json, registry);
    assert.deepEqual(JSON.parse(JSON.stringify(toJSON(copy, registry))), json);
    assert.match(JSON.stringify(json), /"reverseLines":true/);
  }
});

// A shared range on a polar plane: the same machinery, whatever the plane draws.
test('shared ranges on polar planes', () => {
  const rows = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys.flatMap((y, i) => [i, y])), stride: 2 });
  const cell = (ys: number[], plane: typeof PolarPlane | typeof RadarPlane = PolarPlane, extra: Record<string, unknown> = {}) =>
    new ChartGroupItem(
      {},
      new plane(
        { sweep: 4 },
        new Axis({ orientation: 'angle', min: 0, max: ys.length - 1 }, new LinearScale()),
        new SharedAxis({ orientation: 'radius', sharedRef: 'r', ...extra }),
        new DomainSeries({}, rows(ys), new LinePath(new LinearCurve())),
      ),
    );
  const build = (items: ChartGroupItem[]) => {
    const group = new ChartGroup({ columns: 2 }, new SharedRange({ id: 'r' }, new LinearScale()), ...items);
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, group);
    chart.attach(new StringPlatform({ width: W, height: H })).flush();
    return group;
  };

  // Both charts draw the union of what either holds, on the one scale.
  {
    const a = cell([1, 2, 3, 2]),
      b = cell([10, 20, 30, 20], RadarPlane);
    const group = build([a, b]);
    const range = [...group].find((c): c is SharedRange => c instanceof SharedRange)!.range;
    assert.ok(range.min <= 1 && range.max >= 30, `the range covers both: ${JSON.stringify(range)}`);
    const [ra, rb] = [a.planes[0]!.axes[1]!, b.planes[0]!.axes[1]!];
    assert.deepEqual(ra.range, rb.range);
    assert.equal(ra.scale, rb.scale);
  }
  // edgeOnly is for Cartesian planes: on a polar axis it is not an error and the axis is still drawn.
  {
    const a = cell([1, 2, 3, 2], PolarPlane, { edgeOnly: true }),
      b = cell([4, 5, 6, 5], PolarPlane, { edgeOnly: true });
    build([a, b]);
    assert.equal(a.planes[0]!.axes[1]!.drawn, true);
    assert.equal(b.planes[0]!.axes[1]!.drawn, true);
  }
  // A polar chart and a Cartesian one can share a range.
  {
    const c = new ChartGroupItem(
      {},
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom' }, new LinearScale()),
        new SharedAxis({ orientation: 'left', sharedRef: 'r' }),
        new DomainSeries({}, rows([50, 60]), new LinePath(new LinearCurve())),
      ),
    );
    const a = cell([1, 2, 3, 2]);
    const group = build([a, c]);
    const range = [...group].find((x): x is SharedRange => x instanceof SharedRange)!.range;
    assert.ok(range.max >= 60 && range.min <= 1);
  }
});

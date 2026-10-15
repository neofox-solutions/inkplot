// Chart groups: a grid of charts in one picture.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  CartesianPlane,
  Chart,
  ChartGroup,
  ChartGroupItem,
  ChartTitle,
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
  // Rows given alone share the items out; neither given is one line.
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
        [140, 0],
        [280, 0],
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
        new Axis({ orientation: 'bottom', sharedRef: 'time', ...x }),
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
      new CartesianPlane({}, new Axis({ orientation: 'bottom', sharedRef: 'x' })),
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

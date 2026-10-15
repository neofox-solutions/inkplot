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

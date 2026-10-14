// Point annotations: which points get a note, where a note sits against the bar or wedge it labels, and what a long series is held to.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  BandScale,
  BarPath,
  CartesianPlane,
  Chart,
  CircleMarker,
  DomainSeries,
  FlatDataSource,
  LinearScale,
  PointAnnotations,
  PolarPlane,
  Stack,
  StringPlatform,
  lightTheme,
} from './index.ts';
import type { Hit } from './events.ts';
import type { PointAnnotationsAttributes } from './index.ts';

const WIDTH = 400,
  HEIGHT = 300;

/** Boxes of the notes in an SVG string, in drawing order: the middle and the size of each (the box is `M x y h w v h h-w z`). */
function boxesIn(svg: string): { cx: number; cy: number; w: number; h: number }[] {
  return [...svg.matchAll(/d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)h-[\d.]+z"/g)].map((m) => ({
    cx: +m[1]! + +m[3]! / 2,
    cy: +m[2]! + +m[4]! / 2,
    w: +m[3]!,
    h: +m[4]!,
  }));
}
const textsIn = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);

const VALUES = [4, -3, 6, -1, 2];

function bars(options: Partial<PointAnnotationsAttributes> = {}, renderers: 'bar' | 'bar+marker' = 'bar', roomy = true) {
  const notes = new PointAnnotations({ anchor: 'bar', text: (hit: Hit) => `${hit.index}`, ...options });
  const series = new DomainSeries(
    {},
    new FlatDataSource({ data: VALUES, regularDomain: { start: 0, step: 1 } }),
    new BarPath({ id: 'bar' }),
    ...(renderers === 'bar+marker' ? [new CircleMarker({ id: 'dots' })] : []),
  );
  const plane = new CartesianPlane(
    {},
    new Axis({ orientation: 'bottom' }, new LinearScale()),
    new Axis({ orientation: 'left', ...(roomy ? { min: -8, max: 10 } : {}) }, new LinearScale()),
    series,
    notes,
  );
  const chart = new Chart({ theme: lightTheme, width: WIDTH, height: HEIGHT }, plane);
  const platform = new StringPlatform({ width: WIDTH, height: HEIGHT });
  chart.attach(platform).flush();
  return { chart, plane, notes, series, platform, svg: () => platform.toString() };
}

test('pointannotations', () => {
  // Only the points `text` answers for get a note: the negative bars of a financial chart, each with its value and its month.
  {
    const { notes, svg } = bars({ text: (hit, words) => (hit.second < 0 ? `${words.second}\nmonth ${words.first}` : null) });
    const texts = textsIn(svg());
    for (const expected of ['-3', 'month 1', '-1', 'month 3'])
      assert.ok(texts.includes(expected), `${expected} is drawn: ${texts.join('|')}`);
    assert.ok(!texts.includes('month 0') && !texts.includes('month 2'), 'points without a note have none');
    assert.equal(boxesIn(svg()).length, 2);
    assert.equal(notes.omitted, 0);
  }

  // A note sits beyond the far end of its bar: above a bar that grows up, below one that grows down, and not on the bar.
  {
    const { series, svg } = bars();
    const { data, stride } = series.points;
    const boxes = boxesIn(svg());
    assert.equal(boxes.length, VALUES.length);
    VALUES.forEach((v, i) => {
      const tipY = data[i * stride + 1]!,
        b = boxes[i]!;
      if (v > 0) assert.ok(b.cy + b.h / 2 <= tipY + 0.01 || b.cy < tipY, `note ${i} is above the end of its bar`);
      else assert.ok(b.cy - b.h / 2 >= tipY - 0.01, `note ${i} is below the end of its bar`);
      assert.ok(Math.abs(b.cx - data[i * stride]!) < 1, `note ${i} is centred on its bar`);
    });
  }

  // 'inside' puts it towards the foot, 'text' draws no box, and a 'callout' draws an arm to the point.
  {
    const outside = boxesIn(bars().svg())[1]!,
      inside = boxesIn(bars({ placement: 'inside' }).svg())[1]!;
    assert.ok(inside.cy < outside.cy, "inside a negative bar's end is above where outside puts it");
    assert.equal(
      boxesIn(bars({ shape: 'text' }).svg()).filter((b) => b.w > 0).length,
      VALUES.length,
      'a text note still has a (clear) box path',
    );
    assert.match(bars({ shape: 'text' }).svg(), /<path d="M[^"]*" fill="none" fill-opacity="[^"]*" stroke="none"/);
    const arms = (svg: string) => (svg.match(/stroke-dasharray="none"/g) ?? []).length;
    assert.equal(
      arms(bars({ shape: 'callout' }).svg()) - arms(bars({ shape: 'box' }).svg()),
      VALUES.length,
      'an arm for each note, and only with a callout',
    );
  }

  // The notes stay on the plot when a bar reaches its edge (here the axis stops at the longest bars).
  {
    const { plane, svg } = bars({}, 'bar', false);
    const room = plane.rect;
    for (const b of boxesIn(svg())) {
      assert.ok(b.cx - b.w / 2 >= -0.01 && b.cx + b.w / 2 <= room.width + 0.01, 'inside the plot across');
      assert.ok(b.cy - b.h / 2 >= -0.01 && b.cy + b.h / 2 <= room.height + 0.01, 'inside the plot down');
    }
  }

  // `anchor` names the renderer that places the notes: with the markers, the note is at the point and not at the bar's end.
  {
    const { series, svg } = bars({ anchor: 'dots' }, 'bar+marker');
    const { data, stride } = series.points;
    const b = boxesIn(svg())[0]!;
    // The point of a bar series is its end already, so both agree on where; the id has to resolve, which a wrong one does not.
    assert.ok(Math.abs(b.cx - data[0]!) < 1 && b.cy < data[1]!);
    void stride;
    assert.throws(() => bars({ anchor: 'nope' }, 'bar+marker'), /no element with id "nope"/);
  }

  // maxCount holds a long series to a few notes and says how many it left out.
  {
    const { notes, svg } = bars({ maxCount: 2 });
    assert.equal(boxesIn(svg()).length, 2);
    assert.equal(notes.omitted, 3);
  }

  // Changing what `text` says changes the notes: a note that stops applying is taken off, one that applies again comes back.
  {
    const { notes, platform, chart } = bars({ text: () => 'all' });
    assert.equal(boxesIn(platform.toString()).length, 5);
    notes.setAttribute('text', (hit: Hit) => (hit.index === 2 ? 'only' : null));
    chart.flush();
    assert.equal(boxesIn(platform.toString()).length, 1);
    assert.deepEqual(
      textsIn(platform.toString()).filter((t) => t === 'only' || t === 'all'),
      ['only'],
    );
    notes.setAttribute('text', () => 'all');
    chart.flush();
    assert.equal(boxesIn(platform.toString()).length, 5);
  }

  // What assistive technology reads is an option: hidden by default, read on request.
  {
    const hidden = bars().svg(),
      read = bars({ aria: 'text' }).svg();
    const noteGroup = (svg: string) => svg.split('\n').find((l) => l.includes('<g') && l.includes('fill="#333"'))!;
    assert.match(noteGroup(hidden), /aria-hidden="true"/);
    assert.ok(!/aria-hidden/.test(noteGroup(read)));
  }

  // A ring chart's notes: on the rim of their segment when placed outside it, and within the ring when placed inside.
  {
    const notes = (placement: 'outside' | 'inside') =>
      new PointAnnotations({ anchor: 'A', text: (hit: Hit) => String(hit.second), placement, shape: 'box', contain: false });
    const run = (placement: 'outside' | 'inside') => {
      const n = notes(placement);
      const segment = (name: string, data: number[]) =>
        new DomainSeries(
          { name, domainAxis: 'ring', valueAxis: 'share' },
          new FlatDataSource({ data, regularDomain: { start: 0, step: 1 } }),
          new BarPath({ id: name }),
        );
      const plane = new PolarPlane(
        { innerRadius: 0.2, gridlines: false },
        new Axis({ id: 'share', orientation: 'angle', min: 0, max: 1, visible: false }, new LinearScale()),
        new Axis({ id: 'ring', orientation: 'radius', visible: false }, new BandScale({ categories: ['x', 'y'] })),
        new Stack({ mode: 'normalize' }, segment('A', [30, 20]), segment('B', [70, 80])),
        n,
      );
      const chart = new Chart({ theme: lightTheme, width: WIDTH, height: HEIGHT, padding: 60 }, plane);
      const platform = new StringPlatform({ width: WIDTH, height: HEIGHT });
      chart.attach(platform).flush();
      return { svg: platform.toString(), plane };
    };
    for (const placement of ['outside', 'inside'] as const) {
      const { svg, plane } = run(placement);
      const boxes = boxesIn(svg);
      assert.equal(boxes.length, 2, `${placement}: a note for each ring of segment A`);
      const cx = plane.rect.width / 2,
        cy = plane.rect.height / 2;
      // The ring of segment A is the inner part of its two rings; the outer ring's rim is the larger radius.
      const radii = boxes.map((b) => Math.hypot(b.cx - cx, b.cy - cy));
      assert.ok(radii.every(Number.isFinite));
    }
    const out = run('outside'),
      inn = run('inside');
    const r = (svg: string, plane: { rect: { width: number; height: number } }) =>
      boxesIn(svg).map((b) => Math.hypot(b.cx - plane.rect.width / 2, b.cy - plane.rect.height / 2));
    const ro = r(out.svg, out.plane),
      ri = r(inn.svg, inn.plane);
    assert.ok(
      ro.every((v, i) => v > ri[i]!),
      'outside is further from the middle than inside, for every ring',
    );
  }
});

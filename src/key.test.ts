// Keys: separate chart children that refer to a mapped dimension, placed along an edge and drawn from it.
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  DomainSeries,
  ObjectDataSource,
  ColorAxis,
  ScalarAxis,
  CircleMarker,
  StringPlatform,
  ColorKey,
  SizeKey,
} from './index.ts';
import { test } from 'vite-plus/test';

test('key', () => {
  const lin = () => new LinearScale();
  type Row = { x: number; y: number; c: number };
  const rows = Array.from({ length: 100 }, (_, i): Row => ({ x: i, y: Math.sin(i / 10) * 5, c: i }));

  /** A scatter bound to both dimensions, with whatever furniture the test hands in after the dimensions. */
  function build(furniture: (heat: ColorAxis, mass: ScalarAxis) => object[], dims: { heat?: object; mass?: object } = {}) {
    const heat = new ColorAxis({ id: 'heat', ...dims.heat }, lin());
    const mass = new ScalarAxis({ id: 'mass', output: [2, 9], ...dims.mass }, lin());
    const plane = new CartesianPlane(
      {},
      new Axis({}, lin()),
      new Axis({ orientation: 'left' }, lin()),
      new DomainSeries(
        new ObjectDataSource({ source: rows, domain: 'x', value: 'y', isSorted: true, channels: { c: 'c' } }),
        new CircleMarker({ bind: { fill: { axis: heat, channel: 'c' }, size: { axis: mass, channel: 'c' } } }),
      ),
    );
    const chart = new Chart({ theme: lightTheme, width: 600, height: 400 }, plane, heat, mass, ...(furniture(heat, mass) as never[]));
    const platform = new StringPlatform({ width: 600, height: 400 });
    chart.attach(platform);
    chart.flush();
    return { chart, platform, plane, heat, mass, svg: () => platform.toString() };
  }
  const near = (a: number, b: number, why: string) => assert(Math.abs(a - b) < 1e-9, `${why}: ${a} vs ${b}`);
  const bare = () => build(() => []);

  // ── Without a key there is nothing in the way, and nothing is drawn for the dimension.
  const none = bare();
  assert(!/linearGradient/.test(none.svg()));

  // ── A colour key: a gradient bar and its ticks, titled from the key or else from the dimension.
  {
    const k = build((heat) => [new ColorKey({ dimension: heat, title: 'Pressure' })]);
    const svg = k.svg();
    assert.match(svg, /<linearGradient id="grad\d+" x1="0" y1="1" x2="0" y2="0"/, 'low at the bottom of a vertical bar');
    assert.match(svg, /fill="url\(#grad\d+\)"/);
    assert.match(svg, />Pressure</);
    near(none.plane.rect.width - k.plane.rect.width, 72 + 8, 'a vertical key takes its breadth and a gap from the plot');
    assert.equal(k.plane.rect.height, none.plane.rect.height, 'and nothing from its height');

    const fromDimension = build((heat) => [new ColorKey({ dimension: heat })], { heat: { title: 'From the dimension' } }).svg();
    assert.match(fromDimension, />From the dimension</);
    const overridden = build((heat) => [new ColorKey({ dimension: heat, title: 'Mine' })], { heat: { title: 'Theirs' } }).svg();
    assert.match(overridden, />Mine</);
    assert(!/Theirs/.test(overridden), 'the key says what it likes');
  }

  // ── By id as well as by reference.
  {
    const byId = build(() => [new ColorKey({ dimension: 'heat' })]).svg();
    const byRef = build((heat) => [new ColorKey({ dimension: heat })]).svg();
    const anon = (svg: string) => svg.replace(/(grad|clip)\d+/g, '$1');
    assert.equal(anon(byId), anon(byRef));
  }

  // ── Stepped dimensions get hard stops, so bands stay bands.
  {
    const svg = build((heat) => [new ColorKey({ dimension: heat })], {
      heat: { ramp: ['#f00', '#0f0', '#00f'], interpolation: 'step' },
    }).svg();
    const stops = [...svg.matchAll(/<stop offset="([\d.]+)" stop-color="(#[0-9a-f]+)"/g)].map((m) => [+m[1]!, m[2]]);
    assert.equal(stops.length, 6);
    assert.deepEqual(
      stops.map((s) => s[1]),
      ['#f00', '#f00', '#0f0', '#0f0', '#00f', '#00f'],
    );
  }

  // ── A size key: circles at the tick values, at the size each stands for.
  {
    const k = build((_, mass) => [new SizeKey({ dimension: mass, title: 'Mass' })]);
    const svg = k.svg();
    const circles = [...svg.matchAll(/<path d="(M[^"]*? 0 1 0 [^"]*)" fill="none" stroke="#444" stroke-width="1"/g)];
    assert.equal(circles.length, 1, 'one path for all the circles');
    const radii = [...circles[0]![1]!.matchAll(/a([\d.]+) [\d.]+ 0 1 0/g)].map((m) => +m[1]!).filter((_, i) => i % 2 === 0);
    assert(radii.length >= 2 && radii.length <= 8, `a few circles (${radii.length})`);
    assert(
      radii.every((r, i) => i === 0 || r > radii[i - 1]!),
      'drawn from the low value up, each bigger than the last',
    );
    assert(radii.every((r) => r >= 2 - 0.01 && r <= 9 + 0.01));
    near(none.plane.rect.width - k.plane.rect.width, 72 + 8, 'a size key takes the same strip');
  }

  // ── Several on a side stack down it, in child order, sharing one strip; none is taken from the plot twice.
  {
    const k = build((heat, mass) => [new ColorKey({ dimension: heat, title: 'A' }), new SizeKey({ dimension: mass, title: 'B' })]);
    const ys = [...k.svg().matchAll(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)" font-size="11"/g)].map((m) => [+m[1]!, +m[2]!]);
    assert.equal(ys.length, 2);
    assert.equal(ys[0]![0], ys[1]![0], 'one column');
    assert.equal(ys[0]![1], 10, 'the first at the top of the chart padding');
    const first = 18 + 140 + 12;
    assert.equal(ys[1]![1]! - ys[0]![1], first + 8, 'the second below the first, a gap between');
    near(none.plane.rect.width - k.plane.rect.width, 72 + 8, 'one strip for both');
  }

  // ── Every side, and an orientation that follows it unless told otherwise.
  {
    const place = (side: 'left' | 'right' | 'top' | 'bottom', extra: object = {}) =>
      build((heat) => [new ColorKey({ dimension: heat, side, ...extra })]);
    const left = place('left'),
      right = place('right'),
      top = place('top'),
      bottom = place('bottom');
    near(left.plane.rect.x - none.plane.rect.x, 72 + 8, 'left: the plot moves right');
    assert.equal(left.plane.rect.width, right.plane.rect.width);
    assert(
      top.plane.rect.height < none.plane.rect.height && bottom.plane.rect.height === top.plane.rect.height,
      'top and bottom take height',
    );
    assert.equal(top.plane.rect.width, none.plane.rect.width, 'and no width');
    assert.match(top.svg(), /<linearGradient id="grad\d+" x1="0" y1="0" x2="1" y2="0"/, 'horizontal on the top: low at the left');
    assert.match(left.svg(), /y1="1" x2="0" y2="0"/, 'vertical on the left');
    const tall = place('top', { orientation: 'vertical' });
    assert.match(tall.svg(), /y1="1" x2="0" y2="0"/, 'orientation can be asked for');
    const wide = place('right', { orientation: 'horizontal' });
    assert.match(wide.svg(), /x1="0" y1="0" x2="1" y2="0"/);
    // The key is where the plot is not: it sits in the strip it asked for.
    const keyAt = (k: { svg(): string }) => {
      const m = /<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)" font-size="11"/.exec(k.svg())!;
      return [+m[1]!, +m[2]!];
    };
    const [lx] = keyAt(left),
      [rx] = keyAt(right);
    const lp = left.plane.rect,
      rp = right.plane.rect;
    assert(lx! < lp.x && rx! > rp.x + rp.width, 'left of the left plot, right of the right one');
    const [, ty] = keyAt(top),
      [, by] = keyAt(bottom);
    assert(ty! < top.plane.rect.y && by! > bottom.plane.rect.y + bottom.plane.rect.height);
  }

  // ── Length and breadth belong to the key, so two keys of one dimension can differ.
  {
    const k = build((heat) => [
      new ColorKey({ dimension: heat, length: 80, breadth: 100, title: 'Short' }),
      new ColorKey({ dimension: heat, length: 200, title: 'Long' }),
    ]);
    near(none.plane.rect.width - k.plane.rect.width, 100 + 8, 'the widest breadth sets the strip');
    const heights = [...k.svg().matchAll(/<rect x="0" y="18" width="14" height="(\d+)"/g)].map((m) => +m[1]!);
    assert.deepEqual(heights, [80, 200]);
    const thick = build((heat) => [new ColorKey({ dimension: heat, thickness: 30 })]).svg();
    assert.match(thick, /width="30" height="140"/);
  }

  // ── A key that is not visible takes no room; showing it again does.
  {
    const hidden = build((heat) => [new ColorKey({ dimension: heat, visible: false })]);
    assert.equal(hidden.plane.rect.width, none.plane.rect.width);
    const key = [...hidden.chart].find((c) => c instanceof ColorKey) as ColorKey;
    key.setAttribute('visible', true);
    hidden.chart.flush();
    assert(hidden.plane.rect.width < none.plane.rect.width);
  }

  // ── The key follows its dimension: data, ramp, inversion and range all show up.
  {
    const k = build((heat) => [new ColorKey({ dimension: heat })]);
    const labels = (svg: string) => [...svg.matchAll(/<text x="20" y="[\d.]+">([^<]*)</g)].map((m) => m[1]);
    assert(labels(k.svg()).includes('100') || labels(k.svg()).includes('80'), 'ticks of the data range: ' + labels(k.svg()));
    k.heat.setAttribute('min', 0);
    k.heat.setAttribute('max', 500);
    k.chart.flush();
    assert(labels(k.svg()).includes('500') || labels(k.svg()).includes('400'), 'ticks follow a new range: ' + labels(k.svg()));
    k.heat.setAttribute('ramp', 'magma');
    k.chart.flush();
    assert.match(k.svg(), /stop-color="#000004"/);
  }

  // ── The compiler matches keys to dimensions.
  // Never called: these lines only have to fail to compile.
  function compileTimeChecks() {
    const color = new ColorAxis({}, lin());
    const size = new ScalarAxis({}, lin());
    new ColorKey({ dimension: color });
    new SizeKey({ dimension: size, side: 'bottom' });
    // @ts-expect-error a colour key shows a colour dimension
    new ColorKey({ dimension: size });
    // @ts-expect-error a size key shows a size dimension
    new SizeKey({ dimension: color });
    // @ts-expect-error a key needs its dimension
    new ColorKey({ title: 'nothing to show' });
    // @ts-expect-error sides are the four edges
    new ColorKey({ dimension: color, side: 'middle' });
    // @ts-expect-error a key is not a plane: it goes in the chart
    new CartesianPlane({}, new ColorKey({ dimension: color }));
  }
  void compileTimeChecks;
});

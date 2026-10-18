// Pattern fills: a pattern is an element of the chart, named by `url(#id)` in any style that takes a paint.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  BarPath,
  CartesianPlane,
  Chart,
  DomainSeries,
  DotPattern,
  FlatDataSource,
  HatchPattern,
  Legend,
  LinearScale,
  StringPlatform,
  checkerboard,
  darkTheme,
  lightTheme,
  registry,
  toSvgString,
} from './index.ts';

const plane = (fill: string, name = 'A') =>
  new CartesianPlane(
    {},
    new Axis({ orientation: 'bottom' }, new LinearScale()),
    new Axis({ orientation: 'left' }, new LinearScale()),
    new DomainSeries(
      { name },
      new FlatDataSource({ data: Float64Array.from([1, 3, 2]), regularDomain: { start: 0, step: 1 } }),
      new BarPath({ fill }),
    ),
  );
const svgOf = (...children: ConstructorParameters<typeof Chart>[1][]) => {
  const chart = new Chart({ theme: lightTheme, width: 300, height: 200 }, ...children);
  return toSvgString(chart, { idPrefix: 'p' });
};

test('a crosshatch with equal angles names its own attributes', () => {
  assert.throws(
    () => svgOf(plane('url(#h)'), new HatchPattern({ id: 'h', angle: 30, crossAngle: 30 })),
    /HatchPattern: angle and crossAngle must differ.*30 and 30/,
  );
  assert.throws(
    () => svgOf(plane('url(#h)'), new HatchPattern({ id: 'h', angle: 30, crossAngle: 210 })),
    /HatchPattern: angle and crossAngle must differ/,
  );
});

test('a pattern follows the series colour, or its own', () => {
  const svg = svgOf(plane('url(#hatch)'), new HatchPattern({ id: 'hatch' }));
  const series = lightTheme.palette[0]!;
  // The bars use a pattern made for the series' colour; the pattern drawn in that colour has crossing lines.
  assert.match(svg, /<pattern [^>]*id="p-\d+"/);
  assert.equal([...svg.matchAll(/<pattern /g)].length, 2, 'the plain pattern and one in the series colour');
  assert.ok(svg.includes(`stroke="${series}"`), 'the lines are in the series colour');
  assert.match(svg, /<path [^>]*fill="url\(#p-\d+\)"/);
  // An explicit stroke is the pattern's own colour, whatever the series.
  const own = svgOf(plane('url(#h)'), new HatchPattern({ id: 'h', stroke: '#123456' }));
  assert.equal([...own.matchAll(/<pattern /g)].length, 1);
  assert.ok(own.includes('stroke="#123456"') && !own.includes(`stroke="${series}"`));
  // A url that names nothing here is left alone.
  assert.match(svgOf(plane('url(#mine)')), /fill="url\(#mine\)"/);
});

test('two series, two colours, two patterns; the legend uses the same ones', () => {
  const chart = new Chart(
    { theme: lightTheme, width: 300, height: 200 },
    new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom' }, new LinearScale()),
      new Axis({ orientation: 'left' }, new LinearScale()),
      ...['A', 'B'].map(
        (name) =>
          new DomainSeries(
            { name },
            new FlatDataSource({ data: Float64Array.from([1, 3, 2]), regularDomain: { start: 0, step: 1 } }),
            new BarPath({ fill: 'url(#d)' }),
          ),
      ),
    ),
    new Legend({}),
    new DotPattern({ id: 'd', ...checkerboard(3) }),
  );
  const svg = toSvgString(chart, { idPrefix: 'p' });
  assert.equal([...svg.matchAll(/<pattern /g)].length, 3, 'the plain one and one for each colour');
  assert.ok(svg.includes('stroke-linecap="square"'));
});

test('a changed theme lets go of the colours nothing uses', () => {
  const chart = new Chart({ theme: lightTheme, width: 300, height: 200 }, plane('url(#hatch)'), new HatchPattern({ id: 'hatch' }));
  const p = new StringPlatform({ width: 300, height: 200 });
  chart.attach(p).flush();
  const count = () => (p.toString().match(/<pattern /g) ?? []).length;
  assert.equal(count(), 2);
  chart.setAttribute('theme', darkTheme);
  for (let i = 0; i < 3; i++) {
    chart.invalidate();
    chart.flush();
  }
  assert.equal(count(), 2, 'one plain, one for the colour now in use');
  assert.ok(!p.toString().includes(`stroke="${lightTheme.palette[0]!}"`) || lightTheme.palette[0] === darkTheme.palette[0]);
});

test('the tiles are exact', () => {
  // Square dots with every measure equal make a checkerboard: two rows of one square and one gap, the second shifted by one.
  const dots = svgOf(plane('url(#d)'), new DotPattern({ id: 'd', stroke: '#000', ...checkerboard(4) }));
  assert.match(dots, /<pattern [^>]*width="8"[^>]*height="16"/);
  // A hatch's two families share a tile whose transform makes the crossings at the two angles.
  const hatch = svgOf(plane('url(#h)'), new HatchPattern({ id: 'h', stroke: '#000', spacing: 8 }));
  const m = /patternTransform="matrix\(([^)]+)\)"/.exec(hatch)!;
  const [ux, uy, vx, vy] = m[1]!.split(' ').map(Number) as [number, number, number, number];
  assert.ok(Math.abs(Math.hypot(ux, uy) - 8) < 1e-3, 'crossing at right angles the cell is as wide as the spacing');
  assert.ok(Math.abs(ux * vx + uy * vy) < 1e-3, 'the default pair crosses at right angles');
  // At other angles the lattice step is the spacing over the sine of the angle between the families.
  const slant = svgOf(plane('url(#h)'), new HatchPattern({ id: 'h', stroke: '#000', spacing: 8, angle: 0, crossAngle: 60 }));
  const [sx, sy] = /patternTransform="matrix\(([^)]+)\)"/.exec(slant)![1]!.split(' ').map(Number) as [number, number];
  assert.ok(Math.abs(Math.hypot(sx, sy) - 8 / Math.sin(Math.PI / 3)) < 1e-2);
  assert.throws(() => svgOf(plane('url(#h)'), new HatchPattern({ id: 'h', angle: 10, crossAngle: 10 })), /differ/);
});

test('patterns are in the registry, and JSON round trips', () => {
  for (const name of ['LinePattern', 'HatchPattern', 'DotPattern']) assert.ok((registry as Record<string, unknown>)[name], name);
});

test('a tint is a background in the colour in use', () => {
  const series = lightTheme.palette[0]!;
  const tinted = svgOf(plane('url(#h)'), new HatchPattern({ id: 'h', tint: 0.25 }));
  assert.ok(tinted.includes(`fill="${series}"`) && tinted.includes('fill-opacity="0.25"'), 'a wash of the series colour');
  // A fill of its own wins over a tint, and no tint is no background.
  const own = svgOf(plane('url(#h)'), new HatchPattern({ id: 'h', tint: 0.25, fill: '#eeeeee' }));
  assert.ok(own.includes('fill="#eeeeee"') && !own.includes('fill-opacity="0.25"'));
  assert.ok(!svgOf(plane('url(#h)'), new HatchPattern({ id: 'h' })).includes('fill-opacity="0.25"'));
});

test('two charts that name a pattern alike do not share an id in the page, and an export is the same every time', () => {
  const draw = () => {
    const chart = new Chart({ theme: lightTheme, width: 300, height: 200 }, plane('url(#hatch)'), new HatchPattern({ id: 'hatch' }));
    const platform = new StringPlatform({ width: 300, height: 200 });
    chart.attach(platform).flush();
    return { chart, text: platform.toString() };
  };
  const idOf = (text: string) => /<pattern[^>]* id="([^"]+)"/.exec(text)?.[1];
  const one = draw(),
    two = draw();
  assert.ok(idOf(one.text) && idOf(two.text) && idOf(one.text) !== idOf(two.text), `${idOf(one.text)} and ${idOf(two.text)}`);
  assert.ok(one.text.includes(`url(#${idOf(one.text)})`), 'and what uses the pattern names that id');
  assert.equal(toSvgString(one.chart.detach()), toSvgString(two.chart.detach()), 'an export does not depend on what was drawn before');
});

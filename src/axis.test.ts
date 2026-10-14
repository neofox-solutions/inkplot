// Axes: drawn along a ruler their plane gives them; fixed to a side, or floating across the plot at a value of the other axis.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import { Chart, CartesianPlane, Axis, LinearScale, DomainSeries, LinePath, FlatDataSource, StringPlatform } from './index.ts';
import { test } from 'vite-plus/test';

test("axis", () => {
const lin = () => new LinearScale();
const near = (a: number, b: number, tol = 0.01) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);

function build(xAttrs: object, yAttrs: object, size = 400) {
  const x = new Axis({ id: 'x', orientation: 'bottom', min: 0, max: 10, ...xAttrs }, lin());
  const y = new Axis({ id: 'y', orientation: 'left', min: -5, max: 5, ...yAttrs }, lin());
  const series = new DomainSeries(new FlatDataSource({ data: new Float64Array([0, 1, -1, 2]), regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve()));
  const plane = new CartesianPlane({}, x, y, series);
  const chart = new Chart({ theme: lightTheme, width: size, height: size }, plane);
  const platform = new StringPlatform({ width: size, height: size });
  chart.attach(platform);
  chart.flush();
  return { x, y, plane, chart, platform, svg: platform.toString() };
}

// ── Fixed axes sit on their side of the plot and take room from it.
const fixed = build({}, {});
{
  const h = fixed.plane.rect.height;
  near(fixed.x.ruler.at(0)[1], h);
  near(fixed.y.ruler.at(0)[0], 0);
  assert.deepEqual(fixed.x.ruler.at(0.3).slice(2), [0, 1], 'ticks point away from the plot: down for a bottom axis');
  assert(fixed.plane.rect.height < 400 - 8 && fixed.plane.rect.x > 8, 'room is left for both');
}

// ── A floating axis crosses at its value, and takes no room.
{
  const t = build({ crossesAt: 0 }, {});   // y runs -5 to 5, so 0 is the middle
  near(t.x.ruler.at(0)[1], t.plane.rect.height / 2);
  near(t.x.ruler.at(1)[0], t.plane.rect.width);
  assert(t.plane.rect.height > fixed.plane.rect.height + 10, 'the plot gives back what a fixed x axis took');
  near(t.plane.rect.width, fixed.plane.rect.width, 1);
  assert.deepEqual(t.x.ruler.at(0.5).slice(2), [0, 1], 'its labels stay on their side of the line');
  assert.match(t.svg, /M0 [\d.]+H[\d.]+/);

  const v = build({}, { crossesAt: 5 });   // x runs 0 to 10: the middle, again
  near(v.y.ruler.at(0)[0], v.plane.rect.width / 2);
  assert(v.plane.rect.x < fixed.plane.rect.x - 10, 'and so does a floating y axis');
}

// ── Out of range it stays at the nearest edge. At the edge it faces it is a fixed axis again, with its room.
{
  const left = build({}, { crossesAt: -3 });   // x runs 0 to 10: below the left edge
  near(left.y.ruler.at(0)[0], 0);
  near(left.plane.rect.x, fixed.plane.rect.x, 1);
  assert.equal(left.y.ruler.at(0)[2], -1);

  const floor = build({ crossesAt: -100 }, {});   // below the bottom: held there, and takes its room
  near(floor.x.ruler.at(0)[1], floor.plane.rect.height);
  near(floor.plane.rect.height, fixed.plane.rect.height, 1);

  const top = build({ crossesAt: 100 }, {});   // above the top: held there, away from the edge it faces, so floating
  near(top.x.ruler.at(0)[1], 0);
  assert(top.plane.rect.height > fixed.plane.rect.height + 10, 'a bottom axis held at the top takes no room');

  const right = build({}, { crossesAt: 100 });   // y is a left axis held at the right edge: floating
  near(right.y.ruler.at(0)[0], right.plane.rect.width);
  assert(right.plane.rect.x < fixed.plane.rect.x - 10, 'a left axis held at the right edge takes no room');
}

// ── It follows the view: pan the crossing axis and the line slides across the plot.
{
  const t = build({ crossesAt: 0 }, {});
  near(t.x.ruler.at(0)[1], t.plane.rect.height / 2);
  t.y.setViewRange({ min: -5, max: 15 });   // 0 is now a quarter of the way up
  t.chart.flush();
  near(t.x.ruler.at(0)[1], 0.75 * t.plane.rect.height);
  t.y.setViewRange({ min: 1, max: 5 });     // 0 is below the view: held at the bottom
  t.chart.flush();
  near(t.x.ruler.at(0)[1], t.plane.rect.height);
}

// ── It crosses an inverted axis where that axis puts the value, and a named one rather than the first.
{
  const inv = build({ crossesAt: 2.5 }, { inverted: true });   // inverted y: -5 at the top, so 2.5 is three quarters of the way down
  near(inv.x.ruler.at(0)[1], 0.75 * inv.plane.rect.height);
  const second = new Axis({ id: 'y2', orientation: 'right', min: 0, max: 100 }, lin());
  const x = new Axis({ orientation: 'bottom', min: 0, max: 10, crossesAt: 25, crossAxis: 'y2' }, lin());
  const y = new Axis({ orientation: 'left', min: -5, max: 5 }, lin());
  const plane = new CartesianPlane({}, x, y, second, new DomainSeries(new FlatDataSource({ data: new Float64Array([0, 1]), regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve())));
  const chart = new Chart({ theme: lightTheme, width: 400, height: 400 }, plane);
  chart.attach(new StringPlatform({ width: 400, height: 400 }));
  chart.flush();
  near(x.ruler.at(0)[1], 0.75 * plane.rect.height);
}

// ── Label halo is a stroke behind the text; without it, none.
{
  assert.match(build({ style: { tickLabel: { halo: '#fff' } } }, {}).svg, /paint-order="stroke"/);
  assert.match(build({ style: { tickLabel: { halo: '#fff' } } }, {}).svg, /stroke="#fff"/);
  assert(!/stroke="#fff"/.test(fixed.svg));
}

// ── A floating axis has to cross something.
{
  const lonely = new Axis({ orientation: 'bottom', crossesAt: 0 }, lin());
  const plane = new CartesianPlane({}, lonely, new DomainSeries(new FlatDataSource({ data: new Float64Array([0, 1]), regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve())));
  const chart = new Chart({ theme: lightTheme, width: 400, height: 400 }, plane);
  chart.attach(new StringPlatform({ width: 400, height: 400 }));
  assert.throws(() => chart.flush(), /needs an axis on the other orientation/);
}

// ── Titles: on the axis line for a fixed axis, at the edge of the plot for a floating one, and as told.
{
  const spotOf = (svg: string, title: string) => {
    const node = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].find((m) => m[1] === title)?.[0] ?? '';
    const m = /transform="translate\(([-\d.]+) ([-\d.]+)\)( rotate\((-?\d+)\))?"/.exec(node);
    assert(m, `title "${title}" is drawn with a transform: ${node}`);
    return { x: +m[1]!, y: +m[2]!, turn: m[4] ? +m[4] : 0 };
  };
  const plain = build({ crossesAt: 0 }, { crossesAt: 5 });

  // Fixed: part of the axis' own thickness, past its labels, as before.
  const onLine = build({ title: 'time' }, {});
  assert.equal(onLine.x.ruler.title(undefined).beyond, true);
  assert.equal(onLine.x.titleThickness, 0);
  assert(onLine.x.thickness > fixed.x.thickness + 10, 'the title is in the axis thickness');
  const fixedSpot = spotOf(onLine.svg, 'time');
  assert(fixedSpot.y > onLine.plane.rect.height + onLine.x.thickness - 20 && fixedSpot.turn === 0, 'below the labels, level');
  near(fixedSpot.x, onLine.plane.rect.width / 2);

  // Floating: at the edge of the plot on its own side, which then gives it room. The axis line is in the middle of the plot.
  const x = build({ crossesAt: 0, title: 'time' }, {});
  const edge = x.x.ruler.title(undefined);
  assert.equal(edge.beyond, false);
  near(edge.x, x.plane.rect.width / 2);
  near(edge.y, x.plane.rect.height, 0.01);
  assert(x.x.titleThickness > 10 && x.x.thickness < onLine.x.thickness, 'its room is reserved for the title, not the axis');
  assert(x.plane.rect.height < plain.plane.rect.height - 10, 'the plot gives the room up');
  const xs = spotOf(x.svg, 'time');
  assert(xs.y > x.plane.rect.height && xs.turn === 0, 'outside the plot, running along the bottom');
  near(xs.x, x.plane.rect.width / 2);

  const y = build({}, { crossesAt: 5, title: 'level' });
  const ys = spotOf(y.svg, 'level');
  assert(ys.x < 0 && ys.turn === -90, 'a floating y axis puts its title at the left edge, turned up the page');
  near(ys.y, y.plane.rect.height / 2);
  assert(y.plane.rect.x > plain.plane.rect.x + 10, 'and the left of the plot makes room');

  // Told otherwise: another edge, and a direction.
  const top = build({ title: 'time', titlePosition: 'top' }, {});
  assert.equal(top.x.ruler.title('top').beyond, false, 'a fixed axis asked for the other side leaves its line');
  assert.equal(top.x.thickness, fixed.x.thickness, 'so its thickness is the axis alone');
  assert(spotOf(top.svg, 'time').y < 0, 'and the title is above the plot');
  assert(top.plane.rect.y > plain.plane.rect.y + 10 - 1, 'with room made there');

  const word = 'a rather long title';
  const flat = build({ crossesAt: 0, title: word }, {}), upright = build({ crossesAt: 0, title: word, titleDirection: 'vertical' }, {});
  assert.equal(spotOf(upright.svg, word).turn, -90);
  assert(upright.x.titleThickness > flat.x.titleThickness + 40, 'vertical text at the bottom takes its length, not its height');
  const tall = build({}, { crossesAt: 5, title: word, titleDirection: 'horizontal' });
  assert.equal(spotOf(tall.svg, word).turn, 0);
  assert(tall.y.titleThickness > 40, 'horizontal text at the left takes its width');

  // Titles at one edge stack outwards, outside the axes that are there.
  const both = build({ title: 'time' }, { crossesAt: 5, title: 'level', titlePosition: 'bottom', titleDirection: 'horizontal' });
  const below = both.y.ruler.title('bottom'), own = both.x.ruler.at(0)[1];
  near(below.y, own + both.x.thickness, 0.01);
  assert(spotOf(both.svg, 'level').y > own + both.x.thickness, 'the y title sits below the x axis and its title');

  // Style: size and colour and halo, for labels and title separately.
  const styled = build({ title: 'time', style: { axis: { color: '#123456' }, tickLabel: { size: 9, halo: '#fff' }, axisTitle: { size: 20, color: '#abcdef', weight: 700 } } }, {});
  assert.match(styled.svg, /font-size="9"/);
  assert.match(styled.svg, /font-size="20"/);
  assert.match(styled.svg, /fill="#abcdef"/);
  assert.match(styled.svg, /font-weight="700"/);
  assert.match(styled.svg, /stroke="#fff"/);
  assert(styled.x.thickness > fixed.x.thickness, 'a bigger title needs more room');
}
});

// HeatMap: a cell for each point, coloured by a channel, with one path for each colour step.
import assert from 'node:assert/strict';
import { lightTheme } from './themes.ts';
import { Axis, CartesianPlane, Chart, ColorAxis, Density, HeatMap, LinearScale, ObjectDataSource, PolarPlane, StringPlatform, XYSeries } from './index.ts';
import { hitTest } from './hit.ts';
import { test } from 'vite-plus/test';

test("heatmap", () => {
const rows = [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.4 }, { x: 0.7, y: 0.6 }, { x: 1.5, y: 0.5 }, { x: 2.5, y: 2.5 }, { x: 2.6, y: 2.4 }];
const lin = () => new LinearScale();
const grid = () => new Density({ by: ['domain', 'value'], width: 1 }, new ObjectDataSource({ source: rows, domain: 'x', value: 'y' }));

function build(map: HeatMap, data: object = grid(), x = 'domain') {
  const heat = new ColorAxis({ id: 'heat', ramp: ['#ffffff', '#ff0000'] }, lin());
  const series = new XYSeries({ x }, data as never, map);
  const plane = new CartesianPlane({}, new Axis({}, lin()), new Axis({ orientation: 'left' }, lin()), series);
  const chart = new Chart({ theme: lightTheme, width: 300, height: 300 }, plane, heat);
  const platform = new StringPlatform({ width: 300, height: 300 });
  chart.attach(platform);
  chart.flush();
  return { chart, series, plane, heat, map, svg: () => platform.toString() };
}
const paths = (svg: string) => [...svg.matchAll(/<path d="(M[^"]*Z)"([^>]*)>/g)].map((m) => ({ d: m[1]!, attrs: m[2]! })).filter((p) => p.attrs.includes('fill-opacity'));
const cells = (svg: string) => paths(svg).reduce((n, p) => n + (p.d.match(/Z/g) ?? []).length, 0);

{
  // Density cells with the sizes it reports: one rectangle per occupied bin, no NaN.
  const heat = new ColorAxis({ id: 'h', ramp: ['#ffffff', '#ff0000'] }, lin());
  const { svg } = build(new HeatMap({ bind: { fill: { axis: heat, channel: 'count' } } }));
  const out = svg();
  assert(!/NaN|undefined/.test(out));
  assert.equal(cells(out), 3, 'three occupied bins: (0,0) with 3 points, (1,0) with 1, (2,2) with 2');
}
{
  // Colour steps: cells with different counts land in different paths, the same counts share one.
  const heat = new ColorAxis({ id: 'heat', ramp: ['#ffffff', '#ff0000'] }, lin());
  const series = new XYSeries({ x: 'domain' }, grid(), new HeatMap({ maxNodes: 16, bind: { fill: { axis: heat, channel: 'count' } } }));
  const chart = new Chart({ theme: lightTheme, width: 300, height: 300 }, new CartesianPlane({}, new Axis({}, lin()), new Axis({ orientation: 'left' }, lin()), series), heat);
  const platform = new StringPlatform({ width: 300, height: 300 });
  chart.attach(platform); chart.flush();
  const ps = paths(platform.toString());
  assert.equal(ps.length, 3, 'counts 3, 1, 2 are three different looks');
  assert.equal(new Set(ps.map((p) => /fill="([^"]*)"/.exec(p.attrs)![1])).size, 3, 'three fills');
}
{
  // Without a binding every cell takes the series' colour and all are in one path.
  const { svg } = build(new HeatMap({}));
  const ps = paths(svg());
  assert.equal(ps.length, 1);
  assert.equal(cells(svg()), 3);
}
{
  // Constant sizes: cellWidth alone makes squares; cellHeight differs; geometry follows the axes.
  const pts = new ObjectDataSource({ source: [{ x: 1, y: 1 }], domain: 'x', value: 'y', channels: { x: 'x' } });
  const { series, plane, map } = build(new HeatMap({ cellWidth: 2 }), pts, 'x');
  const shapes = map.shapes()!;
  assert.equal(shapes.perShape, 4);
  const d = shapes.data;
  const w = Math.abs(d[2]! - d[0]!), h = Math.abs(d[5]! - d[3]!);
  const xr = series.firstAxis.range, yr = series.secondAxis.range;
  assert(Math.abs(w / plane.rect.width - 2 / (xr.max - xr.min)) < 1e-6, 'two data units wide');
  assert(Math.abs(h / plane.rect.height - 2 / (yr.max - yr.min)) < 1e-6, 'and two high');
  assert(xr.min <= 0 && xr.max >= 2 && yr.min <= 0 && yr.max >= 2, 'the axes reach the cell edges');
}
{
  // Gaps: a cell with a missing size or position is left out, and nothing is NaN.
  const pts = new ObjectDataSource({ source: [{ x: 1, y: 1 }, { x: NaN, y: 2 }, { x: 3, y: NaN }, { x: 4, y: 4 }], domain: 'x', value: 'y', channels: { x: 'x' } });
  const { svg, map, series } = build(new HeatMap({ cellWidth: 1 }), pts, 'x');
  assert.equal(cells(svg()), 2);
  assert(!/NaN/.test(svg()));
  assert.equal(map.shapes()!.count, series.drawn!.points.count, 'one shape for each drawn point, a gap being NaN');
}
{
  // A polar plane places the same corners: straight-edged wedges, nothing NaN.
  const series = new XYSeries({ x: 'domain' }, grid(), new HeatMap({}));
  const plane = new PolarPlane({}, new Axis({ orientation: 'angle' }, lin()), new Axis({ orientation: 'radius' }, lin()), series);
  const chart = new Chart({ theme: lightTheme, width: 300, height: 300 }, plane);
  const platform = new StringPlatform({ width: 300, height: 300 });
  chart.attach(platform); chart.flush();
  assert.equal(cells(platform.toString()), 3);
  assert(!/NaN/.test(platform.toString()));
  assert(!/crispEdges/.test(platform.toString()), 'no crisp edges on curved planes');
}
{
  // Hit as a shape: a pointer inside a cell finds it.
  const { map, series } = build(new HeatMap({}));
  const shapes = map.shapes()!;
  const cx = (shapes.data[0]! + shapes.data[4]!) / 2, cy = (shapes.data[1]! + shapes.data[5]!) / 2;
  const hit = hitTest(series, cx, cy, 5);
  assert(hit, 'a hit inside the first cell');
}
{
  // maxNodes too small for a bound style fails at attach.
  const heat = new ColorAxis({ id: 'heat' }, lin());
  const series = new XYSeries({ x: 'domain' }, grid(), new HeatMap({ maxNodes: 1, bind: { fill: { axis: heat, channel: 'count' } } }));
  const chart = new Chart({ theme: lightTheme }, new CartesianPlane({}, new Axis({}, lin()), new Axis({ orientation: 'left' }, lin()), series), heat);
  assert.throws(() => chart.attach(new StringPlatform({ width: 100, height: 100 })), /fewer than 2 steps/);
}
});

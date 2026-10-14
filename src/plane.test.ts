// Planes: the Cartesian plane's side of the area contract, the baseline.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import { Plane, Chart, CartesianPlane, Axis, LinearScale, DomainSeries, AreaPath, ObjectDataSource, StringPlatform } from './index.ts';
import { test } from 'vite-plus/test';

test("plane", () => {
type Row = { a: number; r: number };
const data = (rows: Row[]) => new ObjectDataSource({ source: rows, domain: 'a', value: 'r', isSorted: true });
const lin = () => new LinearScale();

function render(plane: Plane, size = 400) {
  const chart = new Chart({ theme: lightTheme, width: size, height: size }, plane);
  const platform = new StringPlatform({ width: size, height: size });
  chart.attach(platform);
  chart.flush();
  return { chart, svg: platform.toString() };
}
const pathD = (svg: string, _key: string) => [...svg.matchAll(/<path[^>]*? d="([^"]*)"/g)].map((m) => m[1]!).filter((d) => d.includes('L') && d.endsWith('Z')).pop();

// ── An area on a rectangle is the data forward and the baseline back, closed.
{
  const rows = [{ a: 0, r: 2 }, { a: 5, r: 4 }, { a: 10, r: 2 }];
  const flat = new CartesianPlane({}, new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin()), new Axis({ orientation: 'left', min: 0, max: 4 }, lin()),
    new DomainSeries(data(rows), new AreaPath(new LinearCurve())));
  const d = pathD(render(flat).svg, 'Z')!;
  const w = flat.rect.width, h = flat.rect.height;
  assert.match(d, /^M[\d. ]+L[\d. ]+Z$/, 'one closed shape');
  const nums = d.slice(1, -1).replace('L', ' ').split(' ').map(Number);
  assert.equal(nums.length, 12, 'three points out, three back');
  assert.deepEqual(nums.slice(6), [w, h, w / 2, h, 0, h], 'the way back runs along the bottom edge');
}

// ── A baseline outside the value range is held at the edge; gaps split the shape.
{
  const rows = [{ a: 0, r: 5 }, { a: 1, r: 6 }, { a: 2, r: NaN }, { a: 3, r: 6 }, { a: 4, r: 5 }];
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, lin()), new Axis({ orientation: 'left', min: 4, max: 8 }, lin()),
    new DomainSeries(data(rows), new AreaPath({ baseline: 0 }, new LinearCurve())));
  const d = pathD(render(plane).svg, 'Z')!;
  assert.equal(d.split('M').length - 1, 2, 'two shapes either side of the gap');
  const h = plane.rect.height;
  assert(d.includes(` ${h} `) || d.includes(` ${h}Z`), 'the baseline sits on the bottom of the plot');
}

console.log('ok plane');

// ── A guide through an infinite value draws nothing: ±Infinity in path data would be invalid SVG.
{
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin()), new Axis({ orientation: 'left', min: 0, max: 4 }, lin()),
    new DomainSeries(data([{ a: 0, r: 2 }, { a: 10, r: 4 }]), new AreaPath(new LinearCurve())));
  render(plane);
  assert.match(plane.guide('first', 5), /^M/, 'a finite value gets a guide');
  for (const v of [NaN, Infinity, -Infinity]) assert.equal(plane.guide('first', v), '', `no guide at ${v}`);
}
});

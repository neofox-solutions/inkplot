// Hits on shapes are measured in the plane's own terms: inside a wedge is inside, and the distance outside is the pixel distance to its edge.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  BarPath,
  CartesianPlane,
  Chart,
  DomainSeries,
  FlatDataSource,
  LinearScale,
  PolarPlane,
  RadarPlane,
  StringPlatform,
  hitTest,
  type Plane,
} from './index.ts';
import { lightTheme } from './themes.ts';

test('hits on shapes', () => {
  const near = (a: number, b: number, tol = 1e-6, what = '') => assert(Math.abs(a - b) <= tol, `${what} ${a} is not ${b}`);
  const flat = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start: 0, step: 1 } });
  const mount = (plane: Plane) => {
    const chart = new Chart({ theme: lightTheme, width: 400, height: 400 }, plane);
    chart.attach(new StringPlatform({ width: 400, height: 400 }));
    chart.flush();
  };

  // ── A polar wedge: bars along the angle, out to their value.
  {
    const bars = new DomainSeries({}, flat([4, 8, 6, 2]), new BarPath({ width: 0.8 }));
    const plane = new PolarPlane(
      {},
      new Axis({ orientation: 'angle', min: -0.5, max: 3.5 }, new LinearScale()),
      new Axis({ orientation: 'radius', min: 0, max: 10 }, new LinearScale()),
      bars,
    );
    mount(plane);
    const cx = plane.rect.width / 2,
      cy = plane.rect.height / 2,
      R = plane.radius;
    // The bar for point 1 is centred on angle fraction 0.375 (of the turn), 8 out of 10 long.
    const theta = 0.375 * 2 * Math.PI;
    const at = (r: number, t = theta) => [cx + r * R * Math.sin(t), cy - r * R * Math.cos(t)] as const;
    const inside = hitTest(bars, ...at(0.5), Infinity)!;
    assert.deepEqual([inside.index, inside.distance], [1, 0], 'inside the wedge, well below its tip');
    const past = hitTest(bars, ...at(0.8 + 0.05), Infinity)!;
    assert.equal(past.index, 1);
    near(past.distance, 0.05 * R, 0.01, 'past the tip: the radial gap');
    // Beside the wedge, between it and the next: the distance is to the edge, along the arc's normal, not a chord.
    const side = hitTest(bars, ...at(0.5, theta + 0.25 * 2 * Math.PI * 0.5), Infinity)!;
    assert(side.distance > 0, 'between two wedges is not inside either');
    // Nothing is found beyond the radius asked for.
    assert.equal(hitTest(bars, ...at(0.99), 1), null);
  }

  // ── A radar is the same in its own terms: a point on the polygon's chord is inside the bar that reaches it.
  {
    const bars = new DomainSeries({}, flat([5, 5, 5, 5, 5, 5]), new BarPath({ width: 0.5 }));
    const plane = new RadarPlane(
      {},
      new Axis({ orientation: 'angle', min: -0.5, max: 5.5, tickCount: 6, nice: false }, new LinearScale()),
      new Axis({ orientation: 'radius', min: 0, max: 10 }, new LinearScale()),
      bars,
    );
    mount(plane);
    const p = bars.points.data;
    // The middle of the way from the centre to the end of bar 2 is inside it.
    const cx = plane.rect.width / 2,
      cy = plane.rect.height / 2;
    const h = hitTest(bars, (cx + p[4]!) / 2, (cy + p[5]!) / 2, Infinity)!;
    assert.deepEqual([h.index, h.distance], [2, 0]);
  }

  // ── A rectangle: the same answers as the pixel geometry (inside is zero, outside is the gap to the edge).
  {
    const bars = new DomainSeries({}, flat([3, 9, 5]), new BarPath({}));
    const plane = new CartesianPlane(
      {},
      new Axis({ orientation: 'bottom', min: -0.5, max: 2.5 }, new LinearScale()),
      new Axis({ orientation: 'left', min: 0, max: 10 }, new LinearScale()),
      bars,
    );
    mount(plane);
    const px = bars.points.data[2]!,
      top = bars.points.data[3]!;
    near(hitTest(bars, px, top - 7, Infinity)!.distance, 7, 1e-9);
    // Beside the bar and above its end: the corner is the nearest point.
    const wide = (plane.rect.width / 3) * 0.4;
    near(hitTest(bars, px + wide + 3, top - 4, Infinity)!.distance, 5, 1e-6, 'diagonal from a corner');
  }
});

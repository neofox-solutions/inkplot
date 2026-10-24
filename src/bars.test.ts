// Bars: geometry on every kind of plane, width rules, gaps, the baseline's reach on the axis, and hits inside the shapes.
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  PolarPlane,
  Axis,
  LinearScale,
  LogScale,
  BandScale,
  DomainSeries,
  BarPath,
  StemPath,
  CircleMarker,
  Stack,
  FlatDataSource,
  StringPlatform,
  barShapes,
  stemLines,
  hitTest,
  hitAll,
  type Plane,
} from './index.ts';
import { shapeCorners } from './fake-platform.ts';
import { test } from 'vite-plus/test';

test('bars', () => {
  const near = (a: number, b: number, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
  function mount(plane: Plane, w = 400, h = 300) {
    const chart = new Chart({ theme: lightTheme, width: w, height: h }, plane);
    const platform = new StringPlatform({ width: w, height: h });
    chart.attach(platform);
    chart.flush();
    return { chart, svg: platform.toString() };
  }
  const flat = (ys: number[]) => new FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start: 0, step: 1 } });

  // ── Upright bars on a linear domain: 0.8 of the spacing, from the baseline to the value.
  {
    const bars = new DomainSeries({ name: 'b' }, flat([3, 7, 5, 9]), new BarPath({}));
    const x = new Axis({ orientation: 'bottom', min: -0.5, max: 3.5 }, new LinearScale()),
      y = new Axis({ orientation: 'left', min: 0, max: 10 }, new LinearScale());
    const { svg } = mount(new CartesianPlane({}, x, y, bars));
    const s = barShapes(bars)!;
    assert.equal(s.count, 4);
    const pitch = bars.points.data[2]! - bars.points.data[0]!; // pixels between neighbouring bars
    for (let i = 0; i < 4; i++) {
      const { x: px, y: py } = shapeCorners(bars, s, i);
      near(Math.max(...px) - Math.min(...px), 0.8 * pitch, 1e-6);
      near((Math.max(...px) + Math.min(...px)) / 2, bars.points.data[i * 2]!, 1e-6);
      near(Math.min(...py), bars.points.data[i * 2 + 1]!, 1e-6); // the top is the point
      near(Math.max(...py), bars.baseline(0).data[i * 2 + 1]!, 1e-6); // the foot is the baseline
    }
    assert.equal((svg.match(/M/g) ?? []).length >= 4, true);
    assert(/<path[^>]*d="M[^"]*Z/.test(svg), 'one path, bars closed');
    // The same width rule with a stated width.
    const wide = new DomainSeries({}, flat([3, 7]), new BarPath({ width: 0.5 }));
    mount(
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom' }, new LinearScale()),
        new Axis({ orientation: 'left' }, new LinearScale()),
        wide,
      ),
    );
    const ws = barShapes(wide, { width: 0.5 })!,
      p2 = wide.points.data[2]! - wide.points.data[0]!;
    const wx = shapeCorners(wide, ws, 0).x;
    near(Math.max(...wx) - Math.min(...wx), 0.5 * p2, 1e-6);
  }

  // ── A band axis sets the width itself, from the scale's gap; a stated width is a fraction of the band.
  {
    const cats = ['a', 'b', 'c'];
    const make = (bar: BarPath) => {
      const s = new DomainSeries({}, flat([4, 6, 2]), bar);
      mount(
        new CartesianPlane(
          {},
          new Axis({ orientation: 'bottom' }, new BandScale({ categories: cats, bandGap: 0.4 })),
          new Axis({ orientation: 'left' }, new LinearScale()),
          s,
        ),
      );
      return s;
    };
    const a = make(new BarPath({})),
      sa = barShapes(a)!,
      bandPx = a.points.data[2]! - a.points.data[0]!;
    const ax = shapeCorners(a, sa, 0).x;
    near(Math.max(...ax) - Math.min(...ax), 0.6 * bandPx, 1e-6);
    const b = make(new BarPath({ width: 0.5 })),
      sb = barShapes(b, { width: 0.5 })!;
    const bx = shapeCorners(b, sb, 0).x;
    near(Math.max(...bx) - Math.min(...bx), 0.5 * (b.points.data[2]! - b.points.data[0]!), 1e-6);
  }

  // ── The baseline reaches the axis even when the data does not: bars of 50..60 still grow from zero.
  {
    const s = new DomainSeries({}, flat([50, 60, 55]), new BarPath({}));
    const y = new Axis({ orientation: 'left' }, new LinearScale());
    mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), y, s));
    assert(y.range.min <= 0, `axis starts at ${y.range.min}`);
    const raised = new DomainSeries({}, flat([50, 60, 55]), new BarPath({ baseline: 40 }));
    const y2 = new Axis({ orientation: 'left' }, new LinearScale());
    mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), y2, raised));
    assert(y2.range.min <= 40, 'a stated baseline is reached too');
  }

  // ── Gaps leave a bar out; negative values hang below the baseline.
  {
    const s = new DomainSeries({}, flat([3, NaN, -4]), new BarPath({}));
    const y = new Axis({ orientation: 'left', min: -5, max: 5 }, new LinearScale());
    const { svg } = mount(new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), y, s));
    const shapes = barShapes(s)!;
    assert(Number.isNaN(shapes.data[4 * 1]!), 'the gap is a shape of NaN');
    const d = /<path[^>]*d="([^"]*Z)"/.exec(svg)![1]!;
    assert.equal((d.match(/M/g) ?? []).length, 2, 'two bars drawn');
    const third = shapeCorners(s, shapes, 2).y,
      zero = s.baseline(0).data[1]!;
    near(Math.min(...third), zero, 1e-6);
    assert(Math.max(...third) > zero, 'below the baseline is further down the page');
  }

  // ── Horizontal bars: the domain on the vertical axis; the bars run sideways from the baseline.
  {
    const s = new DomainSeries({ domainAxis: 'cat', valueAxis: 'val' }, flat([3, 6, 9]), new BarPath({}));
    const cat = new Axis({ id: 'cat', orientation: 'left', min: -0.5, max: 2.5 }, new LinearScale()),
      val = new Axis({ id: 'val', orientation: 'bottom', min: 0, max: 10 }, new LinearScale());
    mount(new CartesianPlane({}, val, cat, s));
    const shape = barShapes(s)!,
      foot = s.baseline(0).data[0]!;
    for (let i = 0; i < 3; i++) {
      const { x: px, y: py } = shapeCorners(s, shape, i);
      near(Math.min(...px), foot, 1e-6);
      near(Math.max(...px), s.points.data[i * 2]!, 1e-6);
      near((Math.max(...py) + Math.min(...py)) / 2, s.points.data[i * 2 + 1]!, 1e-6);
    }
  }

  // ── A polar plane makes wedges: the edges along the domain are arcs, so the same radius all along them.
  {
    const s = new DomainSeries({}, flat([4, 8, 6, 10]), new BarPath({}));
    const plane = new PolarPlane(
      {},
      new Axis({ orientation: 'angle', min: -0.5, max: 3.5 }, new LinearScale()),
      new Axis({ orientation: 'radius', min: 0, max: 10 }, new LinearScale()),
      s,
    );
    const { svg } = mount(plane);
    const shape = barShapes(s)!;
    const c = { x: plane.rect.width / 2, y: plane.rect.height / 2 };
    const { x: cx, y: cy } = shapeCorners(s, shape, 0);
    const radius = (j: number) => Math.hypot(cx[j]! - c.x, cy[j]! - c.y);
    near(radius(0), radius(1), 1e-6); // the foot is one circle
    near(radius(2), radius(3), 1e-6); // and so is the top edge
    assert(radius(2) > radius(0));
    // The plane draws the edges along the angle as arcs.
    assert(/<path[^>]*d="M[^"]*A[^"]*Z/.test(svg), 'the edges are arcs');
  }

  // ── A ring: with the value on the angle axis, the edges along the value are the arcs (a segment of a ring), the domain ones spokes.
  {
    const s = new DomainSeries({ domainAxis: 'ring', valueAxis: 'share' }, flat([0.5, 0.25]), new BarPath({}));
    const plane = new PolarPlane(
      {},
      new Axis({ id: 'share', orientation: 'angle', min: 0, max: 1 }, new LinearScale()),
      new Axis({ id: 'ring', orientation: 'radius', min: -0.5, max: 1.5 }, new LinearScale()),
      s,
    );
    mount(plane);
    const shape = barShapes(s)!,
      c = { x: plane.rect.width / 2, y: plane.rect.height / 2 };
    const { x: cx, y: cy } = shapeCorners(s, shape, 0);
    const radius = (j: number) => Math.hypot(cx[j]! - c.x, cy[j]! - c.y);
    near(radius(0), radius(3), 1e-6); // the inner edge is one circle (its two ends, either side of the segment)
    near(radius(1), radius(2), 1e-6); // so is the outer one
    assert(radius(1) > radius(0));
  }

  // ── Hits: inside a bar is a hit at distance 0, whatever the height of the pointer; the shared lookup finds the bar by x.
  {
    const s = new DomainSeries({ name: 'bars' }, flat([3, 9, 5]), new BarPath({}));
    const x = new Axis({ orientation: 'bottom', min: -0.5, max: 2.5 }, new LinearScale()),
      y = new Axis({ orientation: 'left', min: 0, max: 10 }, new LinearScale());
    const plane = new CartesianPlane({}, x, y, s);
    mount(plane);
    const px = s.points.data[2]!,
      top = s.points.data[3]!,
      foot = s.baseline(0).data[3]!;
    const mid = hitTest(s, px, (top + foot) / 2)!;
    assert.deepEqual([mid.index, mid.distance, mid.row, mid.second], [1, 0, 1, 9], 'inside, well away from the top point');
    assert.equal(hitTest(s, px, top - 30), null, 'above the bar, out of reach');
    const near2 = hitTest(s, px, top - 4)!;
    assert.equal(near2.distance, 4, 'a little above is a distance to the edge');
    assert.equal(hitTest(s, px, foot + 20), null, 'below the foot');
    assert.equal(hitAll(plane, px, NaN)[0]!.index, 1, 'a crosshair finds the bar at its x');
    assert.equal(s.hitHint, 'shape');
  }
  // ── Stems: a line from the foot to the value, drawn stroked; they share the geometry and the hit rules of bars.
  {
    const stems = new DomainSeries({ name: 's' }, flat([3, 9, -4, NaN, 5]), new StemPath({}), new CircleMarker({}));
    const x = new Axis({ orientation: 'bottom', min: -0.5, max: 4.5 }, new LinearScale()),
      y = new Axis({ orientation: 'left', min: -5, max: 10 }, new LinearScale());
    const plane = new CartesianPlane({}, x, y, stems);
    const { svg } = mount(plane);
    const g = stemLines(stems)!;
    assert.equal(g.count, 5);
    for (let i = 0; i < 3; i++) {
      const { x, y } = shapeCorners(stems, g, i); // corners 0 and 3 are the foot and the value of a stem with no width
      near(x[0]!, x[3]!, 1e-9); // straight up and down
      near(x[0]!, stems.points.data[2 * i]!, 1e-9);
      near(y[0]!, stems.baseline(0).data[2 * i + 1]!, 1e-9); // from the foot
      near(y[3]!, stems.points.data[2 * i + 1]!, 1e-9); // to the value
    }
    assert(Number.isNaN(g.data[12]!), 'a gap has no stem');
    const d =
      /<path[^>]*d="(M[^"]*V[^"]*)"[^>]*stroke-linecap="butt"/.exec(svg) ?? /<path[^>]*stroke-linecap="butt"[^>]*d="(M[^"]*)"/.exec(svg);
    assert(d, 'one stroked path, butt caps by default');
    assert.equal((d[1]!.match(/M/g) ?? []).length, 4, 'a stem for every value that is there');
    // A stem has to be hit by nearness to its line: along it or at its end, within the radius, and by its x alone with a crosshair.
    const px = stems.points.data[2]!,
      top = stems.points.data[3]!,
      foot = stems.baseline(0).data[3]!;
    const along = hitTest(stems, px + 3, (top + foot) / 2)!;
    assert.deepEqual([along.index, along.distance], [1, 3], 'beside the stem, mid-way');
    assert.equal(hitTest(stems, px + 14, (top + foot) / 2), null, 'out of reach');
    near(hitTest(stems, px, top - 4)!.distance, 4, 1e-9); // past the end
    assert.equal(hitAll(plane, px, NaN)[0]!.index, 1);
    assert.equal(stems.hitHint, 'shape');
    assert.equal(stems.color, lightTheme.palette[0], 'the swatch is the line colour');
    // Style: stroke and width set directly, round caps.
    const styled = new DomainSeries({}, flat([3, 5]), new StemPath({ stroke: 'crimson', strokeWidth: 4, cap: 'round' }));
    const out = mount(
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom' }, new LinearScale()),
        new Axis({ orientation: 'left' }, new LinearScale()),
        styled,
      ),
    ).svg;
    assert(out.includes('stroke="crimson"') && out.includes('stroke-width="4"') && out.includes('stroke-linecap="round"'));
  }

  // ── Stems in a stack and in a group: each foot is the layer below; side by side they share the band.
  {
    const a = new DomainSeries({}, flat([3, 5]), new StemPath({})),
      b = new DomainSeries({}, flat([4, 2]), new StemPath({}));
    mount(
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['p', 'q'], bandGap: 0.4 })),
        new Axis({ orientation: 'left' }, new LinearScale()),
        new Stack({}, a, b),
      ),
    );
    const sa = stemLines(a)!,
      sb = stemLines(b)!;
    // A stem has no width: corner 0 is its foot and corner 3 its top.
    near(shapeCorners(b, sb, 0).y[0]!, shapeCorners(a, sa, 0).y[3]!, 1e-9); // b's foot is a's top
    near(shapeCorners(b, sb, 0).x[0]!, shapeCorners(a, sa, 0).x[0]!, 1e-9); // same x: stacked
    const c = new DomainSeries({}, flat([3, 5]), new StemPath({})),
      e = new DomainSeries({}, flat([4, 2]), new StemPath({}));
    mount(
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom' }, new BandScale({ categories: ['p', 'q'], bandGap: 0.4 })),
        new Axis({ orientation: 'left' }, new LinearScale()),
        new Stack({ mode: 'group' }, c, e),
      ),
    );
    const sc = stemLines(c)!,
      se = stemLines(e)!,
      band = c.points.data[2]! - c.points.data[0]!;
    const xc = shapeCorners(c, sc, 0).x[0]!,
      xe = shapeCorners(e, se, 0).x[0]!;
    near(xe - xc, (0.6 * band) / 2, 1e-6); // half the drawn band apart
    near((xe + xc) / 2, c.points.data[0]!, 1e-6); // centred on the category
  }

  // ── Stems on a polar plane are spokes: both ends on one ray from the centre.
  {
    const s = new DomainSeries({}, flat([4, 8, 6]), new StemPath({}));
    const plane = new PolarPlane(
      {},
      new Axis({ orientation: 'angle', min: -0.5, max: 2.5 }, new LinearScale()),
      new Axis({ orientation: 'radius', min: 0, max: 10 }, new LinearScale()),
      s,
    );
    mount(plane);
    const g = stemLines(s)!,
      cx = plane.rect.width / 2,
      cy = plane.rect.height / 2;
    for (let i = 0; i < 3; i++) {
      const { x, y } = shapeCorners(s, g, i),
        fx = x[0]! - cx,
        fy = y[0]! - cy,
        tx = x[3]! - cx,
        ty = y[3]! - cy;
      near(fx * ty - fy * tx, 0, 1e-6); // foot, top and centre are in line
      assert(Math.hypot(tx, ty) > Math.hypot(fx, fy));
      near(x[3]!, s.points.data[2 * i]!, 1e-9); // and the top is where the point is
    }
  }

  // ── On a log value axis the baseline (0) cannot be placed, so bars and stems start at the axis edge instead of vanishing.
  for (const R of [BarPath, StemPath]) {
    const series = new DomainSeries({ name: 'b' }, flat([10, 100, 1000]), new R({}));
    const x = new Axis({ orientation: 'bottom', min: -0.5, max: 2.5 }, new LinearScale()),
      y = new Axis({ orientation: 'left' }, new LogScale());
    mount(new CartesianPlane({}, x, y, series));
    const s = (R === BarPath ? barShapes : stemLines)(series)!;
    assert(s.count === 3 && s.data.every(Number.isFinite), `${R.name} on a log axis are drawn`);
    assert.deepEqual([y.range.min, y.range.max], [10, 1000], 'the axis fits the data, not a 0 it cannot show');
    const bottom = Math.max(...[0, 1, 2].flatMap((i) => shapeCorners(series, s, i).y));
    near(bottom, series.baseline(0).data[1]!, 1e-6); // the foot is on the axis edge
  }
});

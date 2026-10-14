// Markers: what each shape draws, how bound styles are bucketed into paths, bubbles, culling and the compile-time bindings.
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  Series,
  DomainSeries,
  ObjectDataSource,
  ColorAxis,
  SizeAxis,
  StringPlatform,
  DotMarker,
  CrossMarker,
  PlusMarker,
  CircleMarker,
  SquareMarker,
  FlatDataSource,
} from './index.ts';
import type { AnyElement } from './index.ts';
import { test } from 'vite-plus/test';

test('marker', () => {
  type Row = { x: number; y: number; c: number; s: number };
  const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ x: i, y: (i * 37) % 101, c: i % 20, s: i % 7 }));

  const heat = () => new ColorAxis({ id: 'heat' }, new LinearScale());
  const mass = (output: [number, number] = [2, 10]) => new SizeAxis({ id: 'mass', output }, new LinearScale());

  function scatter(
    renderer: ConstructorParameters<typeof Series>[2],
    extra: ElementLike[] = [],
    n = 200,
    axes: { x?: object; y?: object } = {},
  ) {
    const source = new ObjectDataSource({ source: rows(n), domain: 'x', value: 'y', isSorted: true, channels: { c: 'c', s: 's' } });
    const chart = new Chart(
      { theme: lightTheme, width: 600, height: 400 },
      new CartesianPlane(
        {},
        new Axis({ ...axes.x }, new LinearScale()),
        new Axis({ ...axes.y }, new LinearScale()),
        new DomainSeries(source, renderer),
      ),
      ...(extra as never[]),
    );
    const platform = new StringPlatform({ width: 600, height: 400 });
    chart.attach(platform);
    return {
      chart,
      platform,
      source,
      flush: () => {
        const stats = chart.flush();
        return { stats, svg: platform.toString() };
      },
    };
  }
  type ElementLike = AnyElement;

  const tags = (svg: string) =>
    [...svg.matchAll(/<path ([^>]*?)\/?>/g)].map(
      (m) => Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])) as Record<string, string>,
    );
  const circles = (svg: string) => tags(svg).filter((p) => / 0 1 0 /.test(p.d ?? ''));
  const subpaths = (d: string) => (d.match(/M/g) ?? []).length;
  const total = (ps: Record<string, string>[]) => ps.reduce((n, p) => n + subpaths(p.d!), 0);

  // ── Without bindings every marker is in one path, whatever the shape.
  {
    const n = 150;
    const dot = tags(scatter(new DotMarker()).flush().svg).filter((p) => /h0/.test(p.d ?? ''));
    assert.equal(dot.length, 1);
    assert.equal(subpaths(dot[0]!.d!), n < 200 ? 200 : n, 'one dot per point');
    assert.equal(dot[0]!['stroke-linecap'], 'round');
    assert.equal(dot[0]!['stroke-width'], '6', 'size 3 is a radius, so the stroke is 6 wide');
    const square = tags(scatter(new DotMarker({ cap: 'square', size: 2 })).flush().svg).filter((p) => /h0/.test(p.d ?? ''));
    assert.equal(square[0]!['stroke-linecap'], 'square');
    assert.equal(square[0]!['stroke-width'], '4');

    const cross = tags(scatter(new CrossMarker()).flush().svg).filter(
      (p) => /l-?[\d.]+ -?[\d.]+/.test(p.d ?? '') && subpaths(p.d ?? '') > 50,
    );
    assert.equal(cross.length, 1);
    assert.equal(subpaths(cross[0]!.d!), 400, 'a cross is two strokes');
    assert.equal(cross[0]!.fill, 'none');
    const plus = tags(scatter(new PlusMarker({ stroke: 'crimson', strokeWidth: 2 })).flush().svg).filter((p) =>
      /h-?[\d.]+M-?[\d.]+ -?[\d.]+v/.test(p.d ?? ''),
    );
    assert.equal(plus.length, 1);
    assert.equal(subpaths(plus[0]!.d!), 400);
    assert.equal(plus[0]!.stroke, 'crimson');
    assert.equal(plus[0]!['stroke-width'], '2');

    const circle = circles(scatter(new CircleMarker({ fill: 'seagreen', stroke: '#222', strokeWidth: 0.5 })).flush().svg);
    assert.equal(circle.length, 1);
    assert.equal(subpaths(circle[0]!.d!), 200);
    assert.equal(circle[0]!.fill, 'seagreen');
    assert.equal(circle[0]!['stroke-width'], '0.5');
    const sq = tags(scatter(new SquareMarker()).flush().svg).filter((p) => /h-?[\d.]+v-?[\d.]+h-?[\d.]+z/.test(p.d ?? ''));
    assert.equal(sq.length, 1);
    assert.equal(sq[0]!.stroke, 'none', 'closed shapes are filled, not stroked, until asked');
  }

  // ── A bound colour is quantized: as few paths as there are steps in use, however many distinct values.
  {
    const { flush } = scatter(new CircleMarker({ bind: { fill: { axis: 'heat', channel: 'c' } } }), [heat()]);
    const ps = circles(flush().svg);
    assert(ps.length > 1 && ps.length <= 20, `one path per colour in use (${ps.length})`);
    assert.equal(total(ps), 200, 'every marker is drawn exactly once');
    assert.equal(new Set(ps.map((p) => p.fill)).size, ps.length, 'each path has its own colour');
    assert(ps.every((p) => /^#[0-9a-f]{6}$/.test(p.fill!)));

    const coarse = scatter(new CircleMarker({ maxNodes: 5, bind: { fill: { axis: 'heat', channel: 'c' } } }), [heat()]).flush().svg;
    const cs = circles(coarse);
    assert(cs.length <= 5, `maxNodes caps the paths (${cs.length})`);
    assert.equal(total(cs), 200);
  }

  // ── Two bound styles multiply: the budget is shared out, and over-asking is an error at attach.
  {
    const two = { fill: { axis: 'heat', channel: 'c' }, strokeWidth: { axis: 'mass', channel: 's' } } as const;
    const { flush } = scatter(new CircleMarker({ maxNodes: 100, stroke: '#333', bind: two }), [heat(), mass([0.5, 3])]);
    const ps = circles(flush().svg);
    assert(ps.length <= 100, `within the budget (${ps.length})`);
    assert(ps.length > 10, 'more than either binding alone');
    assert.equal(total(ps), 200);
    assert.throws(() => scatter(new CircleMarker({ maxNodes: 3, bind: two }), [heat(), mass()]), /fewer than 2 steps/);
  }

  // ── Size is geometric on the shape markers: any number of sizes, still one path, and the radius is the dimension's output.
  {
    const { flush } = scatter(new CircleMarker({ bind: { size: { axis: 'mass', channel: 's' } } }), [mass([2, 10])]);
    const ps = circles(flush().svg);
    assert.equal(ps.length, 1, 'a bound size costs no paths');
    const radii = [...ps[0]!.d!.matchAll(/a(-?[\d.]+) -?[\d.]+ 0 1 0/g)].map((m) => +m[1]!);
    assert.equal(new Set(radii).size, 7, 'one radius per distinct value of the channel');
    assert(Math.min(...radii) >= 2 - 0.01 && Math.max(...radii) <= 10 + 0.01);
    assert(
      Math.abs(Math.min(...radii) - 2) < 0.01 && Math.abs(Math.max(...radii) - 10) < 0.01,
      'the ends of the channel reach the ends of the output',
    );
    // Crosses too.
    const crosses = tags(scatter(new CrossMarker({ bind: { size: { axis: 'mass', channel: 's' } } }), [mass()]).flush().svg).filter(
      (p) => /l-?[\d.]+ -?[\d.]+/.test(p.d ?? '') && subpaths(p.d ?? '') > 50,
    );
    assert.equal(crosses.length, 1);
  }

  // ── A dot's size is a stroke width, so it is quantized like a colour.
  {
    const ps = tags(scatter(new DotMarker({ bind: { size: { axis: 'mass', channel: 's' } } }), [mass()]).flush().svg).filter((p) =>
      /h0/.test(p.d ?? ''),
    );
    assert(ps.length > 1 && ps.length <= 7, `a path per size in use (${ps.length})`);
    assert(new Set(ps.map((p) => p['stroke-width'])).size === ps.length);
  }

  // ── Data with no value for a bound channel takes the dimension's missing value.
  {
    const source = new ObjectDataSource({
      source: [
        { x: 0, y: 1, c: 0 },
        { x: 1, y: 2, c: 10 },
        { x: 2, y: 3, c: NaN },
        { x: 3, y: 4, c: 20 },
      ],
      domain: 'x',
      value: 'y',
      isSorted: true,
      channels: { c: 'c' },
    });
    const chart = new Chart(
      { theme: lightTheme, width: 400, height: 300 },
      new CartesianPlane(
        {},
        new Axis({}, new LinearScale()),
        new Axis({}, new LinearScale()),
        new DomainSeries(source, new CircleMarker({ bind: { fill: { axis: 'heat', channel: 'c' } } })),
      ),
      new ColorAxis({ id: 'heat', missing: 'hotpink' }, new LinearScale()),
    );
    const p = new StringPlatform({ width: 400, height: 300 });
    chart.attach(p).flush();
    const ps = circles(p.toString());
    assert(
      ps.some((q) => q.fill === 'hotpink' && subpaths(q.d!) === 1),
      'the point with no value is drawn in the missing colour',
    );
    assert.equal(total(ps), 4);
  }

  // ── merge: false gives every marker a node of its own, each with exactly its own value, and they can be switched back and forth.
  {
    const r = new CircleMarker({ merge: false, opacity: 0.5, bind: { fill: { axis: 'heat', channel: 'c' } } });
    const { flush } = scatter(r, [heat()], 60);
    const first = circles(flush().svg);
    assert.equal(first.length, 60, 'a path per marker');
    assert(first.every((p) => subpaths(p.d!) === 1 && p.opacity === '0.5'));
    assert(new Set(first.map((p) => p.fill)).size > 19, 'and exact colours, not buckets (20 distinct values)');
    r.setAttribute('merge', true);
    const merged = circles(flush().svg);
    assert(merged.length > 1 && merged.length <= 20 && total(merged) === 60, 'back to a path per look, the per-marker nodes gone');
    r.setAttribute('merge', false);
    assert.equal(circles(flush().svg).length, 60);
  }

  // ── Markers outside the plot are not written.
  {
    const clipped = circles(scatter(new CircleMarker(), [], 200, { x: { min: 0, max: 100 } }).flush().svg);
    const drawn = total(clipped);
    assert(drawn >= 100 && drawn <= 103, `only the markers that can show (${drawn})`);
  }

  // ── Updates write only what changed, and paths that are no longer needed go.
  {
    const { flush, source } = scatter(new CircleMarker({ bind: { fill: { axis: 'heat', channel: 'c' } } }), [heat()]);
    flush();
    assert.equal(flush().stats.attributeWrites, 0, 'an idle flush writes nothing');
    source.setAttribute(
      'source',
      rows(200).map((r) => ({ ...r, c: r.c < 10 ? 0 : 19 })),
    );
    const { svg, stats } = flush();
    assert(stats.attributeWrites > 0);
    assert.equal(circles(svg).length, 2, 'two colours in use, so two paths; the other nodes are removed');
  }

  // ── Bindings can name the dimension by id or hold it directly.
  {
    const h = heat();
    const byRef = circles(scatter(new CircleMarker({ bind: { fill: { axis: h, channel: 'c' } } }), [h]).flush().svg);
    const byId = circles(scatter(new CircleMarker({ bind: { fill: { axis: 'heat', channel: 'c' } } }), [heat()]).flush().svg);
    assert.deepEqual(
      byRef.map((p) => p.fill),
      byId.map((p) => p.fill),
    );
  }

  // ── A flat source can supply channels too, by offset into each point.
  {
    const data = new Float64Array([0, 5, 0.1, 1, 8, 0.9, 2, 3, 0.5]);
    const chart = new Chart(
      { theme: lightTheme, width: 300, height: 200 },
      new CartesianPlane(
        {},
        new Axis({}, new LinearScale()),
        new Axis({}, new LinearScale()),
        new DomainSeries(
          new FlatDataSource({ data, stride: 3, isSorted: true, channels: { w: 2 } }),
          new CircleMarker({ bind: { size: { axis: 'mass', channel: 'w' } } }),
        ),
      ),
      mass([2, 8]),
    );
    const p = new StringPlatform({ width: 300, height: 200 });
    chart.attach(p).flush();
    const radii = [...circles(p.toString())[0]!.d!.matchAll(/a(-?[\d.]+) /g)].map((m) => +m[1]!).filter((_, i) => i % 2 === 0);
    assert.deepEqual(radii, [2, 8, 5]);
  }

  // ── A big scatter is one path and builds quickly.
  let bigMs = 0;
  {
    const n = 300_000,
      xy = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      xy[2 * i] = i;
      xy[2 * i + 1] = Math.sin(i / 3000) * 50 + ((i * 7919) % 1000) / 20;
    }
    const chart = new Chart(
      { theme: lightTheme, width: 800, height: 500 },
      new CartesianPlane(
        {},
        new Axis({}, new LinearScale()),
        new Axis({}, new LinearScale()),
        new DomainSeries(new FlatDataSource({ data: xy, isSorted: true }), new DotMarker({ size: 1, opacity: 0.4 })),
      ),
    );
    chart.attach(new StringPlatform({ width: 800, height: 500 }));
    const t0 = performance.now();
    const stats = chart.flush();
    bigMs = performance.now() - t0;
    assert.equal(stats.pointsDrawn, n);
    assert(bigMs < 2000, `300k dots in ${bigMs.toFixed(0)} ms`);
  }

  // ── The compiler knows what each marker can bind, and to what.
  // Never called: these lines only have to fail to compile.
  function compileTimeChecks() {
    const color = new ColorAxis({}, new LinearScale());
    const size = new SizeAxis({}, new LinearScale());
    new CircleMarker({ bind: { fill: { axis: color, channel: 'c' }, size: { axis: size, channel: 's' } } });
    new DotMarker({ bind: { stroke: { axis: color, channel: 'c' }, size: { axis: size, channel: 's' } } });
    new CrossMarker({ bind: { strokeWidth: { axis: size, channel: 's' } } });
    // @ts-expect-error a cross is not filled
    new CrossMarker({ bind: { fill: { axis: color, channel: 'c' } } });
    // @ts-expect-error a dot has one colour, which is its stroke
    new DotMarker({ bind: { fill: { axis: color, channel: 'c' } } });
    // @ts-expect-error a colour needs a colour dimension
    new CircleMarker({ bind: { fill: { axis: size, channel: 's' } } });
    // @ts-expect-error a size needs a number dimension
    new CircleMarker({ bind: { size: { axis: color, channel: 'c' } } });
    // @ts-expect-error a dot has no stroke width of its own: the size is it
    new DotMarker({ bind: { strokeWidth: { axis: size, channel: 's' } } });
  }
  void compileTimeChecks;
});

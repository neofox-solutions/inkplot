import assert from 'node:assert/strict';
import {
  Axis,
  BarPath,
  BandScale,
  CartesianPlane,
  Chart,
  DomainSeries,
  FlatDataSource,
  LinePath,
  LinearCurve,
  LinearScale,
  PolarPlane,
  StringPlatform,
  lightTheme,
} from './index.ts';
import type { TransitionSpec } from './platform.ts';
import { test } from 'vite-plus/test';

// Which entrance each kind of series is given, and when: only on the first draw, only if asked, only where the platform can play it.
type Renderer = ConstructorParameters<typeof DomainSeries>[2];
test('enter', () => {
  const data = () => new FlatDataSource({ data: [3, -2, 5, 4], regularDomain: { start: 0, step: 1 } });
  const kinds = (svg: string) => [...svg.matchAll(/data-ink-enter="([^"]+)"/g)].map((m) => m[1]);
  const draw = (
    plane: (renderer: Renderer) => CartesianPlane | PolarPlane,
    renderer: Renderer,
    options: { enter?: boolean; playable?: boolean } = {},
  ) => {
    const chart = new Chart(
      { theme: lightTheme, transition: { duration: 300, ...(options.enter !== false && { enter: true }) } },
      plane(renderer),
    );
    const prepared: TransitionSpec[] = [];
    const platform = new StringPlatform({ width: 300, height: 200 });
    if (options.playable !== false) Object.assign(platform, { prepareEnter: (spec: TransitionSpec) => void prepared.push(spec) });
    chart.attach(platform).flush();
    return { chart, platform, prepared, svg: platform.toString() };
  };
  const cartesian = (renderer: Renderer, horizontal = false) =>
    new CartesianPlane(
      {},
      new Axis({ id: 'd', orientation: horizontal ? 'left' : 'bottom' }, new BandScale({ categories: ['a', 'b', 'c', 'd'] })),
      new Axis({ id: 'v', orientation: horizontal ? 'bottom' : 'left' }, new LinearScale()),
      new DomainSeries({ domainAxis: 'd', valueAxis: 'v' }, data(), renderer),
    );

  // Bars grow, about the foot of the first bar: up and down bars stand on one baseline, so the origin is that line.
  {
    const { svg, prepared } = draw((r) => cartesian(r), new BarPath({}));
    assert.deepEqual(kinds(svg), ['grow-y']);
    assert.match(svg, /transform-origin:[\d.]+px [\d.]+px/);
    assert.deepEqual(prepared, [{ duration: 300, easing: 'ease-out' }], 'the platform was told the speed');
  }
  // Bars that run sideways grow sideways.
  assert.deepEqual(kinds(draw((r) => cartesian(r, true), new BarPath({})).svg), ['grow-x']);
  // A line is drawn on from the left.
  assert.deepEqual(kinds(draw((r) => cartesian(r), new LinePath(new LinearCurve())).svg), ['sweep']);
  // A round chart fades in.
  {
    const polar = (r: Renderer) =>
      new PolarPlane(
        {},
        new Axis({ id: 'd', orientation: 'angle' }, new LinearScale()),
        new Axis({ id: 'v', orientation: 'radius' }, new LinearScale()),
        new DomainSeries({ domainAxis: 'd', valueAxis: 'v' }, data(), r),
      );
    assert.deepEqual(kinds(draw(polar, new LinePath(new LinearCurve())).svg), ['fade']);
  }

  // Not asked for, or nowhere to play it (a string platform has no `prepareEnter`): no mark in the drawing at all.
  assert.deepEqual(kinds(draw((r) => cartesian(r), new BarPath({}), { enter: false }).svg), []);
  assert.deepEqual(kinds(draw((r) => cartesian(r), new BarPath({}), { playable: false }).svg), []);

  // Only the first draw: a series added later, or a redraw, is left as it is.
  {
    const { chart, platform } = draw((r) => cartesian(r), new BarPath({}));
    const plane = [...chart][0] as CartesianPlane;
    plane.append(new DomainSeries({ domainAxis: 'd', valueAxis: 'v' }, data(), new LinePath(new LinearCurve())));
    chart.flush();
    assert.deepEqual(kinds(platform.toString()), ['grow-y'], 'the new series has no entrance');
  }
});

// The chart shortcuts: how they read a series, and what they do with options that apply to every line.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { FlatDataSource, MonotoneCurve, Slice, StepCurve, StringPlatform, lineChart, lightTheme, type Chart } from './index.ts';

const data = (offset: number) =>
  new FlatDataSource({ data: Float64Array.from([1, 4, 2, 5, 3, 6], (v) => v + offset), regularDomain: { start: 0, step: 1 } });
const options = { theme: lightTheme, width: 300, height: 200 };
const draw = (chart: Chart) => {
  const platform = new StringPlatform({ width: 300, height: 200 });
  chart.attach(platform).flush();
  return platform.toString();
};

test('lineChart: a curve for several lines is made for each, and one given as an element is refused for more than one', () => {
  const svg = draw(lineChart([data(0), data(1)], { ...options, curve: () => new MonotoneCurve() }));
  assert.equal(svg.match(/<path[^>]* d="M[^"]*C/g)?.length, 2, 'both lines are drawn as cubic curves');
  assert.ok(
    draw(lineChart(data(0), { ...options, curve: new StepCurve({ mode: 'after' }) })).length > 0,
    'a single line takes the curve itself',
  );
  assert.throws(() => lineChart([data(0), data(1)], { ...options, curve: new MonotoneCurve() }), /one parent/);
});

test('lineChart: a transform with a source of its own is data, not a { source, name } spec', () => {
  // A Slice has a `source`, which is what the spec is told apart by: reading it as a spec dropped the Slice and drew all the rows.
  const svg = draw(lineChart(new Slice({ last: 2 }, data(0)), options));
  const named = draw(lineChart({ source: new Slice({ last: 2 }, data(0)), name: 'Last two' }, options));
  const all = draw(lineChart(data(0), options));
  assert.notEqual(svg, all, 'the slice shows fewer rows than the data');
  assert.notEqual(named, all, 'a spec around a slice still slices');
});

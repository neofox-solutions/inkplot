import assert from 'node:assert/strict';
import { FlatDataSource, Legend, StringPlatform, barChart, lightTheme, lineChart } from './index.ts';
import { test } from 'vite-plus/test';

const rows = (data: number[]) => new FlatDataSource({ data, regularDomain: { start: 0, step: 1 } });
const draw = (chart: ReturnType<typeof barChart>) => {
  const platform = new StringPlatform({ width: 400, height: 300 });
  chart.attach(platform).flush();
  return platform.toString();
};
const base = { theme: lightTheme, width: 400, height: 300, categories: ['Q1', 'Q2', 'Q3'] };

test('barChart and lineChart', () => {
  const one = draw(barChart(rows([3, 5, 4]), base));
  for (const t of ['Q1', 'Q2', 'Q3']) assert(one.includes(t), t);
  // Several series: grouped by default, stacked on request (the bars then reach higher on the same axis, so the paths differ).
  const two = () => [
    { name: 'A', source: rows([3, 5, 4]) },
    { name: 'B', source: rows([2, 2, 2]), color: '#ff0000' },
  ];
  const grouped = draw(barChart(two(), base));
  const stacked = draw(barChart(two(), { ...base, stack: 'stack' }));
  assert(grouped.includes('#ff0000') && stacked.includes('#ff0000'));
  assert.notEqual(grouped, stacked);
  assert(draw(barChart(two(), { ...base, stack: 'normalize', extras: [new Legend({})] })).includes('>B<'), 'the legend names the series');
  // Swapped axes: the categories are on the left.
  const side = draw(barChart(rows([3, 5, 4]), { ...base, horizontal: true }));
  assert(side.includes('Q1') && side !== one);
  assert.throws(() => barChart(rows([1]), { theme: lightTheme }), /categories/);
  // Several lines, each named.
  const lines = draw(lineChart(two(), { theme: lightTheme, width: 400, height: 300, extras: [new Legend({})] }));
  assert(lines.includes('>A<') && lines.includes('>B<') && lines.includes('#ff0000'));
});

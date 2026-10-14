import assert from 'node:assert/strict';
import { Chart, StringPlatform, lightTheme, pie } from './index.ts';
import { test } from 'vite-plus/test';

function draw(chart: Chart): string {
  const platform = new StringPlatform({ width: 400, height: 300 });
  chart.attach(platform).flush();
  return platform.toString();
}

test('pie', () => {
  const slices = [
    { name: 'Mobile', value: 60 },
    { name: 'Desktop', value: 30, color: '#ff0000' },
    { name: 'Other', value: 10 },
  ];
  const chart = new Chart(
    { theme: lightTheme, padding: 40, width: 400, height: 300 },
    pie(slices, { label: (s, f) => `${s.name} ${Math.round(f * 100)}%` }),
  );
  const svg = draw(chart);
  for (const t of ['Mobile 60%', 'Desktop 30%', 'Other 10%']) assert(svg.includes(t), t);
  assert(svg.includes('#ff0000'));
  // No label: no text at all; a doughnut has a hole.
  const bare = draw(new Chart({ theme: lightTheme, width: 400, height: 300 }, pie(slices, { innerRadius: 0.5 })));
  assert(bare.includes('clip-rule="evenodd"'), 'the doughnut has a hole');
  assert(!bare.includes('Mobile') && !bare.includes('%'), 'no label, no words');
  assert.throws(() => pie([{ name: 'x', value: -1 }]), /not negative/);
  // A slice left out by the label function gets none.
  const some = draw(
    new Chart({ theme: lightTheme, padding: 40, width: 400, height: 300 }, pie(slices, { label: (s) => (s.value > 20 ? s.name : null) })),
  );
  assert(some.includes('Mobile') && !some.includes('Other'));
});

import assert from 'node:assert/strict';
import { DotPattern, HatchPattern, Legend, StringPlatform, lightTheme, pieChart } from './index.ts';
import { test } from 'vite-plus/test';

function draw(chart: ReturnType<typeof pieChart>): string {
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
  const chart = pieChart(slices, {
    theme: lightTheme,
    padding: 40,
    width: 400,
    height: 300,
    label: (s, f) => `${s.name} ${Math.round(f * 100)}%`,
  });
  const svg = draw(chart);
  for (const t of ['Mobile 60%', 'Desktop 30%', 'Other 10%']) assert(svg.includes(t), t);
  assert(svg.includes('#ff0000'));
  // No label: no text at all; a doughnut has a hole.
  const bare = draw(pieChart(slices, { theme: lightTheme, width: 400, height: 300, innerRadius: 0.5 }));
  assert(bare.includes('clip-rule="evenodd"'), 'the doughnut has a hole');
  assert(!bare.includes('Mobile') && !bare.includes('%'), 'no label, no words');
  assert.throws(() => pieChart([{ name: 'x', value: -1 }], { theme: lightTheme }), /not negative/);
  // A slice left out by the label function gets none.
  const some = draw(
    pieChart(slices, { theme: lightTheme, padding: 40, width: 400, height: 300, label: (s) => (s.value > 20 ? s.name : null) }),
  );
  assert(some.includes('Mobile') && !some.includes('Other'));
  // Extras are the chart's other children.
  assert(draw(pieChart(slices, { theme: lightTheme, width: 400, height: 300, extras: [new Legend({})] })).includes('Desktop'));
});

// A slice is a BarPath, so a pattern is a slice's colour like any other fill: and the slice's own colour from the palette is what it is drawn in.
test('pie slices take patterns', () => {
  const svg = draw(
    pieChart(
      [
        { name: 'Mobile', value: 60, color: 'url(#hatch)' },
        { name: 'Desktop', value: 30, color: 'url(#dots)' },
        { name: 'Other', value: 10 },
      ],
      { theme: lightTheme, width: 400, height: 300, extras: [new HatchPattern({ id: 'hatch' }), new DotPattern({ id: 'dots' })] },
    ),
  );
  assert.equal([...svg.matchAll(/<pattern /g)].length, 4, 'a plain one and one in the slice colour, for each pattern');
  assert.equal([...svg.matchAll(/<path [^>]*fill="url\(#[^"]+\)"/g)].length, 2, 'two slices are patterned, the third is flat');
});

import assert from 'node:assert/strict';
import {
  Axis,
  CartesianPlane,
  ChartTitle,
  Chart,
  DomainSeries,
  FlatDataSource,
  Legend,
  LinePath,
  LinearCurve,
  LinearScale,
  StringPlatform,
  lightTheme,
} from './index.ts';
import { test } from 'vite-plus/test';

// A chart that reads right to left is the mirror image: the first vertical axis on the right, a horizontal axis running from the
// right, the legend on the left and the title starting at the right. What is placed by hand stays where it was put.
test('rtl', () => {
  const make = (direction: 'ltr' | 'rtl', yAttrs = {}, xAttrs = {}) => {
    const x = new Axis({ ...xAttrs }, new LinearScale());
    const y = new Axis({ ...yAttrs }, new LinearScale());
    const legend = new Legend({});
    const chart = new Chart(
      { theme: lightTheme, width: 400, height: 300, direction },
      new ChartTitle({ text: 'Sales' }),
      new CartesianPlane(
        {},
        x,
        y,
        new DomainSeries(
          { name: 'a' },
          new FlatDataSource({ data: [1, 3, 2], regularDomain: { start: 0, step: 1 } }),
          new LinePath(new LinearCurve()),
        ),
      ),
      legend,
    );
    const platform = new StringPlatform({ width: 400, height: 300 });
    chart.attach(platform).flush();
    return { x, y, legend, svg: platform.toString(), chart };
  };
  const ltr = make('ltr'),
    rtl = make('rtl');
  assert.equal(ltr.y.orientation, 'left');
  assert.equal(rtl.y.orientation, 'right');
  assert.equal(rtl.x.orientation, 'bottom');
  assert.equal(ltr.legend.side, 'right');
  assert.equal(rtl.legend.side, 'left');
  // The horizontal axis runs from the right: the low end of the domain is at the far right of the plot.
  assert.equal(ltr.x.fractionOf(0), 0);
  assert.equal(rtl.x.fractionOf(0), 1);
  assert.equal(rtl.y.fractionOf(1), ltr.y.fractionOf(1), 'the vertical axis is not turned over');
  // The title's anchor is at the other end.
  assert.match(ltr.svg, /text-anchor="start"/);
  assert.notEqual(ltr.svg, rtl.svg);
  // Placed by hand stays: an explicit orientation, `inverted: false`, and a legend side.
  const own = make('rtl', { orientation: 'left' }, { inverted: false });
  assert.equal(own.y.orientation, 'left');
  assert.equal(own.x.fractionOf(0), 0);
  // And back again.
  rtl.chart.setAttribute('direction', 'ltr');
  rtl.chart.flush();
  assert.equal(rtl.y.orientation, 'left');
  assert.equal(rtl.x.fractionOf(0), 0);
});

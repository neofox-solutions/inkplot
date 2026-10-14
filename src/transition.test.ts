import assert from 'node:assert/strict';
import {
  Axis,
  CartesianPlane,
  Chart,
  DomainSeries,
  FlatDataSource,
  LinePath,
  LinearCurve,
  LinearScale,
  StringPlatform,
  lightTheme,
} from './index.ts';
import type { TransitionSpec } from './platform.ts';
import { test } from 'vite-plus/test';

// What a chart asks its platform for at each flush: easing only after a change to the data, and only if `transition` is set.
// `Array.prototype.at` is newer than the oldest runtime these tests run on.
const last = <T>(list: T[]): T | undefined => list[list.length - 1];

test('transition', () => {
  const make = (transition?: { duration?: number; easing?: string }) => {
    const source = new FlatDataSource({ data: [1, 3, 2], regularDomain: { start: 0, step: 1 } });
    const x = new Axis({ orientation: 'bottom' }, new LinearScale());
    const chart = new Chart(
      { theme: lightTheme, ...(transition && { transition }) },
      new CartesianPlane(
        {},
        x,
        new Axis({ orientation: 'left' }, new LinearScale()),
        new DomainSeries({}, source, new LinePath(new LinearCurve())),
      ),
    );
    const asked: (TransitionSpec | null)[] = [];
    const platform = Object.assign(new StringPlatform({ width: 300, height: 200 }), {
      setTransition: (spec: TransitionSpec | null) => void asked.push(spec),
    });
    chart.attach(platform).flush();
    return { chart, source, x, asked };
  };

  const { chart, source, x, asked } = make({});
  assert.deepEqual(asked, [null], 'the first draw has nothing to move from');
  source.invalidate();
  chart.flush();
  assert.deepEqual(last(asked), { duration: 250, easing: 'ease-out' }, 'a data change eases, with the defaults');
  chart.flush();
  assert.equal(last(asked), null, 'one change eases one flush');
  source.invalidate();
  x.setAttribute('min', 0.5);
  chart.flush();
  assert.notEqual(last(asked), null, 'a data change with a view change eases');
  x.setAttribute('max', 1.5);
  chart.flush();
  assert.equal(last(asked), null, 'a view change alone does not');

  const custom = make({ duration: 90, easing: 'linear' });
  custom.source.invalidate();
  custom.chart.flush();
  assert.deepEqual(last(custom.asked), { duration: 90, easing: 'linear' });

  const off = make();
  off.source.invalidate();
  off.chart.flush();
  assert.equal(last(off.asked), null, 'without `transition` nothing eases');
});

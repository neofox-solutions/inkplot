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
  LogScale,
  StringPlatform,
  lightTheme,
  moveView,
  parseEasing,
} from './index.ts';
import type { Unsubscribe } from './platform.ts';
import { test } from 'vite-plus/test';

// A call, so that what was asserted about the property earlier does not narrow what it is now.
const viewOf = (axis: Axis) => axis.viewRange;

test('viewtween', () => {
  // Easing: the CSS timing functions, from 0 to 1.
  for (const name of ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(.2,.8,.4,1)', 'nonsense']) {
    const f = parseEasing(name);
    assert.equal(f(0), 0, name);
    assert.equal(f(1), 1, name);
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const v = f(i / 20);
      assert.ok(v >= last - 1e-9, `${name} never goes back`);
      last = v;
    }
  }
  assert.equal(parseEasing('linear')(0.3), 0.3);
  assert.ok(parseEasing('ease-out')(0.5) > 0.6 && parseEasing('ease-in')(0.5) < 0.4, 'out is early, in is late');
  assert.ok(Math.abs(parseEasing('ease-in-out')(0.5) - 0.5) < 1e-6);
  assert.ok(parseEasing('cubic-bezier(.34,1.56,.64,1)')(0.6) > 1, 'a curve may overshoot');

  const make = (transition?: { duration?: number; easing?: string; views?: boolean }, scale = () => new LinearScale()) => {
    const x = new Axis({ orientation: 'bottom' }, scale());
    const y = new Axis({ orientation: 'left' }, new LinearScale());
    const chart = new Chart(
      { theme: lightTheme, ...(transition && { transition }) },
      new CartesianPlane(
        {},
        x,
        y,
        new DomainSeries(
          {},
          new FlatDataSource({ data: [1, 2, 3, 4, 5, 6], regularDomain: { start: 1, step: 1 } }),
          new LinePath(new LinearCurve()),
        ),
      ),
    );
    let queue: (() => void)[] = [];
    let clock = 0;
    const platform = Object.assign(new StringPlatform({ width: 300, height: 200 }), {
      schedule: (cb: () => void): Unsubscribe => {
        queue.push(cb);
        return () => void (queue = queue.filter((c) => c !== cb));
      },
    });
    chart.attach(platform);
    // One frame: the chart's own flush and whatever was waiting, at the given time.
    const frame = (at: number) => {
      clock = at;
      const run = queue;
      queue = [];
      for (const cb of run) cb();
    };
    frame(0);
    const options = { now: () => clock };
    return { chart, x, frame, options, pending: () => queue.length };
  };

  // Without `transition`, or with `views: false`, a view is set at once.
  for (const t of [undefined, { views: false }]) {
    const { x, options } = make(t);
    moveView(x, { min: 2, max: 3 }, options);
    assert.deepEqual(x.viewRange, { min: 2, max: 3 });
  }

  // With it, the range moves frame by frame and arrives exactly.
  {
    const { x, frame, options, pending } = make({ duration: 100, easing: 'linear' });
    const natural = { ...x.range };
    moveView(x, { min: 2, max: 3 }, options);
    assert.equal(x.viewRange, null, 'nothing has moved yet');
    frame(50);
    const mid = viewOf(x);
    assert.ok(mid, 'a frame moved it');
    assert.ok(
      Math.abs(mid.min - (natural.min + 2) / 2) < 1e-9 && Math.abs(mid.max - (natural.max + 3) / 2) < 1e-9,
      'halfway through a linear ease',
    );
    frame(100);
    assert.deepEqual(x.viewRange, { min: 2, max: 3 }, 'and it ends at the target');
    frame(150);
    assert.equal(pending(), 0, 'when it has arrived nothing more is scheduled');
    // Back to the natural range: the view is removed when it gets there.
    moveView(x, null, options);
    frame(160);
    assert.ok(x.viewRange !== null);
    frame(300);
    assert.equal(x.viewRange, null, 'null ends as no view at all');
    frame(310);
    assert.deepEqual(x.range, natural);
  }

  // A change from elsewhere (a drag) takes over from the move.
  {
    const { x, frame, options } = make({ duration: 100, easing: 'linear' });
    moveView(x, { min: 2, max: 3 }, options);
    frame(30);
    x.setViewRange({ min: 4, max: 5 });
    frame(60);
    frame(200);
    assert.deepEqual(x.viewRange, { min: 4, max: 5 }, 'the move stopped');
  }

  // A second move replaces the first.
  {
    const { x, frame, options } = make({ duration: 100, easing: 'linear' });
    moveView(x, { min: 2, max: 3 }, options);
    frame(30);
    moveView(x, { min: 5, max: 6 }, options);
    frame(300);
    frame(400);
    assert.deepEqual(x.viewRange, { min: 5, max: 6 });
  }

  // On a log axis the move is even in the scale's terms: halfway between 1..1000 and 10..100 is 10^0.5 … in the middle of each end.
  {
    const { x, frame, options } = make({ duration: 100, easing: 'linear' }, () => new LogScale());
    x.setViewRange({ min: 1, max: 1000 });
    frame(1);
    moveView(x, { min: 10, max: 100 }, options);
    frame(51);
    const v = viewOf(x);
    assert.ok(v && Math.abs(v.min - 1000 ** (1 / 6)) < 1e-6 && Math.abs(v.max - 1000 ** (5 / 6)) < 1e-6, `geometric: ${JSON.stringify(v)}`);
  }
});

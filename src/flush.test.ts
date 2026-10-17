// Flush timing: an explicit flush replaces the one waiting for the next frame, and the DOM platform does not read the page's layout on every flush.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  Axis,
  CartesianPlane,
  Chart,
  DOMPlatform,
  DomainSeries,
  FlatDataSource,
  LinePath,
  LinearCurve,
  LinearScale,
  StringPlatform,
} from './index.ts';
import { lightTheme } from './themes.ts';
import type { Unsubscribe } from './platform.ts';

test('flush', () => {
  const make = () =>
    new Chart(
      { theme: lightTheme, width: 200, height: 100 },
      new CartesianPlane(
        {},
        new Axis({ orientation: 'bottom' }, new LinearScale()),
        new Axis({ orientation: 'left' }, new LinearScale()),
        new DomainSeries(
          {},
          new FlatDataSource({ data: [1, 3, 2], regularDomain: { start: 0, step: 1 } }),
          new LinePath({}, new LinearCurve()),
        ),
      ),
    );

  // A flush by hand takes the waiting one's place: when the frame comes there is nothing to do.
  {
    let queue: (() => void)[] = [];
    const platform = Object.assign(new StringPlatform({ width: 200, height: 100 }), {
      schedule: (cb: () => void): Unsubscribe => {
        queue.push(cb);
        return () => void (queue = queue.filter((c) => c !== cb));
      },
    });
    const chart = make().attach(platform);
    for (const cb of queue.splice(0)) cb();
    const before = chart.flushCount;
    chart.invalidate();
    assert.equal(queue.length, 1, 'a flush is waiting for the frame');
    chart.flush();
    assert.equal(queue.length, 0, 'and flushing by hand cancelled it');
    assert.equal(chart.flushCount, before + 1);
    chart.invalidate();
    assert.equal(queue.length, 1, 'a later change schedules again');
  }

  // The DOM platform reads its container's size once, then trusts the resize observer.
  {
    let reads = 0;
    const container = {
      ownerDocument: { createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
      get clientWidth() {
        reads++;
        return 320;
      },
      clientHeight: 240,
      appendChild() {},
    };
    let fire: () => void = () => {};
    const g = globalThis as unknown as { ResizeObserver?: unknown };
    const saved = g.ResizeObserver;
    g.ResizeObserver = class {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe() {}
      disconnect() {}
    };
    try {
      const platform = new DOMPlatform(container, { schedule: 'manual' });
      platform.size();
      assert.equal(reads, 1, 'unobserved, it reads each time');
      platform.size();
      assert.equal(reads, 2);
      const stop = platform.onResize(() => {});
      fire();
      const after = reads;
      for (let i = 0; i < 5; i++) assert.deepEqual(platform.size(), { width: 320, height: 240 });
      assert.equal(reads, after, 'observed, size() does not touch the layout');
      stop();
      platform.size();
      assert.equal(reads, after + 1, 'and with no observer left it reads again');
    } finally {
      g.ResizeObserver = saved;
    }
  }
});

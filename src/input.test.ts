// The input host: made on the first ask and only then, the same one for every asker, driven by raw pointers without a PanZoom,
// keys and focus to the owner of a node, and let go of on detach.
import assert from 'node:assert/strict';
import { Chart, CartesianPlane, Axis, LinearScale, DomainSeries, FlatDataSource, LinePath, LinearCurve, ChartElement, EVENT_FOCUS, EVENT_KEY, EVENT_POINTER, inputOf, InputHost, type ChartEvent, type BaseAttributes } from './index.ts';
import { lightTheme } from './themes.ts';
import { FakePlatform } from './fake-platform.ts';

class Listener extends ChartElement<CartesianPlane, [], BaseAttributes> {
  pointer: string[] = []; keys: string[] = []; focus: boolean[] = [];
  node: unknown = null;
  static override takesInput = inputOf;
  override onEvent(ev: ChartEvent): void {
    if (ev.type === EVENT_POINTER) this.pointer.push(`${ev.kind}${ev.pointerType === 'touch' ? ':touch' : ''}${ev.outside ? ':outside' : ''}`);
    else if (ev.type === EVENT_KEY) { this.keys.push(ev.key); ev.handled = true; }
    else if (ev.type === EVENT_FOCUS) this.focus.push(ev.focused);
  }
}

const make = (...extra: Listener[]) => {
  const plane = new CartesianPlane({}, new Axis({ orientation: 'bottom' }, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()),
    new DomainSeries({}, new FlatDataSource({ data: [1, 3, 2] }), new LinePath({}, new LinearCurve())), ...(extra as never[]));
  const chart = new Chart({ theme: lightTheme }, plane);
  const platform = new FakePlatform({ width: 400, height: 300 });
  chart.attach(platform).flush();
  return { chart, plane, platform };
};

{
  // Nothing asks: no host. Two askers: one host.
  const none = make();
  assert.equal(none.chart.input, null);
  const a = new Listener({}), b = new Listener({});
  const { chart, plane, platform } = make(a, b);
  assert(chart.input instanceof InputHost);
  assert.equal(inputOf(chart), chart.input, 'the same host for every asker');
  // A pointer over the plot reaches both, in plane coordinates; a touch sets `coarse`; the wheel does not.
  const r = plane.rect, inside = { x: r.x + 10, y: r.y + 10 };
  const send = (kind: 'move' | 'down' | 'up' | 'leave' | 'wheel', extra = {}) => platform.pointer!({ kind, x: inside.x, y: inside.y, buttons: 0, deltaY: 0, shift: false, ctrl: false, ...extra });
  send('move');
  assert.deepEqual(a.pointer, ['move']); assert.deepEqual(b.pointer, ['move']);
  assert.equal(chart.input!.coarse, false);
  send('move', { pointerType: 'touch', id: 3 });
  assert.equal(chart.input!.coarse, true, 'a finger makes pointer input coarse');
  send('wheel', { deltaY: 10 });
  assert.equal(chart.input!.coarse, true, 'a wheel turn says nothing about the pointer');
  send('move', { pointerType: 'mouse' });
  assert.equal(chart.input!.coarse, false);
  // Beside the plot (not on an axis strip): nothing is reached.
  const before = a.pointer.length;
  platform.pointer!({ kind: 'move', x: 1, y: 1, buttons: 0, deltaY: 0, shift: false, ctrl: false });
  assert.equal(a.pointer.length, before + 1, 'the plane the pointer left is told');
  assert.equal(a.pointer.at(-1), 'leave', 'it is told it left');
  // A press holds the plane until it is released, even when the pointer goes elsewhere.
  send('down', { buttons: 1 });
  platform.pointer!({ kind: 'move', x: 1, y: 1, buttons: 1, deltaY: 0, shift: false, ctrl: false });
  assert.equal(a.pointer.at(-1), 'move:outside', 'captured: still sent, flagged as outside');
  send('up');
  // Keys and focus go to the owner of the node.
  const node = chart.platform!.createNode('g');
  chart.input!.focusable(a, node);
  assert.equal(platform.keyHandler!({ kind: 'down', key: 'x', shift: false, ctrl: false, alt: false, repeat: false }, node), true);
  assert.deepEqual(a.keys, ['x']); assert.deepEqual(b.keys, []);
  platform.focusHandler!({ node, focused: true, visible: true });
  assert.deepEqual(a.focus, [true]);
  assert.equal(platform.keyHandler!({ kind: 'down', key: 'y', shift: false, ctrl: false, alt: false, repeat: false }, chart.platform!.createNode('g')), false, 'a node nobody owns');
  chart.input!.speak('hello');
  assert.deepEqual(platform.announced, ['hello']);
  // Detach lets go of everything; a stopped host hears nothing.
  const host = chart.input!;
  chart.detach();
  assert.equal(chart.input, null); assert.equal(platform.pointer, null); assert.equal(platform.keyHandler, null); assert.equal(platform.focusHandler, null);
  host.stop();
}
console.log('ok input');

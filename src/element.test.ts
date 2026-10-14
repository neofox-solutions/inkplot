// Element: the three-link tree, typed fixed and variadic children, and in-place replacement on a live chart.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  DomainSeries,
  LinePath,
  FlatDataSource,
  StringPlatform,
  LogScale,
  toSvgString,
} from './index.ts';
import { test } from 'vite-plus/test';

test('element', () => {
  const ax = (id: string) => new Axis({ id, orientation: 'right' }, new LinearScale());
  const a = ax('a'),
    b = ax('b'),
    c = ax('c'),
    d = ax('d');
  const holder = new CartesianPlane({}, a, c);
  const ids = () => [...holder].map((e) => e.attrs.id).join('');
  assert.equal(ids(), 'ac');
  holder.insertBefore(b, c); // in the middle
  assert.equal(ids(), 'abc');
  holder.append(d); // at the end
  assert.equal(ids(), 'abcd');
  holder.insertBefore(ax('z'), a); // at the front
  assert.equal(ids(), 'zabcd');
  holder.remove(b); // from the middle
  holder.remove(holder.firstChild as Axis); // from the front
  holder.remove(d); // from the end
  assert.equal(ids(), 'ac');
  assert.equal(b.parent, null);
  assert.equal(b.nextSibling, null, 'a removed element keeps no links');
  assert.equal(a.nextSibling, c);
  assert.equal(c.nextSibling, null);
  assert.equal(holder.firstChild, a);
  // Iterating while removing the current element is safe, because the next is read first.
  for (const e of holder) holder.remove(e);
  assert.equal(ids(), '');
  assert.equal(holder.firstChild, null);

  // A fixed child is replaced in place, on a live chart too, and the chart goes on drawing.
  const t = new Axis({ orientation: 'bottom' }, new LinearScale());
  const l = new Axis({ orientation: 'left' }, new LinearScale());
  const src = new FlatDataSource({ data: new Float64Array([1, 3, 2]), regularDomain: { start: 0, step: 1 } });
  const live = new Chart(
    { theme: lightTheme, width: 300, height: 200 },
    new CartesianPlane({}, t, l, new DomainSeries(src, new LinePath(new LinearCurve()))),
  );
  const p = new StringPlatform({ width: 300, height: 200 });
  live.attach(p);
  live.flush();
  const before = p.toString();
  const oldScale = l.child(0, LinearScale);
  const newScale = new LinearScale();
  l.setChild(0, newScale);
  assert.equal(l.child(0, LinearScale), newScale);
  assert.equal(oldScale.parent, null);
  assert.equal(live.flush().attributeWrites, 0, 'an equivalent scale changes nothing on screen');
  assert.equal(p.toString(), before);
  console.log('ok element');

  // ═══ A wrong or missing fixed child says so, where the tree is used, whichever way it was built ═══
  {
    const axisWith = (...kids: unknown[]) => new Axis({}, ...(kids as [LinearScale]));
    assert.throws(() => axisWith().scale, /^Error: Axis: has no child 0 \(it needs Scale\)$/);
    assert.throws(() => axisWith(new LinePath(new LinearCurve())).scale, /^Error: Axis: child 0 should be Scale, but is LinePath$/);
    assert.equal(axisWith(new LogScale()).scale.constructor, LogScale, 'a subclass of the expected class is fine');
    const series = (...kids: unknown[]) => new DomainSeries(...(kids as [FlatDataSource]));
    assert.throws(() => series(new LinearScale()).data, /DomainSeries: child 0 should be DataSource or DataTransform, but is LinearScale/);
    assert.throws(() => series().data, /DomainSeries: has no child 0 \(it needs DataSource or DataTransform\)/);
    assert.throws(() => new (LinePath as unknown as new () => LinePath)().curve, /LinePath: has no child 0 \(it needs Curve\)/);
    // The same mistakes reach a chart as one clear error, not a failure inside layout.
    const chart = new Chart(
      { theme: lightTheme },
      new CartesianPlane({}, axisWith(), new Axis({ orientation: 'left' }, new LinearScale())),
    );
    assert.throws(() => toSvgString(chart, { width: 200, height: 100 }), /Axis: has no child 0 \(it needs Scale\)/);
    // Replacing a child that is not there is a clear error too.
    assert.throws(() => axisWith().setChild(0, new LinearScale()), /Axis: has no child 0 to replace/);
  }
});

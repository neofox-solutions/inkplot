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
  descendantsOfType,
  findById,
  findClosestOfType,
  firstDescendantOfType,
  resolveRef,
  walk,
  type AnyElement,
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
  assert.equal(oldScale?.parent, null);
  assert.equal(live.flush().attributeWrites, 0, 'an equivalent scale changes nothing on screen');
  assert.equal(p.toString(), before);
  console.log('ok element');

  // ═══ A wrong or missing fixed child says so, where the tree is used, whichever way it was built ═══
  {
    const axisWith = (...kids: unknown[]) => new Axis({}, ...(kids as [LinearScale]));
    assert.throws(() => axisWith().scale, /^Error: \[inkplot 255\] Axis: has no child 0 \(it needs Scale\)$/);
    assert.throws(
      () => axisWith(new LinePath(new LinearCurve())).scale,
      /^Error: \[inkplot 254\] Axis: child 0 should be Scale, but is LinePath$/,
    );
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

test('element lookups stay right while the tree changes', () => {
  const axis = (id?: string) => new Axis({ ...(id && { id }), orientation: 'left' }, new LinearScale());
  const plane = (...axes: Axis[]) => new CartesianPlane({}, ...axes);
  const x = axis('x'),
    y = axis('y');
  const p = plane(x, y);
  const chart = new Chart({ theme: lightTheme, width: 100, height: 100 }, p);
  const at = (id: string, from: AnyElement = chart) => resolveRef(id, from);

  // Found from anywhere in the tree, and the answer is kept (the same element each time).
  assert.equal(at('y'), y);
  assert.equal(at('y', x), y);
  assert.equal(x.chart, chart);
  assert.equal(at('y'), y);

  // A new element is found; a removed one is not.
  const late = axis('late');
  assert.throws(() => at('late'), /no element with id "late"/);
  p.append(late);
  assert.equal(at('late'), late);
  p.remove(late);
  assert.throws(() => at('late'), /no element with id "late"/);
  assert.equal(late.chart, null);

  // An id that is set or changed or taken away is followed.
  late.setAttribute('id', 'renamed');
  p.append(late);
  assert.equal(at('renamed'), late);
  late.setAttribute('id', 'again');
  assert.throws(() => at('renamed'), /no element/);
  assert.equal(at('again'), late);
  late.setAttribute('id', undefined);
  assert.throws(() => at('again'), /no element/);

  // Looked up from the root, the first in tree order wins, and what is first changes with the tree.
  const twin = axis('x');
  p.insertBefore(twin, x);
  assert.equal(at('x'), twin);
  p.remove(twin);
  assert.equal(at('x'), x);

  // An element moved to another chart answers for that chart.
  const other = new Chart({ theme: lightTheme, width: 100, height: 100 }, plane(axis('only-here')));
  const moving = plane(axis('m'));
  chart.append(moving);
  assert.equal(moving.chart, chart);
  assert.equal(at('m'), firstDescendantOfType(moving, Axis));
  chart.remove(moving);
  other.append(moving);
  assert.equal(moving.chart, other);
  assert.equal(firstDescendantOfType(moving, Axis)?.chart, other);
  assert.throws(() => at('m'), /no element with id "m"/);
  assert.equal(resolveRef('m', moving), firstDescendantOfType(moving, Axis));

  // A tree not yet in a chart has no chart, then has one.
  const loose = plane(axis('l'));
  assert.equal(loose.chart, null);
  assert.equal(resolveRef('l', loose), firstDescendantOfType(loose, Axis));
  const later = new Chart({ theme: lightTheme, width: 100, height: 100 });
  later.append(loose);
  assert.equal(loose.chart, later);

  // findById looks from the element it is given: itself, below it, then outwards, so the nearest of two equal ids wins.
  assert.equal(findById(p, 'y'), y);
  assert.equal(findById(p, 'nope'), undefined);
  assert.equal(findById(y, 'x'), x, 'up to the plane, then across to the sibling');
  assert.equal(findById(y, 'y'), y, 'itself');
  const near = plane(axis('x'), axis('y'));
  chart.append(near);
  const nearX = firstDescendantOfType(near, Axis) as Axis;
  assert.equal(findById(near, 'x'), nearX);
  assert.equal(findById(nearX, 'x'), nearX);
  assert.equal(findById(nearX, 'y'), near.lastChild, 'its own plane before the other');
  assert.equal(findById(chart, 'x'), x, 'from the top, tree order');
  assert.equal(findClosestOfType(nearX, CartesianPlane), near);
  assert.equal(findClosestOfType(near, Chart), chart);
  assert.equal(findClosestOfType(nearX, Axis), nearX);
  chart.remove(near);
  // The links run both ways, so a child can come out of or go into any place.
  const row = plane(axis('1'), axis('2'), axis('3'));
  const [one, two, three] = [row.firstChild as Axis, row.firstChild!.nextSibling as Axis, row.lastChild as Axis];
  assert.equal(three.previousSibling, two);
  assert.equal(one.previousSibling, null);
  row.remove(two);
  assert.equal(one.nextSibling, three);
  assert.equal(three.previousSibling, one);
  row.remove(three);
  assert.equal(row.lastChild, one);
  row.insertBefore(two, one);
  row.append(three);
  assert.deepEqual(
    [...row].map((e) => e.attrs.id),
    ['2', '1', '3'],
  );
  assert.equal(row.lastChild, three);
  assert.equal(row.firstChild?.previousSibling, null);
  assert.throws(() => row.insertBefore(axis('z'), x), /not a child/);
  const order: string[] = [];
  walk(chart, (e) => void order.push(e.constructor.name));
  assert.deepEqual(order.slice(0, 3), ['Chart', 'CartesianPlane', 'Axis']);
  assert.equal(firstDescendantOfType(chart, Axis), x);
  assert.equal(descendantsOfType(chart, Axis).length, 3, 'x, y and the one put back');
  // A visitor may take the element it is on out of the tree.
  const doomed = plane(axis('a'), axis('b'), axis('c'));
  const seen: string[] = [];
  walk(doomed, (e) => {
    if (e instanceof Axis) {
      seen.push(String(e.attrs.id));
      doomed.remove(e);
    }
  });
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('element: a tree cannot be made into a loop, and removing what is not a child changes nothing', () => {
  const x = new Axis({}, new LinearScale()),
    y = new Axis({ orientation: 'left' }, new LinearScale());
  const a = new CartesianPlane({}, x, y),
    b = new CartesianPlane({}, new Axis({}, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()));
  const chart = new Chart({ theme: lightTheme, width: 200, height: 100 }, a);
  assert.throws(() => a.append(a as never), /inside itself/);
  assert.throws(() => a.append(chart as never), /inside itself/);
  assert.throws(() => b.append(b as never), /inside itself/, 'a loose element too');
  // `b` is in no tree; removing one of a's own children from it must not unmount the child from `a`.
  const child = x;
  assert.throws(() => b.remove(child), /not a child/);
  chart.attach(new StringPlatform({ width: 200, height: 100 })).flush();
  assert.equal(child.parent, a, 'still where it was');
  assert.doesNotThrow(() => chart.flush());
});

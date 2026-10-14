// Attributes: hyphenated names nest, conflicts throw, and every element class' attribute types are sound.
import assert from 'node:assert/strict';
import { AUTO, BOOLEAN, NUMBER, STRING, expandAttributes } from './attrs.ts';
import { Axis, CartesianPlane, DomainSeries, LinearScale } from './index.ts';
import { registry } from './registry.ts';
import { test } from 'vite-plus/test';

test('attrs', () => {
  // Nesting by hyphens, at any depth, next to plain names.
  assert.deepEqual(expandAttributes({ min: 0, 'meta-title': 'Sales', 'meta-aria-roledescription': 'x', 'style-tickLabel-size': 9 }), {
    min: 0,
    meta: { title: 'Sales', aria: { roledescription: 'x' } },
    style: { tickLabel: { size: 9 } },
  });
  assert.deepEqual(expandAttributes({}), {});

  // Several nested names share one object; an object given whole is passed through as it is.
  const meta = { title: 'whole' },
    fn = () => 1,
    arr = [1, 2];
  const out = expandAttributes({ meta, ticks: fn, include: arr, 'style-axis-color': 'red', 'style-axis-size': 8 });
  assert.equal(out.meta, meta);
  assert.equal(out.ticks, fn);
  assert.equal(out.include, arr);
  assert.deepEqual(out.style, { axis: { color: 'red', size: 8 } });
  assert.deepEqual(meta, { title: 'whole' }, "the caller's objects are never written into");

  // An object and nested names for the same key, in either order, and a value and a longer path.
  assert.throws(() => expandAttributes({ meta: { title: 'a' }, 'meta-description': 'b' }), /'meta-description' conflicts with 'meta'/);
  assert.throws(() => expandAttributes({ 'meta-description': 'b', meta: { title: 'a' } }), /'meta' conflicts with 'meta-…'/);
  assert.throws(() => expandAttributes({ 'a-b': 1, 'a-b-c': 2 }), /'a-b-c' conflicts with 'a-b'/);
  assert.throws(() => expandAttributes({ 'a-b-c': 2, 'a-b': 1 }), /'a-b' conflicts/);
  assert.throws(() => expandAttributes({ meta: 'x', 'meta-title': 'y' }), /conflicts with 'meta'/);

  // `undefined` means not set: it never conflicts, and it does not hide a value given the other way.
  assert.deepEqual(expandAttributes({ meta: undefined, 'meta-title': 'a' }), { meta: { title: 'a' } });
  assert.deepEqual(expandAttributes({ 'meta-title': 'a', meta: undefined }), { meta: { title: 'a' } });
  assert.deepEqual(expandAttributes({ meta: undefined }), { meta: undefined }, 'kept, so setAttributes can clear it');
  assert.ok('meta' in expandAttributes({ meta: undefined }));

  // Bad names.
  assert.throws(() => expandAttributes({ 'a--b': 1 }), /empty name part/);
  assert.throws(() => expandAttributes({ '-a': 1 }), /empty name part/);
  assert.throws(() => expandAttributes({ 'a-': 1 }), /empty name part/);
  assert.throws(() => expandAttributes({ '__proto__-x': 1 }), /not allowed/);
  assert.throws(() => expandAttributes(JSON.parse('{"x-__proto__":1}')), /not allowed/);
  assert.equal(({} as Record<string, unknown>).x, undefined, 'nothing leaked onto Object.prototype');
  // Names that exist on every object are ordinary names.
  assert.deepEqual(expandAttributes({ 'constructor-toString': 1 }), { constructor: { toString: 1 } });

  // The hooks: names are resolved per part with the parts above them, values per full path.
  const seen: string[] = [];
  const hooked = expandAttributes(
    { 'style-ticklabel-strokewidth': '2', title: 'T' },
    {
      name: (part, parents) => {
        seen.push(`${parents.join('.')}|${part}`);
        return ({ ticklabel: 'tickLabel', strokewidth: 'strokeWidth' } as Record<string, string>)[part] ?? part;
      },
      value: (path, v) => (path.join('.') === 'style.tickLabel.strokeWidth' ? Number(v) : v),
    },
  );
  assert.deepEqual(hooked, { style: { tickLabel: { strokeWidth: 2 } }, title: 'T' });
  assert.deepEqual(seen, ['|style', 'style|ticklabel', 'style.tickLabel|strokewidth', '|title']);

  // It feeds setAttributes: nested names reach the element as the object they stand for.
  const axis = new Axis({}, new LinearScale());
  axis.setAttributes(expandAttributes({ 'meta-title': 'Time', min: 0 }));
  assert.deepEqual(axis.getAttribute('meta'), { title: 'Time' });
  assert.equal(axis.getAttribute('min'), 0);

  // Every class' attribute types are inherited, well formed, and name nothing twice apart from the case.
  const kinds = new Set([AUTO, STRING, NUMBER, BOOLEAN]);
  for (const [name, cls] of Object.entries(registry)) {
    const types = (cls as unknown as { attrTypes?: Record<string, number> }).attrTypes;
    assert.ok(types, `${name} has attrTypes`);
    assert.equal(types.id, STRING, `${name} inherits the base attributes`);
    const walk = (spec: Record<string, unknown>, where: string): void => {
      const lower = new Map<string, string>();
      for (const [k, v] of Object.entries(spec)) {
        if (typeof v === 'object' && v !== null) walk(v as Record<string, unknown>, `${where}.${k}`);
        else assert.ok(kinds.has(v as 0), `${where}.${k} is a coercion`);
        const clash = lower.get(k.toLowerCase());
        assert.ok(!clash || clash === k, `${where}: '${k}' and '${clash}' differ only in case`);
        lower.set(k.toLowerCase(), k);
      }
    };
    walk(types, name);
  }
  // Spot checks of what the types say.
  const types = (c: unknown) => (c as { attrTypes: Record<string, number> }).attrTypes;
  assert.equal(types(Axis).tickCount, NUMBER);
  assert.equal(types(Axis).title, STRING, 'a title that is only digits must stay text');
  assert.equal(types(Axis).crossesAt, NUMBER, 'inherits and adds');
  assert.equal(types(DomainSeries).name, STRING);
  assert.equal(types(CartesianPlane).id, STRING);
  const nested = (c: unknown, ...path: string[]) =>
    path.reduce<Record<string, unknown>>(
      (o, p) => o[p] as Record<string, unknown>,
      (c as { attrTypes: Record<string, unknown> }).attrTypes,
    );
  assert.equal(nested(Axis, 'meta', 'title'), STRING, 'nested parts are listed too');
  assert.equal(nested(Axis, 'meta', 'role'), STRING);
  console.log('attrs ok');
});

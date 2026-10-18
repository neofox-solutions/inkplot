// StringPlatform: the node tree, attribute writes, text escaping and text measurement. (DOMPlatform runs in playground.test.mjs.)
import assert from 'node:assert/strict';
import { StringPlatform, estimateTextWidth } from './index.ts';
import { test } from 'vite-plus/test';

test('platform', () => {
  const p = new StringPlatform({ width: 200, height: 100 });
  assert.deepEqual(p.size(), { width: 200, height: 100 });
  const g = p.createNode('g');
  const label = p.createNode('text');
  p.insertBefore(p.root, g, null);
  p.insertBefore(g, label, null);
  p.setAttribute(label, 'x', 5);
  p.setText(label, 'a < b & "c"');
  const svg = p.toString();
  assert.match(svg, /<g>/);
  assert.match(svg, /x="5"/);
  assert.match(svg, /a &lt; b &amp; "c"|a &lt; b &amp; &quot;c&quot;/, 'text is escaped');

  // Order follows insertBefore, and removal leaves nothing behind.
  const first = p.createNode('path'),
    second = p.createNode('path');
  p.setAttribute(first, 'id', 'one');
  p.setAttribute(second, 'id', 'two');
  p.insertBefore(g, second, null);
  p.insertBefore(g, first, second);
  assert(p.toString().indexOf('id="one"') < p.toString().indexOf('id="two"'));
  p.remove(first);
  assert(!p.toString().includes('id="one"'));

  // The text estimate grows with length and font size, which is all layout needs from it.
  const font = { family: 'sans-serif', size: 10 };
  assert(estimateTextWidth('wwww', font).width > estimateTextWidth('ww', font).width);
  assert(estimateTextWidth('ww', { ...font, size: 20 }).width > estimateTextWidth('ww', font).width);
});

test('StringPlatform: an attribute name that is not a name is refused, and characters XML cannot hold are replaced', () => {
  const p = new StringPlatform({ width: 200, height: 100 });
  const node = p.createNode('text');
  p.insertBefore(p.root, node, null);
  for (const bad of ['x" onload="alert(1)', 'a b', '', '1x', 'a>b'])
    assert.throws(() => p.setAttribute(node, bad, '1'), /not an attribute name/, JSON.stringify(bad));
  p.setAttribute(node, 'aria-label', 'a\u0001b\u000bc\td');
  p.setText(node, 'x\u0000y\nz');
  const out = p.toString();
  assert.ok(out.includes('aria-label="a�b�c\td"'), out);
  assert.ok(out.includes('>x�y\nz</text>'), out);
  for (let c = 0; c < 32; c++)
    if (c !== 9 && c !== 10 && c !== 13) assert.ok(!out.includes(String.fromCharCode(c)), `character ${c} does not survive`);
});

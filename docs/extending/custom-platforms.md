# Custom platforms

A **platform** is everything the library needs from the outside world. The element tree only talks to its `Surface`, and a surface only talks to a `Platform`, so the core never mentions `document` or `window`. That is why the same chart renders in a browser (`DOMPlatform`), in Node or a serverless function (`StringPlatform`), and in tests. Writing your own is how you render somewhere else (a canvas, a native view, a PDF) or give an existing platform better text metrics, scheduling or input.

## The interface

Only the first group is required. A platform with nothing to observe leaves the rest out.

**Required: a place to put SVG nodes**

| Member | Does |
|---|---|
| `name` | A label, e.g. `'dom'` or `'string'`. |
| `root` | The node the chart draws into (an `svg`). |
| `size()` | The drawing area in CSS pixels. |
| `createNode(tag)` | A new node for an SVG tag (`svg`, `g`, `path`, `rect`, `line`, `circle`, `text`, `clipPath`, `defs`, `title`, `desc`, `linearGradient`, `stop`). |
| `setAttribute(node, name, value)` | Sets an attribute. The surface only calls it when the value changed. |
| `setText(node, text)` | Sets a text node's content. |
| `insertBefore(parent, node, before)` | **Exactly `Node.insertBefore`**: `before` is a child of `parent`, or `null` to append; a node already placed is moved. |
| `remove(node)` | Takes the node, and everything in it, out of whatever holds it. |
| `dispose()` | Releases whatever the platform holds. |

**Optional: time, text and input**

| Member | Does |
|---|---|
| `schedule(callback)` | Present: the chart flushes itself after a change, when you call the callback. Returns an `Unsubscribe`. Absent: the caller calls `chart.flush()`. |
| `measureText(text, font)` | Returns `{ width, height }` for text. Absent: a built-in estimate that errs wide. |
| `onResize(callback)` | Calls back with the new `Size`; returns an `Unsubscribe`. |
| `onPointer(callback)` | Feeds `RawPointer`s (`kind`: `move`, `down`, `up`, `leave`, `wheel`; `x`, `y` relative to `root`; `buttons`, `deltaY`, modifiers). The callback returns `true` when the chart used the input, and then the platform withholds the browser's own handling (page scroll on a wheel turn). |
| `onKey(callback)` | Feeds `RawKey`s for keys pressed while one of the chart's nodes has focus: `callback(key, node)`. `true` means the chart used the key. |
| `onFocus(callback)` | Feeds `RawFocus` (`node`, `focused`, `visible`: whether a ring is wanted, the browser's `:focus-visible`). |
| `focus(node)` | Moves focus to a node that has a `tabindex`. |
| `announce(text)` | Says something to a screen reader without showing it, politely. |
| `setCursor(cursor)` | The mouse cursor over the chart, as a CSS cursor name; `''` for the default. |

Everything the chart gets from the outside is one of these, in one normalised shape, so no element needs to know whether a pointer came from a mouse, a pen, a finger or a test.

## Extend before you write

Most needs are a small change to an existing platform. `StringPlatform` is a plain class, and subclassing it is the simplest way to a headless platform with what your environment has:

```ts check title="A server platform with real font metrics"
import { StringPlatform } from 'inkplot';
import type { FontSpec, Size } from 'inkplot';

// Widths of a font you know, per character, from its metrics file (here, a crude table).
const NARROW = new Set('il1.,:;\'|!');
const WIDE = new Set('mwMW@%');

function measure(text: string, font: FontSpec): Size {
  let em = 0;
  for (const ch of text) em += NARROW.has(ch) ? 0.28 : WIDE.has(ch) ? 0.85 : ch === ' ' ? 0.3 : 0.55;
  return { width: em * font.size, height: font.size * 1.2 };
}

export class MeasuredPlatform extends StringPlatform {
  measureText = measure;
  readonly spoken: string[] = [];
  announce(text: string): void { this.spoken.push(text); }
}
```

Attach it as any platform: `chart.attach(new MeasuredPlatform({ width: 600, height: 300 })).flush()`, then `platform.toString()`. (For a font that every chart in a program shares, the `Chart`'s own `measureText` attribute does the same without a class.)

A test platform that can be resized, poked with pointer and key input, and flushed on demand is also just a subclass; the library's own tests use one. The pieces to add are:

```ts check title="A platform that tests can drive"
import { StringPlatform } from 'inkplot';
import type { PlatformNode, RawKey, RawPointer, Size, Unsubscribe } from 'inkplot';

export class TestPlatform extends StringPlatform {
  current: Size;
  pointer: ((p: RawPointer) => boolean | void) | null = null;
  keys: ((k: RawKey, node: PlatformNode) => boolean | void) | null = null;
  pending: (() => void) | null = null;

  constructor(size: Size) { super(size); this.current = size; }
  override size(): Size { return this.current; }

  // Flushing is the test's decision: nothing happens until runScheduled().
  schedule = (callback: () => void): Unsubscribe => { this.pending = callback; return () => { this.pending = null; }; };
  runScheduled(): void { const cb = this.pending; this.pending = null; cb?.(); }

  onPointer = (callback: (p: RawPointer) => boolean | void): Unsubscribe => { this.pointer = callback; return () => { this.pointer = null; }; };
  onKey = (callback: (k: RawKey, node: PlatformNode) => boolean | void): Unsubscribe => { this.keys = callback; return () => { this.keys = null; }; };

  /** Move the pointer to (x, y) in the chart's pixels and flush. */
  move(x: number, y: number): void {
    this.pointer?.({ kind: 'move', x, y, buttons: 0, deltaY: 0, shift: false, ctrl: false });
    this.runScheduled();
  }
}
```

## A platform of your own

To draw somewhere that is not SVG text or a DOM, implement the required group so that it records or paints what the chart makes. The chart is a retained scene: it creates nodes once and then changes only the attributes that change, so a platform can keep its own object per node and update it in place.

The practical outline, for a canvas platform:

1. **Nodes.** `createNode(tag)` returns your own object (kept as an opaque `PlatformNode`) with the tag, an attribute map, a text value, and its children. `insertBefore` and `remove` keep the child lists.
2. **Dirtiness.** `setAttribute` and `setText` store the value and mark the platform dirty; `schedule` (or your own loop) repaints.
3. **Painting.** Walk the tree from `root` and draw each node by its tag and attributes: `path` takes SVG path data in `d` (so you need an SVG path parser or `Path2D`), plus `fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `opacity`, `fill-opacity`, `transform` (translate only), `clip-path`, and `display`; `text` takes `x`, `y`, `text-anchor`, `font-*` and `fill`; groups carry `transform` and `clip-path`; `clipPath` elements hold the shapes that clips refer to by id.
4. **Input.** Translate your toolkit's pointer events into `RawPointer` (relative to `root`) and report them through `onPointer`, and keys through `onKey`. Hit testing is done by the chart itself, from the data, so you do not need to map events to nodes.
5. **Text.** Provide `measureText` using the toolkit's own metrics: layout depends on it.

The element tree and the surface are untouched, which is the point: charts you have already written draw on the new platform.

Two things to know about what the SVG contains:

- **Presentation attributes only.** The output uses attributes (`stroke`, `fill`, `font-size`), never classes or a stylesheet, so a platform need not understand CSS.
- **Accessibility attributes** (`role`, `aria-*`, `tabindex`) are ordinary attributes on nodes. A platform that has an accessibility tree can map them; one that does not can ignore them, but then should provide `announce`.

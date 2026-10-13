# Serialization

A chart is a tree of elements whose attributes are plain data and whose children are ordered, so it maps directly to JSON: `{ type, attrs, children }`. The same format is what lets a saved chart, a config-driven page, an editor, and the framework adapters share one description.

```ts
interface ElementJSON { type: string; attrs?: Record<string, unknown>; children?: ElementJSON[] }
```

Three functions do the work:

| Function | Does |
|---|---|
| `toJSON(element, registry, options?)` | Writes a tree as JSON (ready for `JSON.stringify`). |
| `fromJSON(json, registry, options?)` | Builds a new, unattached tree. |
| `applyJSON(element, json, registry, options?)` | Changes a live tree to match edited JSON, in place. |

## A chart from JSON

```tsx live title="Building a chart from a JSON description" height=260
import { Refs, fromJSON, lightTheme, registry } from 'inkplot';
import type { Chart, ElementJSON } from 'inkplot';

const description: ElementJSON = {
  type: 'Chart',
  attrs: { theme: { $ref: 'lightTheme' }, meta: { title: 'From JSON' } },
  children: [{
    type: 'CartesianPlane',
    children: [
      { type: 'Axis', attrs: { orientation: 'bottom' }, children: [{ type: 'LinearScale' }] },
      { type: 'Axis', attrs: { orientation: 'left' }, children: [{ type: 'LinearScale' }] },
      {
        type: 'DomainSeries',
        attrs: { name: 'Load' },
        children: [
          { type: 'FlatDataSource', attrs: { data: [3, 5, 4, 8, 6, 9], regularDomain: { start: 0, step: 1 } } },
          { type: 'LinePath', children: [{ type: 'LinearCurve' }] },
        ],
      },
    ],
  }],
};

export default () => fromJSON<Chart>(description, registry, { refs: new Refs({ lightTheme }) });
```

A `type` is the name a class is registered under. `registry` lists every class the library ships, under its own name (`LinePath`, `CartesianPlane`…).

> **Bundle cost.** `registry` names every class, so importing it brings the whole library into a bundle. It is for tools and configuration-driven pages. A page that builds its charts in code never needs it.

## Writing a chart

```ts check title="Saving a chart" 
import { Refs, lightTheme, registry, toJSON } from 'inkplot';
import type { Chart } from 'inkplot';

export function save(chart: Chart): string {
  const refs = new Refs({ lightTheme });
  return JSON.stringify(toJSON(chart, registry, { refs }));
}
```

## What an attribute may hold

| Value | Written as |
|---|---|
| Strings, booleans, finite numbers, arrays, plain objects (`style`, `meta`, bindings) | As they are. |
| `NaN`, `Infinity` | `{ "$number": "NaN" }` |
| A typed array | `{ "$typed": "Float64Array", "data": [...] }`, with `null` for NaN, so gaps survive. |
| An element (an attribute that refers to another by id) | Its `id`, so it must have one. |
| Code (`format`, `onClick`), big or live data, a theme | `{ "$ref": "name" }`, found in the `Refs` you pass. |

## Refs

JSON cannot hold a function, and you would not want a million points inline. A **`Refs`** is a table of names for objects and functions. Writing looks values up in it by identity: a theme you named `lightTheme` is written as `{ "$ref": "lightTheme" }`. Reading needs the same table.

```ts
const refs = new Refs({ lightTheme, formatPrice, readings });
```

- With `auto: true` (`new Refs({}, { auto: true })`) it names what it is asked about and does not know, after the attribute (`onFlush`, `format2`…), so any chart can be written. Without it, an unnamed function is an error that says what to name.
- Arrays longer than `inlineLimit` (default 1000) count as data and go by reference too. That is the line between a chart's configuration and its data.
- Only objects and functions can be named.

## Updating in place

`applyJSON` changes a live tree to match edited JSON. An attribute that already reads the same is left alone, so a referenced array keeps its identity and a decimator keeps its cache. One that differs is set; one that is gone is removed. Children are matched by position and type, and replaced if the type changed. It works everything out first and changes **nothing** if the JSON is unreadable, so a bad edit leaves the chart as it was. This is the call for a live editor.

```ts check title="A live editor's apply step"
import { Refs, applyJSON, lightTheme, registry } from 'inkplot';
import type { Chart, ElementJSON } from 'inkplot';

export function apply(chart: Chart, text: string): string | null {
  try {
    applyJSON(chart, JSON.parse(text) as ElementJSON, registry, { refs: new Refs({ lightTheme }) });
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
```

## Your own classes

A class of your own is one more registry entry, written under the name you give it:

```ts
const mine = { ...registry, MyScale };
```

Naming a class that is not in the registry is an error that says so, with the place in the tree. See [Custom elements](../extending/custom-elements.md#registering).

## The adapters use it

The React and Web Components adapters read attributes the same way (hyphens nest, values keep their types), so a description that works here works there. JSON is also what an AI or a tool should produce when asked for a chart: it can be validated by loading it (`fromJSON` names the element and the place on any error) without drawing anything.

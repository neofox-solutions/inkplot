# inkplot topic: editing-trees

For: changing a chart after it is built. Elements are live objects, not a spec: build once, then edit in place, and a chart that is on screen redraws what changed.

## The model

A chart is a tree of elements. Every element has `parent`, `firstChild`, `lastChild`, `previousSibling`, `nextSibling` and can be iterated (`for (const child of plane)`). Its methods are the DOM's:

| Method | Does |
|---|---|
| `parent.append(...nodes)` / `prepend(...nodes)` | add at the end / the start |
| `el.before(...nodes)` / `el.after(...nodes)` | add beside `el`, in its parent |
| `el.remove()` | take `el` itself out (nothing happens if it has no parent) |
| `el.replaceWith(...nodes)` | put `nodes` where `el` was; with none, it just goes |
| `el.setAttribute(name, value)` / `setAttributes({...})` | change an attribute (set a new object; do not mutate one) |

Each takes any number of elements, so one or many work alike. An element that already has a parent is an error (`remove()` it first): nothing is moved silently.

## Fixed and variadic children

Fixed children (an axis' scale, a series' data) are always there. Swap one with `replaceWith` or `parent.setChild(0, new LogScale())`; they cannot be removed. Variadic children (a plane's axes and series, a series' renderers) come and go freely.

Read a fixed child with `child(index, Class)`. It checks the class and gives the type of that class (several classes give the union). Outside the element you may write `child(0)` for the declared type with no check.

```ts
// `axis` and `series` are elements you made, or found with findById(chart, 'time')
axis.child(0, LinearScale).replaceWith(new LogScale()); // swap the scale
series.before(new DomainSeries({ name: 'new' }, data, new LinePath({}, new LinearCurve())));
series.remove();
series.setAttribute('visible', false);
```

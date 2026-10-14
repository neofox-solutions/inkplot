/**
 * A JSX runtime for building charts as element trees: use it with `jsxImportSource` and write
 *
 *     /** @jsxImportSource inkplot *\/
 *     const chart = (
 *       <Chart theme={lightTheme}>
 *         <CartesianPlane>
 *           <Axis meta-title="Time"><LinearScale /></Axis>
 *           <DomainSeries><ObjectDataSource source={rows} domain="t" value="v" /><LinePath><LinearCurve /></LinePath></DomainSeries>
 *         </CartesianPlane>
 *       </Chart>
 *     );
 *
 * Every tag makes the element at once, so the result is the same `Chart` you would have written with `new`, and can
 * be attached to a platform, serialized, or handed to the React adapter. Runtimes can be mixed per file.
 *
 * - Attribute names with hyphens are nested: `meta-title="x"` is `meta={{ title: 'x' }}` (see attrs.ts).
 * - Children go to the constructor in order. A parent's fixed children (an axis' scale, a series' data) come first and in
 *   the order its documentation gives; they cannot be checked by the types, because JSX does not type children one by one.
 *   `null`, `undefined` and `false` (a skipped `{cond && <X />}`) are dropped, so a fixed child cannot be skipped.
 * - `ref` receives the element (a function, or an object with `current`), to keep hold of it.
 * - A function can stand in for a tag to make a reusable piece: it is called with the props, `children` included, and returns an element.
 * - The text of a tag (`<ChartTitle>Sales</ChartTitle>`) is not supported: write `text="Sales"`.
 */
import { type AnyArgs, type AnyElement, ChartElement } from './element.ts';
import { type JsxRef, expandAttributes } from './attrs.ts';

type Props = Record<string, unknown>;
type ElementConstructor = abstract new (...args: AnyArgs) => AnyElement;
/** A tag: a chart element class, or a function making an element (or several, as a fragment). */
export type JsxType = ElementConstructor | ((props: never) => AnyElement | readonly AnyElement[]);

function flatten(children: unknown, into: AnyElement[], tag: string): AnyElement[] {
  if (children == null || children === false) return into;
  if (Array.isArray(children)) {
    for (const c of children) flatten(c, into, tag);
  } else if (children instanceof ChartElement) {
    into.push(children);
  } else {
    throw new TypeError(
      `<${tag}>: a child must be a chart element, not ${typeof children === 'object' ? 'an object' : `${typeof children} ${JSON.stringify(children)}`}`,
    );
  }
  return into;
}

const nameOf = (type: JsxType) => type.name || 'anonymous';

/** The JSX factory: one call per tag, with the children already made. `key` has no meaning for a retained tree and is ignored. */
export function jsx(type: JsxType, props: Props, _key?: unknown): AnyElement {
  const { children, ref, ...rest } = props;
  const tag = nameOf(type);
  let element: AnyElement;
  const isClass = type.prototype instanceof ChartElement;
  if (isClass) {
    const attrs = expandAttributes(rest);
    for (const k of Object.keys(attrs)) if (attrs[k] === undefined) delete attrs[k];
    // oxlint-disable-next-line typescript/consistent-type-assertions -- JSX tags are either classes or function components: a class is told apart by `isClass` above
    element = new (type as new (...args: unknown[]) => AnyElement)(attrs, ...flatten(children, [], tag));
  } else {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- JSX tags are either classes or function components: a function is told apart by `isClass` above
    const made = (type as (props: Props) => AnyElement)(children === undefined ? rest : { ...rest, children });
    // A list (a fragment, or a function returning several elements) is passed on as it is; the parent flattens it.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- a function component may return an array of elements, which `flatten` turns into one element
    if (Array.isArray(made)) element = flatten(made, [], tag) as unknown as AnyElement;
    else if (made instanceof ChartElement) element = made;
    else throw new TypeError(`<${tag}>: a function used as a tag must return a chart element`);
  }
  if (typeof ref === 'function') ref(element);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a `ref` is an object with `current`, or a callback, which is handled on the line above
  else if (ref) (ref as { current: unknown }).current = element;
  return element;
}
/** Several children given as a list of literals rather than written out: the same as `jsx`. */
export const jsxs = jsx;

/** `<>…</>`: the children, so that a function tag or a parent can take several elements at once. */
export function Fragment(props: { children?: unknown }): AnyElement[] {
  return flatten(props.children, [], 'Fragment');
}

// A fragment's elements are spliced into the parent that receives them, so `Fragment` (and any function tag that returns
// a list) makes a list although the types say an element: TypeScript has no way to say "one or more" for a JSX tag.

/** The types TypeScript reads to check JSX. A tag is a chart element class; `$props` on it says what it takes. */
export declare namespace JSX {
  type Element = AnyElement;
  interface ElementClass extends AnyElement {}
  interface ElementAttributesProperty {
    $props: {};
  }
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicElements {}
  interface IntrinsicAttributes {
    key?: string | number | null;
  }
  interface IntrinsicClassAttributes<T> {
    ref?: JsxRef<T>;
  }
}

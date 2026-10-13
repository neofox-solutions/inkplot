/**
 * The React adapter: a chart written as React components, drawing through the same element tree as any other chart.
 *
 *     import { Chart, CartesianPlane, Axis, LinearScale } from 'inkplot/react';
 *     import { lightTheme } from 'inkplot';
 *
 *     <Chart theme={lightTheme} hostProps={{ style: { height: 300 } }}>
 *       <CartesianPlane>
 *         <Axis meta-title="Time"><LinearScale /></Axis>
 *         …
 *
 * Every concrete element class has a component of the same name, exported from here. Each is made by a call marked pure,
 * so a bundler keeps only the ones you use, and the classes behind the rest stay out. For a class of your own, make
 * its component with `reactWrapper(MyClass)`. The one with no wrapper above it is the root: it
 * renders a `<div>` and attaches the chart to it (`hostProps` are that div's props, `platformOptions` the DOMPlatform's).
 *
 * How the two trees stay one:
 * - Every wrapper instance owns one element, made on its first render and never swapped. React decides which instance is
 *   which (by position and key), so a reorder moves instances and a changed tag type makes a new one.
 * - Rendering only collects. Each wrapper, as it renders, adds its element to the list its parent started. Nothing in the
 *   element tree is touched until React commits: then each wrapper links its element into its parent's, puts the
 *   parent's children in the order the list says, and writes the attributes that differ. So an abandoned render (Strict
 *   Mode, an interrupted transition) changes nothing, and unchanged attributes cost a comparison.
 * - Attributes come from props (`meta-title`, `style-axis-color` nest as in attrs.ts). Plain objects and arrays are compared by content, so
 *   `meta={{ title }}` written in a render does not invalidate the chart each time. Functions are compared by identity: memoize them.
 *
 * Limits, which follow from the element tree having no idea where React put things:
 * - A chart element that appears through state in a component *between* chart elements joins its parent in the right
 *   place only if the parent renders too; otherwise it goes last. Keep the condition in the component that renders the parent.
 * - Do not wrap a component that renders chart elements in `React.memo`, or hand chart elements down as `children` through a
 *   component that re-renders by itself: a child that does not render is not in the list, so it cannot be reordered (it stays where it is).
 * - Fixed children (an axis' scale) come first in the order the class' documentation gives; the order is not type-checked.
 */
import { type ForwardRefExoticComponent, type HTMLAttributes, type PropsWithoutRef, type ReactElement, type ReactNode, type RefAttributes, createContext, createElement, forwardRef, useContext, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { NestedProps } from './attrs.ts';
import { attributesOf, difference } from './adapt.ts';
import { DOMPlatform, type DOMPlatformOptions } from './dom-platform.ts';
import type { AnyArgs, AnyElement } from './element.ts';
import type { Chart as ChartElement } from './chart.ts';
import * as annotation_ from './annotation.ts';
import * as boxplot_ from './boxplot.ts';
import * as boxzoom_ from './boxzoom.ts';
import * as brush_ from './brush.ts';
import * as axis_ from './axis.ts';
import * as bars_ from './bars.ts';
import * as chart_ from './chart.ts';
import * as crosshair_ from './crosshair.ts';
import * as errors_ from './errors.ts';
import * as cursor_ from './cursor.ts';
import * as curve_ from './curve.ts';
import * as curves_ from './curves.ts';
import * as decimation_ from './decimation.ts';
import * as furniture_ from './furniture.ts';
import * as key_ from './key.ts';
import * as legend_ from './legend.ts';
import * as mapped_ from './mapped.ts';
import * as trend_ from './trend.ts';
import * as heatmap_ from './heatmap.ts';
import * as marker_ from './marker.ts';
import * as panzoom_ from './panzoom.ts';
import * as plane_ from './plane.ts';
import * as pointer_ from './pointer.ts';
import * as radial_ from './radial.ts';
import * as renderer_ from './renderer.ts';
import * as scales_ from './scales.ts';
import * as series_ from './series.ts';
import * as sources_ from './sources.ts';
import * as stack_ from './stack.ts';
import * as density_ from './density.ts';
import * as stats_ from './stats.ts';
import * as steps_ from './steps.ts';
import * as summary_ from './summary.ts';
import * as time_intl_ from './time-intl.ts';
import * as time_temporal_ from './time-temporal.ts';

type Plain = Record<string, unknown>;
type ElementConstructor = new (...args: AnyArgs) => AnyElement;

/** What a root wrapper takes besides the element's attributes. */
export interface RootProps {
  /** Props for the `<div>` the chart is drawn in. Give it a size: the chart fills it. */
  hostProps?: HTMLAttributes<HTMLDivElement>;
  platformOptions?: DOMPlatformOptions;
}
/** The props of a wrapped class: its attributes, children, and for a root (anything with `attach`) the host's props. */
export type WrapperProps<C extends ElementConstructor> =
  Omit<InstanceType<C>['$props'], 'children'> & NestedProps & { children?: ReactNode } & (InstanceType<C> extends { attach: unknown } ? RootProps : unknown);

/** What a wrapper tells the wrappers below it: where their elements go, and the list they report to as they render. */
interface Parent {
  element: AnyElement;
  /** The elements of the children that rendered in the parent's current render, in order (a Set: Strict Mode renders twice). */
  list: Set<AnyElement>;
  /** The children linked into the element now. */
  mounted: Set<AnyElement>;
}
const ParentContext = createContext<Parent | null>(null);

/** Put `element` among the parent's children before the first later sibling in the render list that is already there. */
function place(parent: Parent, element: AnyElement): void {
  let found = false;
  for (const other of parent.list) {
    if (found && other.parent === parent.element) { parent.element.insertBefore(element, other); return; }
    if (other === element) found = true;
  }
  parent.element.append(element);
}

/**
 * Bring a parent's children into the order its render listed them. Only when every child linked now was in the list: a child
 * that did not render this time (memoized, say) is not in it, and nothing is known about where it belongs.
 */
function reorder(self: Parent): void {
  if (self.list.size !== self.mounted.size) return;
  let at = self.element.firstChild;
  for (const child of self.list) {
    if (child === at) { at = at.nextSibling; continue; }
    if (child.parent === self.element) self.element.remove(child);
    self.element.insertBefore(child, at);
  }
}

/** Attach `chart` to a div and release it again; used by the root wrapper and by `ChartView`. */
function useAttached(chart: AnyElement, hostRef: { current: HTMLDivElement | null }, options: DOMPlatformOptions | undefined): void {
  const size = options?.size;
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const platform = new DOMPlatform(host, options);
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the ref holds a chart element, which a React ref cannot be typed as
    (chart as ChartElement).attach(platform);
    return () => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- the ref holds a chart element, which a React ref cannot be typed as
      (chart as ChartElement).detach();
      platform.dispose();
    };
    // The platform is made again only for a change that needs a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, size?.width, size?.height, options?.preciseText, options?.schedule]);
}

/** The host div's props: it fills what it is in unless told otherwise. */
const hostPropsOf = (props: HTMLAttributes<HTMLDivElement> | undefined, ref: { current: HTMLDivElement | null }) =>
  ({ ...props, ref, style: { width: '100%', height: '100%', ...props?.style } });

/**
 * A React component for a chart element class. Its props are the element's attributes (hyphenated names nest) and its
 * children are the element's children. A `ref` receives the element. See the notes at the top of this file.
 */
export function reactWrapper<C extends ElementConstructor>(cls: C): ForwardRefExoticComponent<PropsWithoutRef<WrapperProps<C>> & RefAttributes<InstanceType<C>>> {
  const Wrapper = forwardRef<AnyElement, Plain>((props, ref) => {
    const parent = useContext(ParentContext);
    const host = useRef<HTMLDivElement | null>(null);
    const state = useRef<{ element: AnyElement; applied: Plain; self: Parent } | null>(null);

    // oxlint-disable-next-line typescript/consistent-type-assertions -- the props of a generic component, split into the ones this wrapper owns
    const { children, hostProps, platformOptions, ...rest } = props as Plain & { children?: ReactNode; hostProps?: HTMLAttributes<HTMLDivElement>; platformOptions?: DOMPlatformOptions };
    const next = attributesOf(rest);
    if (!state.current) {
      const element = new cls(next);
      state.current = { element, applied: next, self: { element, list: new Set(), mounted: new Set() } };
    }
    const s = state.current;
    // Rendering only collects: this render's children report to the list as they render, and this element reports to its parent's.
    s.self.list.clear();
    parent?.list.add(s.element);

    useImperativeHandle(ref, () => s.element, [s.element]);
    // Committing: attributes first, then the place among the siblings, then the children's order. Children's effects ran before these.
    useLayoutEffect(() => {
      const patch = difference(s.applied, next);
      if (patch) s.element.setAttributes(patch);
      s.applied = next;
    });
    useLayoutEffect(() => {
      if (!parent) return;
      parent.mounted.add(s.element);
      place(parent, s.element);
      return () => {
        parent.mounted.delete(s.element);
        if (s.element.parent === parent.element) parent.element.remove(s.element);
      };
    }, [parent, s.element]);
    useLayoutEffect(() => reorder(s.self));
    // The root is attached last, to a tree that is complete.
    useAttached(s.element, host, parent ? undefined : platformOptions);

    const inside = createElement(ParentContext.Provider, { value: s.self }, children);
    return parent ? inside : createElement('div', hostPropsOf(hostProps, host), inside);
  });
  Wrapper.displayName = cls.name || 'Element';
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the wrapper is typed per element class by the caller's declaration
  return Wrapper as never;
}

/**
 * Shows a chart made some other way (with `new`, or with the JSX runtime) in React. The chart is attached while this is mounted
 * and detached when it is not; its attributes and children are yours to change, as the chart is not React's.
 */
export function ChartView(props: { chart: ChartElement; hostProps?: HTMLAttributes<HTMLDivElement>; platformOptions?: DOMPlatformOptions }): ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  useAttached(props.chart, host, props.platformOptions);
  return createElement('div', hostPropsOf(props.hostProps, host));
}

// ── Built-in components: one per concrete element class (the ones in `registry`). Each is a pure call, so a bundler drops the
// wrappers you do not use, and with them the classes they name. `reactWrapper` stays for classes of your own.
export const Chart = /* @__PURE__ */ reactWrapper(chart_.Chart);
export const ChartTitle = /* @__PURE__ */ reactWrapper(furniture_.ChartTitle);
export const ChartTooltip = /* @__PURE__ */ reactWrapper(furniture_.ChartTooltip);
export const ChartSummary = /* @__PURE__ */ reactWrapper(summary_.ChartSummary);
export const Cursor = /* @__PURE__ */ reactWrapper(cursor_.Cursor);
export const Crosshair = /* @__PURE__ */ reactWrapper(crosshair_.Crosshair);
export const Legend = /* @__PURE__ */ reactWrapper(legend_.Legend);
export const CartesianPlane = /* @__PURE__ */ reactWrapper(plane_.CartesianPlane);
export const PolarPlane = /* @__PURE__ */ reactWrapper(radial_.PolarPlane);
export const RadarPlane = /* @__PURE__ */ reactWrapper(radial_.RadarPlane);
export const Axis = /* @__PURE__ */ reactWrapper(axis_.Axis);
export const ColorAxis = /* @__PURE__ */ reactWrapper(mapped_.ColorAxis);
export const SizeAxis = /* @__PURE__ */ reactWrapper(mapped_.SizeAxis);
export const ColorKey = /* @__PURE__ */ reactWrapper(key_.ColorKey);
export const SizeKey = /* @__PURE__ */ reactWrapper(key_.SizeKey);
export const LinearScale = /* @__PURE__ */ reactWrapper(scales_.LinearScale);
export const LogScale = /* @__PURE__ */ reactWrapper(scales_.LogScale);
export const SqrtScale = /* @__PURE__ */ reactWrapper(scales_.SqrtScale);
export const BandScale = /* @__PURE__ */ reactWrapper(scales_.BandScale);
export const IntlTimeScale = /* @__PURE__ */ reactWrapper(time_intl_.IntlTimeScale);
export const TemporalTimeScale = /* @__PURE__ */ reactWrapper(time_temporal_.TemporalTimeScale);
export const DomainSeries = /* @__PURE__ */ reactWrapper(series_.DomainSeries);
export const XYSeries = /* @__PURE__ */ reactWrapper(series_.XYSeries);
export const Stack = /* @__PURE__ */ reactWrapper(stack_.Stack);
export const FlatDataSource = /* @__PURE__ */ reactWrapper(sources_.FlatDataSource);
export const ObjectDataSource = /* @__PURE__ */ reactWrapper(sources_.ObjectDataSource);
export const CompositeDataSource = /* @__PURE__ */ reactWrapper(sources_.CompositeDataSource);
export const SyntheticDataSource = /* @__PURE__ */ reactWrapper(sources_.SyntheticDataSource);
export const Decimator = /* @__PURE__ */ reactWrapper(decimation_.Decimator);
export const MinMaxKernel = /* @__PURE__ */ reactWrapper(decimation_.MinMaxKernel);
export const M4Kernel = /* @__PURE__ */ reactWrapper(decimation_.M4Kernel);
export const LttbKernel = /* @__PURE__ */ reactWrapper(decimation_.LttbKernel);
export const StrideKernel = /* @__PURE__ */ reactWrapper(decimation_.StrideKernel);
export const LinePath = /* @__PURE__ */ reactWrapper(renderer_.LinePath);
export const AreaPath = /* @__PURE__ */ reactWrapper(renderer_.AreaPath);
export const LinearCurve = /* @__PURE__ */ reactWrapper(curve_.LinearCurve);
export const MonotoneCurve = /* @__PURE__ */ reactWrapper(curves_.MonotoneCurve);
export const NaturalCurve = /* @__PURE__ */ reactWrapper(curves_.NaturalCurve);
export const CardinalCurve = /* @__PURE__ */ reactWrapper(curves_.CardinalCurve);
export const CatmullRomCurve = /* @__PURE__ */ reactWrapper(curves_.CatmullRomCurve);
export const BasisCurve = /* @__PURE__ */ reactWrapper(curves_.BasisCurve);
export const BumpCurve = /* @__PURE__ */ reactWrapper(curves_.BumpCurve);
export const QuadraticCurve = /* @__PURE__ */ reactWrapper(curves_.QuadraticCurve);
export const ArcCurve = /* @__PURE__ */ reactWrapper(curves_.ArcCurve);
export const StepCurve = /* @__PURE__ */ reactWrapper(steps_.StepCurve);
export const BarPath = /* @__PURE__ */ reactWrapper(bars_.BarPath);
export const BarLinePath = /* @__PURE__ */ reactWrapper(bars_.BarLinePath);
export const BoxPath = /* @__PURE__ */ reactWrapper(boxplot_.BoxPath);
export const BoxStats = /* @__PURE__ */ reactWrapper(stats_.BoxStats);
export const Density = /* @__PURE__ */ reactWrapper(density_.Density);
export const ErrorBars = /* @__PURE__ */ reactWrapper(errors_.ErrorBars);
export const ErrorBand = /* @__PURE__ */ reactWrapper(errors_.ErrorBand);
export const LinearTrend = /* @__PURE__ */ reactWrapper(trend_.LinearTrend);
export const PolynomialTrend = /* @__PURE__ */ reactWrapper(trend_.PolynomialTrend);
export const SinusoidalTrend = /* @__PURE__ */ reactWrapper(trend_.SinusoidalTrend);
export const LoessTrend = /* @__PURE__ */ reactWrapper(trend_.LoessTrend);
export const HeatMap = /* @__PURE__ */ reactWrapper(heatmap_.HeatMap);
export const DotMarker = /* @__PURE__ */ reactWrapper(marker_.DotMarker);
export const CrossMarker = /* @__PURE__ */ reactWrapper(marker_.CrossMarker);
export const PlusMarker = /* @__PURE__ */ reactWrapper(marker_.PlusMarker);
export const CircleMarker = /* @__PURE__ */ reactWrapper(marker_.CircleMarker);
export const SquareMarker = /* @__PURE__ */ reactWrapper(marker_.SquareMarker);
export const LineAnnotation = /* @__PURE__ */ reactWrapper(annotation_.LineAnnotation);
export const CalloutAnnotation = /* @__PURE__ */ reactWrapper(annotation_.CalloutAnnotation);
export const BoxZoom = /* @__PURE__ */ reactWrapper(boxzoom_.BoxZoom);
export const Brush = /* @__PURE__ */ reactWrapper(brush_.Brush);
export const PanZoom = /* @__PURE__ */ reactWrapper(panzoom_.PanZoom);
export const PointerListener = /* @__PURE__ */ reactWrapper(pointer_.PointerListener);

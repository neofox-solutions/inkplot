/** @jsxImportSource inkplot */
// The "JSX" demo: the same library, written as JSX. build-playground.ts compiles this file with the library's own JSX runtime
// (`jsxImportSource: 'inkplot'`), so every tag below is an element made at once, and the result is an ordinary Chart.
import {
  Axis,
  CartesianPlane,
  Chart,
  ChartTitle,
  DomainSeries,
  FlatDataSource,
  Legend,
  LinePath,
  LinearCurve,
  LinearScale,
  ChartSummary,
  type FlushStats,
  type BaseTheme,
} from 'inkplot';

/** What a tag's `ref` takes: a function that is given the element, or an object whose `current` is set to it. */
type Ref<E> = ((element: E) => void) | { current: E | null };

export interface WaveProps {
  name: string;
  color: string;
  data: Float64Array;
  ref?: Ref<DomainSeries>;
}
export interface JsxChartOptions {
  theme: BaseTheme;
  onFlush: (stats: FlushStats) => void;
  waves: readonly WaveProps[];
  refs: { plane: Ref<CartesianPlane>; series: Record<string, Ref<DomainSeries>> };
}

/** A reusable piece: a function used as a tag gets its props and returns an element. */
export const Wave = ({ name, color, data, ref }: WaveProps) => (
  <DomainSeries name={name} ref={ref}>
    <FlatDataSource data={data} regularDomain-start={0} regularDomain-step={0.1} />
    <LinePath stroke={color} strokeWidth={2}>
      <LinearCurve />
    </LinePath>
  </DomainSeries>
);

/** `refs` receives the elements the page wants to keep editing; a `ref` can be a function or an object with `current`. */
export function jsxChart({ theme, onFlush, waves, refs }: JsxChartOptions) {
  return (
    <Chart theme={theme} onFlush={onFlush}>
      <ChartTitle text="Written as JSX" meta-description="A chart whose tree is written with the library's own JSX runtime" />
      <CartesianPlane frame ref={refs.plane}>
        <Axis orientation="bottom" meta-title="Time (s)" style-tickLabel-size={11}>
          <LinearScale />
        </Axis>
        <Axis orientation="left" nice meta-title="Level">
          <LinearScale />
        </Axis>
        {waves.map((w) => (
          <Wave key={w.name} {...w} ref={refs.series[w.name]} />
        ))}
      </CartesianPlane>
      <Legend />
      <ChartSummary />
    </Chart>
  );
}

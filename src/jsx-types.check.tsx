/** @jsxImportSource inkplot-dev */
// Not run: compiled by `npm run check` only, to hold the types of JSX tags. A line marked `@ts-expect-error` must be an error.
import { Axis, CartesianPlane, Chart, ChartTitle, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from './index.ts';

// What is allowed.
export const ok = (
  <Chart theme={lightTheme} width={400}>
    <ChartTitle text="Sales" meta-title="Heading" />
    <CartesianPlane frame>
      <Axis orientation="bottom" min={0} meta-title="Time" meta-aria-roledescription="x axis" style-tickLabel-size={9} ref={(axis) => axis.getAttribute('min')}>
        <LinearScale />
      </Axis>
      <DomainSeries name="s" ref={{ current: null }}>
        <FlatDataSource data={[1, 2, 3]} regularDomain-start={0} regularDomain-step={1} />
        {[<LinePath key="a"><LinearCurve /></LinePath>, null]}
        {false && <LinePath><LinearCurve /></LinePath>}
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);

// What is not.
// @ts-expect-error not an attribute of an axis
export const unknown = <Axis nope={1}><LinearScale /></Axis>;
// @ts-expect-error min is a number
export const wrongType = <Axis min="0"><LinearScale /></Axis>;
// @ts-expect-error a string is not a child
export const text = <ChartTitle>Sales</ChartTitle>;
// @ts-expect-error a required attribute (the data) is missing
export const missing = <FlatDataSource />;
// (Which children a parent takes, and in what order, is checked when the tree is used, not here: TypeScript types every tag alike.)

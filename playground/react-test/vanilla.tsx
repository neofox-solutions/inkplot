/** @jsxImportSource inkplot */
// A chart written with the library's own JSX runtime, to be shown by React's ChartView: runtimes mix per file.
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme } from 'inkplot';

export const vanillaChart = (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="vanilla">
        <FlatDataSource data={[2, 4, 3, 6, 5]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath stroke="#2e9e6b"><LinearCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);

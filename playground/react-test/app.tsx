// The React adapter in a real browser: state drives a chart, and a chart made with the vanilla JSX runtime sits beside it.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as inkplot from 'inkplot';
import { ChartView, reactWrapper } from 'inkplot/react';
import { vanillaChart } from './vanilla.tsx';

const Chart = reactWrapper(inkplot.Chart),
  Plane = reactWrapper(inkplot.CartesianPlane),
  Axis = reactWrapper(inkplot.Axis);
const Linear = reactWrapper(inkplot.LinearScale),
  Log = reactWrapper(inkplot.LogScale),
  Series = reactWrapper(inkplot.DomainSeries);
const Flat = reactWrapper(inkplot.FlatDataSource),
  Line = reactWrapper(inkplot.LinePath),
  Curve = reactWrapper(inkplot.LinearCurve);
/** `vanilla.tsx` is JSX, which types as any element; this says which one it is. */
const chartOf = (element: unknown): inkplot.Chart => {
  if (!(element instanceof inkplot.Chart)) throw new Error('vanilla.tsx should make a Chart');
  return element;
};
const vanilla = chartOf(vanillaChart);
const COLORS = ['#2a6fdb', '#d9534f', '#2e9e6b', '#e0a030'];

function App() {
  const [count, setCount] = useState(2);
  const [log, setLog] = useState(false);
  const [width, setWidth] = useState(600);
  return (
    <div>
      <div id="frame" style={{ width, height: 260 }}>
        <Chart theme={inkplot.lightTheme} hostProps={{ id: 'react' }}>
          <Plane>
            <Axis orientation="bottom" meta-title="Index">
              <Linear />
            </Axis>
            <Axis orientation="left">{log ? <Log /> : <Linear />}</Axis>
            {Array.from({ length: count }, (_, i) => (
              <Series key={i} name={`series ${i}`}>
                <Flat data={[1, 10, 100, 1000].map((v) => v * (i + 1))} regularDomain-start={0} regularDomain-step={1} />
                <Line stroke={COLORS[i % COLORS.length]} strokeWidth={3}>
                  <Curve />
                </Line>
              </Series>
            ))}
          </Plane>
        </Chart>
      </div>
      <button id="add" onClick={() => setCount(count + 1)}>
        add
      </button>
      <button id="drop" onClick={() => setCount(count - 1)}>
        drop
      </button>
      <button id="log" onClick={() => setLog(!log)}>
        log
      </button>
      <button id="narrow" onClick={() => setWidth(300)}>
        narrow
      </button>
      <div style={{ width: 400, height: 200 }}>
        <ChartView chart={vanilla} hostProps={{ id: 'vanilla' }} />
      </div>
    </div>
  );
}
const app = document.getElementById('app');
if (!app) throw new Error('the page has no #app');
createRoot(app).render(<App />);

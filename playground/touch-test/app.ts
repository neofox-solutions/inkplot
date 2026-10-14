// A chart with pan and zoom on a real page, for touch.test.mjs: `#always` in the URL gives touch: 'always', `#static` leaves the pan and zoom out.
import {
  Axis,
  CartesianPlane,
  Chart,
  DOMPlatform,
  DomainSeries,
  FlatDataSource,
  LinePath,
  LinearCurve,
  LinearScale,
  PanZoom,
  lightTheme,
} from 'inkplot';

const x = new Axis({ orientation: 'bottom' }, new LinearScale());
const y = new Axis({ orientation: 'left' }, new LinearScale());
const data = Array.from({ length: 101 }, (_, i) => Math.sin(i / 8) * 10);
const chart = new Chart(
  { theme: lightTheme },
  new CartesianPlane(
    {},
    x,
    y,
    new DomainSeries(new FlatDataSource({ data, regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve())),
    ...(location.hash === '#static' ? [] : [new PanZoom({ touch: location.hash === '#always' ? 'always' : 'two-finger' })]),
  ),
);
const host = document.getElementById('host')!;
chart.attach(new DOMPlatform(host, { schedule: 'microtask' }));
Object.assign(window, { chart, xAxis: x, yAxis: y });

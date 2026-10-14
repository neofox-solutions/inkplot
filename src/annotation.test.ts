// Annotations: titles that take room at an edge, reference lines in data space on any plane, and callouts.
import { LinearCurve } from './curve.ts';
import assert from 'node:assert/strict';
import { Axis, CalloutAnnotation, CartesianPlane, Chart, ChartTitle, DomainSeries, FlatDataSource, LineAnnotation, LinePath, LinearScale, LogScale, PolarPlane, RadarPlane, StringPlatform, extendTheme, lightTheme } from './index.ts';
import { test } from 'vite-plus/test';

test("annotation", () => {
const near = (a: number, b: number, tol = 0.02) => assert(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const lin = () => new LinearScale();
const W = 400, H = 300;

function show(chart: Chart) {
  const platform = new StringPlatform({ width: W, height: H });
  chart.attach(platform).flush();
  return platform.toString();
}
/** The numbers of the first path whose d starts with `start`, as [x, y] pairs. */
function pathPoints(svg: string, nth = 0, filter = /d="(M[^"]*)"/g): [number, number][] {
  const d = [...svg.matchAll(filter)].map((m) => m[1]!)[nth] ?? '';
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!]);
  return out;
}
const textsOf = (svg: string) => [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m) => ({ attrs: m[1]!, text: m[2]! }));
const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

function cartesian(extras: (plane: CartesianPlane, x: Axis, y: Axis) => object[], chartChildren: object[] = [], themed = lightTheme) {
  const x = new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin());
  const y = new Axis({ orientation: 'left', min: 0, max: 10 }, lin());
  const series = new DomainSeries(new FlatDataSource({ data: new Float64Array(11).fill(5), regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve()));
  const plane = new CartesianPlane({}, x, y, series);
  for (const e of extras(plane, x, y)) plane.append(e as never);
  const chart = new Chart({ theme: themed, width: W, height: H }, plane, ...(chartChildren as never[]));
  return { chart, plane, x, y, series, svg: show(chart) };
}

// ── ChartTitle: a band at an edge that the plot gives way to.
{
  const bare = cartesian(() => []);
  const titled = cartesian(() => [], [new ChartTitle({ text: 'Quarterly users' })]);
  assert(titled.plane.rect.y > bare.plane.rect.y + 15, 'the plot starts below the title');
  const t = textsOf(titled.svg).find((x) => x.text === 'Quarterly users')!;
  assert.equal(attr(t.attrs, 'x'), '0', 'left-aligned by default');
  assert.match(titled.svg, /font-size="16"[^>]*font-weight="600"|font-weight="600"[^>]*font-size="16"/, 'the title role has the title look');

  // Subtitle underneath, caption at the foot; each takes room from the plot.
  const full = cartesian(() => [], [new ChartTitle({ text: 'Title' }), new ChartTitle({ text: 'Subtitle', role: 'subtitle' }), new ChartTitle({ text: 'Source: nowhere', role: 'caption' })]);
  const place = (svg: string, text: string) => {
    const before = svg.slice(0, svg.indexOf(`>${text}</text>`));
    const g = [...before.matchAll(/translate\(([-\d.]+) ([-\d.]+)\)/g)].pop()!;
    return { x: +g[1]!, y: +g[2]! };
  };
  assert(place(full.svg, 'Subtitle').y > place(full.svg, 'Title').y, 'subtitle under title');
  assert(place(full.svg, 'Source: nowhere').y > H - 30, 'caption at the bottom edge');
  assert(full.plane.rect.height < titled.plane.rect.height - 10, 'and the caption takes room too');
  assert(full.plane.rect.y > titled.plane.rect.y + 10, 'and so does the subtitle');

  // `align` is a style property: where the text sits along its band.
  const mid = cartesian(() => [], [new ChartTitle({ text: 'Centred', style: { chartTitle: { align: 'middle' } } })]);
  const centred = textsOf(mid.svg).find((x) => x.text === 'Centred')!;
  near(+attr(centred.attrs, 'x')!, (W - 20) / 2, 1);
  assert.equal(attr(centred.attrs, 'text-anchor'), undefined, 'the anchor is on the group above');
  assert.match(mid.svg, /text-anchor="middle"/);
  const end = cartesian(() => [], [new ChartTitle({ text: 'Right', style: { chartTitle: { align: 'end' } } })]);
  near(+attr(textsOf(end.svg).find((x) => x.text === 'Right')!.attrs, 'x')!, W - 20, 1);

  // Several lines are several nodes, and the band is as tall as they are.
  const two = cartesian(() => [], [new ChartTitle({ text: 'one\ntwo' })]);
  assert.deepEqual(textsOf(two.svg).map((x) => x.text).filter((x) => x === 'one' || x === 'two'), ['one', 'two']);
  assert(two.plane.rect.y > titled.plane.rect.y + 10);
  // Changing the text to one line removes the extra node.
  const chart = two.chart, title = [...chart].find((c) => c instanceof ChartTitle)!;
  title.setAttribute('text', 'one');
  chart.flush();
  assert(!(chart.platform as StringPlatform).toString().includes('>two</text>'));
}

// ── LineAnnotation on a rectangle: constant value, constant domain, and diagonal; two points when straight.
{
  const h = cartesian(() => [new LineAnnotation({ value: 2.5 })]);
  const w = h.plane.rect.width, ph = h.plane.rect.height;
  const line = pathPoints(h.svg, 0, /<path d="(M[^"]*)"[^>]*stroke-dasharray="5 3"/g);
  assert.equal(line.length, 2, 'two points');
  near(line[0]![0], 0); near(line[1]![0], w);
  near(line[0]![1], ph * 0.75); near(line[1]![1], ph * 0.75);
  assert.match(h.svg, /clip-path="url\(#clip\d+\)"/);

  const v = cartesian(() => [new LineAnnotation({ domain: 4 })]);
  const vl = pathPoints(v.svg, 0, /<path d="(M[^"]*)"[^>]*stroke-dasharray="5 3"/g);
  assert.equal(vl.length, 2);
  near(vl[0]![0], v.plane.rect.width * 0.4); near(vl[1]![0], v.plane.rect.width * 0.4);
  near(vl[0]![1], v.plane.rect.height); near(vl[1]![1], 0);

  const d = cartesian(() => [new LineAnnotation({ from: [0, 0], to: [10, 10] })]);
  const dl = pathPoints(d.svg, 0, /<path d="(M[^"]*)"[^>]*stroke-dasharray="5 3"/g);
  assert.equal(dl.length, 2, 'a diagonal between linear scales is two points');
  near(dl[0]![0], 0); near(dl[0]![1], d.plane.rect.height); near(dl[1]![0], d.plane.rect.width); near(dl[1]![1], 0);

  // On a log value axis the same diagonal is a curve, so it is traced.
  const logY = new Axis({ orientation: 'left', min: 1, max: 1000 }, new LogScale());
  const x = new Axis({ orientation: 'bottom', min: 0, max: 10 }, lin());
  const plane = new CartesianPlane({}, x, logY, new LineAnnotation({ from: [0, 1], to: [10, 1000] }));
  const curved = show(new Chart({ theme: lightTheme, width: W, height: H }, plane));
  assert(pathPoints(curved, 0, /<path d="(M[^"]*)"[^>]*stroke-dasharray="5 3"/g).length > 20, 'a diagonal on a log axis is traced');

  // Line style: stroke attributes and style blocks.
  const styled = cartesian(() => [new LineAnnotation({ value: 5, stroke: '#123456', strokeWidth: 3, style: { annotationLine: { dash: '1 1' } } })]);
  assert.match(styled.svg, /stroke="#123456" stroke-width="3" stroke-dasharray="1 1"/);

  // A label sits beside the line; `align` chooses the end of the line.
  const labels = ['start', 'middle', 'end'].map((align) => {
    const c = cartesian(() => [new LineAnnotation({ value: 8, label: 'target', style: { annotationLabel: { align: align as 'start' } } })]);
    const t = textsOf(c.svg).find((x) => x.text === 'target')!;
    return { x: +attr(t.attrs, 'x')!, y: +attr(t.attrs, 'y')!, anchor: attr(t.attrs, 'text-anchor'), w: c.plane.rect.width, h: c.plane.rect.height };
  });
  assert.deepEqual(labels.map((l) => l.anchor), ['start', 'middle', 'end']);
  assert(labels[0]!.x < labels[1]!.x && labels[1]!.x < labels[2]!.x);
  near(labels[2]!.x, labels[2]!.w, 0.5);
  assert(labels[0]!.y < labels[0]!.h * 0.2, 'above the line at 8 of 10');
}

// ── LineAnnotation on other planes: constant value is a circle on polar, a polygon on a radar.
{
  const radiusAxis = () => new Axis({ orientation: 'radius', min: 0, max: 10 }, lin());
  const polarOf = (plane: PolarPlane | RadarPlane) => {
    const chart = new Chart({ theme: lightTheme, width: W, height: H }, plane);
    return { svg: show(chart), plane };
  };
  const angle = () => new Axis({ orientation: 'angle', min: 0, max: 6, tickCount: 6, nice: false }, lin());

  const polar = new PolarPlane({}, angle(), radiusAxis(), new LineAnnotation({ value: 5 }));
  const p = polarOf(polar);
  const ring = pathPoints(p.svg, 0, /<path d="(M[^"]*)"[^>]*stroke-dasharray="5 3"/g);
  const cx = polar.rect.width / 2, cy = polar.rect.height / 2, R = Math.min(cx, cy);
  assert(ring.length > 90);
  for (const [x, y] of ring) near(Math.hypot(x - cx, y - cy), R * 0.5, 0.05);

  const radar = new RadarPlane({}, angle(), radiusAxis(), new LineAnnotation({ value: 5 }));
  const r = polarOf(radar);
  const poly = pathPoints(r.svg, 0, /<path d="(M[^"]*)"[^>]*stroke-dasharray="5 3"/g);
  const rx = radar.rect.width / 2, ry = radar.rect.height / 2, RR = Math.min(rx, ry);
  assert.equal(poly.length, 7, 'a vertex at each spoke, the sweep closed, and nothing between');
  for (const [x, y] of poly) near(Math.hypot(x - rx, y - ry), RR * 0.5, 0.05);
  // The corners are exact: the spokes of the radar are at 0..6 and the polygon has a vertex at each.
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * 2 * Math.PI, ex = rx + RR * 0.5 * Math.sin(a), ey = ry - RR * 0.5 * Math.cos(a);
    assert(poly.some(([x, y]) => Math.hypot(x - ex, y - ey) < 0.05), `vertex ${k}`);
  }

  // Constant domain: a spoke, straight on both.
  const spoke = new PolarPlane({}, angle(), radiusAxis(), new LineAnnotation({ domain: 3 }));
  const s = pathPoints(polarOf(spoke).svg, 0, /<path d="(M[^"]*)"[^>]*stroke-dasharray="5 3"/g);
  assert.equal(s.length, 2);
  near(s[0]![0], spoke.rect.width / 2); near(s[0]![1], spoke.rect.height / 2);
  near(s[1]![0], spoke.rect.width / 2); near(s[1]![1], spoke.rect.height / 2 + Math.min(spoke.rect.width, spoke.rect.height) / 2, 0.05);   // half a turn is straight down
}

// ── CalloutAnnotation.
{
  const callouts = (c: Chart) => [...c].flatMap((p) => [...p as never as Iterable<unknown>]).filter((e): e is CalloutAnnotation => e instanceof CalloutAnnotation);
  const inside = (box: { x: number; y: number; width: number; height: number }, x: number, y: number) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

  // The box keeps off the series, stays on the plot, and keeps a clear arm to its point.
  const a = cartesian(() => [new CalloutAnnotation({ domain: 5, value: 5, text: 'Midpoint' })]);
  const [note] = callouts(a.chart);
  const box = note!.box!;
  const r = a.plane.rect;
  assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= r.width && box.y + box.height <= r.height, 'on the plot');
  const { data, count, stride } = a.series.points;
  for (let i = 0; i < count; i++) assert(!inside(box, data[i * stride]!, data[i * stride + 1]!), 'no series point under the box');
  assert(textsOf(a.svg).some((t) => t.text === 'Midpoint'));
  assert(box.y + box.height / 2 < r.height / 2, 'above the flat line: the upper right was free, so it was taken');

  // At the top right corner there is no room that way: it goes in.
  const corner = cartesian(() => [new CalloutAnnotation({ domain: 10, value: 10, text: 'Corner point label' })]);
  const cb = callouts(corner.chart)[0]!.box!, cr = corner.plane.rect;
  assert(cb.x + cb.width <= cr.width + 0.01 && cb.y >= -0.01, 'pulled back onto the plot');

  // Two callouts on one point do not sit on each other.
  const two = cartesian(() => [new CalloutAnnotation({ domain: 5, value: 5, text: 'first' }), new CalloutAnnotation({ domain: 5, value: 5, text: 'second' })]);
  const [b1, b2] = callouts(two.chart).map((c) => c.box!);
  assert(!(b1!.x < b2!.x + b2!.width && b1!.x + b1!.width > b2!.x && b1!.y < b2!.y + b2!.height && b1!.y + b1!.height > b2!.y), 'no overlap');

  // Manual placement: the middle of the box is the offset from the point.
  const manual = cartesian(() => [new CalloutAnnotation({ domain: 5, value: 5, text: 'here', dx: -60, dy: 40 })]);
  const mb = callouts(manual.chart)[0]!.box!, mr = manual.plane.rect;
  near(mb.x + mb.width / 2, mr.width / 2 - 60, 0.01);
  near(mb.y + mb.height / 2, mr.height / 2 + 40, 0.01);

  // Outline modes: all four edges, only the one the arm meets, or none.
  const withOutline = (outline: 'box' | 'edge' | 'none') => cartesian(() => [new CalloutAnnotation({ domain: 5, value: 5, text: 'x', dx: 70, dy: 0, style: { callout: { outline } } })]).svg;
  const boxSvg = withOutline('box'), edgeSvg = withOutline('edge'), noneSvg = withOutline('none');
  assert.match(boxSvg, /fill="#fff"[^>]*stroke="#999"/);
  assert.match(edgeSvg, /fill="#fff"[^>]*stroke="none"/);
  assert.match(noneSvg, /fill="#fff"[^>]*stroke="none"/);
  const edgeLines = (svg: string) => [...svg.matchAll(/<path d="(M[\d. -]+L[\d. -]+)" fill="none" stroke="#999" stroke-width="1"\/>/g)].length;
  assert.equal(edgeLines(boxSvg), 0);
  assert.equal(edgeLines(edgeSvg), 1, 'one edge');
  assert.equal(edgeLines(noneSvg), 0);
  // The point is to the left of a box that is to its right: the edge is the left side, vertical.
  const edge = /<path d="M([\d. -]+) ([\d. -]+)L([\d. -]+) ([\d. -]+)" fill="none" stroke="#999"/.exec(edgeSvg)!;
  assert.equal(edge[1], edge[3], 'a vertical edge');

  // Text alignment in the box is a style property.
  const lineX = (align: string) => +attr(textsOf(cartesian(() => [new CalloutAnnotation({ domain: 5, value: 5, text: 'long first line\nshort', dx: 90, style: { calloutText: { align: align as 'start' } } })]).svg).find((t) => t.text === 'short')!.attrs, 'x')!;
  assert(lineX('start') < lineX('middle') && lineX('middle') < lineX('end'));

  // Off the plot (panned away): nothing is drawn and no room is claimed.
  const gone = cartesian(() => [new CalloutAnnotation({ domain: 50, value: 5, text: 'far away' })]);
  assert.equal(callouts(gone.chart)[0]!.box, null);
  assert(!gone.svg.includes('far away'));
  // Bringing it into view draws it again.
  gone.x.setAttributes({ min: 0, max: 100 });
  gone.chart.flush();
  assert((gone.chart.platform as StringPlatform).toString().includes('far away'));

  // A theme can restyle callouts wholesale; the pointer dot can be turned off.
  const noDot = cartesian(() => [new CalloutAnnotation({ domain: 5, value: 5, text: 'x', style: { callout: { pointer: 0 } } })]);
  assert(!/<path d="M[\d. -]+a3 3 0 1 0/.test(noDot.svg));
  const themed = cartesian(() => [new CalloutAnnotation({ domain: 5, value: 5, text: 'x' })], [], extendTheme(lightTheme, { calloutBox: { fill: '#ffeeaa' } }));
  assert.match(themed.svg, /fill="#ffeeaa"/);
}
});

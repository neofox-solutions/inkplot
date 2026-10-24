// Opens playground.html in headless Chromium, walks every demo, and fails on any console or page error.
//   pnpm vp run playground:test     (screenshots go to $INKPLOT_SHOTS, default ./shots)
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from './tools/browser.mjs';
import { test } from 'vite-plus/test';

test('playground', async () => {
  const out = process.env.INKPLOT_SHOTS ?? new URL('./shots/', import.meta.url).pathname;
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const problems = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

  await page.goto(pathToFileURL(new URL('./playground.html', import.meta.url).pathname).href);
  await page.waitForFunction(() => window.playground?.current?.chart?.lastFlush);
  const settle = async () => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };

  const ids = await page.evaluate(() => window.playground.demos.map((d) => d.id));
  for (const id of ids) {
    await page.evaluate((i) => window.playground.select(i), id);
    await settle();
    const info = await page.evaluate(() => {
      const svg = document.querySelector('#host svg');
      return {
        paths: svg.querySelectorAll('path').length,
        nodes: svg.querySelectorAll('*').length,
        flush: window.playground.current.chart.lastFlush.total,
        w: svg.getAttribute('width'),
      };
    });
    assert(info.paths >= 1 && info.nodes > 10, `${id}: chart drawn (${JSON.stringify(info)})`);
    await page.screenshot({ path: `${out}/${id}.png` });
    console.log(id.padEnd(8), JSON.stringify(info));
  }

  // ── The transitions demo's shape switch replaces the series: each shape draws, and nothing throws (a page error fails the test below).
  await page.evaluate(() => window.playground.select('transitions'));
  await settle();
  for (const shape of ['line', 'area', 'bars']) {
    await page.getByRole('button', { name: shape, exact: true }).click();
    await settle();
    const drawn = await page.evaluate(() => document.querySelectorAll('#host svg path').length);
    assert(drawn >= 4, `transitions: ${shape} is drawn (${drawn} paths)`);
  }
  await page.getByRole('button', { name: 'New values' }).click();
  await settle();

  // ── The heat map demo on a polar plane: the same cells, placed as wedges, with nothing NaN.
  await page.evaluate(() => window.playground.select('heatmap'));
  await settle();
  const rectangular = await page.evaluate(() => document.querySelectorAll('#host svg path[fill-opacity]').length);
  await page.getByRole('button', { name: 'polar', exact: true }).click();
  await settle();
  const wedges = await page.evaluate(() => {
    const L = window.inkplot,
      c = window.playground.current.chart;
    const d = [...document.querySelectorAll('#host svg path[fill-opacity]')].map((p) => p.getAttribute('d') ?? '');
    return {
      polar: !!L.firstDescendantOfType(c, L.PolarPlane),
      cartesian: !!L.firstDescendantOfType(c, L.CartesianPlane),
      paths: d.length,
      nan: d.some((x) => x.includes('NaN')),
      cells: L.firstDescendantOfType(c, L.Density).pointCount,
    };
  });
  assert(
    rectangular > 0 && wedges.polar && !wedges.cartesian && wedges.paths > 0 && !wedges.nan && wedges.cells > 100,
    `heat map on a polar plane (${JSON.stringify(wedges)})`,
  );
  await page.getByRole('button', { name: 'rectangular', exact: true }).click();
  await settle();
  assert.equal(
    await page.evaluate(() => !!window.inkplot.firstDescendantOfType(window.playground.current.chart, window.inkplot.CartesianPlane)),
    true,
    'and back to a rectangular plane',
  );

  // ── Swapping a fixed child on a live chart changes what is drawn, and swapping back restores it.
  await page.evaluate(() => window.playground.select('tree'));
  await settle();
  const pathOf = () => page.evaluate(() => [...document.querySelectorAll('#host svg path')].map((p) => p.getAttribute('d')).join('|'));
  const linear = await pathOf();
  await page.getByRole('button', { name: 'signed power (custom)' }).click();
  await settle();
  const power = await pathOf();
  assert.notEqual(power, linear, 'a different scale draws different paths');
  await page.getByLabel('power exponent').fill('0.9');
  await settle();
  assert.notEqual(await pathOf(), power, 'the exponent of the custom scale reaches the drawing');
  await page.getByRole('button', { name: 'linear', exact: true }).click();
  await settle();
  assert.equal(await pathOf(), linear, 'swapping back restores the original drawing');

  // ── Two equal crosshatch angles are refused by the pattern; the demo says so and goes on.
  await page.evaluate(() => window.playground.select('patterns'));
  await settle();
  await page.getByLabel('line angle (degrees)').fill('30');
  await page.getByLabel('crosshatch: second angle').fill('30');
  await settle();
  assert.match(await page.locator('.note.warn').first().textContent(), /two different angles/);
  await page.getByLabel('crosshatch: second angle').fill('-30');
  await settle();
  assert.equal(await page.locator('.note.warn').first().textContent(), '');

  // ── Resize: dragging the box follows through ResizeObserver to a new flush with new dimensions.
  await page.evaluate(() => window.playground.select('basic'));
  await settle();
  const before = await page.evaluate(() => document.querySelector('#host svg').getAttribute('width'));
  await page.evaluate(() => {
    document.getElementById('host').style.width = '520px';
  });
  await page.waitForFunction((w) => document.querySelector('#host svg').getAttribute('width') !== w, before);
  await settle();
  const after = await page.evaluate(() => document.querySelector('#host svg').getAttribute('width'));
  assert.equal(after, '518', 'the chart follows its container (520 less its 1px borders)');
  await page.evaluate(() => {
    document.getElementById('host').style.width = '';
  });

  // ── Pointer: real mouse events reach the crosshair element in plane coordinates; a drag outside keeps going.
  await page.evaluate(() => window.playground.select('pointer'));
  await settle();
  await page.locator('#host svg').scrollIntoViewIfNeeded();
  const box = await page.locator('#host svg').boundingBox();
  await page.mouse.move(box.x + 200, box.y + 150);
  await settle();
  let text = await page.locator('.readout').first().textContent();
  assert.match(text, /plane\s+\d+, \d+/, 'pointer move is reported in plane coordinates: ' + text);
  assert.match(
    await page.locator('#host svg path[stroke-dasharray="4 3"]').first().getAttribute('d'),
    /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+M[\d.]+ [\d.]+L/,
    'the library crosshair is drawn: a vertical and a horizontal line',
  );
  await page.mouse.down();
  await page.mouse.move(box.x - 50, box.y + 150); // outside the svg entirely
  await settle();
  text = await page.locator('.readout').nth(1).textContent();
  assert.match(text, /move\s+-?\d+/, 'a drag keeps reporting after leaving: ' + text);
  await page.mouse.up();
  await page.mouse.move(box.x + 210, box.y + 160);
  await page.mouse.wheel(0, 120);
  await settle();
  text = await page.locator('.readout').nth(1).textContent();
  assert.match(text, /wheel/, 'wheel arrives: ' + text);
  await page.screenshot({ path: `${out}/pointer-active.png` });

  // ── Pan and zoom with real wheel and mouse input over two million decimated points.
  await page.evaluate(() => window.playground.select('panzoom'));
  await settle();
  const ranges = () =>
    page.evaluate(() => {
      const L = window.inkplot,
        c = window.playground.current.chart;
      return {
        x: { ...L.findById(c, 'x').range },
        y: { ...L.findById(c, 'y').range },
        zoomed: L.findById(c, 'x').isZoomed,
        drawn: c.lastFlush.pointsDrawn,
        cursor: document.querySelector('#host svg').style.cursor,
      };
    });
  await page.locator('#host svg').scrollIntoViewIfNeeded();
  const pbox = await page.locator('#host svg').boundingBox();
  const centre = [pbox.x + pbox.width / 2, pbox.y + pbox.height / 2];
  const start = await ranges();
  await page.mouse.move(...centre);
  assert.equal((await ranges()).cursor, 'grab');
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -400);
    await settle();
  }
  const zoomed = await ranges();
  assert(zoomed.zoomed && zoomed.x.max - zoomed.x.min < (start.x.max - start.x.min) / 20, 'wheel zooms in: ' + JSON.stringify(zoomed.x));
  assert(zoomed.drawn < 2000, 'still bounded: ' + zoomed.drawn);
  await page.mouse.down();
  assert.equal((await ranges()).cursor, 'grabbing');
  await page.mouse.move(centre[0] + 120, centre[1] + 30, { steps: 6 });
  await page.mouse.up();
  await settle();
  const panned = await ranges();
  assert(panned.x.min < zoomed.x.min, 'dragging right moves the view left');
  await page.screenshot({ path: `${out}/panzoom.png` });
  await page.mouse.dblclick(...centre);
  await settle();
  const reset = await ranges();
  assert(
    !reset.zoomed && Math.abs(reset.x.min - start.x.min) < 1e-9 && Math.abs(reset.x.max - start.x.max) < 1e-9,
    'double-click resets: ' + JSON.stringify(reset),
  );

  // ── Markers: shared paths when merged, a node per point when not, and shapes, bindings and keys that follow the controls.
  await page.evaluate(() => window.playground.select('markers'));
  await settle();
  const pathCount = () => page.evaluate(() => document.querySelectorAll('#host svg path').length);
  const merged = await pathCount();
  assert(merged < 1100, `a scatter of 5000 is a handful of paths, not 5000 (${merged})`);
  assert((await page.locator('#host svg').textContent()).includes('Pressure'), 'the colour key is drawn');
  await page.screenshot({ path: `${out}/markers.png` });
  await page.getByRole('button', { name: '×' }).click();
  await settle();
  assert((await pathCount()) < 1100, 'crosses are merged too');
  await page.getByRole('button', { name: 'dot', exact: true }).click();
  await page.getByLabel('size = mass').check();
  await settle();
  assert((await pathCount()) < 1100, 'a bound size on dots is quantized, not a node per point');
  await page.getByLabel('size = mass').uncheck();
  await page.getByRole('button', { name: 'circle', exact: true }).click();
  await page.getByLabel('merge into shared paths').uncheck();
  await settle();
  const separate = await pathCount();
  assert(separate > 4000, `merge off: a node per marker (${separate})`);
  await page.screenshot({ path: `${out}/markers-separate.png` });
  await page.getByLabel('merge into shared paths').check();
  await settle();
  assert((await pathCount()) < 1100, 'merging again removes the per-marker nodes');
  const keyLabel = page.locator('#host svg text', { hasText: 'Pressure' });
  assert(await keyLabel.isVisible(), 'the colour key is shown');
  await page.getByRole('button', { name: 'top', exact: true }).click();
  await settle();
  assert((await page.locator('#host svg').innerHTML()).includes('x1="0" y1="0" x2="1" y2="0"'), 'a key along the top runs horizontally');
  await page.getByRole('button', { name: 'right', exact: true }).click();
  await page.getByLabel('show keys').uncheck();
  await settle();
  assert(!(await keyLabel.isVisible()), 'keys hidden');
  await page.getByLabel('show keys').check();
  await settle();
  assert(await keyLabel.isVisible(), 'and shown again');

  // ── Bubbles: one circle path per region in use.
  await page.evaluate(() => window.playground.select('bubble'));
  await settle();
  const bubble = await page.evaluate(() => {
    const svg = document.querySelector('#host svg');
    return { paths: svg.querySelectorAll('path').length, text: svg.textContent };
  });
  assert(bubble.paths < 40, `bubbles share paths by colour (${bubble.paths})`);
  assert(/North/.test(bubble.text) && /Population/.test(bubble.text), 'both keys are drawn');
  await page.screenshot({ path: `${out}/bubble.png` });

  // ── Polar: a ring-shaped area and an arc axis, with the controls moving it.
  await page.evaluate(() => window.playground.select('polar'));
  await settle();
  const polar = await page.evaluate(() => {
    const svg = document.querySelector('#host svg');
    const closed = [...svg.querySelectorAll('path')].filter((p) => /L.*Z$/.test(p.getAttribute('d') ?? '')).length;
    return { closed, arcs: [...svg.querySelectorAll('path')].some((p) => /A/.test(p.getAttribute('d') ?? '')), text: svg.textContent };
  });
  assert(polar.closed >= 2 && polar.arcs && /100°/.test(polar.text), `polar chart is drawn (${JSON.stringify(polar)})`);
  await page.locator('#host svg').scrollIntoViewIfNeeded();
  const pb = await page.locator('#host svg').boundingBox();
  await page.mouse.move(pb.x + pb.width / 2 + 60, pb.y + pb.height / 2 - 40);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -300);
    await settle();
  }
  const zoomedPolar = await page.evaluate(() => {
    const L = window.inkplot,
      c = window.playground.current.chart;
    return { r: L.findById(c, 'radius').isZoomed, a: L.findById(c, 'angle').isZoomed };
  });
  assert(zoomedPolar.r && !zoomedPolar.a, 'the wheel zooms the radius axis only: ' + JSON.stringify(zoomedPolar));
  await page.mouse.dblclick(pb.x + pb.width / 2 + 60, pb.y + pb.height / 2 - 40);
  await settle();
  assert(!(await page.evaluate(() => window.inkplot.findById(window.playground.current.chart, 'radius').isZoomed)), 'double-click resets');
  await page.getByRole('button', { name: 'half', exact: true }).click();
  await settle();
  await page.screenshot({ path: `${out}/polar.png` });
  await page.getByRole('button', { name: 'full', exact: true }).click();
  await settle();

  // ── Radar: hexagonal rings, a label per spoke.
  await page.evaluate(() => window.playground.select('radar'));
  await settle();
  const radar = await page.evaluate(() => {
    const svg = document.querySelector('#host svg');
    return {
      arcs: [...svg.querySelectorAll('path')].filter((p) => p.getAttribute('stroke') === '#e6e6e6' && /A/.test(p.getAttribute('d') ?? ''))
        .length,
      text: svg.textContent,
    };
  });
  assert(radar.arcs === 0 && /Stealth/.test(radar.text) && /Armour/.test(radar.text), `radar chart is drawn (${JSON.stringify(radar)})`);
  await page.getByLabel('fixed radius range 0–10').uncheck();
  await settle();
  await page.screenshot({ path: `${out}/radar.png` });
  await page.getByLabel('fixed radius range 0–10').check();
  await settle();

  // ── XY: a closed loop, axes floating through the origin, and panning slides them.
  await page.evaluate(() => window.playground.select('xy'));
  await settle();
  const xy = await page.evaluate(() => {
    const L = window.inkplot,
      c = window.playground.current.chart,
      x = L.findById(c, 'x'),
      y = L.findById(c, 'y');
    const s = L.firstDescendantOfType(c, L.XYSeries);
    const p = s.points,
      last = p.count - 1;
    return {
      count: p.count,
      closed: p.data[0] === p.data[last * p.stride] && p.data[1] === p.data[last * p.stride + 1],
      at: y.ruler.at(0)[0],
      mid: x.ruler.at(0)[1],
      text: document.querySelector('#host svg').textContent,
    };
  });
  assert(xy.count === 401 && xy.closed, `the loop closes with wrap: ${JSON.stringify(xy)}`);
  assert(xy.at > 50 && xy.mid > 50, 'the axes cross inside the plot');
  await page.screenshot({ path: `${out}/xy.png` });
  await page.evaluate(() => window.playground.select('scatter'));
  await settle();
  const sc = await page.evaluate(() => {
    const L = window.inkplot,
      c = window.playground.current.chart;
    return {
      paths: document.querySelectorAll('#host svg path').length,
      key: /Group/.test(document.querySelector('#host svg').textContent),
      n: L.firstDescendantOfType(c, L.XYSeries).points.count,
    };
  });
  assert(sc.n === 1500 && sc.key && sc.paths < 60, `scatter is drawn: ${JSON.stringify(sc)}`);
  await page.screenshot({ path: `${out}/scatter.png` });

  // ── Decimation at scale through the UI path.
  await page.evaluate(() => window.playground.select('big'));
  await settle();
  const big = await page.evaluate(() => {
    const chart = window.playground.current.chart,
      L = window.inkplot;
    return { in: L.firstDescendantOfType(chart, L.Decimator).pointCount, drawn: chart.lastFlush.pointsDrawn, ms: chart.lastFlush.total };
  });
  assert(big.in === 1e6 && big.drawn > 500 && big.drawn < 2000, JSON.stringify(big));
  console.log('big', JSON.stringify(big));

  // ── The same chart with the decimation in a worker (a classic worker from a blob, in a page opened from a file).
  await page.getByText('decimate in a worker', { exact: false }).click();
  await page.evaluate(() => window.playground.current.chart.idle());
  const worked = await page.evaluate(() => {
    const chart = window.playground.current.chart,
      L = window.inkplot;
    const boundary = L.firstDescendantOfType(chart, L.WorkerBoundary);
    return { boundary: !!boundary, points: boundary?.pointCount, drawn: chart.lastFlush.pointsDrawn, arrived: boundary?.arrived };
  });
  assert(worked.boundary && worked.arrived && worked.points === 1e6 && worked.drawn > 500 && worked.drawn < 2000, JSON.stringify(worked));
  const workerJson = await page.evaluate(() => window.playground.roundTrip());
  assert.equal(workerJson.copy, workerJson.live, 'the chart with a worker boundary reads back from its JSON');
  await page.getByText('pan automatically', { exact: false }).click();
  const workerPan = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const flushes = [];
        const chart = window.playground.current.chart;
        const was = chart.attrs.onFlush;
        chart.setAttribute('onFlush', (st) => (flushes.push(st.total), was?.(st)));
        setTimeout(() => {
          chart.setAttribute('onFlush', was);
          resolve({ n: flushes.length, max: Math.max(...flushes) });
        }, 2000);
      }),
  );
  console.log('worker pan', JSON.stringify(workerPan));
  assert(workerPan.n > 30 && workerPan.max < 25, 'panning with the worker keeps the flush short: ' + JSON.stringify(workerPan));
  await page.getByText('pan automatically', { exact: false }).click();
  await page.getByText('decimate in a worker', { exact: false }).click();
  await page.evaluate(() => window.playground.current.chart.idle());

  // ── JSON: every demo's chart is written as JSON and read back into a second chart that draws exactly the same.
  for (const id of ids) {
    await page.evaluate((i) => window.playground.select(i), id);
    await settle();
    const r = await page.evaluate(() => window.playground.roundTrip());
    assert.equal(r.copy, r.live, `${id}: a chart read back from its JSON draws what the original draws`);
  }
  console.log('json round trip', ids.length, 'demos');

  // ── The JSON tab edits the live chart; a bad edit is reported and changes nothing.
  await page.evaluate(() => window.playground.select('basic'));
  await settle();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const area = page.locator('textarea.json');
  const status = page.locator('.jsonbar span').first();
  const strokes = () =>
    page.evaluate(() => [...document.querySelectorAll('#host svg path')].map((p) => p.getAttribute('stroke')).filter(Boolean));
  const json = JSON.parse(await area.inputValue());
  assert.equal(json.type, 'Chart');
  assert.deepEqual(json.attrs.theme, { $ref: 'lightTheme' }, 'the page theme goes by name');
  const walkType = (n, type) => (n.type === type ? n : (n.children ?? []).map((c) => walkType(c, type)).find(Boolean));
  const line = walkType(json, 'LinePath');
  assert(line, 'a line renderer is in the JSON');
  const was = (await strokes()).join();
  line.attrs = { ...line.attrs, stroke: '#ff00aa' };
  await area.fill(JSON.stringify(json, null, 2));
  await page.waitForFunction(() => document.querySelector('.jsonbar span')?.textContent.startsWith('applied'));
  assert((await strokes()).includes('#ff00aa'), 'the edit reached the live chart');
  assert.notEqual((await strokes()).join(), was);
  const good = (await strokes()).join();
  await area.fill('{ "type": "Chart", ');
  await page.waitForFunction(() => document.querySelector('.jsonbar span')?.className === 'bad');
  assert.match(await status.textContent(), /not JSON yet/);
  assert.equal((await strokes()).join(), good, 'unreadable text changes nothing');
  walkType(json, 'LinePath').type = 'LinePth';
  await area.fill(JSON.stringify(json));
  await page.waitForFunction(() => /unknown type "LinePth"/.test(document.querySelector('.jsonbar span')?.textContent ?? ''));
  assert.match(await status.textContent(), /children\[0\]/, 'it says where');
  assert.equal((await strokes()).join(), good, 'an unknown type changes nothing');
  // The copy built with fromJSON from the (good) text.
  walkType(json, 'LinePth').type = 'LinePath';
  await area.fill(JSON.stringify(json));
  await page.waitForFunction(() => document.querySelector('.jsonbar span')?.textContent.startsWith('applied'));
  await page.getByRole('button', { name: 'Draw a copy with fromJSON' }).click();
  assert.equal(await page.locator('.copyhost svg').count(), 1, 'a copy is drawn from the text');
  assert((await page.locator('.copyhost svg').innerHTML()).includes('#ff00aa'));
  await page.screenshot({ path: `${out}/json.png` });

  // ── A layout that cannot draw what the JSON says is refused, and the chart goes back to what worked.
  await page.evaluate(() => window.playground.select('stack'));
  await settle();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const stackJson = JSON.parse(await area.inputValue());
  const stackNode = walkType(stackJson, 'Stack');
  assert.deepEqual(stackNode.attrs, { mode: 'stack', align: 'strict' });
  stackNode.attrs.mode = 'group';
  await area.fill(JSON.stringify(stackJson, null, 2));
  await page.waitForFunction(() => document.querySelector('.jsonbar span')?.textContent.startsWith('applied'));
  assert.equal(await page.evaluate(() => window.playground.current.chart.lastFlush && true), true);
  await page.screenshot({ path: `${out}/json-stack.png` });
  // Data the page keeps editing is named, so editing the JSON cannot swap it for a copy.
  await page.evaluate(() => window.playground.select('edit'));
  await settle();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  assert.match(await status.textContent(), /by reference, from the page: .*rowsNorth.*rowsSouth.*rowsEast/);
  await page.getByRole('button', { name: 'Element tree', exact: true }).click();

  // ── Gaps and ticks: a policy changed in the JSON reaches the drawing.
  await page.evaluate(() => window.playground.select('edges'));
  await settle();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const runs = () =>
    page.evaluate(() => {
      const d = [...document.querySelectorAll('#host svg path')]
        .map((p) => p.getAttribute('d') ?? '')
        .find((t) => /^M[\d.-]+ [\d.-]+L/.test(t));
      return d ? d.split('M').length - 1 : -1;
    });
  assert.equal(await runs(), 3, 'a line broken by two stretches of NaN is three runs');
  const edgesJson = JSON.parse(await area.inputValue());
  walkType(edgesJson, 'DomainSeries').attrs.missing = 'connect';
  await area.fill(JSON.stringify(edgesJson, null, 2));
  await page.waitForFunction(() => document.querySelector('.jsonbar span')?.textContent.startsWith('applied'));
  assert.equal(await runs(), 1, 'connected, it is one');
  walkType(edgesJson, 'Axis').attrs.ticks = [1, 5, 8];
  await area.fill(JSON.stringify(edgesJson, null, 2));
  await page.waitForFunction(() => document.querySelector('.jsonbar span')?.textContent.startsWith('applied'));
  await page.screenshot({ path: `${out}/edges.png` });
  await page.getByRole('button', { name: 'Element tree', exact: true }).click();

  // ── Steps and curves: each choice draws what it says, on every plane.
  await page.evaluate(() => window.playground.select('curves'));
  await settle();
  const commands = () =>
    page.evaluate(() => {
      const all = [...document.querySelectorAll('#host svg path')].map((p) => p.getAttribute('d') ?? '');
      return all.filter((d) => /^M[\d. -]+[LCQAT]/.test(d) && !/[VH]/.test(d));
    });
  for (const [label, letter] of [
    ['natural', 'C'],
    ['quadratic', 'Q'],
    ['arc', 'A'],
    ['bump', 'C'],
    ['basis', 'C'],
    ['Catmull-Rom', 'C'],
    ['cardinal', 'C'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await settle();
    const d = await commands();
    assert(
      d.some((p) => p.includes(letter) && !/NaN/.test(p)),
      `${label} draws with ${letter}`,
    );
  }
  // Steps are drawn by the plane, as horizontal and vertical moves on a rectangle.
  for (const label of ['step centred', 'step before']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await settle();
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('#host svg path[stroke-linejoin="round"]')].map((p) => p.getAttribute('d') ?? ''),
    );
    assert(
      lines.some((d) => /^M[\d. -]+[HV]/.test(d) && !/NaN/.test(d)),
      `${label} draws with H and V`,
    );
  }
  await page.getByRole('button', { name: 'natural', exact: true }).click();
  for (const plane of ['polar', 'radar', 'domain up the side', 'upright']) {
    await page.getByRole('button', { name: plane, exact: true }).click();
    await settle();
    assert((await commands()).length > 0, `a curve is drawn on ${plane}`);
  }
  await page.getByRole('button', { name: 'the line drawn (between points)' }).click();
  await settle();
  for (const mode of ['step centred', 'natural', 'arc']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await settle();
    const box = await page.locator('#host svg').first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45);
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await settle();
  }
  await page.getByRole('button', { name: 'area', exact: true }).click();
  await page
    .getByRole('button', { name: 'two series, stacked', exact: false })
    .first()
    .click()
    .catch(() => {});
  await settle();
  await page.locator('#host').screenshot({ path: `${out}/curves.png` });

  // ── Keyboard: Tab reaches the plot and then the legend entries; keys act on them; the ring shows for keys only.
  await page.evaluate(() => window.playground.select('a11y'));
  await settle();
  const svg = page.locator('#host svg').first();
  const box0 = await svg.boundingBox();
  await page.mouse.click(box0.x + 4, box0.y + 4); // sequential focus starts from where the click was
  await page.keyboard.press('Tab');
  const role = () => page.evaluate(() => document.activeElement?.getAttribute?.('role') ?? null);
  const label = () => page.evaluate(() => document.activeElement?.getAttribute?.('aria-label') ?? null);
  const rings = () => page.evaluate(() => document.querySelectorAll('#host svg rect[pointer-events=none][display=inline]').length);
  const axisText = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#host svg text')]
        .map((t) => t.textContent)
        .sort()
        .join(','),
    );
  await settle();
  assert.equal(await role(), 'application', 'Tab arrives at the plot');
  assert.equal(await label(), 'Visits and signups over 30 days');
  assert.equal(await rings(), 1, 'a ring for keyboard focus');
  await page.locator('#host').screenshot({ path: `${out}/a11y-plot-focus.png` });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const labelsBefore = await axisText();
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await settle();
  const keyZoomed = await axisText();
  assert.notEqual(keyZoomed, labelsBefore, 'plus zooms the plot');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await settle();
  assert.notEqual(await axisText(), keyZoomed, 'arrows pan it');
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, 'and the page does not scroll with them');
  await page.keyboard.press('0');
  await settle();
  assert.equal(await axisText(), labelsBefore, 'zero puts it back');

  await page.keyboard.press('Tab');
  await settle();
  assert.equal(await role(), 'application', 'the next stop is the plot again, for reading values');
  assert.equal(await label(), 'Reading the values, one day at a time');
  const spoken = () => page.evaluate(() => document.querySelector('#host [role=status]')?.textContent ?? '');
  await page.keyboard.press('ArrowRight');
  await settle();
  const first = await spoken();
  assert(/Signups: [\d.]+/.test(first) && /Visits: [\d.]+/.test(first), 'what the tooltip says is announced: ' + first);
  await page.keyboard.press('ArrowRight');
  await settle();
  assert.notEqual(await spoken(), first, 'and again for the next day');
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, 'arrow keys do not scroll the page');
  await page.locator('#host').screenshot({ path: `${out}/a11y-cursor.png` });
  await page.keyboard.press('Escape');
  await settle();
  await page.keyboard.press('Tab');
  assert.equal(await role(), 'button', 'the next stop is a legend entry');
  assert.equal(await label(), 'Visits');
  const pressed = (n) => page.evaluate((i) => document.querySelectorAll('#host svg [role=button]')[i].getAttribute('aria-pressed'), n);
  assert.equal(await pressed(0), 'true');
  await page.keyboard.press('Space');
  await settle();
  assert.equal(await pressed(0), 'false', 'Space presses it');
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, 'without scrolling the page');
  await page.keyboard.press('Space');
  await settle();
  assert.equal(await pressed(0), 'true');
  await page.keyboard.press('Tab');
  assert.equal(await label(), 'Signups');
  await page.locator('#host').screenshot({ path: `${out}/a11y-legend-focus.png` });
  await page.keyboard.press('Enter');
  await settle();
  assert.equal(await pressed(1), 'false', 'Enter presses it');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await role(), 'application', 'and back with Shift+Tab');
  assert.equal(await page.evaluate(() => document.querySelector('#host svg').getAttribute('aria-roledescription')), 'chart');
  assert(
    (await page.evaluate(() => document.querySelector('#host svg').getAttribute('aria-description'))).startsWith('2 series'),
    'the summary is on the chart',
  );

  // A click leaves focus on the entry without a ring.
  const entry = page.locator('#host svg [role=button]').first();
  await entry.click();
  await settle();
  assert.equal(await pressed(0), 'false', 'a click presses it, on release');
  assert.equal(await rings(), 0, 'and shows no ring');
  await entry.click();
  await settle();

  // ── A cursor on a polar plane: the guides are a spoke and a circle at the pointer, and the reading is by angle.
  await page.evaluate(() => window.playground.select('polar'));
  await settle();
  const pbox2 = await page.locator('#host svg').boundingBox();
  await page.mouse.move(pbox2.x + pbox2.width * 0.5 + 120, pbox2.y + pbox2.height * 0.5 - 40);
  await settle();
  const spokeOnly = await page.locator('#host svg path[stroke-dasharray="4 3"]').first().getAttribute('d');
  assert.match(spokeOnly, /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+$/, 'the angle guide alone is a spoke: ' + spokeOnly);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'both').click()); // without scrolling the chart away
  const pbox3 = await page.locator('#host svg').boundingBox(); // the click may have scrolled the page
  await page.mouse.move(pbox3.x + pbox3.width * 0.5 + 118, pbox3.y + pbox3.height * 0.5 - 38);
  await settle();
  const guide = await page.locator('#host svg path[stroke-dasharray="4 3"]').first().getAttribute('d');
  assert.match(guide, /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+M[\d.]+ [\d.]+A/, 'a spoke, then a circle: ' + guide);
  assert.equal(await page.locator('#host svg path[stroke-dasharray="4 3"]').count(), 1);
  await page.locator('#host').screenshot({ path: `${out}/polar-cursor.png` });
  await page.evaluate(() => window.playground.select('radar'));
  await settle();
  await page.mouse.move(pbox2.x + pbox2.width * 0.5 - 90, pbox2.y + pbox2.height * 0.5 + 30);
  await settle();
  await page.locator('#host').screenshot({ path: `${out}/radar-cursor.png` });

  // ── JSX: the chart written as JSX is a live chart; a `ref` reached the elements, and a function tag adds a series.
  await page.evaluate(() => window.playground.select('jsx'));
  await settle();
  const lines = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#host svg path[stroke-width="2"]')]
        .filter((p) => (p.getAttribute('d') ?? '').length > 200 && p.getClientRects().length > 0)
        .map((p) => p.getAttribute('stroke')),
    );
  assert.deepEqual(await lines(), ['#2a6fdb', '#d9534f'], 'two series from the JSX');
  assert.equal(
    await page.evaluate(() => document.querySelector('#host svg [aria-label="Time (s)"]') !== null),
    true,
    'meta-title became the axis name',
  );
  await page.getByLabel('show the second series').uncheck();
  await settle();
  assert.deepEqual(await lines(), ['#2a6fdb'], 'the ref reached the series, and hiding it removed its line');
  await page.getByRole('button', { name: /Add a series/ }).click();
  await settle();
  assert.equal((await lines()).length, 2, 'a series made by a function tag joins the running chart');
  await page.screenshot({ path: `${out}/jsx.png` });

  // ── Box plot: the options that change the numbers change the boxes (a swapped data node must refill the series).
  await page.evaluate(() => window.playground.select('box'));
  await settle();
  const boxes = () => page.evaluate(() => [...document.querySelectorAll('#host svg path')].map((p) => p.getAttribute('d') ?? '').join('|'));
  const boxBefore = await boxes();
  await page.getByRole('button', { name: 'mean', exact: true }).click();
  await settle();
  assert.notEqual(await boxes(), boxBefore, 'box plot: the middle line is now the mean, and the drawing changed');
  await page.getByRole('button', { name: 'New data' }).click();
  await settle();

  // ── Lollipops side by side: each marker stands on its stem, and the value axis starts at the baseline.
  await page.evaluate(() => window.playground.select('stack'));
  await settle();
  await page.getByRole('button', { name: 'lollipops', exact: true }).click();
  await page.getByRole('button', { name: 'side by side', exact: true }).click();
  await settle();
  const lollipop = await page.evaluate(() => {
    const L = window.inkplot;
    const plane = L.firstDescendantOfType(window.playground.current.chart, L.CartesianPlane);
    const svg = document.querySelector('#host svg');
    const stems = [...svg.querySelectorAll('path')].flatMap((p) =>
      [...(p.getAttribute('d') ?? '').matchAll(/M([\d.]+) [\d.-]+L\1 /g)].map((m) => +m[1]),
    );
    const dots = [...svg.querySelectorAll('path')].flatMap((p) =>
      [...(p.getAttribute('d') ?? '').matchAll(/M([\d.]+) [\d.]+a5 5 /g)].map((m) => +m[1] + 5),
    );
    return { stems, dots, min: plane.axes.find((a) => a.attrs.id === 'v').range.min };
  });
  assert(
    lollipop.dots.length > 3 && lollipop.dots.every((x) => lollipop.stems.some((s) => Math.abs(s - x) < 1.1)),
    `lollipops: markers on stems ${JSON.stringify(lollipop)}`,
  );
  assert(lollipop.min >= 0, `lollipops: the value axis starts at the baseline (${lollipop.min})`);

  // ── Histogram: weighting the points changes the bars, and clearing it puts them back.
  await page.evaluate(() => window.playground.select('histogram'));
  await settle();
  // The bars' heights (a resize of a fraction of a pixel moves them sideways, not up).
  const bars = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#host svg path')]
        .map((p) => p.getAttribute('d') ?? '')
        .filter((d) => d.includes('Z'))
        .flatMap((d) => d.split('Z').map((b) => /V([\d.]+)/.exec(b)?.[1] ?? ''))
        .join(','),
    );
  const unweighted = await bars();
  await page.getByLabel('weight each point by w').check();
  await settle();
  assert.notEqual(await bars(), unweighted, 'histogram: weights change the bars');
  await page.getByLabel('weight each point by w').uncheck();
  await settle();
  assert.equal(await bars(), unweighted, 'histogram: clearing the weights restores them');

  // ── Right to left: the vertical axis moves to the right, and back.
  await page.evaluate(() => window.playground.select('rtl'));
  await settle();
  const yside = () =>
    page.evaluate(() => {
      const L = window.inkplot;
      const plane = L.firstDescendantOfType(window.playground.current.chart, L.CartesianPlane);
      return plane.axes.find((a) => a.attrs.title === 'مليون ريال').orientation;
    });
  assert.equal(await yside(), 'right', 'the demo starts right to left, so the vertical axis is on the right');
  await page.getByLabel('right to left').uncheck();
  await settle();
  assert.equal(await yside(), 'left');
  await page.getByLabel('right to left').check();
  await settle();
  assert.equal(await yside(), 'right');

  // ── The headline: the spiral plays, scrubs from the slider and from the ring, and the stripes dim the years to come.
  await page.evaluate(() => window.playground.select('hero'));
  await page.waitForTimeout(900); // it starts playing a moment after it is shown
  const heroText = () => page.evaluate(() => [...document.querySelectorAll('#host svg text')].map((t) => t.textContent).join('|'));
  const stripePaths = () =>
    page.evaluate(() => {
      const L = window.inkplot;
      const bars = L.firstDescendantOfType(window.playground.current.chart, L.BarPath);
      return bars.bindings.length;
    });
  assert.equal(await stripePaths(), 2, 'the stripes bind a fill and an opacity');
  const stripeNodes = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('#host svg path')].filter(
          (p) => p.getAttribute('opacity') === '0.14' || p.getAttribute('opacity') === '1',
        ).length,
    );
  const slider = page.locator('#controls input[type=range]').first();
  await slider.evaluate((el) => {
    el.value = '1950';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  assert((await heroText()).includes('1950'), 'the slider sets the year in the middle');
  const lit = () =>
    page.evaluate(() => [...document.querySelectorAll('#host svg path')].filter((p) => p.getAttribute('opacity') === '0.14').length);
  assert((await lit()) > 0, 'the years still to come are faint');
  await slider.evaluate((el) => {
    el.value = '2025';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  assert((await lit()) === 0, 'at the last year nothing is faint');
  assert((await stripeNodes()) < 150, 'a hundred and forty-six stripes are a few dozen paths');

  // ── The SVG tab follows the chart.
  await page.evaluate(() => window.playground.select('stack'));
  await settle();
  await page.getByRole('button', { name: 'SVG output' }).click();
  const svgText = () => page.locator('#panel pre').textContent();
  const svgBefore = await svgText();
  await page.getByRole('button', { name: 'stems', exact: true }).click();
  await page.waitForTimeout(400);
  assert.notEqual(await svgText(), svgBefore, 'the SVG tab shows the chart as it is now');
  await page.getByRole('button', { name: 'Element tree' }).click();

  // ── Tabs render.
  for (const name of ['SVG output', 'JSON', 'Coverage', 'Element tree']) {
    await page.getByRole('button', { name }).click();
    assert((await page.locator('#panel').textContent()).length > 20, name);
  }
  await page.getByRole('button', { name: 'Coverage' }).click();
  await page.screenshot({ path: `${out}/coverage.png` });

  await browser.close();
  assert.deepEqual(problems, [], 'no console errors or warnings');
});

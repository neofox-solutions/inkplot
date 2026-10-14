// Web Components adapter, in jsdom: markup becomes the element tree `new` builds, attributes follow the DOM, order follows the document, and events are DOM events.
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as L from './index.ts';
import { test } from 'vite-plus/test';

test('web-components', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    customElements: dom.window.customElements,
  });
  const { defineElements } = await import('./web-components.ts');
  type Wrapper = HTMLElement & { element: L.AnyElement | null; props: Record<string, unknown>; platformOptions?: unknown; sync(): void };

  const tags = defineElements(
    {
      Chart: L.Chart,
      ChartTitle: L.ChartTitle,
      CartesianPlane: L.CartesianPlane,
      Axis: L.Axis,
      LinearScale: L.LinearScale,
      LogScale: L.LogScale,
      DomainSeries: L.DomainSeries,
      FlatDataSource: L.FlatDataSource,
      LinePath: L.LinePath,
      LinearCurve: L.LinearCurve,
      PointerListener: L.PointerListener,
    },
    { prefix: 'ch' },
  );
  assert.equal(tags.CartesianPlane, 'ch-cartesian-plane');
  assert.equal(tags.FlatDataSource, 'ch-flat-data-source');
  assert.deepEqual(defineElements({ Axis: L.Axis }, { prefix: 'ch' }), { Axis: 'ch-axis' }, 'defining again is harmless');
  assert.throws(() => defineElements({ Axis: L.LinearScale }, { prefix: 'ch' }), /already defined/);

  const flush = () => new Promise<void>((r) => setTimeout(r));
  const el = <T extends Wrapper = Wrapper>(root: ParentNode, selector: string) => root.querySelector(selector) as T;
  const names = (e: L.AnyElement) => [...e].map((c) => (c.attrs as { id?: string }).id ?? c.constructor.name);

  const series = (id: string, name = id) =>
    `<ch-domain-series id="${id}" name="${name}"><ch-flat-data-source data="[1,3,2,5]" regulardomain-start="0" regulardomain-step="1"></ch-flat-data-source><ch-line-path stroke="#36c" strokewidth="2"><ch-linear-curve></ch-linear-curve></ch-line-path></ch-domain-series>`;
  const markup = `
  <ch-title text="T" meta-description="d"></ch-title>
  <ch-cartesian-plane id="plane">
    <ch-axis id="x" orientation="bottom" meta-title="Month" tickcount="3" title="2024"><ch-linear-scale></ch-linear-scale></ch-axis>
    <ch-axis id="y" orientation="left" nice style-ticklabel-size="9"><ch-linear-scale></ch-linear-scale></ch-axis>
    ${series('s1')}${series('s2', '2025')}
  </ch-cartesian-plane>`
    .replace('<ch-title', '<ch-chart-title')
    .replace('</ch-title>', '</ch-chart-title>');
  const make = () => {
    const chart = document.createElement('ch-chart') as Wrapper;
    chart.platformOptions = { size: { width: 400, height: 200 }, preciseText: false, schedule: 'manual' };
    chart.setAttribute('id', 'chart');
    chart.innerHTML = markup;
    return chart;
  };
  // Hmm: the theme is a function-valued attribute, so it is a prop.
  const chart = make();
  chart.props = { theme: L.lightTheme };
  document.body.append(chart);

  // Markup becomes the tree `new` builds, with values converted as the classes say.
  const reference = new L.Chart(
    { id: 'chart', theme: L.lightTheme },
    new L.ChartTitle({ text: 'T', meta: { description: 'd' } }),
    new L.CartesianPlane(
      { id: 'plane' },
      new L.Axis({ id: 'x', orientation: 'bottom', meta: { title: 'Month' }, tickCount: 3, title: '2024' }, new L.LinearScale()),
      new L.Axis({ id: 'y', orientation: 'left', nice: true, style: { tickLabel: { size: 9 } } }, new L.LinearScale()),
      ...['s1', 's2'].map(
        (id) =>
          new L.DomainSeries(
            { id, name: id === 's1' ? 's1' : '2025' },
            new L.FlatDataSource({ data: [1, 3, 2, 5], regularDomain: { start: 0, step: 1 } }),
            new L.LinePath({ stroke: '#36c', strokeWidth: 2 }, new L.LinearCurve()),
          ),
      ),
    ),
  );
  const root = chart.element as L.Chart;
  assert.ok(
    JSON.stringify(L.toJSON(root, L.registry)) === JSON.stringify(L.toJSON(reference, L.registry)),
    'the same tree, attribute for attribute',
  );
  assert.equal((el(chart, '#x').element!.attrs as { title: string }).title, '2024', 'a title of digits stays text');

  // Drawn in a shadow root, which hides the tags.
  assert.ok(root.isAttached);
  root.flush();
  const svg = chart.shadowRoot!.querySelector('svg')!;
  assert.ok(svg && svg.querySelectorAll('path').length >= 3, 'drawn into the shadow root');
  assert.equal(svg.getAttribute('width'), '400');

  // Attributes follow: changed, removed, and objects given as props win.
  const x = el(chart, '#x');
  x.setAttribute('tickcount', '5');
  x.setAttribute('meta-title', 'Mois');
  await flush();
  assert.equal((x.element!.attrs as { tickCount: number }).tickCount, 5);
  assert.deepEqual(x.element!.attrs.meta, { title: 'Mois' });
  // Nested parts follow their class' spec: text stays text however it looks, and capitals are found from lowercase.
  x.setAttribute('meta-title', '2024');
  x.setAttribute('meta-role', 'true');
  await flush();
  assert.deepEqual(x.element!.attrs.meta, { title: '2024', role: 'true' }, 'meta parts are STRING');
  x.removeAttribute('meta-role');
  x.removeAttribute('meta-title');
  x.setAttribute('meta-title', 'Mois');
  await flush();
  x.removeAttribute('tickcount');
  await flush();
  assert.ok(!('tickCount' in x.element!.attrs), 'a removed attribute is removed');
  const fmt = (v: number) => `${v}!`;
  x.props = { format: fmt };
  assert.equal((x.element!.attrs as { format?: unknown }).format, fmt, 'a prop sets what HTML cannot carry');
  x.setAttribute('tickstep', '2');
  await flush();
  assert.equal((x.element!.attrs as { format?: unknown }).format, fmt, 'and stays when attributes change');
  assert.equal((x.element!.attrs as { tickStep?: number }).tickStep, 2);
  x.props = {};
  assert.ok(!('format' in x.element!.attrs), 'until the prop is taken away');

  // The document order is the tree order: insert, move and remove.
  const plane = el(chart, '#plane');
  const planeElement = plane.element!;
  assert.deepEqual(names(planeElement), ['x', 'y', 's1', 's2']);
  plane.insertAdjacentHTML('beforeend', series('s3'));
  plane.insertBefore(el(plane, '#s3'), el(plane, '#s1'));
  assert.deepEqual(names(planeElement), ['x', 'y', 's3', 's1', 's2'], 'inserted before a sibling');
  plane.append(el(plane, '#s3'));
  assert.deepEqual(names(planeElement), ['x', 'y', 's1', 's2', 's3'], 'moved to the end');
  el(plane, '#s1').remove();
  assert.deepEqual(names(planeElement), ['x', 'y', 's2', 's3'], 'removed');
  const s3 = el(plane, '#s3').element!;
  assert.equal(s3.parent, planeElement);
  plane.replaceChildren();
  assert.deepEqual(names(planeElement), [], 'the children of a removed subtree leave too');
  assert.equal(s3.parent, null);

  // A scale swapped in the markup.
  plane.insertAdjacentHTML('beforeend', `<ch-axis id="x2"><ch-linear-scale></ch-linear-scale></ch-axis>`);
  const x2 = el(plane, '#x2');
  x2.firstElementChild!.remove();
  x2.append(document.createElement('ch-log-scale'));
  assert.deepEqual(
    [...x2.element!].map((c) => c.constructor.name),
    ['LogScale'],
  );

  // Callbacks are DOM events.
  plane.insertAdjacentHTML('beforeend', `<ch-pointer-listener id="pl"></ch-pointer-listener>`);
  const listener = el(plane, '#pl');
  assert.equal((listener.element!.attrs as { onClick?: unknown }).onClick, undefined, 'no callback until someone listens');
  const got: unknown[] = [];
  listener.addEventListener('click', (e) => got.push((e as unknown as CustomEvent).detail));
  chart.addEventListener('click', () => got.push('bubbled'));
  (listener.element!.attrs as { onClick(i: unknown): void }).onClick({ x: 1 });
  assert.deepEqual(got, [{ x: 1 }, 'bubbled'], "a click event with the callback's argument, which bubbles");
  listener.setAttribute('onclick', 'ignored()');
  await flush();
  assert.equal(
    typeof (listener.element!.attrs as { onClick: unknown }).onClick,
    'function',
    "on… attributes are the DOM's: they switch the event on, and are not chart attributes",
  );
  assert.ok(!('onclick' in listener.element!.attrs));

  // Leaving the document detaches the chart; coming back draws it again.
  chart.remove();
  assert.ok(!root.isAttached);
  document.body.append(chart);
  assert.ok(root.isAttached);
  root.flush();
  assert.ok(chart.shadowRoot!.querySelectorAll('svg path').length >= 1);

  // Mistakes are errors naming the attribute.
  x2.setAttribute('tickcount', 'many');
  assert.throws(() => x2.sync(), /attribute 'tickCount': 'many' is not a number/);
  x2.removeAttribute('tickcount');
  x2.setAttribute('data', '[1,');
  assert.throws(() => x2.sync(), /not valid JSON/);
  x2.removeAttribute('data');
  x2.setAttribute('meta-title', 't');
  x2.setAttribute('meta', 'x');
  assert.throws(() => x2.sync(), /'meta' conflicts with 'meta-…'/);
  x2.removeAttribute('meta');
  x2.removeAttribute('meta-title');
  await flush();
  console.log('web components ok');

  // Nested names with capitals (cursor keys, Intl formats) are found from the lowercase HTML gives.
  {
    const sc = new L.IntlTimeScale();
    void sc;
    const cur = (await import('./cursor.ts')).Cursor;
    const tag = defineElements({ Cursor: cur, IntlTimeScale: L.IntlTimeScale }, { prefix: 'nest' });
    const host = document.createElement('div');
    host.innerHTML = `<nest-cursor keys-nextseries='["n"]'></nest-cursor><nest-intl-time-scale formats-hour-hourcycle="h23" formats-hour-timezone="UTC" formats-day-day="2-digit"></nest-intl-time-scale>`;
    document.body.append(host);
    type Synced = { sync(): void; element: { attrs: { keys?: unknown; formats?: unknown } } };
    const c = host.children[0] as unknown as Synced,
      t = host.children[1] as unknown as Synced;
    c.sync();
    t.sync();
    assert.deepEqual(c.element.attrs.keys, { nextSeries: ['n'] });
    assert.deepEqual(t.element.attrs.formats, { hour: { hourCycle: 'h23', timeZone: 'UTC' }, day: { day: '2-digit' } });
    void tag;
  }
});

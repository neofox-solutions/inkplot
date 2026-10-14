// Server rendering and hydration of the React adapter: the server draws the chart to markup, the browser keeps it, draws the live
// chart over it at the same size, and takes the markup away. The server half runs first, while there is no `document`.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { darkTheme, lightTheme, toSvgString } from './index.ts';
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale } from './react.ts';
import { test } from 'vite-plus/test';

const SIZE = { width: 420, height: 240, toSvg: toSvgString };

test('react ssr', async () => {
  const React = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { createElement: h, StrictMode } = React;
  assert.equal(typeof document, 'undefined', 'the server half runs without a DOM');

  const page = (theme = lightTheme, extra: React.ReactNode = null) =>
    h(
      Chart,
      { theme, hydrate: SIZE, hostProps: { id: 'host' } },
      h(
        CartesianPlane,
        null,
        h(Axis, { orientation: 'bottom' }, h(LinearScale)),
        h(Axis, { orientation: 'left' }, h(LinearScale)),
        h(
          DomainSeries,
          { name: 'a' },
          h(FlatDataSource, { data: [1, 3, 2, 5], regularDomain: { start: 0, step: 1 } }),
          h(LinePath, null, h(LinearCurve)),
        ),
        extra,
      ),
    );

  // On the server: one host div at the given size, holding the whole chart as SVG, the same text twice over.
  const html = renderToString(page());
  const server = renderToString(page());
  assert.equal(html, server, 'the same props give the same markup');
  assert.match(html, /^<div id="host" style="width:420px;height:240px"><div><svg /);
  assert.equal((html.match(/<svg /g) ?? []).length, 1);
  assert.match(html, /<path d="M/);
  assert.ok(renderToString(h(StrictMode, null, page())) === html, 'Strict Mode makes no difference');
  const dark = renderToString(page(darkTheme));
  assert.notEqual(dark, html, 'the theme given is the theme drawn');

  // What was drawn, in the order it was drawn: the geometry and the words.
  const picture = (root: ParentNode | string) => {
    if (typeof root === 'string') {
      return {
        paths: [...root.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]),
        texts: [...root.matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1]),
      };
    }
    return {
      paths: [...root.querySelectorAll('path')].map((p) => p.getAttribute('d')).filter((d) => d !== null),
      texts: [...root.querySelectorAll('text')].map((t) => t.textContent),
    };
  };

  // In the browser: hydrate without a warning, draw the live chart at once, drop the markup, and draw what the server drew.
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  const { hydrateRoot } = await import('react-dom/client');
  const { act } = React;

  const problems: unknown[][] = [];
  const spy = console.error;
  console.error = (...args: unknown[]) => void problems.push(args);
  try {
    for (const strict of [false, true]) {
      const markup = strict ? renderToString(h(StrictMode, null, page())) : html;
      const container = document.createElement('div');
      container.innerHTML = markup;
      document.body.append(container);
      const before = container.querySelector('svg');
      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, strict ? h(StrictMode, null, page()) : page());
      });
      assert.deepEqual(problems, [], 'no hydration warning');
      assert.equal(container.querySelectorAll('svg').length, 1, 'the markup was replaced, not added to');
      const live = container.querySelector('svg');
      assert.ok(live && live !== before, 'the live chart is a new drawing');
      assert.equal(container.querySelector('#host > div'), null, 'the server markup is gone');
      assert.deepEqual(picture(container), picture(html), 'the live chart is the one the server drew');
      assert.equal(live.getAttribute('width'), '420');

      // A theme that changes after hydration is drawn again.
      await act(async () => {
        root.render(strict ? h(StrictMode, null, page(darkTheme)) : page(darkTheme));
      });
      assert.deepEqual(picture(container), picture(dark), 'a new theme redraws the chart');
      assert.equal(container.querySelectorAll('svg').length, 1);
      await act(async () => root.unmount());
      container.remove();
    }
    assert.deepEqual(problems, [], 'no warnings at all');
  } finally {
    console.error = spy;
  }
});

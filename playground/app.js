import * as L from 'inkplot';
import { Wave, jsxChart } from 'playground/jsx-demo';
import { gistemp } from 'playground/gistemp';

document.getElementById('build-info').textContent = '__BUILD_INFO__';

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...kids.flat().filter((x) => x != null && x !== false));
  return e;
};
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: d }) : String(v));
const ms = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const bytes = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' kB' : n + ' B');

/** Controls. Each takes an `onChange` and returns the element; `set` updates it from code. */
const ui = {
  slider({ label, min, max, step = 1, value, log = false, format = fmt, onChange }) {
    const toPos = (v) => (log ? Math.log10(v) : v),
      fromPos = (p) => (log ? 10 ** p : p);
    const out = h('output', {}, format(value));
    const input = h('input', { type: 'range', min: toPos(min), max: toPos(max), step: log ? 'any' : step, value: toPos(value) });
    input.addEventListener('input', () => {
      let v = fromPos(+input.value);
      if (log) v = Math.round(v);
      else v = Math.round(v / step) * step;
      out.textContent = format(v);
      onChange(v);
    });
    return h('div', { class: 'field' }, h('label', {}, h('span', {}, label), out), input);
  },
  seg({ label, options, value, onChange, columns }) {
    const buttons = options.map(([v, text]) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(v === value),
          onclick: () => {
            buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v)));
            onChange(v);
          },
        },
        text,
      ),
    );
    return h(
      'div',
      { class: 'field' },
      label && h('div', { class: 'lab' }, label),
      h(
        'div',
        { class: 'seg' + (columns ? ' wrap' : ''), style: columns ? `grid-template-columns: repeat(${columns}, 1fr)` : undefined },
        buttons,
      ),
    );
  },
  toggle({ label, value, onChange }) {
    const input = h('input', { type: 'checkbox', checked: value });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' }, input, h('span', {}, label));
  },
  text({ label, value, onChange }) {
    const input = h('input', { type: 'text', value });
    input.addEventListener('input', () => onChange(input.value));
    return h('div', { class: 'field' }, h('label', {}, h('span', {}, label)), input);
  },
  buttons(...list) {
    return h(
      'div',
      { class: 'btns' },
      list.map(([text, fn]) => h('button', { class: 'btn', type: 'button', onclick: fn }, text)),
    );
  },
  note: (text, warn = false) => h('p', { class: 'note' + (warn ? ' warn' : '') }, text),
  readout: () => h('pre', { class: 'readout' }),
};

// Seeded random numbers, so a given seed always draws the same chart.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** n values of a named shape, over t in [0, 10]. */
function shape(kind, n, seed) {
  const r = rng(seed),
    y = new Float64Array(n);
  let walk = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / Math.max(1, n - 1)) * 10;
    switch (kind) {
      case 'walk':
        walk += gauss(r) * 0.05;
        y[i] = walk;
        break;
      case 'spikes':
        y[i] = 1.2 * Math.sin(t * 2) + (r() < (2 / n) * 8 ? (r() - 0.5) * 8 : 0) + gauss(r) * 0.05;
        break;
      default:
        y[i] = 1.5 * Math.sin(t * 3) + Math.sin(t * 17.3) * 0.3 + gauss(r) * 0.25;
    }
  }
  return y;
}

// ─────────────────────────────────────────────────────────────────────────────
// The stage: one chart on a DOMPlatform in a resizable box, plus the readouts
// ─────────────────────────────────────────────────────────────────────────────

/** The chart follows the page's light/dark choice: another base theme, nothing else. */
const isDark = () => document.documentElement.dataset.theme === 'dark';
/** The accessible variant of the theme, switched on by its own button: larger type in OpenDyslexic (if installed), stronger contrast, thicker lines. */
const isAccessible = () => document.documentElement.dataset.accessible === 'true';
const chartTheme = () => (isAccessible() ? (isDark() ? L.accessibleDarkTheme : L.accessibleTheme) : isDark() ? L.darkTheme : L.lightTheme);
/**
 * A cursor with a tooltip and a crosshair in it, as the demos use them. `mode` is how the tooltip reads: 'snap' the nearest
 * point with the box beside it, 'follow' the same with the box at the pointer, 'shared' every series at the cursor (with a
 * crosshair and a dot on each). The mode changes the cursor and the tooltip's `follow`, nothing else, so it can be switched live.
 */
function tipKit(mode = 'snap', tip = {}) {
  const tooltip = new L.ChartTooltip(tip);
  const crosshair = new L.Crosshair({ lines: 'first', dots: true });
  const cursor = new L.Cursor({}, crosshair, tooltip);
  const kit = {
    cursor,
    tooltip,
    crosshair,
    mode,
    setMode(m) {
      kit.mode = m;
      cursor.setAttribute('mode', m === 'shared' ? 'shared' : 'nearest');
      tooltip.setAttribute('follow', m === 'follow' ? true : undefined);
      crosshair.setAttribute('visible', m === 'shared');
    },
  };
  kit.setMode(mode);
  return kit;
}
/** The colour behind the chart, which a halo has to match. */
const pageBackground = () => (isDark() ? '#141c21' : '#ffffff');
let themeHooks = [];

const host = $('host');
let current = null; // { demo, chart, platform, dispose? }
const history = [];

/** A flush that did nothing (a resize that changed nothing, say) leaves the readouts as the last real one left them. */
function onFlush(stats) {
  if (stats.filled === 0 && stats.attributeWrites === 0) return;
  history.push(stats.total);
  if (history.length > 60) history.shift();
  probe.afterFlush(stats);
  readouts.show(stats);
  if (tab === 'json') jsonPanel.refresh();
  else if (tab === 'svg') svgPanel.soon();
  else renderPanel();
}

/** The SVG tab follows the chart, a moment after the last flush (an animation or a drag flushes every frame, and serialising the DOM is not free). */
const svgPanel = {
  timer: 0,
  soon() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = 0;
      if (tab === 'svg') renderPanel();
    }, 150);
  },
};

// ── Profiling aids ──────────────────────────────────────────────────────────
// What the browser does with a flush is not in the flush's own time: it styles, lays out and paints afterwards. These estimate it from the page
// (a profiler gives the exact figures; these are for a quick look, and the markers below are for finding the flush in one).
//  · render: from the end of a flush to the first task after the frame was drawn (a message posted during the frame is handled after the browser
//    has styled, laid out and painted), so it is style + layout + paint, as the page saw it. Exact in a frame callback, a loose upper bound elsewhere.
//  · layout probe: optional. It forces style and layout right after the flush and times that, which is the layout cost of the flush alone. Forcing it
//    takes that work out of the frame, so the render estimate falls by about as much; read one or the other.
//  · timer: the smallest step `performance.now()` is seen to make. A page that is not cross-origin isolated gets it coarsened by the browser.
//  · user timing: every flush is a `measure` named "inkplot flush", which the Chrome and Firefox profilers draw as a marker on the timeline.
const probe = (() => {
  const keep = (a, v) => (a.push(v), a.length > 60 && a.shift());
  const state = {
    render: [],
    layout: [],
    interval: [],
    busy: [],
    forceLayout: false,
    last: 0,
    timer: null,
    pending: 0,
  };
  const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  const waiting = [];
  if (channel) {
    channel.port1.onmessage = () => {
      const t = performance.now(),
        { end, flush, at } = waiting.shift() ?? {};
      if (end === undefined) return;
      const render = t - end;
      keep(state.render, render);
      if (at > 0) keep(state.busy, ((flush + render) / at) * 100);
      readouts.refresh();
    };
  }
  /** The finest step `performance.now()` takes, seen over a short spin; null if it never moves. */
  const measureTimer = () => {
    let best = Infinity;
    for (let i = 0, last = performance.now(); i < 20000; i++) {
      const t = performance.now(),
        d = t - last;
      if (d > 0) {
        best = Math.min(best, d);
        last = t;
      }
    }
    return Number.isFinite(best) ? best : null;
  };
  state.timer = measureTimer();
  return {
    state,
    afterFlush(stats) {
      const end = performance.now();
      const at = state.last ? end - state.last : 0;
      state.last = end;
      if (at > 0 && at < 2000) keep(state.interval, at);
      // The flush as a marker for a profiler. The entries are not needed here, so they are not allowed to pile up.
      try {
        performance.measure('inkplot flush', {
          start: end - stats.total,
          end,
          detail: { filled: stats.filled, writes: stats.attributeWrites, drawn: stats.pointsDrawn },
        });
        if (++state.pending > 100) {
          state.pending = 0;
          performance.clearMeasures('inkplot flush');
        }
      } catch {
        // an older browser: no user timing detail
      }
      if (state.forceLayout) {
        const svg = host.querySelector('svg');
        const t0 = performance.now();
        if (svg) svg.getBoundingClientRect();
        keep(state.layout, performance.now() - t0);
      }
      if (channel) {
        waiting.push({ end: performance.now(), flush: stats.total, at });
        channel.port2.postMessage(0);
      }
    },
    reset() {
      for (const k of ['render', 'layout', 'interval', 'busy']) state[k].length = 0;
      state.last = 0;
    },
  };
})();

/** The readouts are redrawn at most four times a second: rewriting them on every flush of an animation would be page layout of their own, in what is being measured. */
const readouts = (() => {
  let latest = null,
    timer = 0,
    shownAt = 0;
  const draw = () => {
    timer = 0;
    shownAt = performance.now();
    if (latest && current && history.length > 0) renderStats(latest);
  };
  return {
    show(stats) {
      latest = stats;
      if (timer) return;
      const wait = 250 - (performance.now() - shownAt);
      if (wait <= 0) draw();
      else timer = setTimeout(draw, wait);
    },
    /** A new demo: what is waiting to be shown belongs to the old one. */
    reset() {
      clearTimeout(timer);
      timer = 0;
      latest = null;
    },
    refresh() {
      if (!timer && latest && performance.now() - shownAt >= 250) draw();
    },
  };
})();

const stat = (a) => {
  if (a.length === 0) return null;
  const sorted = [...a].sort((x, y) => x - y);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], n: a.length };
};
/** Milliseconds: a third decimal when the timer can tell. */
const msf = (v) => (v < 1 && (probe.state.timer ?? 1) <= 0.011 ? v.toFixed(3) : ms(v));
const micro = (v) => (v === null ? 'n/a' : v < 0.001 ? '< 1 µs' : v < 1 ? `${+(v * 1000).toPrecision(2)} µs` : `${+v.toPrecision(2)} ms`);
const layoutToggle = h('input', {
  type: 'checkbox',
  id: 'probe-layout',
  onchange: (e) => {
    probe.state.forceLayout = e.target.checked;
    probe.state.layout.length = 0;
    probe.state.render.length = 0;
  },
});
const layoutToggleLabel = h(
  'label',
  {
    class: 'probe-toggle',
    for: 'probe-layout',
    title:
      'Forces style and layout right after each flush and times it. That takes the work out of the frame, so the render figure falls to match.',
  },
  layoutToggle,
  ' measure layout (forces it)',
);

function renderStats(s) {
  const sorted = [...history].sort((a, b) => a - b);
  const stages = ['generate', 'decimate', 'normalize', 'place', 'path'];
  const peak = Math.max(0.001, ...stages.map((k) => s.stages[k]));
  const svg = host.querySelector('svg');
  const size = current.platform.size();
  $('stats').replaceChildren(
    h(
      'div',
      {},
      h('div', { class: 'big' }, ms(s.total), h('small', {}, ' ms')),
      h('div', { class: 'sub' }, `median ${ms(sorted[sorted.length >> 1])} of ${history.length}`),
      h('div', { class: 'sub' }, `${size.width} × ${size.height}`),
    ),
    h(
      'div',
      {},
      h(
        'div',
        { class: 'bars' },
        stages.map((k) =>
          h(
            'div',
            { class: 'bar' },
            h('span', {}, k),
            h('i', { style: `width:${(s.stages[k] / peak) * 100}%` }),
            h('span', {}, ms(s.stages[k]) + ' ms'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'kv' },
        kv('points in', fmt(s.pointsIn, 0)),
        kv('points drawn', fmt(s.pointsDrawn, 0)),
        kv('fills', `${s.filled} (+${s.fillsCached} cached)`),
        kv('projected', s.projected),
        kv('attr writes', `${s.attributeWrites} (${s.attributeWritesSkipped} skipped)`),
        kv('path data', bytes(s.pathBytes)),
        kv('svg nodes', svg ? svg.querySelectorAll('*').length : 0),
        kv('written', s.attributesWritten.slice(0, 3).join(' ') + (s.attributesWritten.length > 3 ? ' …' : '')),
      ),
      h('div', { class: 'kv frame' }, ...frameRows()),
      layoutToggleLabel,
    ),
  );
}
/** What the page spent round the flush: see the profiling aids above. */
function frameRows() {
  const p = probe.state;
  const row = (name, a, unit = 'ms') => {
    const st = stat(a);
    return st
      ? kv(
          name,
          unit === '%'
            ? `${st.median.toFixed(0)} % · p95 ${st.p95.toFixed(0)} %`
            : `${msf(st.median)} · p95 ${msf(st.p95)} · max ${msf(st.max)} ms`,
        )
      : null;
  };
  const gap = stat(p.interval);
  return [
    kv(
      'flush (60)',
      (() => {
        const st = stat(history);
        return st ? `${msf(st.median)} · p95 ${msf(st.p95)} · max ${msf(st.max)} ms` : 'n/a';
      })(),
    ),
    row('render est.', p.render),
    p.forceLayout ? row('layout (forced)', p.layout) : null,
    gap ? kv('between flushes', `${msf(gap.median)} ms · ${(1000 / gap.median).toFixed(0)} per s`) : null,
    row('busy', p.busy, '%'),
    kv('timer', `${micro(p.timer)}${typeof crossOriginIsolated === 'boolean' && crossOriginIsolated ? ' · isolated' : ''}`),
  ].filter(Boolean);
}
const kv = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, String(v)));

function mount(demo) {
  if (current) {
    current.chart.detach();
    current.platform.dispose();
    current.dispose?.();
  }
  history.length = 0;
  probe.reset();
  readouts.reset();
  $('controls').replaceChildren();
  themeHooks = [];
  host.querySelectorAll('svg').forEach((n) => n.remove());
  const platform = new L.DOMPlatform(host);
  const ctx = {
    controls: $('controls'),
    onFlush,
    /** Called when the page switches between light and dark, for what depends on the background (a halo). */
    onTheme: (fn) => themeHooks.push(fn),
    add: (...els) => $('controls').append(...els),
    host,
  };
  /** The names that stay: the page's own and the ones a demo gave. The rest were made up while writing JSON, and go when the data they named is replaced. */
  const kept = new Set(['lightTheme', 'darkTheme', 'accessibleTheme', 'accessibleDarkTheme']);
  const refs = new L.Refs(
    { lightTheme: L.lightTheme, darkTheme: L.darkTheme, accessibleTheme: L.accessibleTheme, accessibleDarkTheme: L.accessibleDarkTheme },
    { auto: true },
  );
  /** A demo names the data it keeps editing, so that JSON refers to it and editing the JSON cannot swap it for a copy. */
  ctx.name = (name, value) => {
    const given = refs.adopt(value, name);
    kept.add(given);
    return given;
  };
  const built = demo.setup(ctx);
  current = { demo, platform, chart: built.chart, dispose: built.dispose, root: built.chart, refs, kept };
  jsonPanel.reset();
  built.chart.attach(platform);
  renderPanel();
}

new ResizeObserver(() => {
  $('host-size').textContent = `${host.clientWidth} × ${host.clientHeight}`;
}).observe(host);

// ─── Panels under the chart ───

// ─── JSON: any chart as JSON, editable live ───

/** The classes of the library, and the ones this page defines, by the names JSON uses for them. */
const pageRegistry = () => ({ ...L.registry, Watermark, SignedPowerScale, EventProbe });
const JSON_LIMIT = 24; // longer arrays are data (rows, samples), and go by reference, so that the text stays readable

const jsonPanel = {
  area: null,
  status: null,
  copyHost: null,
  copy: null,
  dirty: false,
  timer: 0,
  good: '',
  /** A new demo: forget edits in progress. */
  reset() {
    this.dirty = false;
    clearTimeout(this.timer);
    this.good = '';
    this.disposeCopy();
  },
  disposeCopy() {
    if (this.copy) {
      this.copy.chart.detach();
      this.copy.platform.dispose();
      this.copy = null;
    }
    this.copyHost?.remove();
    this.copyHost = null;
  },
  options() {
    return { refs: current.refs, inlineLimit: JSON_LIMIT };
  },
  /** The live chart as indented JSON, or the reason it cannot be. */
  text() {
    try {
      const text = JSON.stringify(L.toJSON(current.chart, pageRegistry(), this.options()), null, 2);
      // Data a demo replaces (new samples for a transform) would be named afresh each time: drop the names this text no longer uses.
      const used = new Set([...text.matchAll(/"\$ref": "([^"]*)"/g)].map((m) => m[1]));
      for (const n of current.refs.names) if (!current.kept.has(n) && !used.has(n)) current.refs.forget(n);
      return { text };
    } catch (e) {
      return { error: e.message };
    }
  },
  say(text, bad = false) {
    this.status.className = bad ? 'bad' : 'ok';
    this.status.textContent = text;
  },
  byRef() {
    const names = current.refs.names.filter((n) => !['lightTheme', 'darkTheme', 'accessibleTheme', 'accessibleDarkTheme'].includes(n));
    return names.length ? `by reference, from the page: ${names.join(', ')}` : 'everything is in the JSON';
  },
  render(panel) {
    this.area = h('textarea', { class: 'json', spellcheck: 'false', 'aria-label': 'Chart as JSON; edits apply live' });
    this.area.addEventListener('input', () => {
      this.dirty = true;
      clearTimeout(this.timer);
      this.say('editing…');
      this.timer = setTimeout(() => this.apply(), 350);
    });
    this.area.addEventListener('blur', () => {
      if (!this.dirty) this.refresh();
    });
    this.area.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    });
    this.status = h('span', {});
    this.copyHost = null;
    panel.replaceChildren(
      h(
        'p',
        { class: 'note' },
        'The chart, written with toJSON. Edit it and the live chart follows (applyJSON changes only what differs, so zoom and data stay). Functions and long data are ',
        h('code', {}, '{ "$ref": … }'),
        ': names for objects the page holds, found again when the JSON is read.',
      ),
      this.area,
      h(
        'div',
        { class: 'jsonbar' },
        this.status,
        h('button', { class: 'btn', type: 'button', onclick: () => this.preview() }, 'Draw a copy with fromJSON'),
        h('button', { class: 'btn', type: 'button', onclick: () => navigator.clipboard?.writeText(this.area.value) }, 'Copy'),
      ),
    );
    this.refresh(true);
  },
  /** Bring the text up to date with the chart, unless someone is in the middle of editing it. */
  refresh(force = false) {
    if (!this.area || !this.area.isConnected) return;
    if (!force && (this.dirty || document.activeElement === this.area)) return;
    const r = this.text();
    if (r.error) {
      this.area.value = '';
      this.say(r.error, true);
      return;
    }
    if (this.area.value !== r.text) this.area.value = r.text;
    this.good = r.text;
    this.say(this.byRef());
  },
  apply() {
    let json;
    try {
      json = JSON.parse(this.area.value);
    } catch (e) {
      this.say('not JSON yet: ' + e.message, true);
      return;
    }
    try {
      L.applyJSON(current.chart, json, pageRegistry(), this.options());
      current.chart.flush();
    } catch (e) {
      this.say(e.message, true);
      // Reading failures change nothing; a layout that cannot draw this does, so go back to what last worked.
      try {
        L.applyJSON(current.chart, JSON.parse(this.good), pageRegistry(), this.options());
        current.chart.flush();
      } catch {
        /* nothing more to do */
      }
      return;
    }
    this.good = this.area.value;
    this.dirty = false;
    this.say('applied · ' + this.byRef());
  },
  /** Build a second chart from the text with fromJSON, to show what a reader of this JSON would get. */
  preview() {
    this.disposeCopy();
    try {
      const chart = L.fromJSON(JSON.parse(this.area.value), pageRegistry(), this.options());
      this.copyHost = h('div', { class: 'copyhost' });
      this.area.parentElement.append(this.copyHost);
      const platform = new L.DOMPlatform(this.copyHost);
      chart.attach(platform);
      chart.flush();
      this.copy = { chart, platform };
      this.say('drawn from the text with fromJSON, below');
    } catch (e) {
      this.say(e.message, true);
    }
  },
};

let tab = 'tree';
const tabs = { tree: 'Element tree', json: 'JSON', svg: 'SVG output', coverage: 'Coverage' };
function renderTabs() {
  $('tabs').replaceChildren(
    ...Object.entries(tabs).map(([id, text]) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(id === tab),
          onclick: () => {
            tab = id;
            renderTabs();
            renderPanel();
          },
        },
        text,
      ),
    ),
  );
}
function describe(el) {
  const a = Object.entries(el.attrs)
    .filter(([, v]) => typeof v !== 'object' && typeof v !== 'function')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join(' ');
  return el.constructor.name + (a ? '  ' + a : '');
}
function renderPanel() {
  if (!current) return;
  const panel = $('panel');
  switch (tab) {
    case 'tree': {
      const lines = [];
      L.walk(current.chart, (el, depth) => {
        lines.push('  '.repeat(depth) + describe(el));
      });
      panel.replaceChildren(h('pre', { class: 'view' }, lines.join('\n')));
      break;
    }
    case 'svg': {
      const svg = host.querySelector('svg');
      const text = svg ? svg.outerHTML.replace(/></g, '>\n<') : '';
      const shown = text.length > 30000 ? text.slice(0, 30000) + '\n… (' + bytes(text.length) + ' in all)' : text;
      panel.replaceChildren(
        h(
          'p',
          { class: 'note' },
          `${bytes(text.length)} as the browser serialises the live DOM. `,
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () => download('chart.svg', L.toSvgString(current.chart, { width: host.clientWidth, height: host.clientHeight })),
            },
            'Download via StringPlatform',
          ),
        ),
        h('pre', { class: 'view' }, shown),
      );
      break;
    }
    case 'json':
      jsonPanel.render(panel);
      break;
    case 'coverage':
      panel.replaceChildren(coverage());
      break;
  }
}
function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })), download: name });
  a.click();
}

/** What exists and what is only declared: each class is constructed, and a declared one says so by throwing. */
function coverage() {
  const scale = () => new L.LinearScale();
  const data = () => new L.FlatDataSource({ data: new Float64Array([1, 2]), regularDomain: { start: 0, step: 1 } });
  const groups = {
    Scales: ['LinearScale', 'LogScale', 'SqrtScale', 'BandScale', 'IntlTimeScale', 'TemporalTimeScale'],
    Planes: ['CartesianPlane', 'PolarPlane'],
    Dimensions: ['Axis', 'ColorAxis', 'ScalarAxis', 'ColorKey', 'SizeKey'],
    'Data sources': ['FlatDataSource', 'ObjectDataSource', 'SyntheticDataSource', 'CompositeDataSource'],
    Grouping: ['Stack'],
    Patterns: ['LinePattern', 'HatchPattern', 'DotPattern'],
    Transforms: ['Decimator', 'BoxStats', 'Density', 'LinearTrend', 'PolynomialTrend', 'SinusoidalTrend', 'LoessTrend', 'MeanTrend'],
    Kernels: ['MinMaxKernel', 'M4Kernel', 'LttbKernel', 'StrideKernel'],
    Curves: [
      'LinearCurve',
      'StepCurve',
      'MonotoneCurve',
      'NaturalCurve',
      'CardinalCurve',
      'CatmullRomCurve',
      'BasisCurve',
      'BumpCurve',
      'QuadraticCurve',
      'ArcCurve',
    ],
    Renderers: [
      'LinePath',
      'AreaPath',
      'DotMarker',
      'CrossMarker',
      'PlusMarker',
      'CircleMarker',
      'SquareMarker',
      'BarPath',
      'StemPath',
      'BoxPath',
      'ErrorBars',
      'ErrorBand',
      'HeatMap',
    ],
    'Chart furniture': [
      'ChartTitle',
      'Cursor',
      'Crosshair',
      'ChartTooltip',
      'Legend',
      'ChartSummary',
      'LineAnnotation',
      'CalloutAnnotation',
      'PanZoom',
      'BoxZoom',
      'Brush',
      'PointerListener',
    ],
  };
  const make = {
    ColorKey: () => new L.ColorKey({ dimension: new L.ColorAxis({}, scale()) }),
    SizeKey: () => new L.SizeKey({ dimension: new L.ScalarAxis({}, scale()) }),
    BandScale: () => new L.BandScale({ categories: ['a', 'b'] }),
    Axis: () => new L.Axis({}, scale()),
    ColorAxis: () => new L.ColorAxis({}, scale()),
    ScalarAxis: () => new L.ScalarAxis({}, scale()),
    ObjectDataSource: () => new L.ObjectDataSource({ source: [], domain: 't', value: 'v' }),
    SyntheticDataSource: () => new L.SyntheticDataSource({ fn: Math.sin, domain: { min: 0, max: 1 } }),
    CompositeDataSource: () => new L.CompositeDataSource({ count: 0, domain: [], value: [] }),
    FlatDataSource: data,
    Decimator: () => new L.Decimator({}, new L.MinMaxKernel(), data()),
    Stack: () => new L.Stack({}),
    ChartTitle: () => new L.ChartTitle({ text: 'x' }),
    LineAnnotation: () => new L.LineAnnotation({ value: 0 }),
    CalloutAnnotation: () => new L.CalloutAnnotation({ domain: 0, value: 0, text: 'x' }),
  };
  const state = (name) => {
    try {
      (make[name] ?? (() => new L[name]()))();
      return true;
    } catch (e) {
      return /not implemented/.test(String(e.message)) ? false : true;
    }
  };
  const platform = (() => {
    try {
      new L.DOMPlatform(document.createElement('div')).dispose();
      return true;
    } catch {
      return false;
    }
  })();
  const extra = {
    Platforms: [
      ['StringPlatform', true],
      ['DOMPlatform', platform],
    ],
    Serialization: [
      ['toJSON', true],
      ['fromJSON', true],
      ['applyJSON', true],
      ['Refs', true],
      ['registry', true],
    ],
  };
  const wrap = h('div', {});
  let done = 0,
    total = 0;
  const group = (title, items) => {
    wrap.append(
      h(
        'div',
        { class: 'group' },
        h('div', { class: 'lab' }, title),
        h(
          'div',
          { class: 'chips' },
          items.map(([name, ok]) => {
            total++;
            if (ok) done++;
            return h('span', { class: 'chip' + (ok ? '' : ' stub'), title: ok ? 'implemented' : 'declared, not implemented' }, name);
          }),
        ),
      ),
    );
  };
  for (const [title, names] of Object.entries(groups))
    group(
      title,
      names.map((n) => [n, state(n)]),
    );
  for (const [title, items] of Object.entries(extra)) group(title, items);
  wrap.prepend(
    h('p', { class: 'note' }, `${done} of ${total} implemented. Dashed chips are declared in the library and throw when constructed.`),
  );
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Demos
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE = ['#2a6fdb', '#d9534f', '#2e9e6b', '#e0a030', '#8a5cd0', '#17a2b8'];

const demos = [];

// ── 0. Headline: the warming spiral ──────────────────────────────────────────
// One chart, two polar planes laid over each other (a one-cell ChartGroup). Inside, each year is a ring of twelve months, coloured by the year's anomaly.
// Outside, the same years are a ring of stripes: bars on a polar plane whose fill is bound to a colour axis and whose opacity is
// bound to a function of the year, so the years still to come dim as the spiral plays. The numbers are the real record: NASA GISS
// GISTEMP v4 (see playground/gistemp.js for the source), and the page's caption credits it.
const HERO = { FIRST: gistemp.first, LAST: gistemp.first + gistemp.months.length - 1 };
const heroData = {
  months: gistemp.months,
  annual: gistemp.months.map((r) => r.reduce((x, y) => x + y, 0) / 12),
};

demos.push({
  id: 'hero',
  title: 'Warming spiral',
  blurb:
    'A century and a half of the NASA global temperature record: bound bars on a polar plane, a group of 146 rings, a callout in the middle, played from outside',
  setup(ctx) {
    const { FIRST, LAST } = HERO;
    const { months, annual } = heroData;
    const N = LAST - FIRST + 1;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const S = { year: LAST, pinned: LAST, trail: 0, speed: 14, playing: false };
    const fg = () => (isDark() ? '#eef3f6' : '#1b2a33');
    const signed = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' °C';
    const hottest = annual.indexOf(Math.max(...annual)) + FIRST;
    const coldest = annual.indexOf(Math.min(...annual)) + FIRST;

    // The ramp both rings share: a colour axis, which the stripes bind their fill to and the spiral's group reads for each ring's stroke.
    const LIM = 1.5;
    const heat = new L.ColorAxis(
      {
        id: 'heat',
        title: 'Annual anomaly (°C)',
        ramp: ['#2c5aa0', '#4a90c8', '#9ecae1', '#e8eef2', '#f6c58d', '#e8744f', '#b3202a', '#6e0b1f'],
        min: -LIM,
        max: LIM,
        format: (v) => (v > 0 ? '+' : '') + v.toFixed(1),
      },
      new L.LinearScale(),
    );

    // ── The outer ring: one wedge a year, all the same height, coloured and dimmed by the data.
    const stripes = new L.BarPath({ id: 'stripes', width: 1, stroke: 'none', maxNodes: 2500 });
    const ringSeries = new L.DomainSeries(
      { domainAxis: 'yr', valueAxis: 'one' },
      new L.ObjectDataSource({
        source: annual.map((a, i) => ({ year: FIRST + i, centre: FIRST + i + 0.5, one: 1, a })),
        domain: 'centre',
        value: 'one',
        isSorted: true,
        channels: { a: 'a', year: 'year' },
      }),
      stripes,
    );
    const ringNotes = new L.PointAnnotations({ anchor: 'stripes', shape: 'text', contain: false, offset: 6, text: () => null });
    const ring = new L.PolarPlane(
      { innerRadius: 0.9, gridlines: false },
      new L.Axis(
        {
          id: 'yr',
          orientation: 'angle',
          min: FIRST,
          max: LAST + 1,
          ticks: [1900, 1920, 1940, 1960, 1980, 2000, 2020],
          format: (v) => String(v),
        },
        new L.LinearScale(),
      ),
      new L.Axis({ id: 'one', orientation: 'radius', min: 0, max: 1, visible: false }, new L.LinearScale()),
      ringSeries,
      ringNotes,
    );

    // ── The spiral: a ring of twelve months for each year.
    const R_MIN = -2.2,
      R_MAX = 3.9;
    // One group draws all of them: rows of (month, anomaly, year), month by month, so the domain ascends, and the year is the
    // channel that splits them. The ring is closed with January of the next year.
    const ringRows = new Float64Array(13 * N * 3);
    for (let m = 0, k = 0; m <= 12; m++)
      for (let i = 0; i < N; i++, k += 3) {
        ringRows[k] = m;
        ringRows[k + 1] = m < 12 ? months[i][m] : (months[i + 1]?.[0] ?? months[i][11]);
        ringRows[k + 2] = FIRST + i;
      }
    // What the bindings read from outside is the year being played: invalidating the group says it has moved.
    const ringOpacity = (y) => {
      const age = Math.round(S.year) - y;
      if (age < 0 || (S.trail && age >= S.trail)) return 0;
      return S.trail ? Math.max(0.12, 1 - age / S.trail) : 0.2 + 0.55 * ((y - FIRST) / (N - 1));
    };
    const rings = new L.SeriesGroup(
      {
        channel: 'year',
        domainAxis: 'month',
        valueAxis: 'anomaly',
        maxGroups: N,
        bind: {
          stroke: { axis: heat, value: (y) => annual[y - FIRST] },
          strokeWidth: { map: (y) => 0.6 + ((y - FIRST) / (N - 1)) * 0.9 },
          opacity: { map: ringOpacity },
        },
      },
      new L.FlatDataSource({ data: ringRows, stride: 3, channels: { year: 2 }, isSorted: true }),
      new L.LinePath({}, new L.CatmullRomCurve()),
    );
    const nowSource = new L.FlatDataSource({ data: [...months[N - 1], months[N - 1][0]], regularDomain: { start: 0, step: 1 } });
    const nowLine = new L.LinePath({ id: 'now', strokeWidth: 2.6, stroke: fg() }, new L.CatmullRomCurve());
    const nowDots = new L.CircleMarker({ size: 3, fill: fg(), stroke: 'none' });
    const nowSeries = new L.DomainSeries({ domainAxis: 'month', valueAxis: 'anomaly' }, nowSource, nowLine, nowDots);
    // The month names ride on a series of twelve invisible points, so they are notes like any other.
    const names = new L.DomainSeries(
      { domainAxis: 'month', valueAxis: 'anomaly' },
      new L.FlatDataSource({ data: new Array(12).fill(2.55), regularDomain: { start: 0.5, step: 1 } }),
      new L.DotMarker({ id: 'names', size: 0, opacity: 0 }),
    );
    const monthNotes = new L.PointAnnotations({
      anchor: 'names',
      shape: 'text',
      contain: false,
      offset: 0,
      placement: 'center',
      text: (hit) => MONTHS[Math.floor(hit.first)],
    });
    const limit = new L.LineAnnotation({
      value: 1.5,
      label: '+1.5 °C',
      stroke: '#e8744f',
      strokeWidth: 1,
      style: { annotationLine: { dash: '3 4' } },
    });
    const yearNote = new L.CalloutAnnotation({ domain: 0, value: R_MIN, text: String(LAST), dx: 0, dy: -4 });
    const anomalyNote = new L.CalloutAnnotation({ domain: 0, value: R_MIN, text: signed(annual[N - 1]), dx: 0, dy: 30 });
    const bare = { callout: { outline: 'none' }, calloutBox: { fill: 'none', stroke: 'none' }, calloutArm: { stroke: 'none' } };
    const restyle = () => {
      yearNote.setAttribute('style', { ...bare, calloutText: { size: 46, weight: 700, color: fg() } });
      anomalyNote.setAttribute('style', { ...bare, calloutText: { size: 17, weight: 500, color: fg() } });
      nowLine.setAttribute('stroke', fg());
      nowDots.setAttribute('fill', fg());
    };
    restyle();
    ctx.onTheme(restyle);
    const spiral = new L.PolarPlane(
      { gridlines: true },
      new L.Axis({ id: 'month', orientation: 'angle', min: 0, max: 12, tickStep: 1, visible: false }, new L.LinearScale()),
      new L.Axis(
        { id: 'anomaly', orientation: 'radius', min: R_MIN, max: R_MAX, ticks: [0, 1, 2], format: (v) => (v === 0 ? '0 °C' : `+${v}`) },
        new L.LinearScale(),
      ),
      rings,
      limit,
      nowSeries,
      names,
      monthNotes,
      yearNote,
      anomalyNote,
    );

    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: ctx.onFlush,
        padding: 26,
        meta: {
          title: 'Warming spiral',
          description: 'Global monthly temperature anomalies relative to 1951–1980, 1880 to 2025 (NASA GISS GISTEMP v4)',
        },
      },
      heat,
      new L.ChartGroup({ columns: 1, rows: 1, gap: 0 }, new L.ChartGroupItem({}, spiral), new L.ChartGroupItem({}, ring)),
      new L.ChartTitle({ text: 'A century and a half of warming', role: 'title' }),
      new L.ChartTitle({ text: 'Each ring is a year, January at the top; the stripes outside are the same years', role: 'subtitle' }),
      new L.ChartTitle({
        text: 'Data: NASA GISS Surface Temperature Analysis (GISTEMP v4), global land-ocean anomalies vs 1951–1980 · NASA GISS/GISTEMP',
        role: 'caption',
      }),
      new L.ColorKey({ dimension: heat, side: 'bottom' }),
    );
    chart.setAttribute('style', { chartTitle: { align: 'middle' }, chartSubtitle: { align: 'middle' }, chartCaption: { align: 'middle' } });

    // ── What changes as the year moves.
    const show = () => {
      const yr = Math.round(S.year),
        i = yr - FIRST;
      rings.invalidate();
      nowSource.setAttributes({ data: [...months[i], months[i][0]], regularDomain: { start: 0, step: 1 } });
      yearNote.setAttribute('text', String(yr));
      anomalyNote.setAttribute('text', signed(annual[i]));
      // The years to come are faint: a function of the year makes it, and a new one each time says the answer has changed.
      stripes.setAttribute('bind', {
        fill: { axis: heat, channel: 'a' },
        opacity: { channel: 'year', map: (y) => (y <= yr ? 1 : 0.14) },
      });
      ringNotes.setAttribute('text', (hit) => {
        const y = Math.floor(hit.first);
        return y === yr
          ? String(y)
          : Math.abs(y - yr) < 9
            ? null
            : y === hottest && y < yr
              ? `hottest, ${y}`
              : y === coldest && y < yr
                ? `coldest, ${y}`
                : null;
      });
      if (yearSlider) yearSlider.set(yr);
    };

    // ── Playing it.
    let raf = 0,
      last = 0,
      playButton = null,
      yearSlider = null;
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const before = Math.round(S.year);
      S.year = Math.min(LAST, S.year + dt * S.speed);
      if (Math.round(S.year) !== before) show();
      if (S.year >= LAST) {
        S.pinned = LAST;
        return stop();
      }
      raf = requestAnimationFrame(frame);
    };
    const play = () => {
      if (S.year >= LAST) S.year = FIRST;
      S.playing = true;
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      show();
      refreshButton();
    };
    const stop = () => {
      S.playing = false;
      cancelAnimationFrame(raf);
      refreshButton();
    };
    const refreshButton = () => {
      if (playButton) playButton.textContent = S.playing ? 'Pause' : S.year >= LAST ? 'Replay' : 'Play';
    };

    playButton = h('button', { type: 'button', onclick: () => (S.playing ? stop() : play()) }, 'Replay');
    yearSlider = (() => {
      const f = ui.slider({
        label: 'year',
        min: FIRST,
        max: LAST,
        value: LAST,
        format: (v) => String(v),
        onChange: (v) => {
          stop();
          S.pinned = S.year = v;
          show();
          refreshButton();
        },
      });
      const input = f.querySelector('input'),
        out = f.querySelector('output');
      return {
        el: f,
        set: (v) => {
          input.value = v;
          out.textContent = String(v);
        },
      };
    })();
    ctx.add(
      h('div', { class: 'field' }, h('div', { class: 'seg' }, playButton)),
      yearSlider.el,
      ui.seg({
        label: 'rings shown',
        options: [
          [0, 'all so far'],
          [40, '40 years'],
          [15, '15 years'],
        ],
        value: 0,
        onChange: (v) => {
          S.trail = v;
          show();
        },
      }),
      ui.seg({
        label: 'speed',
        options: [
          [6, 'slow'],
          [14, 'medium'],
          [40, 'fast'],
        ],
        value: 14,
        onChange: (v) => (S.speed = v),
      }),
      ui.note(
        'Hover the stripes to scrub the spiral; click one to pin its year. One chart with two polar planes. The outer ring is a bar series on a polar plane whose fill is bound to a colour axis and whose opacity is bound to a function of the year (the years to come dim). The spiral is one `SeriesGroup`: a ring for each year, its colour, width and opacity bound to the year (the opacity reads the year being played, so moving it invalidates the group and nothing is refilled); the month names are notes on twelve invisible points; the year in the middle is a callout with no box. The data are NASA GISS GISTEMP v4 global land-ocean anomalies against 1951–1980, 1880–2025 (source and citation in playground/gistemp.js).',
      ),
    );
    // Hover the stripes (when nothing is playing) and the spiral follows the pointer; off them it goes back to the pinned year. A click pins it.
    // The two planes share one box, so the pointer is read here, against the ring's own circle.
    const yearAt = (ev) => {
      const box = ctx.host.getBoundingClientRect(),
        r = ring.rect;
      const dx = ev.clientX - box.left - (r.x + r.width / 2),
        dy = ev.clientY - box.top - (r.y + r.height / 2);
      const radius = Math.min(r.width, r.height) / 2,
        d = Math.hypot(dx, dy);
      if (d < radius * 0.8 || d > radius * 1.08) return null;
      const turn = (((Math.atan2(dx, -dy) / (2 * Math.PI)) % 1) + 1) % 1;
      return FIRST + Math.min(N - 1, Math.floor(turn * N));
    };
    const onMove = (ev) => {
      if (S.playing) return;
      const y = yearAt(ev);
      ctx.host.style.cursor = y === null ? '' : 'pointer';
      const next = y ?? S.pinned;
      if (next !== S.year) {
        S.year = next;
        show();
      }
    };
    const onLeave = () => onMove({ clientX: -1e6, clientY: -1e6 });
    const onClick = (ev) => {
      const y = yearAt(ev);
      if (y === null) return;
      stop();
      S.pinned = S.year = y;
      show();
    };
    ctx.host.addEventListener('pointermove', onMove);
    ctx.host.addEventListener('pointerleave', onLeave);
    ctx.host.addEventListener('click', onClick);

    // A tall stage: this one is a circle.
    ctx.host.style.height = '800px';
    S.year = FIRST;
    show();
    // Start it going, once the chart is on the page, unless the visitor would rather things did not move.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      S.year = S.pinned = LAST;
      show();
    }
    const starter = still ? 0 : setTimeout(play, 500);
    return {
      chart,
      dispose: () => {
        clearTimeout(starter);
        cancelAnimationFrame(raf);
        ctx.host.removeEventListener('pointermove', onMove);
        ctx.host.removeEventListener('pointerleave', onLeave);
        ctx.host.removeEventListener('click', onClick);
        ctx.host.style.cursor = '';
        ctx.host.style.height = '';
      },
    };
  },
});

// ── 0b. Headline: a cluster dashboard ────────────────────────────────────────
// The second hero, for the other kind of page: dense, many kinds of metric together, and the odd one out has to be seen at a glance.
// One chart, one ChartGroup of twelve columns: four headline numbers with a sparkline each, a latency chart and a restarts chart,
// and a sparkline for every node of the cluster, all on the same 0–100 scale so a node that stands out does so by its height.
// Everything is made up (see `clusterData`), with four things going wrong at known moments. Time advances by moving a `Slice`
// along each series' history: nothing is refilled but the window.
const clusterData = (() => {
  const T = 2400,
    NODES = 24;
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Noise that remembers where it was, so a series wanders and does not fizz.
  const walk = (n, keep, size) => {
    const out = new Float64Array(n);
    let v = 0;
    for (let i = 0; i < n; i++) out[i] = v = v * keep + (rand() - 0.5) * size;
    return out;
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const DEAD = 18,
    DEAD_AT = 1000,
    SPIKE = 6,
    LEAK = 12,
    FLAP = 2;
  const SPIKE_FROM = 700,
    SPIKE_TO = 790,
    LEAK_FROM = 1300,
    LEAK_TO = 1900;
  const day = (t) => Math.sin(t / 380) * 9;
  const cpu = [];
  for (let n = 0; n < NODES; n++) {
    const base = 26 + ((n * 7) % 19),
      phase = n * 0.7,
      noise = walk(T, 0.9, 7),
      a = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      let v = base + day(t) + Math.sin(t / 55 + phase) * 4 + noise[t];
      if (t >= DEAD_AT && n !== DEAD) v += 5; // the dead node's work goes elsewhere
      if (n === SPIKE && t >= SPIKE_FROM && t < SPIKE_TO) v = 91 + Math.min(8, (t - SPIKE_FROM) / 6) + (rand() - 0.5) * 4;
      if (n === LEAK && t >= LEAK_FROM) v += Math.min(55, ((t - LEAK_FROM) / (LEAK_TO - LEAK_FROM)) * 60);
      if (n === FLAP && t > 400 && t < 520) v += Math.sin(t * 1.9) * 24;
      a[t] = n === DEAD && t >= DEAD_AT ? 0 : clamp(v, 1, 99);
    }
    cpu.push(a);
  }
  const traffic = walk(T, 0.97, 0.12);
  const rps = new Float64Array(T),
    p99 = new Float64Array(T),
    errors = new Float64Array(T),
    up = new Float64Array(T),
    restarts = new Float64Array(T);
  const jitter = walk(T, 0.6, 14),
    errNoise = walk(T, 0.5, 0.06);
  for (let t = 0; t < T; t++) {
    let hottest = 0;
    for (let n = 0; n < NODES; n++) hottest = Math.max(hottest, cpu[n][t]);
    const sinceDeath = t - DEAD_AT;
    rps[t] = 4200 * (1 + 0.3 * Math.sin(t / 380 - 0.6) + traffic[t]) * (t >= SPIKE_FROM && t < SPIKE_TO ? 0.92 : 1);
    p99[t] = 98 + jitter[t] + 6.5 * Math.max(0, hottest - 66) + (sinceDeath >= 0 ? 60 * Math.exp(-sinceDeath / 45) : 0);
    errors[t] =
      0.12 + Math.abs(errNoise[t]) + (t >= SPIKE_FROM && t < SPIKE_TO ? 2.4 : 0) + (sinceDeath >= 0 ? 1.6 * Math.exp(-sinceDeath / 30) : 0);
    up[t] = t >= DEAD_AT ? NODES - 1 : NODES;
    restarts[t] = (t >= SPIKE_FROM + 20 && t < SPIKE_TO + 40 && rand() < 0.35 ? 1 + Math.floor(rand() * 3) : 0) + (rand() < 0.01 ? 1 : 0);
    if (t >= LEAK_TO - 30 && t < LEAK_TO && rand() < 0.4) restarts[t] += 2;
  }
  // The services, as slower or faster cousins of the cluster's p99.
  const svc = (k, off, noise) => Float64Array.from(p99, (v, t) => v * k + off + noise[t]);
  const services = {
    api: p99,
    auth: svc(0.5, 8, walk(T, 0.8, 5)),
    db: Float64Array.from(cpu[LEAK], (c, t) => 34 + c * 0.9 + jitter[t] * 0.5 + (t >= LEAK_FROM ? (c - 50) * 2.2 : 0)),
    cache: svc(0.12, 4, walk(T, 0.7, 1.2)),
  };
  return { T, NODES, cpu, rps, p99, errors, up, restarts, services, DEAD, DEAD_AT, SPIKE_FROM, SPIKE_TO, LEAK_FROM, LEAK_TO };
})();

demos.push({
  id: 'dashboard',
  title: 'Cluster dashboard',
  blurb:
    'A made-up 24-node cluster, live: headline numbers, latency and restarts, and a sparkline for every node, in one ChartGroup, moved along its history by Slice',
  setup(ctx) {
    const D = clusterData;
    const S = { end: 360, rate: 10, playing: false, held: false };
    const TICK = 2; // seconds of the made-up clock to a sample
    const clock = (i) => {
      const s = 9 * 3600 + Math.round(i) * TICK;
      return String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
    };
    const tone = () => ({
      ok: isDark() ? '#5aa6ff' : '#2a6fdb',
      hot: isDark() ? '#ff6a5e' : '#d63a2f',
      down: isDark() ? '#8a9aa4' : '#7d8c96',
      text: isDark() ? '#e3ebef' : '#12202b',
      muted: isDark() ? '#8b9ea9' : '#566772',
    });

    // ── Every series reads its own history through a Slice, which the clock moves.
    const slices = [];
    const feed = (data, last) => {
      const slice = new L.Slice({ last, end: S.end }, new L.FlatDataSource({ data, regularDomain: { start: 0, step: 1 }, isSorted: true }));
      slices.push(slice);
      return slice;
    };
    // Every chart reads the same stretch of time, so they share one range: a pointer over one is at the same moment in all of them.
    const hidden = () => new L.SharedAxis({ orientation: 'bottom', sharedRef: 'time', visible: false });
    const WINDOW = 240;
    const crosshair = () => new L.Cursor({ mode: 'shared', keys: false }, new L.Crosshair({ lines: 'first', dots: true }));
    const fixed = (min, max) => new L.Axis({ orientation: 'left', visible: false, min, max }, new L.LinearScale());
    const tight = { gridlines: false, insets: { left: 2, right: 2, top: 4, bottom: 4 } };
    const smallText = { chartTitle: { size: 11, weight: 600, align: 'start' } };

    // ── The headline numbers: the value is the item's title and the name its subtitle, and the line behind them is the last few minutes.
    const kpis = [
      { name: 'Requests / s', data: D.rps, last: WINDOW, min: 0, max: 8000, format: (v) => Math.round(v).toLocaleString(), kind: 'area' },
      { name: 'p99 latency', data: D.p99, last: WINDOW, min: 0, max: 400, format: (v) => Math.round(v) + ' ms', kind: 'line', limit: 250 },
      { name: 'Error rate', data: D.errors, last: WINDOW, min: 0, max: 4, format: (v) => v.toFixed(2) + ' %', kind: 'area', limit: 1 },
      { name: 'Nodes up', data: D.up, last: WINDOW, min: 0, max: D.NODES + 1, format: (v) => `${v} / ${D.NODES}`, kind: 'step' },
    ].map((k) => {
      const title = new L.ChartTitle({ text: '', role: 'title' });
      const sub = new L.ChartTitle({ text: k.name, role: 'subtitle' });
      const line = new L.LinePath({ strokeWidth: 1.5 }, k.kind === 'step' ? new L.LinearCurve() : new L.MonotoneCurve());
      const area = k.kind === 'line' ? null : new L.AreaPath({ opacity: 0.18 }, new L.LinearCurve());
      const series = new L.DomainSeries({ name: k.name }, feed(k.data, k.last), ...[area, line].filter(Boolean));
      const plane = new L.CartesianPlane(
        {
          ...tight,
          meta: { title: k.name, description: `${k.name}, the last five minutes${k.limit === undefined ? '' : ', with its limit marked'}` },
        },
        hidden(),
        fixed(k.min, k.max),
        series,
        ...(k.limit === undefined
          ? []
          : [new L.LineAnnotation({ value: k.limit, stroke: '#e5483d', strokeWidth: 1, style: { annotationLine: { dash: '2 3' } } })]),
      );
      const item = new L.ChartGroupItem(
        { span: [3, 1], style: { chartTitle: { size: 22, weight: 700, align: 'start' }, chartSubtitle: { size: 11, align: 'start' } } },
        plane,
        title,
        sub,
        crosshair(),
      );
      return { ...k, title, line, area, item };
    });

    // ── Latency by service, with the limit the team promised.
    const svcNames = Object.keys(D.services);
    const svcColors = ['#2a6fdb', '#8a5cd0', '#e0a030', '#2e9e6b'];
    const latency = new L.ChartGroupItem(
      { span: [8, 2], style: { chartTitle: { size: 12, weight: 600, align: 'start' } } },
      new L.CartesianPlane(
        {
          gridlines: true,
          meta: {
            title: 'Latency by service',
            description: 'p99 latency of four services, the last ten minutes, against the 250 ms limit',
          },
        },
        new L.SharedAxis({ orientation: 'bottom', sharedRef: 'time', format: clock, tickStep: 60 }),
        new L.Axis(
          { orientation: 'left', min: 0, max: 400, ticks: [0, 100, 200, 300, 400], format: (v) => v + ' ms' },
          new L.LinearScale(),
        ),
        ...svcNames.map(
          (name, i) =>
            new L.DomainSeries(
              { name },
              feed(D.services[name], WINDOW),
              new L.LinePath({ stroke: svcColors[i], strokeWidth: 1.4 }, new L.LinearCurve()),
            ),
        ),
        new L.LineAnnotation({
          value: 250,
          label: 'SLO 250 ms',
          stroke: '#e5483d',
          strokeWidth: 1,
          style: { annotationLine: { dash: '4 4' } },
        }),
      ),
      new L.ChartTitle({ text: 'Latency by service (p99)', role: 'title' }),
      new L.Legend({ side: 'top' }),
      new L.Cursor(
        { mode: 'shared' },
        new L.Crosshair({ lines: 'first', dots: true }),
        new L.ChartTooltip({ swatch: true, format: (hit) => `${hit.series.attrs.name}   ${Math.round(hit.second)} ms` }),
      ),
    );

    // ── Restarts: a bar for every sample that had any.
    const restartBars = new L.BarPath({ fill: '#e0a030', stroke: 'none', width: 0.8 });
    const restarts = new L.ChartGroupItem(
      { span: [4, 2], style: { chartTitle: { size: 12, weight: 600, align: 'start' } } },
      new L.CartesianPlane(
        { gridlines: true, meta: { title: 'Pod restarts', description: 'Pod restarts in each interval, the last four minutes' } },
        new L.SharedAxis({ orientation: 'bottom', sharedRef: 'time', format: clock, tickStep: 60 }),
        new L.Axis({ orientation: 'left', min: 0, max: 6, tickStep: 2 }, new L.LinearScale()),
        new L.DomainSeries({ name: 'Restarts' }, feed(D.restarts, WINDOW), restartBars),
      ),
      new L.ChartTitle({ text: 'Pod restarts', role: 'title' }),
      crosshair(),
    );

    // ── A sparkline for every node. They share a scale and nothing is drawn but the line and its area, so a node that is
    // working hard is a tall one, and one that has stopped is a flat one. The title carries the name and the figure.
    const nodes = D.cpu.map((cpu, n) => {
      const name = 'node-' + String(n + 1).padStart(2, '0');
      const title = new L.ChartTitle({ text: name, role: 'title' });
      const line = new L.LinePath({ strokeWidth: 1.2 }, new L.LinearCurve());
      const area = new L.AreaPath({ opacity: 0.2 }, new L.LinearCurve());
      const item = new L.ChartGroupItem(
        { span: [2, 1], style: smallText },
        new L.CartesianPlane(
          {
            ...tight,
            meta: { title: name + ' CPU', description: `CPU use of ${name}, the last five minutes, on a scale of 0 to 100 percent` },
          },
          hidden(),
          fixed(0, 100),
          new L.DomainSeries({ name: name + ' CPU' }, feed(cpu, WINDOW), area, line),
        ),
        title,
        crosshair(),
      );
      return { name, cpu, title, line, area, item, state: '' };
    });

    const head = new L.ChartTitle({ text: 'prod-eu-1', role: 'title' });
    const headSub = new L.ChartTitle({ text: '', role: 'subtitle' });
    const group = new L.ChartGroup(
      { columns: 12, gap: { row: 12, column: 6 }, linkCursor: true },
      new L.SharedRange({ id: 'time' }, new L.LinearScale()),
      ...kpis.map((k) => k.item),
      latency,
      restarts,
      ...nodes.map((n) => n.item),
    );
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: ctx.onFlush,
        padding: 14,
        meta: {
          title: 'Cluster dashboard',
          description: 'A made-up 24-node cluster: headline numbers, latency, restarts and CPU for every node',
        },
      },
      group,
      head,
      headSub,
    );
    chart.setAttribute('style', { chartTitle: { size: 18, align: 'start' }, chartSubtitle: { size: 12, align: 'start' } });

    // ── What a tick changes: the window, the figures, and which nodes look wrong.
    const HOT = 85;
    const apply = (n, state) => {
      const c = tone();
      const color = state === 'hot' ? c.hot : state === 'down' ? c.down : c.ok;
      n.line.setAttribute('stroke', color);
      n.area.setAttribute('fill', color);
      n.item.setAttribute('style', { ...smallText, chartTitle: { ...smallText.chartTitle, color: state === 'ok' ? c.muted : color } });
    };
    const show = () => {
      const e = Math.min(D.T, Math.max(1, Math.round(S.end))),
        i = e - 1;
      for (const s of slices) s.setAttribute('end', e);
      for (const k of kpis) k.title.setAttribute('text', k.format(k.data[i]));
      let alerts = 0;
      for (const n of nodes) {
        let peak = 0;
        for (let j = Math.max(0, i - 30); j <= i; j++) peak = Math.max(peak, n.cpu[j]);
        const state = n.cpu[i] < 1 ? 'down' : peak > HOT ? 'hot' : 'ok';
        if (state !== 'ok') alerts++;
        const value = state === 'down' ? 'down' : Math.round(n.cpu[i]) + '%';
        n.title.setAttribute('text', `${n.name}   ${value}`);
        if (state !== n.state) {
          n.state = state;
          apply(n, state);
        }
      }
      headSub.setAttribute(
        'text',
        `${clock(i)} · ${D.up[i]} of ${D.NODES} nodes up · ${alerts === 0 ? 'all quiet' : alerts + (alerts === 1 ? ' node needs attention' : ' nodes need attention')}`,
      );
      if (slider) slider.set(e);
    };
    ctx.onTheme(() => {
      for (const n of nodes) apply(n, n.state || 'ok');
    });

    // ── Playing it.
    let raf = 0,
      last = 0,
      owed = 0,
      playButton = null,
      slider = null;
    const frame = (now) => {
      // Under the pointer the clock stands still, so there is something to read; it goes on when the pointer leaves.
      owed += S.held ? 0 : Math.min(0.25, (now - last) / 1000) * S.rate;
      last = now;
      const steps = Math.floor(owed);
      if (steps > 0) {
        owed -= steps;
        S.end += steps;
        if (S.end >= D.T) S.end = 360; // and round again
        show();
        // Flushed here, in the frame that changed it: the chart would otherwise be drawn on the next frame, and the page would lay out twice.
        chart.flush();
      }
      raf = requestAnimationFrame(frame);
    };
    const play = () => {
      S.playing = true;
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      refresh();
    };
    const stop = () => {
      S.playing = false;
      cancelAnimationFrame(raf);
      refresh();
    };
    const refresh = () => {
      if (playButton) playButton.textContent = S.playing ? 'Pause' : 'Play';
    };
    playButton = h('button', { type: 'button', onclick: () => (S.playing ? stop() : play()) }, 'Pause');
    slider = (() => {
      const f = ui.slider({
        label: 'time',
        min: WINDOW,
        max: D.T,
        value: S.end,
        format: clock,
        onChange: (v) => {
          stop();
          S.end = v;
          show();
        },
      });
      const input = f.querySelector('input'),
        out = f.querySelector('output');
      return {
        el: f,
        // The page lays out again for any text it changes, so the readout is written only when it says something new.
        set: (v) => {
          input.value = v;
          const text = clock(v);
          if (out.textContent !== text) out.textContent = text;
        },
      };
    })();
    const jumps = [
      ['runaway process', D.SPIKE_FROM + 60],
      ['node lost', D.DEAD_AT + 30],
      ['memory leak', D.LEAK_TO - 20],
    ];
    ctx.add(
      h('div', { class: 'field' }, h('div', { class: 'seg' }, playButton)),
      slider.el,
      ui.seg({
        label: 'speed (samples per second)',
        options: [
          [4, 'slow'],
          [10, 'medium'],
          [30, 'fast'],
        ],
        value: S.rate,
        onChange: (v) => (S.rate = v),
      }),
      ui.seg({
        label: 'jump to',
        options: jumps.map(([text, at]) => [at, text]),
        value: -1,
        onChange: (v) => {
          stop();
          S.end = v;
          show();
        },
      }),
      ui.note(
        "Everything here is invented. Three things go wrong: a runaway process on node-07 (CPU pinned, latency and errors up, pods restarting), node-19 dropping out (a flat line, and its work lands on the rest), and a leak on node-13 that climbs for ten minutes. One ChartGroup of twelve columns holds a chart in every cell; the sparklines share a 0–100 scale. The clock is a `Slice` on every series, moved by one row a tick (`setAttribute('end', n)`): the series refill their window and nothing else is rebuilt. The line and area of a node that is hot or down are restyled, and the title says so.",
      ),
    );
    const hold = (v) => () => (S.held = v);
    const onEnter = hold(true),
      onLeave = hold(false);
    ctx.host.addEventListener('pointerenter', onEnter);
    ctx.host.addEventListener('pointerleave', onLeave);
    ctx.host.style.height = '840px';
    show();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) stop();
    const starter = still ? 0 : setTimeout(play, 400);
    refresh();
    return {
      chart,
      dispose: () => {
        clearTimeout(starter);
        cancelAnimationFrame(raf);
        ctx.host.removeEventListener('pointerenter', onEnter);
        ctx.host.removeEventListener('pointerleave', onLeave);
        ctx.host.style.height = '';
      },
    };
  },
});

// ── 1. Basic line ────────────────────────────────────────────────────────────
demos.push({
  id: 'basic',
  title: 'Basic line',
  blurb: 'Axes, gridlines, and live attribute changes',
  setup(ctx) {
    let n = 200,
      seed = 1;
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 'Time (s)' }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'Level', nice: true }, new L.LinearScale());
    const line = new L.LinePath({ stroke: PALETTE[0], strokeWidth: 1.5 }, new L.LinearCurve());
    const source = new L.FlatDataSource({ data: shape('sine', n, seed), regularDomain: { start: 0, step: 10 / (n - 1) } });
    const plane = new L.CartesianPlane({ frame: true }, x, y, new L.DomainSeries(source, line));
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane);
    const regen = () => source.setAttributes({ data: shape('sine', n, seed), regularDomain: { start: 0, step: 10 / (n - 1) } });
    ctx.add(
      ui.slider({
        label: 'points',
        min: 3,
        max: 5000,
        value: n,
        log: true,
        onChange: (v) => {
          n = v;
          regen();
        },
      }),
      ui.buttons([
        'New data',
        () => {
          seed++;
          regen();
        },
      ]),
      ui.slider({ label: 'stroke width', min: 0.5, max: 8, step: 0.5, value: 1.5, onChange: (v) => line.setAttribute('strokeWidth', v) }),
      ui.seg({
        label: 'colour',
        options: PALETTE.map((c, i) => [c, ['blue', 'red', 'green', 'amber', 'violet', 'teal'][i]]),
        value: PALETTE[0],
        onChange: (v) => line.setAttribute('stroke', v),
      }),
      ui.seg({
        label: 'dash',
        options: [
          ['', 'solid'],
          ['6 4', 'dashed'],
          ['1 4', 'dotted'],
        ],
        value: '',
        onChange: (v) => line.setAttribute('style', { seriesLine: { dash: v || 'none' } }),
      }),
      ui.toggle({ label: 'gridlines', value: true, onChange: (v) => plane.setAttribute('gridlines', v) }),
      ui.toggle({ label: 'frame', value: true, onChange: (v) => plane.setAttribute('frame', v) }),
      ui.toggle({ label: 'clip to plot', value: true, onChange: (v) => plane.setAttribute('clip', v) }),
      ui.toggle({ label: 'nice value axis', value: true, onChange: (v) => y.setAttribute('nice', v) }),
      ui.toggle({ label: 'invert value axis', value: false, onChange: (v) => y.setAttribute('inverted', v) }),
      ui.seg({
        label: 'time axis side',
        options: [
          ['bottom', 'bottom'],
          ['top', 'top'],
        ],
        value: 'bottom',
        onChange: (v) => x.setAttribute('orientation', v),
      }),
      ui.seg({
        label: 'value axis side',
        options: [
          ['left', 'left'],
          ['right', 'right'],
        ],
        value: 'left',
        onChange: (v) => y.setAttribute('orientation', v),
      }),
      ui.slider({
        label: 'tick count',
        min: 2,
        max: 20,
        value: 5,
        onChange: (v) => {
          x.setAttribute('tickCount', v);
          y.setAttribute('tickCount', v);
        },
      }),
      ui.slider({ label: 'value padding', min: 0, max: 0.5, step: 0.05, value: 0, onChange: (v) => y.setAttribute('padding', v) }),
      ui.text({ label: 'value axis title', value: 'Level', onChange: (v) => y.setAttribute('title', v || undefined) }),
      ui.slider({
        label: 'tick label size',
        min: 8,
        max: 20,
        value: 11,
        onChange: (v) => {
          for (const a of [x, y]) a.setAttribute('style', { tickLabel: { size: v } });
        },
      }),
    );
    return { chart };
  },
});

// ── 1b. Scales ───────────────────────────────────────────────────────────────
demos.push({
  id: 'scales',
  title: 'Scales',
  blurb: 'Linear, log, square-root and category axes; swap the scale on a running axis',
  setup(ctx) {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
    const rows = names.map((month, i) => ({ month, i, users: Math.round(20 * 2.3 ** i) }));
    const makeScale = { linear: () => new L.LinearScale(), log: () => new L.LogScale(), sqrt: () => new L.SqrtScale() };
    const category = () => new L.BandScale({ categories: names });
    const x = new L.Axis({ orientation: 'bottom', title: 'Month' }, category());
    const y = new L.Axis({ orientation: 'left', title: 'Users', nice: true }, makeScale.log());
    const source = new L.ObjectDataSource({ source: rows, domain: 'i', value: 'users' });
    const plane = new L.CartesianPlane(
      { frame: true },
      x,
      y,
      new L.DomainSeries(
        source,
        new L.LinePath({ stroke: PALETTE[0], strokeWidth: 2 }, new L.LinearCurve()),
        new L.CircleMarker({ fill: PALETTE[0], size: 4 }),
      ),
    );
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane);
    ctx.add(
      ui.seg({
        label: 'value scale',
        options: [
          ['linear', 'linear'],
          ['log', 'log'],
          ['sqrt', 'sqrt'],
        ],
        value: 'log',
        onChange: (v) => y.setChild(0, makeScale[v]()),
      }),
      ui.seg({
        label: 'time scale',
        options: [
          ['band', 'categories'],
          ['linear', 'numbers'],
        ],
        value: 'band',
        onChange: (v) => x.setChild(0, v === 'band' ? category() : new L.LinearScale()),
      }),
      ui.toggle({ label: 'nice value axis', value: true, onChange: (v) => y.setAttribute('nice', v) }),
    );
    return { chart };
  },
});

// ── 1c. Themes ───────────────────────────────────────────────────────────────

/** An element written in this page, to show that a new kind of thing joins the theme with a selector of its own. */
class Watermark extends L.ChartElement {
  onEvent(ev) {
    if (ev.type !== L.EVENT_PAINT) return;
    const look = this.styleFor(['watermark', 'text']);
    const s = this.surface,
      n = s.node('mark', 'text');
    L.applyText(s, n, look);
    s.set(n, 'x', this.chart.platform.size().width - 14);
    s.set(n, 'y', 12 + look.size);
    s.set(n, 'text-anchor', 'end');
    s.text(n, this.attrs.text);
  }
}

demos.push({
  id: 'themes',
  title: 'Themes',
  blurb: 'Selectors, nearest-block-wins, the palette, and a selector of your own',
  setup(ctx) {
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 'Time (s)' }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'Level', nice: true }, new L.LinearScale());
    const lines = [0, 1, 2].map(
      (k) =>
        new L.DomainSeries(
          new L.FlatDataSource({
            data: shape('sine', 120, k + 3).map((v, i) => v * (1 - k * 0.25) + k * 1.5),
            regularDomain: { start: 0, step: 10 / 119 },
          }),
          new L.LinePath(new L.LinearCurve()),
        ),
    );
    const plane = new L.CartesianPlane({ frame: true }, x, y, ...lines);
    // The watermark's look is a selector of its own, kept on the element so it survives the page's theme switch.
    const mark = new Watermark({ text: 'DRAFT', style: { watermark: { size: 30, weight: 700, color: '#8884' } } });
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane, mark);
    // Two switches feed one block, so it is rebuilt from both.
    let fonts = false,
      grid = false;
    const restylePlane = () =>
      plane.setAttribute('style', {
        ...(fonts && { text: { family: 'Georgia, serif' }, tickLabel: { size: 14 } }),
        ...(grid && { gridline: { color: '#e8a0a0' } }),
      });
    const block = (target, selectors) => (on) => target.setAttribute('style', on ? selectors : undefined);
    ctx.add(
      ui.note(
        "The chart's base theme comes from the page's light/dark switch. Everything below is a `style` block on one element: it applies to that element and what is inside it, and the nearest block wins.",
      ),
      ui.toggle({ label: 'chart block: every line dashed', value: false, onChange: block(chart, { seriesLine: { dash: '6 3' } }) }),
      ui.toggle({
        label: 'plane block: serif text, larger labels',
        value: false,
        onChange: (on) => {
          fonts = on;
          restylePlane();
        },
      }),
      ui.toggle({
        label: 'plane block: pale-red gridlines',
        value: false,
        onChange: (on) => {
          grid = on;
          restylePlane();
        },
      }),
      ui.toggle({ label: 'x axis block: one colour for the lot', value: false, onChange: block(x, { axis: { color: '#c0392b' } }) }),
      ui.toggle({
        label: 'first series: its own stroke',
        value: false,
        onChange: (on) => lines[0].firstChild.nextSibling.setAttribute('stroke', on ? '#111' : undefined),
      }),
      ui.toggle({ label: 'watermark', value: true, onChange: (on) => mark.setAttribute('visible', on) }),
      ui.note("Series colours are the theme's palette in turn; a colour you set on a renderer beats them."),
    );
    return { chart };
  },
});

// ── 1d. Annotations ──────────────────────────────────────────────────────────
demos.push({
  id: 'annotations',
  title: 'Annotations',
  blurb: 'Titles, reference lines in data space on any plane, and callouts that find room',
  setup(ctx) {
    const rows = Array.from({ length: 48 }, (_, i) => ({ t: i / 4, v: 40 + 25 * Math.sin(i / 5) + 12 * Math.sin(i / 1.7) + i * 0.6 }));
    let peak = rows[0];
    for (const r of rows) if (r.v > peak.v) peak = r;
    const x = new L.Axis({ orientation: 'bottom', title: 'Week' }, new L.LinearScale());
    const y = new L.Axis({ orientation: 'left', title: 'Signups', nice: true, min: 0 }, new L.LinearScale());
    const source = new L.ObjectDataSource({ source: rows, domain: 't', value: 'v' });
    const target = new L.LineAnnotation({ value: 70, label: 'Target: 70' });
    const trend = new L.LineAnnotation({ from: [0, 40], to: [12, 70], label: 'Plan', style: { annotationLabel: { align: 'middle' } } });
    const launch = new L.LineAnnotation({ domain: 6, label: 'Launch' });
    const note = new L.CalloutAnnotation({ domain: peak.t, value: peak.v, text: `Best week\n${peak.v.toFixed(0)} signups` });
    const plane = new L.CartesianPlane(
      { frame: true },
      x,
      y,
      new L.DomainSeries(source, new L.LinePath(new L.LinearCurve())),
      target,
      trend,
      launch,
      note,
      new L.PanZoom({}),
    );
    const title = new L.ChartTitle({ text: 'Signups since launch' });
    const subtitle = new L.ChartTitle({ text: 'Weekly, all regions', role: 'subtitle' });
    const caption = new L.ChartTitle({ text: 'Source: the playground', role: 'caption', style: { chartCaption: { align: 'end' } } });
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, title, subtitle, plane, caption);
    ctx.add(
      ui.seg({
        label: 'title align',
        options: [
          ['start', 'left'],
          ['middle', 'centre'],
          ['end', 'right'],
        ],
        value: 'start',
        onChange: (v) => title.setAttribute('style', { chartTitle: { align: v } }),
      }),
      ui.toggle({ label: 'subtitle', value: true, onChange: (v) => subtitle.setAttribute('visible', v) }),
      ui.toggle({ label: 'target line (constant value)', value: true, onChange: (v) => target.setAttribute('visible', v) }),
      ui.toggle({ label: 'plan line (diagonal)', value: true, onChange: (v) => trend.setAttribute('visible', v) }),
      ui.toggle({ label: 'launch line (constant domain)', value: true, onChange: (v) => launch.setAttribute('visible', v) }),
      ui.seg({
        label: 'line label sits at',
        options: [
          ['start', 'start'],
          ['middle', 'middle'],
          ['end', 'end'],
        ],
        value: 'end',
        onChange: (v) => {
          target.setAttribute('style', { annotationLabel: { align: v } });
          launch.setAttribute('style', { annotationLabel: { align: v } });
        },
      }),
      ui.seg({
        label: 'callout outline',
        options: [
          ['box', 'full box'],
          ['edge', 'arm side only'],
          ['none', 'none'],
        ],
        value: 'box',
        onChange: (v) => note.setAttribute('style', { callout: { outline: v } }),
      }),
      ui.seg({
        label: 'callout text',
        options: [
          ['start', 'left'],
          ['middle', 'centre'],
          ['end', 'right'],
        ],
        value: 'start',
        onChange: (v) => note.setAttribute('style', { ...note.attrs.style, calloutText: { align: v } }),
      }),
      ui.toggle({
        label: 'place callout by hand',
        value: false,
        onChange: (v) => {
          note.setAttributes({ dx: v ? -70 : undefined, dy: v ? 60 : undefined });
        },
      }),
      ui.note(
        'Drag and zoom: lines and the callout stay on their data, and the callout looks for a clear spot as the view changes (and disappears when its point leaves the plot). Lines are drawn in data space, so they follow the scales and clip to the plot.',
      ),
    );
    return { chart };
  },
});

// ── 1e. Annotations on other planes ──────────────────────────────────────────
demos.push({
  id: 'annotations-radial',
  title: 'Annotations, round',
  blurb: 'The same line on a polar plane is a circle; on a radar, a polygon',
  setup(ctx) {
    const traits = ['Speed', 'Power', 'Range', 'Cost', 'Comfort', 'Safety'];
    const rows = traits.map((name, i) => ({ i, name, v: [7, 5, 8, 4, 6, 9][i] }));
    const mk = (Plane) => {
      const angle = new L.Axis(
        { orientation: 'angle', min: 0, max: 6, tickCount: 6, nice: false, format: (v) => traits[Math.round(v) % 6] ?? '' },
        new L.LinearScale(),
      );
      const radius = new L.Axis({ orientation: 'radius', min: 0, max: 10, nice: false, tickCount: 5 }, new L.LinearScale());
      const data = new L.ObjectDataSource({ source: rows, domain: 'i', value: 'v', wrap: 6 });
      const guard = new L.LineAnnotation({ value: 6, label: 'Required' });
      const spoke = new L.LineAnnotation({ domain: 2, label: 'Range' });
      const note = new L.CalloutAnnotation({ domain: 5, value: 9, text: 'Best trait' });
      return {
        angle,
        radius,
        guard,
        spoke,
        note,
        plane: new Plane(
          {},
          angle,
          radius,
          new L.DomainSeries(data, new L.AreaPath(new L.LinearCurve()), new L.LinePath(new L.LinearCurve())),
          guard,
          spoke,
          note,
        ),
      };
    };
    const radar = mk(L.RadarPlane),
      polar = mk(L.PolarPlane);
    let current = radar;
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, new L.ChartTitle({ text: 'Product profile' }), radar.plane);
    ctx.add(
      ui.seg({
        label: 'plane',
        options: [
          ['radar', 'radar'],
          ['polar', 'polar'],
        ],
        value: 'radar',
        onChange: (v) => {
          const next = v === 'radar' ? radar : polar;
          chart.remove(current.plane);
          chart.append(next.plane);
          current = next;
        },
      }),
      ui.note(
        'One `LineAnnotation({ value: 6 })` is used in both: it traces a circle on the polar plane, and on the radar it is exactly the polygon through the spokes. A `domain` line is a spoke. The callout finds room away from the data.',
      ),
    );
    return { chart };
  },
});

// ── 1f. Editing data: hits, drags and a tooltip ─────────────────────────────
demos.push({
  id: 'edit',
  title: 'Edit data',
  blurb: 'A PointerListener to select, drag, move between series, add and delete points; and a tooltip',
  setup(ctx) {
    const r = rng(11);
    const names = ['North', 'South', 'East'];
    const clamp = (v) => Math.min(10, Math.max(0, v));
    const fresh = () =>
      names.map((_, k) =>
        Array.from({ length: 8 }, (_, i) => ({
          x: 0.8 + i * 1.2 + r() * 0.5,
          y: clamp([3 + i * 0.5, 7 - i * 0.4, 5 + Math.sin(i) * 2.5][k] + (r() - 0.5) * 1.5),
        })),
      );
    const initial = fresh();
    initial.forEach((rows, k) => ctx.name('rows' + names[k], rows));
    const groups = names.map((name, k) => {
      const rows = initial[k];
      const source = new L.ObjectDataSource({ source: rows, domain: 'x', value: 'y' });
      const series = new L.DomainSeries(
        { name, hit: { mode: 'point', radius: 10 } },
        source,
        new L.LinePath({ stroke: PALETTE[k], strokeWidth: 2 }, new L.LinearCurve()),
        new L.CircleMarker({ fill: PALETTE[k], size: 5 }),
      );
      return { name, rows, source, series, colour: PALETTE[k] };
    });
    // The selection is not a feature of the library: it is one more series, over the rest, that draws a ring round each
    // selected row and takes no hits. The rows are the very objects the other series read, so it follows a drag by itself.
    const selected = new Set(),
      selRows = [];
    ctx.name('selection', selRows);
    const selSource = new L.ObjectDataSource({ source: selRows, domain: 'x', value: 'y' });
    const ring = new L.CircleMarker({ fill: 'none', stroke: isDark() ? '#fff' : '#111', strokeWidth: 2, size: 10 });
    const selSeries = new L.DomainSeries({ hit: false }, selSource, ring);
    ctx.onTheme(() => ring.setAttribute('stroke', isDark() ? '#fff' : '#111'));

    const S = { tool: 'select', dest: groups[0], snap: false };
    const readout = ui.readout();
    const ownerOf = (row) => groups.find((g) => g.rows.includes(row));
    const refresh = () => {
      selRows.length = 0;
      for (const row of selected)
        if (ownerOf(row)) selRows.push(row);
        else selected.delete(row);
      selSource.invalidate();
      for (const g of groups) g.source.invalidate();
      readout.textContent = `selected ${selRows.length}\n` + groups.map((g) => `${g.name.padEnd(6)} ${g.rows.length} points`).join('\n');
      drawChips();
    };
    const grid = (v) => (S.snap ? Math.round(v * 4) / 4 : v);

    // All of the wiring: three callbacks over what the listener reports.
    let drag = null;
    const groupOf = (hit) => groups.find((g) => g.series === hit.series);
    const onDrag = ({ phase, hit, first, second }) => {
      const grabbed = groupOf(hit).rows[hit.row];
      if (phase === 'start')
        drag = { from: [grabbed.x, grabbed.y], moving: (selected.has(grabbed) ? [...selected] : [grabbed]).map((o) => [o, o.x, o.y]) };
      if (!drag) return;
      const dx = grid(first) - drag.from[0],
        dy = grid(second) - drag.from[1];
      for (const [o, x, y] of drag.moving) {
        o.x = clamp(x + dx);
        o.y = clamp(y + dy);
      }
      if (phase === 'end') drag = null;
      refresh();
    };
    const onClick = ({ hit, first, second, shift }) => {
      const owner = hit && groupOf(hit),
        row = owner && owner.rows[hit.row];
      switch (S.tool) {
        case 'select':
          if (!row) {
            if (!shift) selected.clear();
          } else if (shift) {
            selected.has(row) ? selected.delete(row) : selected.add(row);
          } else {
            selected.clear();
            selected.add(row);
          }
          break;
        case 'reassign':
          if (row)
            for (const o of selected.has(row) ? [...selected] : [row]) {
              const from = ownerOf(o);
              if (from && from !== S.dest) {
                from.rows.splice(from.rows.indexOf(o), 1);
                S.dest.rows.push(o);
              }
            }
          break;
        case 'add':
          if (!row) {
            const o = { x: clamp(grid(first)), y: clamp(grid(second)) };
            S.dest.rows.push(o);
            selected.clear();
            selected.add(o);
          }
          break;
        case 'delete':
          if (row) {
            owner.rows.splice(hit.row, 1);
            selected.delete(row);
          }
          break;
      }
      refresh();
    };
    const listener = new L.PointerListener({ onClick });
    const pan = new L.PanZoom({});
    const x = new L.Axis({ orientation: 'bottom', title: 'x', min: 0, max: 10, nice: false }, new L.LinearScale());
    const y = new L.Axis({ orientation: 'left', title: 'y', min: 0, max: 10, nice: false }, new L.LinearScale());
    // The listener goes before PanZoom, so a press on a point is the listener's and a press on the background pans.
    const plane = new L.CartesianPlane({ frame: true }, x, y, ...groups.map((g) => g.series), selSeries, listener, pan);
    const kit = tipKit('snap'),
      tip = kit.cursor;
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, new L.ChartTitle({ text: 'Points by region' }), plane, tip);
    let tipOn = true;

    const chips = h('div', { class: 'chips' });
    const drawChips = () =>
      chips.replaceChildren(
        ...groups.map((g) =>
          h(
            'button',
            {
              class: 'chip',
              type: 'button',
              title: 'where Reassign and Add put points',
              style: `border-color:${g.colour};` + (g === S.dest ? `background:${g.colour};color:#fff;` : `color:${g.colour};`),
              onclick: () => {
                S.dest = g;
                drawChips();
              },
            },
            g.name,
          ),
        ),
      );
    refresh();

    const setTool = (t) => {
      S.tool = t;
      listener.setAttribute('onDrag', t === 'drag' ? onDrag : undefined);
    };
    ctx.add(
      ui.seg({
        label: 'tool',
        options: [
          ['select', 'Select'],
          ['drag', 'Drag'],
          ['reassign', 'Reassign'],
          ['add', 'Add'],
          ['delete', 'Delete'],
        ],
        value: 'select',
        onChange: setTool,
      }),
      h('div', { class: 'field' }, h('div', { class: 'lab' }, 'destination (Reassign, Add)'), chips),
      ui.buttons(
        [
          'Clear selection',
          () => {
            selected.clear();
            refresh();
          },
        ],
        [
          'Delete selected',
          () => {
            for (const o of [...selected]) {
              const g = ownerOf(o);
              if (g) g.rows.splice(g.rows.indexOf(o), 1);
            }
            selected.clear();
            refresh();
          },
        ],
        [
          'Reset data',
          () => {
            const f = fresh();
            groups.forEach((g, k) => {
              g.rows.length = 0;
              g.rows.push(...f[k]);
            });
            selected.clear();
            refresh();
          },
        ],
      ),
      ui.toggle({
        label: 'snap to a grid (¼)',
        value: false,
        onChange: (v) => {
          S.snap = v;
        },
      }),
      ui.seg({
        label: 'hit distance (series `hit`)',
        options: [
          ['point', 'point'],
          ['line', 'line'],
        ],
        value: 'point',
        onChange: (m) => groups.forEach((g) => g.series.setAttribute('hit', { mode: m, radius: 10 })),
      }),
      ui.seg({
        label: 'tooltip',
        options: [
          ['snap', 'snap'],
          ['follow', 'follow'],
          ['shared', 'shared'],
          ['off', 'off'],
        ],
        value: 'snap',
        onChange: (m) => {
          if (m === 'off') {
            if (tipOn) chart.remove(tip);
            tipOn = false;
            return;
          }
          if (!tipOn) {
            chart.append(tip);
            tipOn = true;
          }
          kit.setMode(m);
        },
      }),
      ui.toggle({ label: 'tooltip: series colour dot', value: false, onChange: (v) => kit.tooltip.setAttribute('swatch', v) }),
      ui.toggle({
        label: 'tooltip: read the line between points',
        value: false,
        onChange: (v) => kit.cursor.setAttribute('interpolate', v),
      }),
      ui.toggle({
        label: 'pan and zoom (after the listener)',
        value: true,
        onChange: (on) => {
          if (on) plane.append(pan);
          else plane.remove(pan);
        },
      }),
      readout,
      ui.note(
        "Select: click, shift-click for several. Drag: pulls a point (or the whole selection) in data space; dragging the background still pans, because the listener only claims presses that land on a point. Reassign: click a point, or any selected one to move them all, and it joins the destination series. Rows are edited in the page's own arrays and `source.invalidate()` is the only call needed; a dragged point keeps its identity as it passes its neighbours because a hit names its storage row, not its place in the sorted points. With hit distance set to `line` a point is grabbed by its line as well.",
      ),
    );
    setTool('select');
    return { chart };
  },
});

// ── 2. Big data and decimation ───────────────────────────────────────────────
demos.push({
  id: 'big',
  title: 'Big data',
  blurb: 'Decimation kernels over up to 10 million points, on this thread or in a worker',
  setup(ctx) {
    const S = {
      n: 1e6,
      shape: 'noisy',
      storage: 'regular',
      kernel: 'minmax',
      seed: 1,
      sorted: true,
      resolution: 1,
      worker: false,
      transfer: false,
      shared: false,
      pan: false,
    };
    const isolated = typeof crossOriginIsolated === 'boolean' && crossOriginIsolated;
    const x = new L.Axis({ orientation: 'bottom', title: 't' }, new L.LinearScale());
    const y = new L.Axis({ orientation: 'left', title: 'value', nice: true }, new L.LinearScale());
    const KERNELS = { minmax: L.MinMaxKernel, m4: L.M4Kernel, lttb: L.LttbKernel, stride: L.StrideKernel };
    const gen = h('pre', { class: 'readout' });
    const warn = h('p', { class: 'note warn' });
    const status = h('pre', { class: 'readout' });
    let source, worker, boundary, sharedData;
    const makeSource = () => {
      const t0 = performance.now();
      const ys = shape(S.shape, S.n, S.seed),
        step = 10 / (S.n - 1);
      let s;
      switch (S.storage) {
        case 'pairs': {
          const d = new Float64Array(2 * S.n);
          for (let i = 0; i < S.n; i++) {
            d[2 * i] = i * step;
            d[2 * i + 1] = ys[i];
          }
          s = { data: d, isSorted: S.sorted };
          break;
        }
        case 'objects': {
          const rows = Array.from({ length: S.n }, (_, i) => ({ t: i * step, v: ys[i] }));
          const o = new L.ObjectDataSource({ source: rows, domain: 't', value: 'v', isSorted: S.sorted });
          gen.textContent = `generated in ${ms(performance.now() - t0)} ms`;
          return o;
        }
        default: {
          let data = ys;
          sharedData = null;
          // On shared memory the worker reads the array where it is, and the page can change it in place.
          if (S.worker && S.shared) {
            data = sharedData = new Float64Array(new SharedArrayBuffer(8 * S.n));
            data.set(ys);
          }
          s = { data, regularDomain: { start: 0, step } };
        }
      }
      gen.textContent = `generated in ${ms(performance.now() - t0)} ms`;
      return new L.FlatDataSource(s);
    };
    source = makeSource();
    let decimator = new L.Decimator({}, new KERNELS.minmax(), source);
    const line = new L.LinePath({ stroke: PALETTE[0], strokeWidth: 1 }, new L.LinearCurve());
    const series = new L.DomainSeries(decimator, line);
    const workerCode = document.getElementById('ink-worker')?.textContent ?? '';
    const registry = {
      FlatDataSource: L.FlatDataSource,
      Decimator: L.Decimator,
      MinMaxKernel: L.MinMaxKernel,
      M4Kernel: L.M4Kernel,
      LttbKernel: L.LttbKernel,
      StrideKernel: L.StrideKernel,
    };
    // A classic worker made from the code in the page: it starts wherever the page is opened from, a file included.
    const getWorker = () =>
      (worker ??= new L.WebWorker(URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' })), { worker: {} }));
    const useWorker = () => S.worker && S.storage !== 'objects';
    let answers = 0;
    const updateStatus = () => {
      status.textContent = !useWorker()
        ? 'decimating on this thread'
        : `worker · ${boundary?.pending ? 'waiting for an answer' : 'up to date'} · ${S.transfer && !S.shared ? 'array moved' : S.shared ? 'shared memory' : 'array copied'}`;
    };
    const chart = new L.Chart(
      { theme: chartTheme(), onFlush: (st) => (ctx.onFlush(st), updateStatus()) },
      new L.CartesianPlane({ frame: true }, x, y, series),
    );
    const checkWarning = () => {
      warn.textContent =
        S.kernel === 'off' && S.n > 200000 ? `Without a kernel this draws ${fmt(S.n, 0)} points. Expect a very large path.` : '';
    };
    // New data, and the stages round it as the settings say: on this thread, or inside a boundary to a worker.
    const rebuild = () => {
      series.remove(boundary ?? decimator);
      decimator = new L.Decimator(
        { enabled: S.kernel !== 'off', resolution: S.resolution },
        new KERNELS[S.kernel === 'off' ? 'minmax' : S.kernel](),
        makeSource(),
      );
      boundary = useWorker()
        ? new L.WorkerBoundary({ worker: getWorker(), registry, transfer: S.transfer && !S.shared, shared: S.shared }, decimator)
        : null;
      series.insertBefore(boundary ?? decimator, line);
      checkWarning();
      updateStatus();
    };
    ctx.add(
      ui.slider({
        label: 'points',
        min: 1000,
        max: 1e7,
        value: S.n,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.n = v;
          rebuild();
        },
      }),
      ui.seg({
        label: 'shape',
        options: [
          ['noisy', 'noisy sine'],
          ['walk', 'random walk'],
          ['spikes', 'spikes'],
        ],
        value: S.shape,
        onChange: (v) => {
          S.shape = v;
          rebuild();
        },
      }),
      ui.buttons([
        'New data',
        () => {
          S.seed++;
          rebuild();
        },
      ]),
      ui.seg({
        label: 'storage',
        options: [
          ['regular', 'y only'],
          ['pairs', 'x,y pairs'],
          ['objects', 'objects'],
        ],
        value: S.storage,
        onChange: (v) => {
          S.storage = v;
          rebuild();
        },
      }),
      ui.toggle({
        label: 'source is flagged isSorted (pairs, objects)',
        value: S.sorted,
        onChange: (v) => {
          S.sorted = v;
          rebuild();
        },
      }),
      ui.seg({
        label: 'kernel',
        options: [
          ['off', 'off'],
          ['minmax', 'min/max'],
          ['m4', 'M4'],
          ['lttb', 'LTTB'],
          ['stride', 'stride'],
        ],
        value: S.kernel,
        onChange: (v) => {
          S.kernel = v;
          if (v === 'off') decimator.setAttribute('enabled', false);
          else {
            decimator.setAttribute('enabled', true);
            decimator.setChild(0, new KERNELS[v]());
          }
          checkWarning();
        },
      }),
      ui.slider({
        label: 'resolution (columns per pixel)',
        min: 0.25,
        max: 4,
        step: 0.25,
        value: 1,
        onChange: (v) => decimator.setAttribute('resolution', (S.resolution = v)),
      }),
      ui.slider({ label: 'stroke width', min: 0.5, max: 4, step: 0.5, value: 1, onChange: (v) => line.setAttribute('strokeWidth', v) }),
      ...(workerCode
        ? [
            ui.toggle({
              label: 'decimate in a worker',
              value: S.worker,
              onChange: (v) => {
                S.worker = v;
                rebuild();
              },
            }),
            ui.toggle({
              label: 'move the array, do not copy it (the JSON tab cannot write it then)',
              value: S.transfer,
              onChange: (v) => {
                S.transfer = v;
                rebuild();
              },
            }),
            ...(isolated
              ? [
                  ui.toggle({
                    label: 'shared memory (SharedArrayBuffer; y only)',
                    value: S.shared,
                    onChange: (v) => {
                      S.shared = v;
                      rebuild();
                    },
                  }),
                  ui.buttons([
                    'Change a region in place (shared)',
                    () => {
                      if (!sharedData || !boundary) return;
                      const from = Math.floor(Math.random() * 0.8 * S.n),
                        to = from + Math.floor(0.1 * S.n);
                      const lift = 4 * (Math.random() - 0.5) * (y.view?.max ?? 10);
                      for (let i = from; i < to; i++) sharedData[i] += lift;
                      boundary.refresh();
                    },
                  ]),
                ]
              : [
                  ui.note(
                    'Shared memory needs a page that is cross-origin isolated (served with COOP and COEP headers), which this one is not.',
                  ),
                ]),
            ui.toggle({
              label: 'pan automatically (watch flush max)',
              value: S.pan,
              onChange: (v) => {
                S.pan = v;
                const t0 = performance.now();
                const step = (now) => {
                  if (!S.pan) return;
                  const t = ((now - t0) / 8000) % 2,
                    at = t < 1 ? t : 2 - t;
                  x.setAttributes({ min: at * 9, max: at * 9 + 1 });
                  requestAnimationFrame(step);
                };
                if (v) requestAnimationFrame(step);
                else x.setAttributes({ min: undefined, max: undefined });
              },
            }),
            status,
          ]
        : []),
      gen,
      warn,
      ui.note(
        'Object rows are loaded once into numbers on each change, so they cost memory and time at the top end. Unflagged data is copied and, if it is out of order, sorted.',
      ),
    );
    return { chart, dispose: () => ((S.pan = false), worker?.terminate()) };
  },
});

// ── 3. Gaps and ordering ─────────────────────────────────────────────────────
demos.push({
  id: 'sources',
  title: 'Gaps & ordering',
  blurb: 'What a data source delivers, however it stores the points',
  setup(ctx) {
    const S = { n: 4000, layout: 'ordered', sorted: false, gaps: 3, gapLength: 120, nanX: 0, decimate: false, seed: 1 };
    const x = new L.Axis({ orientation: 'bottom' }, new L.LinearScale());
    const y = new L.Axis({ orientation: 'left', nice: true }, new L.LinearScale());
    const read = ui.readout();
    const line = new L.LinePath({ stroke: PALETTE[2], strokeWidth: 1.5 }, new L.LinearCurve());
    let raw = new Float64Array(0);
    const source = new L.FlatDataSource({ data: raw });
    const dec = new L.Decimator({ enabled: false }, new L.MinMaxKernel(), source);
    const series = new L.DomainSeries(dec, line);
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: (s) => {
          ctx.onFlush(s);
          report();
        },
      },
      new L.CartesianPlane({ frame: true }, x, y, series),
    );

    function report() {
      const v = source.view();
      const d = source.domain();
      read.textContent = [
        `stored points    ${raw.length / 2}`,
        `delivered        ${v ? v.count : '(no view)'}`,
        `domain           ${d ? `${fmt(d.min)} … ${fmt(d.max)}` : 'none'}`,
        `view is my array ${v ? v.data === raw : 'n/a'}`,
        `drawn            ${series.points.count}`,
      ].join('\n');
      misuse.textContent =
        S.sorted && S.layout === 'shuffled'
          ? 'isSorted is set but the data is shuffled: the source trusts you, so the lines are wrong. This is the documented cost of the flag.'
          : '';
    }
    function build() {
      const r = rng(S.seed),
        ys = shape('sine', S.n, S.seed),
        pairs = new Float64Array(2 * S.n);
      for (let i = 0; i < S.n; i++) {
        pairs[2 * i] = (i / (S.n - 1)) * 10;
        pairs[2 * i + 1] = ys[i];
      }
      for (let g = 0; g < S.gaps; g++) {
        const at = Math.floor(r() * (S.n - S.gapLength));
        for (let i = at; i < at + S.gapLength; i++) pairs[2 * i + 1] = NaN;
      }
      for (let k = 0; k < S.nanX; k++) pairs[2 * Math.floor(r() * S.n)] = NaN;
      switch (S.layout) {
        case 'shuffled':
          for (let i = S.n - 1; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            for (let k = 0; k < 2; k++) {
              const t = pairs[2 * i + k];
              pairs[2 * i + k] = pairs[2 * j + k];
              pairs[2 * j + k] = t;
            }
          }
          break;
        case 'reversed':
          for (let i = 0, j = S.n - 1; i < j; i++, j--)
            for (let k = 0; k < 2; k++) {
              const t = pairs[2 * i + k];
              pairs[2 * i + k] = pairs[2 * j + k];
              pairs[2 * j + k] = t;
            }
          break;
      }
      raw = pairs;
      source.setAttributes({ data: raw, isSorted: S.sorted });
    }
    const misuse = ui.note('', true);
    build();
    ctx.add(
      ui.slider({
        label: 'points',
        min: 100,
        max: 100000,
        value: S.n,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.n = v;
          build();
        },
      }),
      ui.seg({
        label: 'storage order',
        options: [
          ['ordered', 'ordered'],
          ['shuffled', 'shuffled'],
          ['reversed', 'reversed'],
        ],
        value: S.layout,
        onChange: (v) => {
          S.layout = v;
          build();
        },
      }),
      ui.toggle({
        label: 'flag the source isSorted',
        value: S.sorted,
        onChange: (v) => {
          S.sorted = v;
          build();
        },
      }),
      ui.slider({
        label: 'gaps (NaN values)',
        min: 0,
        max: 20,
        value: S.gaps,
        onChange: (v) => {
          S.gaps = v;
          build();
        },
      }),
      ui.slider({
        label: 'gap length',
        min: 1,
        max: 600,
        value: S.gapLength,
        onChange: (v) => {
          S.gapLength = v;
          build();
        },
      }),
      ui.slider({
        label: 'points with NaN domain',
        min: 0,
        max: 50,
        value: 0,
        onChange: (v) => {
          S.nanX = v;
          build();
        },
      }),
      ui.toggle({ label: 'decimate (min/max)', value: false, onChange: (v) => dec.setAttribute('enabled', v) }),
      ui.buttons([
        'New data',
        () => {
          S.seed++;
          build();
        },
      ]),
      read,
      misuse,
      ui.note(
        'A source always delivers points ascending in the domain with NaN-domain points dropped. The flag only says whether it has to arrange that itself.',
      ),
    );
    return { chart };
  },
});

// ── 3b. Generated and column-wise data ───────────────────────────────────────
demos.push({
  id: 'generated',
  title: 'Functions & columns',
  blurb: 'SyntheticDataSource samples a function as you zoom; CompositeDataSource keeps columns apart',
  setup(ctx) {
    const S = { fn: 'chirp', fixed: false, count: 200 };
    const fns = {
      chirp: (x) => Math.sin((x * x) / 8) * Math.exp(-x / 40),
      sinc: (x) => (x === 0 ? 1 : Math.sin(x * 3) / (x * 3)),
      steps: (x) => (Math.floor(x) % 3 === 0 ? NaN : Math.floor(x) % 5),
    };
    const x = new L.Axis({ orientation: 'bottom' }, new L.LinearScale());
    const y = new L.Axis({ orientation: 'left', nice: true }, new L.LinearScale());
    const read = ui.readout();
    const synthetic = new L.SyntheticDataSource({ fn: fns.chirp, domain: { min: 0, max: 40 } });
    // "Measurements" kept as separate columns: an x array, a y array and a spare column the markers' size is bound to.
    const N = 80,
      r = rng(7),
      xs = new Float64Array(N),
      ys = new Float64Array(N),
      weights = new Float64Array(N);
    const composite = new L.CompositeDataSource({ count: N, domain: xs, value: ys, channels: { weight: weights } });
    function measure() {
      for (let i = 0; i < N; i++) {
        xs[i] = r() * 40;
        weights[i] = 1 + Math.floor(r() * 6);
      }
      xs.sort();
      for (let i = 0; i < N; i++) {
        const v = fns[S.fn](xs[i]);
        ys[i] = v + (r() - 0.5) * 0.4;
      }
      composite.invalidate();
    }
    measure();
    const size = new L.ScalarAxis({ id: 'weight', output: [2, 7] }, new L.LinearScale());
    const curve = new L.DomainSeries(
      { name: 'function', hit: 'line' },
      synthetic,
      new L.LinePath({ stroke: PALETTE[0], strokeWidth: 1.5 }, new L.LinearCurve()),
    );
    const points = new L.DomainSeries(
      { name: 'measurements', hit: 'point' },
      composite,
      new L.CircleMarker({ bind: { size: { axis: size, channel: 'weight' } }, fill: PALETTE[1], opacity: 0.8 }),
    );
    const plane = new L.CartesianPlane({ frame: true }, x, y, curve, points, new L.PanZoom({}));
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: (s) => {
          ctx.onFlush(s);
          report();
        },
      },
      plane,
      size,
      tipKit('snap').cursor,
    );
    function report() {
      read.textContent = [
        `function samples  ${curve.points.count}`,
        `measurement rows  ${points.points.count}`,
        `domain in view    ${fmt(x.range.min)} … ${fmt(x.range.max)}`,
      ].join('\n');
    }
    const apply = () => {
      synthetic.setAttributes({ fn: fns[S.fn], count: S.fixed ? S.count : undefined });
      measure();
    };
    ctx.add(
      ui.seg({
        label: 'function',
        options: [
          ['chirp', 'chirp'],
          ['sinc', 'sinc'],
          ['steps', 'steps (gaps)'],
        ],
        value: S.fn,
        onChange: (v) => {
          S.fn = v;
          apply();
        },
      }),
      ui.toggle({
        label: 'fixed number of samples',
        value: S.fixed,
        onChange: (v) => {
          S.fixed = v;
          apply();
        },
      }),
      ui.slider({
        label: 'samples',
        min: 5,
        max: 2000,
        value: S.count,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.count = v;
          apply();
        },
      }),
      read,
      ui.note(
        'Left to itself the function is sampled once per pixel across the part in view, so zooming in (wheel) keeps the curve smooth; a fixed count samples the whole domain once and zooming only magnifies it. The dots come from a CompositeDataSource: separate x, y and weight arrays.',
      ),
    );
    return { chart };
  },
});

// ── 3b2. Ticks, edges and missing values ────────────────────────────────────
demos.push({
  id: 'edges',
  title: 'Ticks, edges & gaps',
  blurb: 'Ticks you choose, room for markers and bars at the ends, a reversed axis, and what a missing value means',
  setup(ctx) {
    const S = { shape: 'line+markers', gaps: 'break', ticks: 'auto', reversed: false, size: 6, fixed: false };
    const ys = [4, 7, 5, 9, NaN, NaN, 6, 8, 3, NaN, 7, 5];
    const tickModes = {
      auto: {},
      list: { ticks: [0, 2.5, 3, 9] },
      step: { tickStep: 2 },
      function: { ticks: (r) => [r.min, (r.min + r.max) / 2, r.max] },
    };
    let plane = null;
    const read = ui.readout();
    const kit = tipKit('snap'),
      tooltip = kit.cursor;
    const chart = new L.Chart({
      theme: chartTheme(),
      onFlush: (st) => {
        ctx.onFlush(st);
        report();
      },
    });
    let x, y, series;
    function build() {
      x = new L.Axis({ id: 'x', orientation: 'bottom', ...(S.fixed ? { min: 0, max: 11 } : {}) }, new L.LinearScale());
      y = new L.Axis(
        { id: 'y', orientation: 'left', inverted: S.reversed, ...tickModes[S.ticks], ...(S.ticks === 'auto' ? { nice: true } : {}) },
        new L.LinearScale(),
      );
      const r = {
        line: [new L.LinePath({}, new L.LinearCurve())],
        'line+markers': [new L.LinePath({}, new L.LinearCurve()), new L.CircleMarker({ size: S.size })],
        markers: [new L.CircleMarker({ size: S.size })],
        area: [new L.AreaPath({}, new L.LinearCurve()), new L.LinePath({}, new L.LinearCurve())],
        bars: [new L.BarPath({})],
      }[S.shape];
      series = new L.DomainSeries(
        { name: 'readings', gaps: S.gaps, hit: S.shape === 'bars' ? undefined : 'point' },
        new L.FlatDataSource({ data: Float64Array.from(ys), regularDomain: { start: 0, step: 1 } }),
        ...r,
      );
      return new L.CartesianPlane({ frame: true }, x, y, series);
    }
    function mount() {
      if (plane) chart.remove(plane);
      plane = build();
      chart.insertBefore(plane, tooltip);
    }
    chart.append(tooltip);
    mount();
    function report() {
      const px = (v) => fmt(v, 1);
      read.textContent = [
        `x range     ${fmt(x.range.min, 2)} … ${fmt(x.range.max, 2)}   (data 0 … 11)`,
        `y range     ${fmt(y.range.min, 2)} … ${fmt(y.range.max, 2)}`,
        `first point ${px(series.points.data[0])} px from the left edge`,
        `ticks y     ${y
          .getTicks(plane.rect.height)
          .map((t) => t.label)
          .join('  ')}`,
      ].join('\n');
    }
    const rebuild = () => {
      mount();
      chart.flush();
    };
    ctx.add(
      ui.seg({
        label: 'drawn as',
        options: [
          ['line', 'line'],
          ['line+markers', 'line + markers'],
          ['markers', 'markers'],
          ['area', 'area'],
          ['bars', 'bars'],
        ],
        value: S.shape,
        onChange: (v) => {
          S.shape = v;
          rebuild();
        },
      }),
      ui.seg({
        label: 'missing values (NaN)',
        options: [
          ['break', 'break'],
          ['connect', 'connect'],
          ['zero', 'zero'],
        ],
        value: S.gaps,
        onChange: (v) => {
          S.gaps = v;
          series.setAttribute('gaps', v);
        },
      }),
      ui.seg({
        label: 'y ticks',
        options: [
          ['auto', 'automatic'],
          ['list', 'a list'],
          ['step', 'every 2'],
          ['function', 'ends and middle'],
        ],
        value: S.ticks,
        onChange: (v) => {
          S.ticks = v;
          rebuild();
        },
      }),
      ui.toggle({
        label: 'reverse the y axis',
        value: S.reversed,
        onChange: (v) => {
          S.reversed = v;
          y.setAttribute('inverted', v);
        },
      }),
      ui.slider({
        label: 'marker size',
        min: 1,
        max: 20,
        value: S.size,
        onChange: (v) => {
          S.size = v;
          rebuild();
        },
      }),
      ui.toggle({
        label: 'fix the x axis to 0 … 11 (no room left)',
        value: S.fixed,
        onChange: (v) => {
          S.fixed = v;
          rebuild();
        },
      }),
      read,
      ui.note(
        "With the x axis fixed, markers and bars at the ends are cut by the plot edge; left free, the axis leaves their radius (in pixels, whatever the size of the chart) past each end of the data, and bars get half a bar. A list or function of ticks overrides the scale's choice; ticks outside the range are not drawn. Missing values break the line, connect across, or count as zero (the axis then reaches zero).",
      ),
    );
    return { chart };
  },
});

// ── 3b3. Steps and curves ────────────────────────────────────────────────────
demos.push({
  id: 'curves',
  title: 'Steps & curves',
  blurb: 'Stepped lines before, after and centred; every curve SVG draws natively; on any plane',
  setup(ctx) {
    const S = {
      shape: 'line',
      curve: 'monotone',
      tension: 0,
      alpha: 0.5,
      bend: 0.3,
      view: 'vertical',
      data: 'random',
      n: 10,
      gaps: 'none',
      points: true,
      stack: false,
      read: 'points',
      seed: 1,
    };
    const curves = [
      ['after', 'step after'],
      ['before', 'step before'],
      ['center', 'step centred'],
      ['linear', 'linear'],
      ['monotone', 'monotone'],
      ['natural', 'natural'],
      ['cardinal', 'cardinal'],
      ['catmull-rom', 'Catmull-Rom'],
      ['basis', 'basis'],
      ['bump', 'bump'],
      ['quadratic', 'quadratic'],
      ['arc', 'arc'],
    ];
    const isStep = (c) => ['after', 'before', 'center'].includes(c);
    const read = ui.readout();
    let plane = null;
    const kit = tipKit('snap'),
      tooltip = kit.cursor;
    const chart = new L.Chart({
      theme: chartTheme(),
      onFlush: (st) => {
        ctx.onFlush(st);
        report();
      },
    });
    const reading = () => {
      kit.setMode(S.read === 'line' ? 'shared' : 'snap');
      kit.cursor.setAttribute('interpolate', S.read === 'line');
    };
    function values(k) {
      const r = rng(S.seed + k * 17);
      const base = S.data === 'plateaus' ? [1, 1, 1, 4, 4, 4, 2, 2, 5, 5, 5, 3, 3, 1, 1, 4] : null;
      return Array.from({ length: S.n }, (_, i) => {
        if (S.gaps === 'one' && i === Math.floor(S.n / 2)) return NaN;
        if (S.gaps === 'two' && (i === Math.floor(S.n / 3) || i === Math.floor((2 * S.n) / 3))) return NaN;
        return base ? base[i % base.length] + k : Math.round((2 + 2 * Math.sin(i / 1.6 + k) + r() * 2 + k) * 10) / 10;
      });
    }
    /** The curve for the current choice, a new one each time (a curve is an element, and an element has one parent). */
    const curveFor = () => {
      const c = S.curve;
      if (isStep(c)) return new L.StepCurve({ mode: c });
      switch (c) {
        case 'monotone':
          return new L.MonotoneCurve();
        case 'natural':
          return new L.NaturalCurve();
        case 'cardinal':
          return new L.CardinalCurve({ tension: S.tension });
        case 'catmull-rom':
          return new L.CatmullRomCurve({ alpha: S.alpha });
        case 'basis':
          return new L.BasisCurve();
        case 'bump':
          return new L.BumpCurve();
        case 'quadratic':
          return new L.QuadraticCurve();
        case 'arc':
          return new L.ArcCurve({ bend: S.bend });
        default:
          return new L.LinearCurve();
      }
    };
    let paths = [];
    const renderers = () => {
      const area = S.shape === 'area',
        out = [];
      const path = (A) => {
        const p = new A({}, curveFor());
        paths.push(p);
        return p;
      };
      out.push(area ? path(L.AreaPath) : path(L.LinePath));
      if (area) out.push(path(L.LinePath));
      if (S.points) out.push(new L.CircleMarker({ size: 3.5 }));
      return out;
    };
    /** Changing the curve swaps the child of each path in place; nothing is rebuilt. */
    const swap = () => {
      for (const p of paths) p.setChild(0, curveFor());
      chart.flush();
      report();
    };
    function build() {
      const polar = S.view === 'polar' || S.view === 'radar',
        horizontal = S.view === 'horizontal';
      const orient = polar ? ['angle', 'radius'] : horizontal ? ['left', 'bottom'] : ['bottom', 'left'];
      const d = new L.Axis(
        {
          id: 'd',
          orientation: orient[0],
          ...(polar ? { min: 0, max: S.n, ...(S.view === 'radar' ? { tickCount: S.n + 1 } : {}) } : { padding: 0.02 }),
        },
        new L.LinearScale(),
      );
      const v = new L.Axis(
        { id: 'v', orientation: orient[1], min: 0, ...(S.stack ? { nice: true } : { max: S.data === 'plateaus' ? 6 : 8 }) },
        new L.LinearScale(),
      );
      const mk = (k) =>
        new L.DomainSeries(
          { name: 'series ' + (k + 1), domainAxis: 'd', valueAxis: 'v', hit: S.read === 'line' ? 'line' : 'point' },
          new L.FlatDataSource({ data: Float64Array.from(values(k)), regularDomain: { start: 0, step: 1 } }),
          ...renderers(),
        );
      const members = S.stack ? [mk(0), mk(1)] : [mk(0)];
      const kids = S.stack ? [new L.Stack({}, ...members)] : members;
      return S.view === 'polar'
        ? new L.PolarPlane({}, d, v, ...kids)
        : S.view === 'radar'
          ? new L.RadarPlane({}, d, v, ...kids)
          : new L.CartesianPlane({ frame: true }, d, v, ...kids);
    }
    function mount() {
      if (plane) chart.remove(plane);
      paths = [];
      plane = build();
      reading();
      chart.insertBefore(plane, tooltip);
    }
    chart.append(tooltip);
    mount();
    function report() {
      read.textContent = [
        `curve    ${S.curve}${isStep(S.curve) ? ' (steps: a level, then a jump)' : ''}`,
        `points   ${plane ? plane.series[0]?.points.count : 0}`,
      ].join('\n');
    }
    const rebuild = () => {
      mount();
      chart.flush();
    };
    ctx.add(
      ui.seg({
        label: 'drawn as',
        options: [
          ['line', 'line'],
          ['area', 'area'],
        ],
        value: S.shape,
        onChange: (x) => {
          S.shape = x;
          rebuild();
        },
      }),
      ui.seg({
        label: 'join the points with',
        options: curves,
        columns: 3,
        value: S.curve,
        onChange: (x) => {
          S.curve = x;
          swap();
        },
      }),
      ui.slider({
        label: 'cardinal tension',
        min: 0,
        max: 1,
        value: S.tension,
        format: (v) => fmt(v, 2),
        onChange: (x) => {
          S.tension = x;
          swap();
        },
      }),
      ui.slider({
        label: 'Catmull-Rom alpha (0 even, 0.5 centripetal, 1 chordal)',
        min: 0,
        max: 1,
        value: S.alpha,
        format: (v) => fmt(v, 2),
        onChange: (x) => {
          S.alpha = x;
          swap();
        },
      }),
      ui.slider({
        label: 'arc bend (rise ÷ chord, negative flips)',
        min: -0.9,
        max: 0.9,
        value: S.bend,
        format: (v) => fmt(v, 2),
        onChange: (x) => {
          S.bend = x;
          swap();
        },
      }),
      ui.seg({
        label: 'plane',
        options: [
          ['vertical', 'upright'],
          ['horizontal', 'domain up the side'],
          ['polar', 'polar'],
          ['radar', 'radar'],
        ],
        value: S.view,
        onChange: (x) => {
          S.view = x;
          rebuild();
        },
      }),
      ui.seg({
        label: 'data',
        options: [
          ['random', 'random'],
          ['plateaus', 'plateaus and jumps'],
        ],
        value: S.data,
        onChange: (x) => {
          S.data = x;
          rebuild();
        },
      }),
      ui.slider({
        label: 'points',
        min: 3,
        max: 40,
        value: S.n,
        onChange: (x) => {
          S.n = x;
          rebuild();
        },
      }),
      ui.seg({
        label: 'missing values',
        options: [
          ['none', 'none'],
          ['one', 'one'],
          ['two', 'two'],
        ],
        value: S.gaps,
        onChange: (x) => {
          S.gaps = x;
          rebuild();
        },
      }),
      ui.toggle({
        label: 'mark the points',
        value: S.points,
        onChange: (x) => {
          S.points = x;
          rebuild();
        },
      }),
      ui.toggle({
        label: 'two series, stacked',
        value: S.stack,
        onChange: (x) => {
          S.stack = x;
          rebuild();
        },
      }),
      ui.seg({
        label: 'hover reads',
        options: [
          ['points', 'the nearest point'],
          ['line', 'the line drawn (between points)'],
        ],
        value: S.read,
        onChange: (x) => {
          S.read = x;
          rebuild();
        },
      }),
      ui.buttons([
        'New data',
        () => {
          S.seed++;
          rebuild();
        },
      ]),
      read,
      ui.note(
        'Steps are worked out in the plane\'s own terms: on a circle a level is an arc and a jump a spoke, on a radar a level follows the polygon. The other curves are cubic (C), quadratic (Q, T) and arc (A) paths through the points as placed, so on a circle they are smooth lines through the points, not arcs of constant radius. Use "plateaus and jumps" to see monotone hold its flats where natural and cardinal swing past them. Each curve traces the path it draws; swapping one is a `setChild` on the path, so nothing is rebuilt. With hover set to read the line,, so with hover set to read the line, a tooltip between points gives the level of a step or the height of a curve, and it sits on what is drawn.',
      ),
    );
    return { chart };
  },
});

// ── 3b4. Time ────────────────────────────────────────────────────────────────
demos.push({
  id: 'time',
  title: 'Time axis',
  blurb: 'Calendar ticks in any time zone: midnights say the date, minutes say the time; Date + Intl or Temporal',
  setup(ctx) {
    const hasTemporal = typeof Temporal !== 'undefined';
    const S = { adapter: 'intl', zone: 'UTC', locale: 'en-US', span: 'days', weekStart: 1, seed: 1 };
    const zones = [
      ['UTC', 'UTC'],
      ['America/New_York', 'New York'],
      ['Europe/London', 'London'],
      ['Asia/Kolkata', 'Kolkata (+5:30)'],
      ['Australia/Lord_Howe', 'Lord Howe (30 min DST)'],
      ['local', 'this browser'],
    ];
    // Each span: where the data starts, how long it runs, how many points. The starts are chosen so the clocks change in New York inside the shorter ones.
    const H = 3600e3,
      D = 24 * H;
    const spans = {
      seconds: { label: '90 seconds', from: Date.UTC(2024, 2, 10, 6, 59, 30), length: 90e3, n: 91 },
      hours: { label: '6 hours', from: Date.UTC(2024, 5, 11, 20), length: 6 * H, n: 145 },
      days: { label: '4 days (clocks change in New York)', from: Date.UTC(2024, 2, 8, 12), length: 4 * D, n: 193 },
      weeks: { label: '10 weeks', from: Date.UTC(2024, 4, 20), length: 70 * D, n: 141 },
      years: { label: '3 years', from: Date.UTC(2022, 5, 1), length: 3 * 365 * D, n: 150 },
      decades: { label: '60 years', from: Date.UTC(1970, 0, 1), length: 60 * 365.25 * D, n: 241 },
    };
    const read = ui.readout();
    const kit = tipKit('snap'),
      tooltip = kit.cursor;
    const chart = new L.Chart({
      theme: chartTheme(),
      onFlush: (st) => {
        ctx.onFlush(st);
        report();
      },
    });
    let plane = null,
      x = null;
    const scale = () => {
      const attrs = { timeZone: S.zone, locale: S.locale, weekStart: S.weekStart };
      return S.adapter === 'temporal' ? new L.TemporalTimeScale(attrs) : new L.IntlTimeScale(attrs);
    };
    /** The sample data is ISO strings, as an API sends them; the library takes timestamps, so the domain is a function that parses each. */
    function rows() {
      const sp = spans[S.span],
        r = rng(S.seed);
      let v = 50;
      return Array.from({ length: sp.n }, (_, i) => {
        v += (r() - 0.5) * 8;
        return { at: new Date(sp.from + (sp.length * i) / (sp.n - 1)).toISOString(), value: Math.round(v * 10) / 10 };
      });
    }
    function build() {
      x = new L.Axis({ id: 'x', orientation: 'bottom' }, scale());
      const y = new L.Axis({ id: 'y', orientation: 'left', nice: true }, new L.LinearScale());
      const source = new L.ObjectDataSource({ source: rows(), domain: (row) => Date.parse(row.at), value: 'value' });
      return new L.CartesianPlane(
        { frame: true },
        x,
        y,
        new L.DomainSeries(
          { name: 'reading', hit: 'point' },
          source,
          new L.LinePath({}, new L.LinearCurve()),
          new L.CircleMarker({ size: 3 }),
        ),
        new L.PanZoom({}),
      );
    }
    function mount() {
      if (plane) chart.remove(plane);
      plane = build();
      chart.insertBefore(plane, tooltip);
    }
    chart.append(tooltip);
    mount();
    function report() {
      if (!x) return;
      const t = x.getTicks(plane.rect.width),
        iso = (v) => new Date(v).toISOString().replace('.000Z', 'Z');
      read.textContent = [
        `range  ${iso(x.range.min)}`,
        `    to ${iso(x.range.max)}`,
        `ticks  ${t.map((k) => k.label).join('  ·  ')}`,
        `mid    ${x.formatValue((x.range.min + x.range.max) / 2)}`,
      ].join('\n');
    }
    const rebuild = () => {
      mount();
      chart.flush();
    };
    /** The zone, locale, week and adapter are all the scale's, so they swap in place; the axis and the data stay. */
    const swap = () => {
      x.setChild(0, scale());
      chart.flush();
    };
    ctx.add(
      ui.seg({
        label: 'spanning',
        options: Object.entries(spans).map(([k, v]) => [k, v.label]),
        columns: 2,
        value: S.span,
        onChange: (v) => {
          S.span = v;
          rebuild();
        },
      }),
      ui.seg({
        label: 'time zone',
        options: zones,
        columns: 2,
        value: S.zone,
        onChange: (v) => {
          S.zone = v;
          swap();
        },
      }),
      ui.seg({
        label: 'built on',
        options: [['intl', 'Date + Intl'], ...(hasTemporal ? [['temporal', 'Temporal']] : [])],
        value: S.adapter,
        onChange: (v) => {
          S.adapter = v;
          swap();
        },
      }),
      ui.seg({
        label: 'language',
        options: [
          ['en-US', 'English (US)'],
          ['en-GB', 'English (UK)'],
          ['de-DE', 'Deutsch'],
          ['ja-JP', '日本語'],
        ],
        columns: 2,
        value: S.locale,
        onChange: (v) => {
          S.locale = v;
          swap();
        },
      }),
      ui.seg({
        label: 'weeks start on',
        options: [
          ['1', 'Monday'],
          ['0', 'Sunday'],
        ],
        value: String(S.weekStart),
        onChange: (v) => {
          S.weekStart = +v;
          swap();
        },
      }),
      ui.buttons([
        'New data',
        () => {
          S.seed++;
          rebuild();
        },
      ]),
      read,
      ui.note(
        'Data is ISO strings, parsed by the domain function (`Date.parse(row.at)`, or `Temporal.Instant.from(row.at).epochMilliseconds`); the library sees only millisecond timestamps. Ticks fall on the calendar, in the zone: midnights, the hour, the first of the month. Each tick says what it is: one that begins a day reads as the date, one that does not as the time, and the labels are worked out from the whole set. Zoom with the wheel through the levels; in "4 days" New York has a 23-hour day. ' +
          (hasTemporal ? '' : 'This browser has no Temporal, so only Date + Intl is offered.'),
      ),
    );
    return { chart };
  },
});

// ── 3b5. Legend ──────────────────────────────────────────────────────────────
demos.push({
  id: 'legend',
  title: 'Legend',
  blurb: 'Each series as it is drawn (dashes, boxes, markers over lines); click an entry (or Tab to it and press Space) to hide its series',
  setup(ctx) {
    const S = { side: 'right', toggle: true, title: true, swatch: true };
    const months = Array.from({ length: 12 }, (_, i) => i);
    const data = (f) => new L.FlatDataSource({ data: Float64Array.from(months, f), regularDomain: { start: 0, step: 1 } });
    const r = rng(5);
    const noise = months.map(() => r());
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 'month', tickStep: 1 }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', min: 0, nice: true }, new L.LinearScale());
    const linear = () => new L.LinearCurve();
    // Every kind of graphic the library draws, so each kind of sample is on show: bars, a dashed line, an area with its edge, markers alone, a line with markers over it, a smooth thick line.
    const series = [
      new L.DomainSeries(
        { name: 'Revenue', hit: 'shape' },
        data((i) => 40 + 18 * Math.sin(i / 2) + noise[i] * 10),
        new L.BarPath({}),
      ),
      new L.DomainSeries(
        { name: 'Target (dashed)', hit: 'line' },
        data(() => 55),
        new L.LinePath({ stroke: '#555', style: { seriesLine: { dash: '6 4' } } }, linear()),
      ),
      new L.DomainSeries(
        { name: 'Range', hit: 'point' },
        data((i) => 20 + 6 * Math.cos(i / 3) + noise[i] * 4),
        new L.AreaPath({}, linear()),
        new L.LinePath({}, linear()),
      ),
      new L.DomainSeries(
        { name: 'Samples (crosses)', hit: 'point' },
        data((i) => 30 + noise[i] * 40),
        new L.CrossMarker({ size: 4 }),
      ),
      new L.DomainSeries(
        { name: 'Trend (line + dots)', hit: 'point' },
        data((i) => 25 + i * 3.5),
        new L.LinePath({}, linear()),
        new L.CircleMarker({ size: 3.5 }),
      ),
      new L.DomainSeries(
        { name: 'Smoothed', hit: 'point' },
        data((i) => 62 + 10 * Math.sin(i / 1.5)),
        new L.LinePath({ strokeWidth: 3 }, new L.MonotoneCurve()),
      ),
    ];
    const plane = new L.CartesianPlane({ frame: true }, x, y, ...series);
    const legend = new L.Legend({ side: S.side, title: 'Series' });
    const kit = tipKit('shared', { swatch: S.swatch }),
      tooltip = kit.cursor;
    const read = ui.readout();
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: (st) => {
          ctx.onFlush(st);
          report();
        },
      },
      plane,
      legend,
      tooltip,
    );
    function report() {
      read.textContent =
        series.map((s) => `${s.shown ? '●' : '○'} ${s.attrs.name}`).join('\n') +
        `\n\nvalue axis ${fmt(y.range.min, 0)} … ${fmt(y.range.max, 0)}`;
    }
    ctx.add(
      ui.seg({
        label: 'legend on',
        options: [
          ['right', 'right'],
          ['left', 'left'],
          ['top', 'top'],
          ['bottom', 'bottom'],
        ],
        columns: 2,
        value: S.side,
        onChange: (v) => {
          S.side = v;
          legend.setAttribute('side', v);
        },
      }),
      ui.toggle({
        label: 'click an entry (or Tab to it and press Space) to hide its series',
        value: S.toggle,
        onChange: (v) => {
          S.toggle = v;
          legend.setAttribute('toggle', v);
        },
      }),
      ui.toggle({
        label: 'title',
        value: S.title,
        onChange: (v) => {
          S.title = v;
          legend.setAttribute('title', v ? 'Series' : '');
        },
      }),
      ui.toggle({
        label: 'tooltip shows a sample of each series',
        value: S.swatch,
        onChange: (v) => {
          S.swatch = v;
          kit.tooltip.setAttribute('swatch', v);
        },
      }),
      ui.buttons(
        [
          'Show all',
          () => {
            for (const s of series) s.setAttribute('visible', true);
          },
        ],
        ['Hide all but the first', () => series.forEach((s, i) => s.setAttribute('visible', i === 0))],
      ),
      read,
      ui.note(
        'A legend entry is a sample the series draws itself (`Series.sample`), in the look its renderers resolve: the dash of a line, the fill and outline of a box, the shape of a marker with a line under it when a series has both. The tooltip uses the same samples. A hidden series takes no part: it leaves the axis range (watch the value axis when Revenue goes), its stack, and the hits.',
      ),
    );
    return { chart };
  },
});

// ── 3b6. Keyboard and screen readers ─────────────────────────────────────────
demos.push({
  id: 'a11y',
  title: 'Keyboard & screen readers',
  blurb: 'Tab to the plot and the legend; arrows pan, + and - zoom, 0 resets; Enter or Space on a legend entry',
  setup(ctx) {
    const S = { summary: true, keys: 'default' };
    const days = Array.from({ length: 30 }, (_, i) => i);
    const r = rng(11);
    const data = (f) => new L.FlatDataSource({ data: Float64Array.from(days, f), regularDomain: { start: 0, step: 1 } });
    const x = new L.Axis({ orientation: 'bottom', title: 'day', tickStep: 5 }, new L.LinearScale());
    const y = new L.Axis({ orientation: 'left', title: 'visits', min: 0, nice: true }, new L.LinearScale());
    const series = [
      new L.DomainSeries(
        { name: 'Visits' },
        data((i) => 50 + 20 * Math.sin(i / 4) + r() * 8),
        new L.LinePath({}, new L.LinearCurve()),
      ),
      new L.DomainSeries(
        { name: 'Signups' },
        data((i) => 20 + i * 0.8 + r() * 5),
        new L.LinePath({}, new L.LinearCurve()),
      ),
    ];
    const pan = new L.PanZoom({});
    const plane = new L.CartesianPlane({ frame: true, meta: { title: 'Visits and signups over 30 days' } }, x, y, ...series, pan);
    const legend = new L.Legend({ side: 'bottom' });
    const kit = tipKit('shared', {});
    kit.cursor.setAttribute('meta', { title: 'Reading the values, one day at a time' });
    const summary = new L.ChartSummary({});
    const read = ui.readout();
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        meta: { title: 'Site traffic' },
        onFlush: (st) => {
          ctx.onFlush(st);
          report();
        },
      },
      plane,
      kit.cursor,
      legend,
      summary,
    );
    function report() {
      const svg = document.querySelector('#host svg');
      if (!svg) return;
      read.textContent = ['aria-label', 'aria-roledescription', 'aria-description']
        .map((n) => `${n}: ${svg.getAttribute(n) ?? '—'}`)
        .join('\n');
    }
    ctx.add(
      ui.toggle({
        label: 'summary for screen readers (English, opt-in)',
        value: S.summary,
        onChange: (v) => {
          S.summary = v;
          summary.setAttribute('visible', v);
        },
      }),
      ui.seg({
        label: 'plot keys',
        options: [
          ['default', 'default'],
          ['custom', 'i / o / r'],
          ['off', 'off'],
        ],
        columns: 3,
        value: S.keys,
        onChange: (v) => {
          S.keys = v;
          pan.setAttribute('keys', v === 'off' ? false : v === 'custom' ? { zoomIn: ['i'], zoomOut: ['o'], reset: ['r'] } : undefined);
        },
      }),
      ui.buttons(['Focus the plot', () => document.querySelector('#host svg [role=application]')?.focus()]),
      read,
      ui.note(
        'Tab reaches the plot for panning (role=application, so a screen reader passes the arrow keys through), then the plot for reading values, then each legend entry; at the reading cursor, Left and Right step through the days, Up and Down change series, Home and End go to the ends, and what the tooltip says is announced; a ring shows keyboard focus and not mouse focus. Arrows pan a tenth of the view (Shift or PageUp/PageDown a page), + and - zoom about the middle, 0 or Home reset. Legend entries are buttons: Enter presses on the way down, Space on the way up. The wording of the summary is in one opt-in component, so the core has no language in it.',
      ),
    );
    return { chart };
  },
});

// ── 3c. Stacked and grouped ──────────────────────────────────────────────────
demos.push({
  id: 'stack',
  title: 'Stacked & grouped',
  blurb: 'A Stack lays series on one another or side by side; bars, areas and lines on any plane',
  setup(ctx) {
    const S = {
      shape: 'bars',
      mode: 'stack',
      view: 'vertical',
      domain: 'categories',
      ragged: false,
      align: 'strict',
      negative: false,
      edit: true,
      seed: 1,
    };
    const names = ['Apples', 'Pears', 'Plums', 'Figs'],
      cats = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
    let rows = [];
    const read = ui.readout();
    const message = ui.note('', true);
    function generate() {
      const r = rng(S.seed);
      rows = names.map((_, k) => {
        const n = S.ragged ? 6 + k : cats.length,
          step = S.ragged ? 7.4 / (n - 1) : 1,
          shift = S.ragged ? k * 0.35 : 0;
        return Array.from({ length: n }, (_, i) => ({
          x: shift + i * step,
          y: Math.round((1.5 + r() * 4 + Math.sin(i / 1.5 + k) * 1.2) * (S.negative && k === 3 ? -0.8 : 1) * 10) / 10,
        }));
      });
    }
    const listener = () =>
      new L.PointerListener({
        onDrag: ({ hit, second, phase }) => {
          if (!S.edit || hit.row === undefined) return;
          const source = sources[names.indexOf(hit.series.attrs.name)],
            row = source?.attrs.source[hit.row];
          if (!row) return;
          row.y = Math.round(second * 10) / 10;
          source.invalidate();
        },
      });
    let sources = [];
    function build() {
      generate();
      const cat = S.domain === 'categories',
        polar = S.view === 'polar',
        horizontal = S.view === 'horizontal' && ['bars', 'stems', 'lollipops'].includes(S.shape);
      const percent = S.mode === 'normalize';
      const d = new L.Axis(
        { id: 'd', orientation: horizontal ? 'left' : polar ? 'angle' : 'bottom', ...(cat ? {} : { padding: 0.04, nice: false }) },
        cat ? new L.BandScale({ categories: cats }) : new L.LinearScale(),
      );
      const v = new L.Axis(
        {
          id: 'v',
          orientation: horizontal ? 'bottom' : polar ? 'radius' : 'left',
          nice: true,
          ...(percent ? { format: (n) => Math.round(n * 100) + '%' } : {}),
        },
        new L.LinearScale(),
      );
      sources = rows.map((rs) => new L.ObjectDataSource({ source: rs, domain: 'x', value: 'y', isSorted: true }));
      const renderers = () =>
        S.shape === 'bars'
          ? [new L.BarPath({})]
          : S.shape === 'stems'
            ? [new L.StemPath({ strokeWidth: 3 })]
            : S.shape === 'lollipops'
              ? [new L.StemPath({ strokeWidth: 2 }), new L.CircleMarker({ size: 5 })]
              : S.shape === 'areas'
                ? [new L.AreaPath({}, new L.LinearCurve())]
                : [new L.LinePath({}, new L.LinearCurve())];
      const members = sources.map((src, k) => new L.DomainSeries({ name: names[k], domainAxis: 'd', valueAxis: 'v' }, src, ...renderers()));
      const stack = new L.Stack({ mode: S.mode, align: S.align }, ...members);
      return polar ? new L.PolarPlane({}, d, v, stack, listener()) : new L.CartesianPlane({ frame: true }, d, v, stack, listener());
    }
    let plane = null;
    const kit = tipKit('shared'),
      tooltip = kit.cursor;
    const chart = new L.Chart({
      theme: chartTheme(),
      onFlush: (st) => {
        ctx.onFlush(st);
        report();
      },
    });
    function mountPlane() {
      if (plane) chart.remove(plane);
      plane = null;
      plane = build();
      chart.insertBefore(plane, tooltip);
    }
    chart.append(tooltip);
    mountPlane();
    function report() {
      const m = plane ? plane.series : [];
      read.textContent = [`series          ${m.length}`, `rows drawn      ${m.map((s) => s.points.count).join(' / ')}`].join('\n');
    }
    // A failed layout (strict domains that do not match) is shown rather than thrown into the page.
    const rebuild = () => {
      try {
        mountPlane();
        message.textContent = '';
        chart.flush();
      } catch (e) {
        message.textContent = String(e.message);
        chart.remove(plane);
        plane = null; // nothing to draw until the options make sense again
      }
    };
    ctx.add(
      ui.seg({
        label: 'drawn as',
        options: [
          ['bars', 'bars'],
          ['stems', 'stems'],
          ['lollipops', 'lollipops'],
          ['areas', 'areas'],
          ['lines', 'lines'],
        ],
        value: S.shape,
        onChange: (x) => {
          S.shape = x;
          rebuild();
        },
      }),
      ui.seg({
        label: 'layout',
        options: [
          ['stack', 'stack'],
          ['normalize', '100%'],
          ['center', 'centre'],
          ['group', 'side by side'],
        ],
        value: S.mode,
        onChange: (x) => {
          S.mode = x;
          rebuild();
        },
      }),
      ui.seg({
        label: 'plane',
        options: [
          ['vertical', 'upright'],
          ['horizontal', 'horizontal (bars, stems)'],
          ['polar', 'polar'],
        ],
        value: S.view,
        onChange: (x) => {
          S.view = x;
          rebuild();
        },
      }),
      ui.seg({
        label: 'domain',
        options: [
          ['categories', 'categories'],
          ['numbers', 'numbers'],
        ],
        value: S.domain,
        onChange: (x) => {
          S.domain = x;
          rebuild();
        },
      }),
      ui.toggle({
        label: 'different sampling per series (numbers)',
        value: S.ragged,
        onChange: (x) => {
          S.ragged = x;
          rebuild();
        },
      }),
      ui.seg({
        label: 'when the domains differ',
        options: [
          ['strict', 'strict'],
          ['gaps', 'gaps'],
          ['interpolate', 'interpolate'],
        ],
        value: S.align,
        onChange: (x) => {
          S.align = x;
          rebuild();
        },
      }),
      ui.toggle({
        label: 'a negative layer (Figs)',
        value: S.negative,
        onChange: (x) => {
          S.negative = x;
          rebuild();
        },
      }),
      ui.toggle({
        label: 'drag a point or bar to edit it',
        value: S.edit,
        onChange: (x) => {
          S.edit = x;
        },
      }),
      ui.buttons([
        'New data',
        () => {
          S.seed++;
          rebuild();
        },
      ]),
      read,
      message,
      ui.note(
        "Each member of the Stack is an ordinary series, with its own name, source and renderer; the stack only decides where each row starts and where it is drawn. Positive values stack up and negative ones down. With different sampling, strict refuses (try it), gaps leaves a hole where a series has no value (right for bars and stems) and interpolate draws the straight line between its points (right for areas). Dragging edits the layer's own value, not the stacked height.",
      ),
    );
    return { chart };
  },
});

/** A scale defined in this page, to show that a new transform is just a class: sign(v) * |v| ** exponent. */
class SignedPowerScale extends L.Scale {
  #linear = new L.LinearScale(); // ticks and tidy ends are still chosen in data space
  #f(v) {
    return Math.sign(v) * Math.abs(v) ** (this.attrs.exponent ?? 0.5);
  }
  #g(u) {
    return Math.sign(u) * Math.abs(u) ** (1 / (this.attrs.exponent ?? 0.5));
  }
  normalize(buffer, count, stride, offset, range) {
    const lo = this.#f(range.min),
      span = this.#f(range.max) - lo,
      inv = span > 0 ? 1 / span : 0;
    for (let k = 0, i = offset; k < count; k++, i += stride) buffer[i] = (this.#f(buffer[i]) - lo) * inv;
  }
  denormalize(fraction, range) {
    const lo = this.#f(range.min);
    return this.#g(lo + fraction * (this.#f(range.max) - lo));
  }
  constrain(range) {
    return range;
  }
  nice(range) {
    return this.#linear.nice(range);
  }
  ticks(range, count) {
    return this.#linear.ticks(range, count);
  }
}

// ── 3z. JSX ──────────────────────────────────────────────────────────────────
demos.push({
  id: 'jsx',
  title: 'JSX',
  blurb: "The same library written as JSX: compiled against the library's own runtime, tags build elements at once",
  setup(ctx) {
    const wave = (k) => Float64Array.from({ length: 100 }, (_, i) => Math.sin(i / 8 + k) * (1 + k / 3) + k);
    const waves = [
      { name: 'first', color: PALETTE[0], data: wave(0) },
      { name: 'second', color: PALETTE[1], data: wave(1) },
    ];
    const refs = { plane: { current: null }, series: { first: { current: null }, second: { current: null } } };
    const chart = jsxChart({ theme: chartTheme(), onFlush: ctx.onFlush, waves, refs });
    let extra = 0;
    ctx.add(
      ui.toggle({ label: 'show the second series', value: true, onChange: (v) => refs.series.second.current.setAttribute('visible', v) }),
      ui.buttons([
        'Add a series (a function used as a tag)',
        () => {
          const k = 2 + extra++;
          refs.plane.current.append(Wave({ name: 'wave ' + k, color: PALETTE[k % PALETTE.length], data: wave(k) }));
        },
      ]),
    );
    ctx.add(
      ui.note(
        'The chart above is built by jsxChart() in playground/jsx-demo.jsx. Hyphenated attributes such as meta-title="Time (s)" and regularDomain-step={0.1} become nested objects.',
      ),
    );
    return { chart };
  },
});

// ── 4. Live tree ─────────────────────────────────────────────────────────────
demos.push({
  id: 'tree',
  title: 'Live tree',
  blurb: 'Add, remove, reorder and swap elements on a running chart',
  setup(ctx) {
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 'x' }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'y', nice: true }, new L.LinearScale());
    const plane = new L.CartesianPlane({ frame: true }, x, y);
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane);
    let count = 0,
      y2 = null,
      exponent = 0.5;
    const names = new Map();
    const list = h('div', { class: 'chips' });
    const mk = () => {
      const i = count++,
        r = rng(i + 7);
      const amp = 0.5 + r() * 2,
        f = 1 + r() * 4,
        ph = r() * 6;
      const rows = Array.from({ length: 120 }, (_, k) => ({ t: k / 12, v: amp * Math.sin(ph + (f * k) / 12) }));
      const s = new L.DomainSeries(
        new L.ObjectDataSource({ source: rows, domain: 't', value: 'v', isSorted: true }),
        new L.LinePath({ stroke: PALETTE[i % PALETTE.length], strokeWidth: 2 }, new L.LinearCurve()),
      );
      names.set(s, 'series ' + (i + 1));
      return s;
    };
    const series = () => plane.series;
    const refresh = () => {
      list.replaceChildren(
        ...series().map((s) =>
          h(
            'button',
            {
              class: 'chip',
              type: 'button',
              title: 'click to delete',
              onclick: () => {
                plane.remove(s);
                refresh();
              },
            },
            names.get(s),
          ),
        ),
      );
    };
    plane.append(mk(), mk());
    refresh();
    ctx.add(
      ui.buttons(
        [
          'Add series',
          () => {
            plane.append(mk());
            refresh();
          },
        ],
        [
          'Remove last',
          () => {
            const l = series().at(-1);
            if (l) plane.remove(l);
            refresh();
          },
        ],
      ),
      ui.buttons(
        [
          'First → end',
          () => {
            const f = series()[0];
            if (f) {
              plane.remove(f);
              plane.append(f);
            }
            refresh();
          },
        ],
        [
          'Last → front',
          () => {
            const l = series().at(-1);
            if (l) {
              plane.remove(l);
              plane.insertBefore(l, plane.firstChild);
            }
            refresh();
          },
        ],
      ),
      ui.toggle({
        label: 'second value axis (last series)',
        value: false,
        onChange: (on) => {
          const last = series().at(-1);
          if (on && last) {
            y2 = new L.Axis({ id: 'y2', orientation: 'right', title: 'y2', nice: true }, new L.LinearScale());
            plane.append(y2);
            last.setAttribute('valueAxis', 'y2');
          } else if (y2) {
            series().forEach((s) => s.setAttribute('valueAxis', undefined));
            plane.remove(y2);
            y2 = null;
          }
        },
      }),
      ui.seg({
        label: 'left axis scale (swapped in place)',
        options: [
          ['linear', 'linear'],
          ['power', 'signed power (custom)'],
        ],
        value: 'linear',
        onChange: (v) => {
          y.setChild(0, v === 'linear' ? new L.LinearScale() : new SignedPowerScale({ exponent }));
        },
      }),
      ui.slider({
        label: 'power exponent',
        min: 0.2,
        max: 1,
        step: 0.05,
        value: exponent,
        onChange: (v) => {
          exponent = v;
          if (y.child(0) instanceof SignedPowerScale) y.child(0).setAttribute('exponent', v);
        },
      }),
      h('div', { class: 'field' }, h('div', { class: 'lab' }, 'series (click to delete)'), list),
      ui.note(
        'Order in the tree is drawing order. Nodes are created where they belong, so reordering never leaves a series under the gridlines or over the frame. Open the element tree and SVG tabs to watch it.',
      ),
    );
    return { chart };
  },
});

// ── 5. Pointer and events ────────────────────────────────────────────────────
/** A custom element: it only listens, to show what a plane's children are sent. Drawing is the library's `Crosshair`. */
class EventProbe extends L.ChartElement {
  onEvent(ev) {
    if (ev.type !== L.EVENT_POINTER) return;
    if (ev.kind === 'wheel' && this.attrs.claimWheel) ev.handled = true;
    this.attrs.onPointer?.(ev, ev.kind === 'leave' ? null : { x: ev.x, y: ev.y });
  }
}
demos.push({
  id: 'pointer',
  title: 'Pointer & events',
  blurb: 'Input routed to a plane, in its own coordinates',
  setup(ctx) {
    const x = new L.Axis({ orientation: 'bottom', title: 'x' }, new L.LinearScale());
    const y = new L.Axis({ orientation: 'left', title: 'y', nice: true }, new L.LinearScale());
    const ys = shape('noisy', 300, 3);
    const read = ui.readout(),
      log = ui.readout();
    const lines = [];
    let plane;
    const crosshair = new EventProbe({
      claimWheel: true,
      onPointer: (ev, pos) => {
        lines.unshift(
          `${ev.kind.padEnd(6)} ${ev.x.toFixed(0).padStart(4)} ${ev.y.toFixed(0).padStart(4)}  buttons=${ev.buttons}${ev.kind === 'wheel' ? ' dy=' + ev.deltaY.toFixed(0) : ''}`,
        );
        lines.length = Math.min(lines.length, 10);
        log.textContent = lines.join('\n');
        const r = plane.rect,
          dx = plane.defaultAxis('domain'),
          dy = plane.defaultAxis('value');
        read.textContent = pos
          ? `plane  ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}   (plot ${r.width.toFixed(0)} × ${r.height.toFixed(0)})\ndata   ${dx.denormalize(pos.x / r.width).toFixed(3)}, ${dy.denormalize(1 - pos.y / r.height).toFixed(3)}`
          : 'pointer is outside the plane';
      },
    });
    plane = new L.CartesianPlane(
      { frame: true },
      x,
      y,
      new L.DomainSeries(
        new L.FlatDataSource({ data: ys, regularDomain: { start: 0, step: 10 / 299 } }),
        new L.LinePath({ stroke: PALETTE[0], strokeWidth: 1.5 }, new L.LinearCurve()),
      ),
      crosshair,
    );
    const chart = new L.Chart(
      { theme: chartTheme(), onFlush: ctx.onFlush },
      plane,
      new L.Cursor({ keys: false }, new L.Crosshair({ lines: 'both' })),
    );
    ctx.add(
      ui.toggle({
        label: 'claim wheel events (page will not scroll over the chart)',
        value: true,
        onChange: (v) => crosshair.setAttribute('claimWheel', v),
      }),
      read,
      log,
      ui.note(
        "The log is a custom element defined in this page: it extends ChartElement and handles EVENT_POINTER, in the plane's own coordinates. The crosshair is the library's, in a Cursor. Drag past the edge while a button is down: the plane keeps receiving moves until release. Resize the chart by its corner.",
      ),
    );
    return { chart };
  },
});

// ── 6. Pan and zoom ──────────────────────────────────────────────────────────
demos.push({
  id: 'panzoom',
  title: 'Pan & zoom',
  blurb: 'Drag, wheel and double-click over millions of points',
  setup(ctx) {
    const S = { n: 2e6, shape: 'walk', seed: 1, second: false };
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 't' }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'value', nice: true }, new L.LinearScale());
    const dataFor = (n, shapeName, seed, scale = 1) => {
      const v = shape(shapeName, n, seed);
      if (scale !== 1) for (let i = 0; i < n; i++) v[i] *= scale;
      return new L.FlatDataSource({ data: v, regularDomain: { start: 0, step: 10 / (n - 1) } });
    };
    const mainSource = dataFor(S.n, S.shape, S.seed);
    const mainDecimator = new L.Decimator({}, new L.MinMaxKernel(), mainSource);
    const pz = new L.PanZoom({ direction: 'horizontal' });
    const plane = new L.CartesianPlane(
      { frame: true },
      x,
      y,
      new L.DomainSeries(mainDecimator, new L.LinePath({ stroke: PALETTE[0], strokeWidth: 1 }, new L.LinearCurve())),
      pz,
    );
    const read = ui.readout(),
      axesBox = h('div', { class: 'btns' });
    let y2 = null,
      second = null;
    const enabled = { x: true, y: true, y2: true };
    const syncAxes = () => {
      const ids = ['x', 'y', ...(y2 ? ['y2'] : [])].filter((id) => enabled[id]);
      pz.setAttribute('axes', ids);
    };
    const report = () => {
      const axes = plane.axes;
      read.textContent = axes
        .map(
          (a) =>
            `${(a.attrs.id ?? '?').padEnd(3)} ${fmt(a.range.min, 4).padStart(12)} … ${fmt(a.range.max, 4).padEnd(12)} ${a.isZoomed ? 'zoomed' : 'natural'}`,
        )
        .join('\n');
    };
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: (st) => {
          ctx.onFlush(st);
          report();
        },
      },
      plane,
    );
    const rebuild = () => {
      mainDecimator.setChild(1, dataFor(S.n, S.shape, S.seed));
      if (second) second.setChild(0, dataFor((S.n / 4) | 0, 'noisy', S.seed + 1, 100));
    };
    const toggleAxis = (id) =>
      ui.toggle({
        label: `move ${id}`,
        value: true,
        onChange: (v) => {
          enabled[id] = v;
          syncAxes();
        },
      });
    ctx.add(
      h('p', { class: 'note' }, 'Drag to pan. Turn the wheel to zoom about the pointer. Double-click to reset.'),
      ui.buttons(['Reset view', () => pz.reset()]),
      ui.slider({
        label: 'points',
        min: 1e4,
        max: 1e7,
        value: S.n,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.n = v;
          rebuild();
        },
      }),
      ui.seg({
        label: 'shape',
        options: [
          ['walk', 'random walk'],
          ['noisy', 'noisy sine'],
          ['spikes', 'spikes'],
        ],
        value: S.shape,
        onChange: (v) => {
          S.shape = v;
          rebuild();
        },
      }),
      ui.seg({
        label: 'direction',
        options: [
          ['both', 'both'],
          ['horizontal', 'horizontal'],
          ['vertical', 'vertical'],
        ],
        value: 'horizontal',
        onChange: (v) => pz.setAttribute('direction', v),
      }),
      ui.toggle({ label: 'pan (drag)', value: true, onChange: (v) => pz.setAttribute('pan', v) }),
      ui.toggle({ label: 'zoom (wheel)', value: true, onChange: (v) => pz.setAttribute('zoom', v) }),
      ui.toggle({ label: 'limit to the data', value: true, onChange: (v) => pz.setAttribute('limit', v) }),
      ui.toggle({ label: 'double-click resets', value: true, onChange: (v) => pz.setAttribute('resetOnDoubleClick', v) }),
      ui.slider({
        label: 'zoom speed',
        min: 0.0005,
        max: 0.006,
        step: 0.0005,
        value: 0.002,
        format: (v) => v.toFixed(4),
        onChange: (v) => pz.setAttribute('zoomSpeed', v),
      }),
      ui.toggle({
        label: 'second series on its own right-hand axis',
        value: false,
        onChange: (on) => {
          if (on) {
            y2 = new L.Axis({ id: 'y2', orientation: 'right', title: 'y2 (×100)', nice: true }, new L.LinearScale());
            second = new L.DomainSeries(
              { domainAxis: 'x', valueAxis: 'y2' },
              new L.Decimator({}, new L.MinMaxKernel(), dataFor((S.n / 4) | 0, 'noisy', S.seed + 1, 100)),
              new L.LinePath({ stroke: PALETTE[1], strokeWidth: 1 }, new L.LinearCurve()),
            );
            plane.append(y2, second);
          } else {
            plane.remove(second);
            plane.remove(y2);
            second = y2 = null;
          }
          axesBox.replaceChildren(...['x', 'y', ...(y2 ? ['y2'] : [])].map((id) => toggleAxis(id)));
          syncAxes();
        },
      }),
      h('div', { class: 'field' }, h('div', { class: 'lab' }, 'axes it may move'), axesBox),
      read,
      ui.note(
        'The value axis refits what is in view whenever only the horizontal axis moves (direction: horizontal). Each step reads from the full data again, so the detail stays at one point or two per pixel however far in you go. The plot area can change size a little as tick labels change width, which shows up as a slight shift while zooming.',
      ),
    );
    axesBox.replaceChildren(...['x', 'y'].map((id) => toggleAxis(id)));
    return { chart };
  },
});

demos.push({
  id: 'markers',
  title: 'Markers & scatter',
  blurb: 'Dots, crosses and shapes, with colour and size bound to data',
  setup(ctx) {
    const S = { n: 5000, kind: 'circle', colour: true, size: false, cap: 'round', merge: true, px: 3, opacity: 1, maxNodes: 100, seed: 1 };
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 'x', padding: 0.04 }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'y', padding: 0.04 }, new L.LinearScale());
    const heat = new L.ColorAxis({ id: 'heat', title: 'Pressure' }, new L.LinearScale());
    const mass = new L.ScalarAxis({ id: 'mass', title: 'Mass', output: [2, 10] }, new L.LinearScale());
    // Four clusters. Points are interleaved x, y, pressure, mass, in no particular order: the source sorts them.
    const makeData = () => {
      const r = rng(S.seed),
        v = new Float64Array(4 * S.n),
        centres = [
          [-4, -2],
          [3, 3],
          [5, -3],
          [-2, 4],
        ];
      for (let i = 0; i < S.n; i++) {
        const k = i % 4,
          [cx, cy] = centres[k];
        v[4 * i] = cx + gauss(r);
        v[4 * i + 1] = cy + gauss(r) * 1.2;
        v[4 * i + 2] = k * 25 + gauss(r) * 10;
        v[4 * i + 3] = Math.exp(gauss(r) * 0.5);
      }
      return new L.FlatDataSource({ data: v, stride: 4, channels: { pressure: 2, mass: 3 } });
    };
    const filled = () => S.kind === 'circle' || S.kind === 'square';
    const build = () => {
      const bind = {};
      if (S.colour) bind[filled() ? 'fill' : 'stroke'] = { axis: heat, channel: 'pressure' };
      if (S.size) bind.size = { axis: mass, channel: 'mass' };
      const common = { size: S.px, opacity: S.opacity, merge: S.merge, maxNodes: S.maxNodes, bind };
      const colour = filled() ? { fill: PALETTE[0] } : { stroke: PALETTE[0] };
      switch (S.kind) {
        case 'dot':
          return new L.DotMarker({ ...common, ...colour, cap: S.cap });
        case 'cross':
          return new L.CrossMarker({ ...common, ...colour });
        case 'plus':
          return new L.PlusMarker({ ...common, ...colour });
        case 'square':
          return new L.SquareMarker({ ...common, ...colour });
        default:
          return new L.CircleMarker({ ...common, ...colour });
      }
    };
    let renderer = build();
    const series = new L.DomainSeries(makeData(), renderer);
    const plane = new L.CartesianPlane({ frame: true }, x, y, series, new L.PanZoom({ direction: 'both' }));
    const heatKey = new L.ColorKey({ dimension: heat }),
      massKey = new L.SizeKey({ dimension: mass, visible: S.size });
    const keys = { show: true, side: 'right' };
    const syncKeys = () => {
      heatKey.setAttribute('visible', keys.show && S.colour);
      heatKey.setAttribute('side', keys.side);
      massKey.setAttribute('visible', keys.show && S.size);
      massKey.setAttribute('side', keys.side);
    };
    const read = ui.readout();
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: (st) => {
          ctx.onFlush(st);
          read.textContent = `${host.querySelectorAll('svg path').length} paths in the chart\n${fmt(st.pointsDrawn, 0)} points drawn, ${bytes(st.pathBytes)} of path data`;
        },
      },
      plane,
      heat,
      mass,
      heatKey,
      massKey,
    );
    const swap = () => {
      const old = renderer;
      renderer = build();
      series.remove(old);
      series.append(renderer);
    };
    ctx.add(
      ui.note('Drag to pan, wheel to zoom. Markers outside the plot are not drawn.'),
      ui.seg({
        label: 'marker',
        options: [
          ['dot', 'dot'],
          ['cross', '×'],
          ['plus', '+'],
          ['circle', 'circle'],
          ['square', 'square'],
        ],
        value: S.kind,
        onChange: (v) => {
          S.kind = v;
          swap();
        },
      }),
      ui.seg({
        label: 'dot cap (DotMarker)',
        options: [
          ['round', 'round'],
          ['square', 'square'],
        ],
        value: S.cap,
        onChange: (v) => {
          S.cap = v;
          renderer.setAttribute('cap', v);
        },
      }),
      ui.slider({
        label: 'points',
        min: 100,
        max: 2e5,
        value: S.n,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.n = v;
          series.setChild(0, makeData());
        },
      }),
      ui.slider({
        label: 'size (px)',
        min: 1,
        max: 12,
        step: 0.5,
        value: S.px,
        onChange: (v) => {
          S.px = v;
          renderer.setAttribute('size', v);
        },
      }),
      ui.slider({
        label: 'opacity',
        min: 0.1,
        max: 1,
        step: 0.05,
        value: S.opacity,
        onChange: (v) => {
          S.opacity = v;
          renderer.setAttribute('opacity', v);
        },
      }),
      ui.toggle({
        label: 'colour = pressure',
        value: S.colour,
        onChange: (v) => {
          S.colour = v;
          swap();
          syncKeys();
        },
      }),
      ui.toggle({
        label: 'size = mass',
        value: S.size,
        onChange: (v) => {
          S.size = v;
          swap();
          syncKeys();
        },
      }),
      ui.seg({
        label: 'colour ramp',
        options: [
          ['viridis', 'viridis'],
          ['magma', 'magma'],
          ['turbo', 'turbo'],
          ['diverging', 'diverging'],
        ],
        value: 'viridis',
        onChange: (v) => heat.setAttribute('ramp', v),
      }),
      ui.toggle({
        label: 'show keys',
        value: true,
        onChange: (v) => {
          keys.show = v;
          syncKeys();
        },
      }),
      ui.seg({
        label: 'keys on',
        options: [
          ['right', 'right'],
          ['left', 'left'],
          ['top', 'top'],
          ['bottom', 'bottom'],
        ],
        value: keys.side,
        onChange: (v) => {
          keys.side = v;
          syncKeys();
        },
      }),
      ui.slider({
        label: 'maxNodes',
        min: 4,
        max: 1000,
        value: S.maxNodes,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.maxNodes = v;
          renderer.setAttribute('maxNodes', v);
        },
      }),
      ui.toggle({
        label: 'merge into shared paths',
        value: S.merge,
        onChange: (v) => {
          S.merge = v;
          renderer.setAttribute('merge', v);
        },
      }),
      read,
      ui.note(
        "Merged markers that look alike share one path, so opacity does not darken where they overlap; switch merge off to see them blend (and watch the node count and flush time, which is why it is a bad idea for big data). A bound colour is quantized into at most maxNodes paths: lower it to see the bands. A bound size costs nothing on crosses, pluses and shapes, but a dot's size is a stroke width, so on dots it is quantized like a colour.",
        true,
      ),
    );
    return { chart };
  },
});

demos.push({
  id: 'bubble',
  title: 'Bubble series',
  blurb: 'A CircleMarker with its size bound to a channel',
  setup(ctx) {
    const regions = ['North', 'South', 'East', 'West', 'Islands'];
    const r = rng(7);
    // Made up: income, life expectancy, population (millions) and region for forty places.
    const places = Array.from({ length: 40 }, (_, i) => {
      const income = 1 + r() * 11,
        region = i % 5;
      return { income, life: 52 + income * 2.1 + region * 1.2 + (r() - 0.5) * 7, pop: Math.exp(r() * 4.2), region };
    });
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 'Income (k per head)', padding: 0.08 }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'Life expectancy', padding: 0.1 }, new L.LinearScale());
    const area = new L.ScalarAxis(
      { id: 'pop', title: 'Population (M)', output: [3, 26], format: (v) => fmt(v * v, 0) },
      new L.LinearScale(),
    );
    const group = new L.ColorAxis(
      {
        id: 'region',
        title: 'Region',
        ramp: PALETTE.slice(0, 5),
        interpolation: 'step',
        min: 0,
        max: 4,
        tickCount: 5,
        format: (v) => regions[Math.round(v)] ?? '',
      },
      new L.LinearScale(),
    );
    const source = new L.ObjectDataSource({
      source: places,
      domain: 'income',
      value: 'life',
      channels: { region: 'region', root: (p) => Math.sqrt(p.pop) }, // area is proportional to population
    });
    const marker = new L.CircleMarker({
      stroke: '#fff',
      strokeWidth: 1,
      opacity: 0.8,
      bind: { fill: { axis: group, channel: 'region' }, size: { axis: area, channel: 'root' } },
    });
    const plane = new L.CartesianPlane({ frame: true }, x, y, new L.DomainSeries(source, marker));
    const keys = [new L.ColorKey({ dimension: group, length: 100 }), new L.SizeKey({ dimension: area, length: 200 })];
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane, group, area, ...keys);
    ctx.add(
      ui.slider({ label: 'largest bubble (px)', min: 8, max: 50, value: 26, onChange: (v) => area.setAttribute('output', [3, v]) }),
      ui.slider({ label: 'opacity', min: 0.2, max: 1, step: 0.05, value: 0.8, onChange: (v) => marker.setAttribute('opacity', v) }),
      ui.toggle({ label: 'merge into shared paths', value: true, onChange: (v) => marker.setAttribute('merge', v) }),
      ui.seg({
        label: 'keys on',
        options: [
          ['right', 'right'],
          ['left', 'left'],
          ['top', 'top'],
          ['bottom', 'bottom'],
        ],
        value: 'right',
        onChange: (v) => keys.forEach((k) => k.setAttribute('side', v)),
      }),
      ui.note(
        "No bubble series exists: this is a CircleMarker with `size` bound to a channel through a ScalarAxis, and `fill` bound to the region through a stepped ColorAxis. The channel is the square root of the population, so a bubble's area, not its radius, follows the population. With merge on, bubbles of one region share a path (one node per colour in use) and do not blend where they overlap.",
      ),
    );
    return { chart };
  },
});

demos.push({
  id: 'polar',
  title: 'Polar plane',
  blurb: 'Angle round, value out; an area closes without being told how',
  setup(ctx) {
    // Made up: a daily cycle in degrees of the clock face, and a second, smaller one a different shape.
    const rows = (f) => Array.from({ length: 361 }, (_, a) => ({ a, r: f((a * Math.PI) / 180) }));
    const main = rows((t) => 6 + 3 * Math.sin(2 * t) + 1.5 * Math.cos(5 * t));
    const second = rows((t) => 4 + 2 * Math.cos(3 * t));
    const angle = new L.Axis(
      { id: 'angle', orientation: 'angle', min: 0, max: 360, tickCount: 12, format: (v) => Math.round(v * 10) / 10 + '°' },
      new L.LinearScale(),
    );
    const radius = new L.Axis({ id: 'radius', orientation: 'radius', min: 0, max: 10, tickCount: 5 }, new L.LinearScale());
    const area = new L.AreaPath({ fill: '#2a6fdb', opacity: 0.3 }, new L.LinearCurve());
    const edge = new L.LinePath({ stroke: '#2a6fdb', strokeWidth: 1.5 }, new L.LinearCurve());
    const inner = new L.AreaPath({ fill: '#e8590c', opacity: 0.3, baseline: 2 }, new L.LinearCurve());
    const innerEdge = new L.LinePath({ stroke: '#e8590c', strokeWidth: 1.5 }, new L.LinearCurve());
    const src = (r) => new L.ObjectDataSource({ source: r, domain: 'a', value: 'r', isSorted: true });
    const plane = new L.PolarPlane(
      {},
      angle,
      radius,
      new L.DomainSeries({ name: 'Blue' }, src(main), area, edge),
      new L.DomainSeries({ name: 'Orange' }, src(second), inner, innerEdge),
      new L.PanZoom({}),
    );
    const kit = tipKit('shared');
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane, kit.cursor);
    ctx.add(
      ui.seg({
        label: 'cursor',
        options: [
          ['off', 'off'],
          ['snap', 'nearest point'],
          ['shared', 'every series here'],
        ],
        value: 'shared',
        onChange: (m) => {
          kit.cursor.setAttribute('visible', m !== 'off');
          if (m !== 'off') kit.setMode(m);
        },
      }),
      ui.seg({
        label: 'crosshair',
        options: [
          ['first', 'spoke (angle)'],
          ['second', 'ring (radius)'],
          ['both', 'both'],
        ],
        value: 'first',
        onChange: (v) => kit.crosshair.setAttribute('lines', v),
      }),
      ui.slider({
        label: 'hole in the middle',
        min: 0,
        max: 0.8,
        step: 0.05,
        value: 0,
        onChange: (v) => plane.setAttribute('innerRadius', v),
      }),
      ui.slider({
        label: 'start angle (°)',
        min: -180,
        max: 180,
        step: 15,
        value: 0,
        onChange: (v) => plane.setAttribute('startAngle', (v * Math.PI) / 180),
      }),
      ui.seg({
        label: 'sweep',
        options: [
          [360, 'full'],
          [270, 'three quarters'],
          [180, 'half'],
        ],
        value: 360,
        onChange: (v) => {
          plane.setAttribute('sweep', (v * Math.PI) / 180);
          angle.setAttribute('max', v); // the angle axis shows only the part of the data that fits
        },
      }),
      ui.slider({ label: 'orange baseline', min: 0, max: 8, step: 0.5, value: 2, onChange: (v) => inner.setAttribute('baseline', v) }),
      ui.toggle({ label: 'clip to the circle', value: true, onChange: (v) => plane.setAttribute('clip', v) }),
      ui.note(
        'Both series use the same `AreaPath` and `LinePath` as a Cartesian chart. The area is the data forward and its baseline backward, and the plane places both, so here the baseline is a circle and the shape is a closed ring. Zero is the middle with a baseline of 0 and the shape closes on a point. The wheel and drag move the radius axis; double-click resets.',
      ),
    );
    return { chart };
  },
});

demos.push({
  id: 'radar',
  title: 'Radar plane',
  blurb: 'Spokes at the ticks, chords between them',
  setup(ctx) {
    const skills = ['Speed', 'Power', 'Range', 'Armour', 'Stealth', 'Control'];
    const n = skills.length;
    // Made up: two profiles scored 0 to 10. `wrap` repeats the first row at the end of the domain, which closes the turn.
    const profile = (scores) => scores.map((r, a) => ({ a, r }));
    const src = (rows) => new L.ObjectDataSource({ source: rows, domain: 'a', value: 'r', isSorted: true, wrap: n });
    const angle = new L.Axis(
      { id: 'angle', orientation: 'angle', min: 0, max: n, tickCount: n + 1, format: (v) => skills[v] ?? '' },
      new L.LinearScale(),
    );
    const radius = new L.Axis({ id: 'radius', orientation: 'radius', min: 0, max: 10, tickCount: 6 }, new L.LinearScale());
    const second = new L.DomainSeries(
      { name: 'Profile B' },
      src(profile([5, 9, 4, 8, 3, 7])),
      new L.AreaPath({ fill: '#e8590c', opacity: 0.25 }, new L.LinearCurve()),
      new L.LinePath({ stroke: '#e8590c' }, new L.LinearCurve()),
    );
    const plane = new L.RadarPlane(
      {},
      angle,
      radius,
      new L.DomainSeries(
        { name: 'Profile A' },
        src(profile([8, 5, 7, 4, 9, 6])),
        new L.AreaPath({ fill: '#2a6fdb', opacity: 0.25 }, new L.LinearCurve()),
        new L.LinePath({ stroke: '#2a6fdb' }, new L.LinearCurve()),
      ),
      second,
      new L.PanZoom({}),
    );
    const kit = tipKit('shared');
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane, kit.cursor);
    ctx.add(
      ui.seg({
        label: 'cursor',
        options: [
          ['off', 'off'],
          ['snap', 'nearest point'],
          ['shared', 'every series here'],
        ],
        value: 'shared',
        onChange: (m) => {
          kit.cursor.setAttribute('visible', m !== 'off');
          if (m !== 'off') kit.setMode(m);
        },
      }),
      ui.seg({
        label: 'crosshair',
        options: [
          ['first', 'spoke (skill)'],
          ['second', 'ring (score)'],
          ['both', 'both'],
        ],
        value: 'first',
        onChange: (v) => kit.crosshair.setAttribute('lines', v),
      }),
      ui.slider({
        label: 'hole in the middle',
        min: 0,
        max: 0.6,
        step: 0.05,
        value: 0,
        onChange: (v) => plane.setAttribute('innerRadius', v),
      }),
      ui.slider({
        label: 'start angle (°)',
        min: -90,
        max: 90,
        step: 15,
        value: 0,
        onChange: (v) => plane.setAttribute('startAngle', (v * Math.PI) / 180),
      }),
      ui.toggle({
        label: 'fixed radius range 0–10',
        value: true,
        onChange: (v) => radius.setAttributes(v ? { min: 0, max: 10 } : { min: undefined, max: undefined }),
      }),
      ui.toggle({ label: 'show the orange profile', value: true, onChange: (v) => second.setAttribute('visible', v) }),
      ui.note(
        "A `RadarPlane` puts a spoke at each tick of the angle axis and joins them with chords. Rings are polygons, and a point between two spokes lies on the chord, so dense data would follow the polygon too. Turn the fixed range off and the rings follow the data instead: the math holds, the scale moves. The wheel and drag move the radius axis; the rim is left alone. The angle axis is 0 to 6 with a tick per category, and the data source's `wrap: 6` repeats the first row at 6 so the shape closes.",
      ),
    );
    return { chart };
  },
});

demos.push({
  id: 'xy',
  title: 'XY plot',
  blurb: 'A path in the order given, with axes floating through the origin',
  setup(ctx) {
    const lissajous = (n, a, b, phase) =>
      Array.from({ length: n }, (_, i) => {
        const t = (i / n) * 2 * Math.PI;
        return { x: Math.sin(a * t + phase), y: Math.sin(b * t) };
      });
    const x = new L.Axis(
      { id: 'x', orientation: 'bottom', min: -1.2, max: 1.2, crossesAt: 0, style: { tickLabel: { halo: pageBackground() } }, title: 'x' },
      new L.LinearScale(),
    );
    const y = new L.Axis(
      { id: 'y', orientation: 'left', min: -1.2, max: 1.2, crossesAt: 0, style: { tickLabel: { halo: pageBackground() } }, title: 'y' },
      new L.LinearScale(),
    );
    // No domain: it is the row's index. `wrap` puts the first row again after the last, so the loop closes.
    const source = new L.ObjectDataSource({ source: lissajous(400, 3, 2, 0.5), value: 'y', channels: { x: 'x' }, wrap: 400 });
    const plane = new L.CartesianPlane(
      { frame: true },
      x,
      y,
      new L.XYSeries({ x: 'x' }, source, new L.LinePath({ strokeWidth: 1.5 }, new L.LinearCurve())),
      new L.PanZoom({}),
    );
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane);
    // The halo has to match what is behind the chart, so it follows the page's light/dark switch.
    let halo = true;
    const setHalo = () => {
      for (const ax of [x, y]) ax.setAttribute('style', { tickLabel: { halo: halo ? pageBackground() : 'none' } });
    };
    ctx.onTheme(setHalo);
    let a = 3,
      b = 2,
      phase = 0.5,
      n = 400;
    const rebuild = () => {
      source.setAttributes({ source: lissajous(n, a, b, phase), wrap: n });
    };
    ctx.add(
      ui.slider({
        label: 'x frequency',
        min: 1,
        max: 9,
        value: a,
        onChange: (v) => {
          a = v;
          rebuild();
        },
      }),
      ui.slider({
        label: 'y frequency',
        min: 1,
        max: 9,
        value: b,
        onChange: (v) => {
          b = v;
          rebuild();
        },
      }),
      ui.slider({
        label: 'phase',
        min: 0,
        max: 3.14,
        step: 0.05,
        value: phase,
        onChange: (v) => {
          phase = v;
          rebuild();
        },
      }),
      ui.slider({
        label: 'points',
        min: 20,
        max: 2000,
        step: 10,
        value: n,
        onChange: (v) => {
          n = v;
          rebuild();
        },
      }),
      ui.toggle({ label: 'close the loop (wrap)', value: true, onChange: (v) => source.setAttribute('wrap', v ? n : undefined) }),
      ui.toggle({
        label: 'axes float through the origin',
        value: true,
        onChange: (v) => {
          x.setAttribute('crossesAt', v ? 0 : undefined);
          y.setAttribute('crossesAt', v ? 0 : undefined);
        },
      }),
      ui.seg({
        label: 'x title at',
        options: [
          ['bottom', 'bottom'],
          ['top', 'top'],
          ['left', 'left'],
        ],
        value: 'bottom',
        onChange: (v) => x.setAttribute('titlePosition', v),
      }),
      ui.seg({
        label: 'y title runs',
        options: [
          ['', 'default'],
          ['horizontal', 'across'],
          ['vertical', 'up'],
        ],
        value: '',
        onChange: (v) => y.setAttribute('titleDirection', v || undefined),
      }),
      ui.toggle({
        label: 'halo behind labels',
        value: true,
        onChange: (v) => {
          halo = v;
          setHalo();
        },
      }),
      ui.note(
        "The source has no domain, so a point's place in the order is its index, and `XYSeries` takes x from a channel and y from the value. Pan and zoom move both axes, and the crossing axes slide with the view, holding at the edge when the origin leaves it. A `Decimator` would refuse this series: thinning by pixel column means nothing for a path.",
      ),
    );
    return { chart };
  },
});

demos.push({
  id: 'scatter',
  title: 'XY scatter',
  blurb: 'Clusters coloured by group, with floating axes you can pan away from',
  setup(ctx) {
    const r = rng(11);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    const centres = [
      [-2, -1],
      [2.5, 1.5],
      [0, 3],
      [1, -2.5],
    ];
    const rows = Array.from({ length: 1500 }, (_, i) => {
      const g = i % 4,
        [cx, cy] = centres[g];
      return { x: cx + gauss() * 0.8, y: cy + gauss() * 0.8, g };
    });
    const x = new L.Axis(
      { id: 'x', orientation: 'bottom', crossesAt: 0, style: { tickLabel: { halo: pageBackground() } }, padding: 0.05 },
      new L.LinearScale(),
    );
    const y = new L.Axis(
      { id: 'y', orientation: 'left', crossesAt: 0, style: { tickLabel: { halo: pageBackground() } }, padding: 0.05 },
      new L.LinearScale(),
    );
    const group = new L.ColorAxis(
      {
        id: 'group',
        title: 'Group',
        ramp: PALETTE.slice(0, 4),
        interpolation: 'step',
        min: 0,
        max: 3,
        tickCount: 4,
        format: (v) => 'ABCD'[Math.round(v)] ?? '',
      },
      new L.LinearScale(),
    );
    const source = new L.ObjectDataSource({ source: rows, value: 'y', channels: { x: 'x', g: 'g' } });
    const dots = new L.CircleMarker({ size: 3, opacity: 0.7, bind: { fill: { axis: group, channel: 'g' } } });
    const plane = new L.CartesianPlane({ frame: true }, x, y, new L.XYSeries({ x: 'x' }, source, dots), new L.PanZoom({}));
    const chart = new L.Chart(
      { theme: chartTheme(), onFlush: ctx.onFlush },
      plane,
      group,
      new L.ColorKey({ dimension: group, length: 80 }),
    );
    ctx.onTheme(() => {
      for (const ax of [x, y]) ax.setAttribute('style', { tickLabel: { halo: pageBackground() } });
    });
    ctx.add(
      ui.slider({ label: 'dot size (px)', min: 1, max: 8, step: 0.5, value: 3, onChange: (v) => dots.setAttribute('size', v) }),
      ui.toggle({
        label: 'axes float at the origin',
        value: true,
        onChange: (v) => {
          x.setAttribute('crossesAt', v ? 0 : undefined);
          y.setAttribute('crossesAt', v ? 0 : undefined);
        },
      }),
      ui.note(
        'Drag to pan: the axes stay at zero while it is in view and stop at the edge when it is not, where they take their usual room. Every point is always read; markers outside the plot are left out of the path data.',
      ),
    );
    return { chart };
  },
});

// ── Statistics: histograms, heat maps and trendlines ─────────────────────────
/** A table as CSV text, and as a download. `readTable` needs no chart: this is all the export there is. */
const csv = (table) =>
  [table.columns.join(','), ...Array.from({ length: table.count }, (_, i) => table.data.map((c) => c[i]).join(','))].join('\n');
const saveCsv = (name, table) =>
  h('a', { href: URL.createObjectURL(new Blob([csv(table)], { type: 'text/csv' })), download: name }).click();

demos.push({
  id: 'histogram',
  title: 'Histogram (Density)',
  blurb: 'A Density transform in front of BarPath: bin by width, count or rule; count, fraction or density',
  setup(ctx) {
    const S = { n: 2000, mode: 'width', width: 0.5, bins: 20, stat: 'auto', weighted: false, bar: 0.95, seed: 1 };
    const rows = () => {
      const r = rng(S.seed);
      return Array.from({ length: S.n }, () => {
        const k = r() < 0.65;
        return { v: k ? gauss(r) * 1.1 : 4 + gauss(r) * 0.6, w: 0.5 + r() * 2 };
      });
    };
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 'value' }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'count', min: 0, nice: true }, new L.LinearScale());
    const source = () => new L.ObjectDataSource({ source: rows(), domain: 'v', value: 'v', channels: { w: 'w' } });
    const attrs = () => ({
      ...(S.mode === 'width' ? { width: S.width } : S.mode === 'bins' ? { bins: S.bins } : {}),
      ...(S.weighted ? { weight: 'w' } : {}),
      ...(S.stat === 'auto' ? {} : { stat: S.stat }),
    });
    const statName = () => (S.stat === 'auto' ? (S.weighted ? 'sum' : 'count') : S.stat);
    let density = new L.Density(attrs(), source());
    const bars = new L.BarPath({ width: S.bar });
    const series = new L.DomainSeries({ name: 'Samples' }, density, bars);
    const plane = new L.CartesianPlane({}, x, y, series, new L.PanZoom({ direction: 'x' }));
    const read = ui.readout();
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: (st) => {
          ctx.onFlush(st);
          const t = L.readTable(density),
            width = t.count ? t.column('width')[0] : NaN;
          read.textContent = `${t.count} bins, each ${fmt(width, 3)} wide\n${fmt(
            t.column('count').reduce((p, q) => p + q, 0),
            0,
          )} points counted`;
        },
      },
      plane,
    );
    const redo = () => {
      density = new L.Density(attrs(), source());
      series.setChild(0, density);
      y.setAttribute('title', statName());
    };
    ctx.add(
      ui.slider({
        label: 'points',
        min: 50,
        max: 2e5,
        value: S.n,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.n = v;
          redo();
        },
      }),
      ui.seg({
        label: 'bin size from',
        options: [
          ['width', 'width'],
          ['bins', 'bin count'],
          ['rule', 'the rule'],
        ],
        value: S.mode,
        onChange: (v) => {
          S.mode = v;
          redo();
        },
      }),
      ui.slider({
        label: 'width (width mode)',
        min: 0.05,
        max: 2,
        step: 0.05,
        value: S.width,
        onChange: (v) => {
          S.width = v;
          if (S.mode === 'width') density.setAttribute('width', v);
        },
      }),
      ui.slider({
        label: 'bins (bin count mode)',
        min: 3,
        max: 120,
        value: S.bins,
        onChange: (v) => {
          S.bins = v;
          if (S.mode === 'bins') density.setAttribute('bins', v);
        },
      }),
      ui.seg({
        label: 'value of a bar',
        options: [
          ['auto', 'count (sum if weighted)'],
          ['count', 'count'],
          ['sum', 'sum of w'],
          ['fraction', 'fraction'],
          ['density', 'density'],
          ['mean', 'mean of w'],
        ],
        value: S.stat,
        onChange: (v) => {
          S.stat = v;
          density.setAttribute('stat', v === 'auto' ? undefined : v);
          y.setAttribute('title', statName());
        },
      }),
      ui.toggle({
        label: 'weight each point by w',
        value: S.weighted,
        onChange: (v) => {
          S.weighted = v;
          redo();
        },
      }),
      ui.slider({
        label: 'bar width (fraction of a bin)',
        min: 0.2,
        max: 1,
        step: 0.05,
        value: S.bar,
        onChange: (v) => {
          S.bar = v;
          bars.setAttribute('width', v);
        },
      }),
      read,
      ui.buttons(
        [
          'New data',
          () => {
            S.seed++;
            redo();
          },
        ],
        ['Download the bins (CSV)', () => saveCsv('histogram.csv', L.readTable(density))],
      ),
      ui.note(
        'The histogram is a Density and a BarPath; the bars know nothing of binning. With the rule, Freedman–Diaconis picks the width from the spread of the points. readTable(density) is the bins as a table, with no chart involved.',
      ),
    );
    return { chart };
  },
});

demos.push({
  id: 'heatmap',
  title: 'Heat map',
  blurb: 'A two-dimensional Density and a HeatMap: a coloured rectangle per bin, one path per colour step',
  setup(ctx) {
    const S = { n: 20000, cw: 0.5, ch: 0.5, channel: 'count', maxNodes: 64, seed: 1, ramp: 'viridis', plane: 'cartesian' };
    const rows = () => {
      const r = rng(S.seed),
        centres = [
          [-3, -2, 1.2],
          [2, 2.5, 0.9],
          [3.5, -2.5, 0.6],
        ];
      return Array.from({ length: S.n }, (_, i) => {
        const [cx, cy, s] = centres[i % 3];
        return { x: cx + gauss(r) * s * 1.4, y: cy + gauss(r) * s, t: (i % 3) * 10 + gauss(r) * 3 };
      });
    };
    const heat = new L.ColorAxis({ id: 'heat', title: 'count', ramp: S.ramp }, new L.LinearScale());
    const source = () => new L.ObjectDataSource({ source: rows(), domain: 'x', value: 'y', channels: { t: 't' } });
    const attrs = () => ({ by: ['domain', 'value'], width: [S.cw, S.ch], ...(S.channel === 'mean t' ? { weight: 't' } : {}) });
    const channel = () => (S.channel === 'mean t' ? 'mean' : S.channel);
    const makeCells = () => new L.HeatMap({ maxNodes: S.maxNodes, bind: { fill: { axis: heat, channel: channel() } } });
    let density, cells, series, plane;
    /** The same data and the same cells on either kind of plane: only the plane and its two axes are new. */
    function build() {
      const polar = S.plane === 'polar';
      const x = new L.Axis(
        { id: 'x', orientation: polar ? 'angle' : 'bottom', ...(polar ? {} : { title: 'x' }), padding: 0.02 },
        new L.LinearScale(),
      );
      const y = new L.Axis(
        { id: 'y', orientation: polar ? 'radius' : 'left', ...(polar ? {} : { title: 'y' }), padding: 0.02 },
        new L.LinearScale(),
      );
      density = new L.Density(attrs(), source());
      cells = makeCells();
      series = new L.XYSeries({ x: 'domain' }, density, cells);
      return polar
        ? new L.PolarPlane({}, x, y, series, new L.PanZoom({ direction: 'both' }))
        : new L.CartesianPlane({ frame: true }, x, y, series, new L.PanZoom({ direction: 'both' }));
    }
    const read = ui.readout();
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: (st) => {
          ctx.onFlush(st);
          read.textContent = `${density.pointCount} occupied cells\n${host.querySelectorAll('svg path[fill-opacity]').length} paths drawn`;
        },
      },
      heat,
      new L.ColorKey({ dimension: heat, side: 'right' }),
    );
    function mount() {
      if (plane) chart.remove(plane);
      plane = build();
      chart.insertBefore(plane, heat);
    }
    mount();
    const redo = () => {
      density = new L.Density(attrs(), source());
      series.setChild(0, density);
    };
    const rebind = () => {
      const old = cells;
      cells = makeCells();
      series.remove(old);
      series.append(cells);
      heat.setAttribute('title', S.channel);
    };
    ctx.add(
      ui.note('Drag to pan, wheel to zoom.'),
      ui.seg({
        label: 'plane',
        options: [
          ['cartesian', 'rectangular'],
          ['polar', 'polar'],
        ],
        value: S.plane,
        onChange: (v) => {
          S.plane = v;
          mount();
          chart.flush();
        },
      }),
      ui.slider({
        label: 'points',
        min: 500,
        max: 5e5,
        value: S.n,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.n = v;
          redo();
        },
      }),
      ui.slider({
        label: 'cell width',
        min: 0.1,
        max: 2,
        step: 0.05,
        value: S.cw,
        onChange: (v) => {
          S.cw = v;
          density.setAttribute('width', [S.cw, S.ch]);
        },
      }),
      ui.slider({
        label: 'cell height',
        min: 0.1,
        max: 2,
        step: 0.05,
        value: S.ch,
        onChange: (v) => {
          S.ch = v;
          density.setAttribute('width', [S.cw, S.ch]);
        },
      }),
      ui.seg({
        label: 'colour by',
        options: [
          ['count', 'count'],
          ['density', 'density'],
          ['fraction', 'fraction'],
          ['mean t', 'mean of t'],
        ],
        value: S.channel,
        onChange: (v) => {
          S.channel = v;
          redo();
          rebind();
        },
      }),
      ui.seg({
        label: 'colour ramp',
        options: [
          ['viridis', 'viridis'],
          ['magma', 'magma'],
          ['turbo', 'turbo'],
        ],
        value: S.ramp,
        onChange: (v) => {
          S.ramp = v;
          heat.setAttribute('ramp', v);
        },
      }),
      ui.slider({
        label: 'maxNodes (colour steps)',
        min: 4,
        max: 400,
        value: S.maxNodes,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.maxNodes = v;
          cells.setAttribute('maxNodes', v);
        },
      }),
      read,
      ui.buttons(
        [
          'New data',
          () => {
            S.seed++;
            redo();
          },
        ],
        ['Download the cells (CSV)', () => saveCsv('heatmap.csv', L.readTable(density))],
      ),
      ui.note(
        'Each bin is a point at its centre with width and height channels, and HeatMap draws it as the rectangle it is. Cells with the same colour step share a path, so lowering maxNodes shows the bands without changing how many cells there are. On a polar plane x is the angle and y the radius, and each cell becomes a wedge with straight edges.',
      ),
    );
    return { chart };
  },
});

demos.push({
  id: 'patterns',
  title: 'Pattern fills',
  blurb: 'Lines, crosshatch and dots as fills, drawn in each series colour, so series can be told apart without colour',
  setup(ctx) {
    const S = {
      angle: 45,
      crossAngle: -45,
      spacing: 7,
      width: 2,
      dash: 'none',
      dot: 3,
      gap: 4,
      offset: 3.5,
      cap: 'round',
      mode: 'group',
      outline: true,
      background: 'tint',
    };
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const names = ['Lines', 'Crosshatch', 'Dots', 'Checkerboard'];
    const values = [
      [30, 38, 35, 50],
      [22, 27, 31, 36],
      [14, 20, 16, 23],
      [8, 11, 9, 14],
    ];
    const patterns = {
      lines: new L.LinePattern({ id: 'lines' }),
      hatch: new L.HatchPattern({ id: 'hatch' }),
      dots: new L.DotPattern({ id: 'dots' }),
      checks: new L.DotPattern({ id: 'checks', ...L.checkerboard(4) }),
    };
    const fills = ['url(#lines)', 'url(#hatch)', 'url(#dots)', 'url(#checks)'];
    const bars = names.map((name, i) => new L.BarPath({ fill: fills[i] }));
    const series = names.map(
      (name, i) =>
        new L.DomainSeries(
          { name },
          new L.FlatDataSource({ data: Float64Array.from(values[i]), regularDomain: { start: 0, step: 1 } }),
          bars[i],
        ),
    );
    const stack = new L.Stack({ mode: S.mode }, ...series);
    const plane = new L.CartesianPlane(
      {},
      new L.Axis({ orientation: 'bottom' }, new L.BandScale({ categories: quarters })),
      new L.Axis({ orientation: 'left', min: 0, nice: true }, new L.LinearScale()),
      stack,
    );
    const chart = new L.Chart(
      { theme: chartTheme(), onFlush: ctx.onFlush },
      plane,
      new L.Legend({ side: 'bottom' }),
      ...Object.values(patterns),
    );
    // An outline in the series' own colour gives each bar a clear edge, and a background of the page's colour keeps the gridlines from showing through the gaps between lines.
    const looks = () => {
      const palette = chartTheme().palette;
      bars.forEach((bar, i) =>
        bar.setAttributes({ stroke: S.outline ? palette[i % palette.length] : undefined, strokeWidth: S.outline ? 2 : undefined }),
      );
      for (const p of Object.values(patterns)) {
        p.setAttribute('fill', S.background === 'page' ? pageBackground() : undefined);
        p.setAttribute('tint', S.background === 'tint' ? 0.2 : undefined);
      }
    };
    ctx.onTheme(looks);
    const set = () => {
      looks();
      patterns.lines.setAttributes({
        angle: S.angle,
        spacing: S.spacing,
        strokeWidth: S.width,
        dash: S.dash === 'none' ? undefined : S.dash,
      });
      patterns.hatch.setAttributes({
        angle: S.angle,
        crossAngle: S.crossAngle,
        spacing: S.spacing,
        strokeWidth: S.width,
        dash: S.dash === 'none' ? undefined : S.dash,
      });
      patterns.dots.setAttributes({ strokeWidth: S.dot, gapX: S.gap, offset: S.offset, cap: S.cap });
      patterns.checks.setAttributes({ ...L.checkerboard(S.dot), cap: 'square' });
    };
    ctx.add(
      ui.note(
        'Each series fills with a pattern named in its fill as url(#id). The pattern takes the colour of the series, so it follows the palette and the theme: try Accessible, and Theme.',
      ),
      ui.seg({
        label: 'layout',
        options: [
          ['group', 'side by side'],
          ['stack', 'stacked'],
        ],
        value: S.mode,
        onChange: (v) => {
          S.mode = v;
          stack.setAttribute('mode', v);
        },
      }),
      ui.toggle({ label: 'outline in the series colour', value: S.outline, onChange: (v) => ((S.outline = v), set()) }),
      ui.seg({
        label: 'background of the tile',
        options: [
          ['none', 'none'],
          ['page', 'page colour'],
          ['tint', 'series tint'],
        ],
        value: S.background,
        onChange: (v) => ((S.background = v), set()),
      }),
      ui.slider({ label: 'line angle (degrees)', min: -90, max: 90, step: 5, value: S.angle, onChange: (v) => ((S.angle = v), set()) }),
      ui.slider({
        label: 'crosshatch: second angle',
        min: -90,
        max: 90,
        step: 5,
        value: S.crossAngle,
        onChange: (v) => ((S.crossAngle = v), set()),
      }),
      ui.slider({ label: 'line spacing', min: 3, max: 16, step: 1, value: S.spacing, onChange: (v) => ((S.spacing = v), set()) }),
      ui.slider({ label: 'line width', min: 0.5, max: 5, step: 0.5, value: S.width, onChange: (v) => ((S.width = v), set()) }),
      ui.seg({
        label: 'line dashes',
        options: [
          ['none', 'solid'],
          ['6 3', 'dashed'],
          ['2 3', 'dotted'],
        ],
        value: S.dash,
        onChange: (v) => ((S.dash = v), set()),
      }),
      ui.slider({
        label: 'dot size (and checkerboard square)',
        min: 1,
        max: 8,
        step: 0.5,
        value: S.dot,
        onChange: (v) => ((S.dot = v), set()),
      }),
      ui.slider({ label: 'dot gap', min: 0, max: 12, step: 1, value: S.gap, onChange: (v) => ((S.gap = v), set()) }),
      ui.slider({
        label: 'alternate rows shifted by',
        min: 0,
        max: 12,
        step: 0.5,
        value: S.offset,
        onChange: (v) => ((S.offset = v), set()),
      }),
      ui.seg({
        label: 'dot shape',
        options: [
          ['round', 'round'],
          ['square', 'square'],
        ],
        value: S.cap,
        onChange: (v) => ((S.cap = v), set()),
      }),
    );
    set();
    return { chart };
  },
});

demos.push({
  id: 'trend',
  title: 'Trendlines',
  blurb: 'Linear, polynomial, sinusoidal, loess and stable (mean) fits, sampled across the view, extended past the data',
  setup(ctx) {
    const S = {
      shape: 'bend',
      noise: 1,
      kind: 'loess',
      degree: 3,
      period: 0,
      smoothness: 0.4,
      kernel: 'tricube',
      extend: 0.2,
      seed: 1,
      n: 150,
    };
    const rows = () => {
      const r = rng(S.seed);
      const f = {
        bend: (t) => 4 + 0.6 * t + 3 * Math.sin(t / 2.5),
        wave: (t) => 6 + 4 * Math.sin((2 * Math.PI * t) / 7.3),
        steps: (t) => Math.floor(t / 5) * 3,
      }[S.shape];
      // Unevenly spaced on purpose: the sinusoid's periodogram and the loess window both cope with that.
      return Array.from({ length: S.n }, () => {
        const t = r() * 20;
        return { t, v: f(t) + gauss(r) * S.noise };
      }).sort((a, b) => a.t - b.t);
    };
    let data = rows();
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 't', padding: 0.02 }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'v', nice: true }, new L.LinearScale());
    const source = () => new L.ObjectDataSource({ source: data, domain: 't', value: 'v', isSorted: true });
    const common = () => ({ extend: S.extend });
    const make = () => {
      switch (S.kind) {
        case 'linear':
          return new L.LinearTrend(common(), source());
        case 'poly':
          return new L.PolynomialTrend({ ...common(), degree: S.degree }, source());
        case 'sine':
          return new L.SinusoidalTrend({ ...common(), ...(S.period > 0 ? { period: S.period } : {}) }, source());
        case 'mean':
          return new L.MeanTrend({ ...common(), smoothness: S.smoothness, kernel: S.kernel }, source());
        default:
          return new L.LoessTrend({ ...common(), smoothness: S.smoothness, kernel: S.kernel }, source());
      }
    };
    let trend = make();
    const dots = new L.DomainSeries({ name: 'Data' }, source(), new L.CircleMarker({ size: 2.5, opacity: 0.55 }));
    const line = new L.DomainSeries({ name: 'Trend' }, trend, new L.LinePath(new L.LinearCurve()));
    const plane = new L.CartesianPlane({}, x, y, dots, line, new L.PanZoom({ direction: 'x' }));
    const read = ui.readout();
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: (st) => {
          ctx.onFlush(st);
          const f = trend.fit;
          read.textContent = !f
            ? 'no fit'
            : [
                `${f.n} points   r² ${f.r2.toFixed(4)}   rmse ${f.rmse.toFixed(3)}`,
                f.period !== undefined ? `period ${f.period.toFixed(3)}   amplitude ${f.amplitude.toFixed(3)}` : '',
                f.bandwidth !== undefined ? `reach ${f.bandwidth.toFixed(3)}` : '',
                f.coefficients && !f.period ? `coefficients ${f.coefficients.map((c) => c.toFixed(3)).join(', ')}` : '',
              ]
                .filter(Boolean)
                .join('\n');
        },
      },
      plane,
      new L.Legend({ side: 'top' }),
    );
    const swap = () => {
      trend = make();
      line.setChild(0, trend);
    };
    const redata = () => {
      data = rows();
      dots.setChild(0, source());
      swap();
    };
    ctx.add(
      ui.note('Drag to pan, wheel to zoom: the line is sampled again for what is in view, one point a pixel.'),
      ui.seg({
        label: 'data',
        options: [
          ['bend', 'bend'],
          ['wave', 'wave'],
          ['steps', 'steps'],
        ],
        value: S.shape,
        onChange: (v) => {
          S.shape = v;
          redata();
        },
      }),
      ui.slider({
        label: 'noise',
        min: 0,
        max: 4,
        step: 0.1,
        value: S.noise,
        onChange: (v) => {
          S.noise = v;
          redata();
        },
      }),
      ui.seg({
        label: 'fit',
        options: [
          ['linear', 'linear'],
          ['poly', 'polynomial'],
          ['sine', 'sinusoid'],
          ['loess', 'loess'],
          ['mean', 'mean (stable)'],
        ],
        value: S.kind,
        onChange: (v) => {
          S.kind = v;
          swap();
        },
      }),
      ui.slider({
        label: 'degree (polynomial)',
        min: 1,
        max: 12,
        value: S.degree,
        onChange: (v) => {
          S.degree = v;
          if (S.kind === 'poly') trend.setAttribute('degree', v);
        },
      }),
      ui.slider({
        label: 'period (sinusoid; 0 finds it)',
        min: 0,
        max: 20,
        step: 0.1,
        value: S.period,
        format: (v) => (v === 0 ? 'auto' : fmt(v, 1)),
        onChange: (v) => {
          S.period = v;
          if (S.kind === 'sine') trend.setAttribute('period', v > 0 ? v : undefined);
        },
      }),
      ui.slider({
        label: 'smoothness (loess/mean: 0 joins the points, 1 is the line/mean)',
        min: 0,
        max: 1,
        step: 0.01,
        value: S.smoothness,
        onChange: (v) => {
          S.smoothness = v;
          if (S.kind === 'loess' || S.kind === 'mean') trend.setAttribute('smoothness', v);
        },
      }),
      ui.seg({
        label: 'kernel (loess/mean)',
        options: [
          ['tricube', 'tricube'],
          ['gaussian', 'gaussian'],
        ],
        value: S.kernel,
        onChange: (v) => {
          S.kernel = v;
          if (S.kind === 'loess' || S.kind === 'mean') trend.setAttribute('kernel', v);
        },
      }),
      ui.slider({
        label: 'extend past the data (fraction of its span)',
        min: 0,
        max: 1,
        step: 0.05,
        value: S.extend,
        onChange: (v) => {
          S.extend = v;
          trend.setAttribute('extend', v);
        },
      }),
      read,
      ui.buttons(
        [
          'New data',
          () => {
            S.seed++;
            redata();
          },
        ],
        ['Download the line (CSV)', () => saveCsv('trend.csv', L.readTable(trend, { samples: 200 }))],
      ),
      ui.note(
        'Slide smoothness from 1 to 0: the loess line goes from the least-squares line to a line joining the points. Extrapolating a high-degree polynomial shows why extend is opt-in. trend.evaluate(x) and trend.fit work without a chart.',
      ),
    );
    return { chart };
  },
});

// ── Error bars and bands ─────────────────────────────────────────────────────
demos.push({
  id: 'errors',
  title: 'Error bars & bands',
  blurb:
    'A channel of how far each value may be out, drawn as whiskers or a band; symmetric, asymmetric, absolute or relative; on lines and bars',
  setup(ctx) {
    const S = { n: 24, draw: 'bars', style: 'both', symmetric: true, mode: 'absolute', cap: 8, seed: 1, gap: false };
    const rows = () => {
      const r = rng(S.seed);
      return Array.from({ length: S.n }, (_, t) => {
        const v = 20 + 8 * Math.sin(t / 4) + t * 0.3,
          up = 1 + r() * 4,
          down = 1 + r() * 2;
        return {
          t,
          v: S.gap && t % 9 === 5 ? NaN : v,
          up: S.mode === 'relative' ? up / 40 : up,
          down: S.mode === 'relative' ? down / 40 : down,
        };
      });
    };
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 'sample', tickStep: S.n > 30 ? undefined : 2 }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'value', nice: true }, new L.LinearScale());
    const source = () =>
      new L.ObjectDataSource({ source: rows(), domain: 't', value: 'v', isSorted: true, channels: { up: 'up', down: 'down' } });
    const err = () => ({ error: 'up', mode: S.mode, ...(S.symmetric ? {} : { negativeError: 'down' }) });
    const renderers = () => {
      const out = [];
      if (S.style !== 'bars') out.push(new L.ErrorBand(err()));
      out.push(S.draw === 'bars' ? new L.BarPath({ width: 0.6, opacity: 0.6 }) : new L.LinePath(new L.LinearCurve()));
      if (S.style !== 'band') out.push(new L.ErrorBars({ ...err(), capWidth: S.cap }));
      return out;
    };
    let current = renderers();
    const series = new L.DomainSeries({ name: 'Mean ± error' }, source(), ...current);
    const plane = new L.CartesianPlane({}, x, y, series, new L.PanZoom({ direction: 'both' }));
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane);
    const swap = () => {
      for (const r of current) series.remove(r);
      current = renderers();
      series.append(...current);
    };
    const redata = () => series.setChild(0, source());
    ctx.add(
      ui.note('Drag to pan, wheel to zoom. The axes leave room for the bars, and zooming out never goes past them.'),
      ui.seg({
        label: 'drawn as',
        options: [
          ['bars', 'bars'],
          ['band', 'band'],
          ['both', 'both'],
        ],
        value: S.style,
        onChange: (v) => {
          S.style = v;
          swap();
        },
      }),
      ui.seg({
        label: 'under it',
        options: [
          ['bars', 'bars'],
          ['line', 'line'],
        ],
        value: S.draw,
        onChange: (v) => {
          S.draw = v;
          swap();
        },
      }),
      ui.toggle({
        label: 'symmetric (one channel); off: two',
        value: S.symmetric,
        onChange: (v) => {
          S.symmetric = v;
          swap();
        },
      }),
      ui.seg({
        label: 'error is',
        options: [
          ['absolute', "in the value's unit"],
          ['relative', 'a fraction of it'],
        ],
        value: S.mode,
        onChange: (v) => {
          S.mode = v;
          redata();
          swap();
        },
      }),
      ui.slider({
        label: 'cap width (px)',
        min: 0,
        max: 20,
        value: S.cap,
        onChange: (v) => {
          S.cap = v;
          swap();
        },
      }),
      ui.toggle({
        label: 'gaps in the data',
        value: S.gap,
        onChange: (v) => {
          S.gap = v;
          redata();
        },
      }),
      ui.buttons([
        'New data',
        () => {
          S.seed++;
          redata();
        },
      ]),
      ui.note(
        'A gap in the value or the error leaves that point without a bar, and splits the band. The band has straight edges, and goes before the line to sit under it.',
      ),
    );
    return { chart };
  },
});

// ── Box and whisker ──────────────────────────────────────────────────────────
demos.push({
  id: 'box',
  title: 'Box & whisker',
  blurb: 'BoxStats works the five numbers out of raw samples; BoxPath draws them; outliers are a second series of dots',
  setup(ctx) {
    const S = {
      groups: 4,
      per: 60,
      spread: 3,
      fence: '1.5',
      outliers: true,
      width: 0.8,
      cap: 0.5,
      value: 'median',
      method: 'inclusive',
      seed: 1,
    };
    const samples = () => {
      const r = rng(S.seed);
      // Sorted by group, as BoxStats needs. A few far values so that there are outliers.
      return Array.from({ length: S.groups }, (_, g) =>
        Array.from({ length: S.per }, () => ({ g, x: 10 + g * 2.5 + gauss(r) * S.spread * (1 + g * 0.2) + (r() < 0.03 ? 12 : 0) })),
      ).flat();
    };
    const x = new L.Axis(
      { id: 'x', orientation: 'bottom', title: 'group' },
      new L.BandScale({ categories: Array.from({ length: S.groups }, (_, i) => 'ABCDEFGH'[i]) }),
    );
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'measurement', nice: true }, new L.LinearScale());
    const source = () => new L.ObjectDataSource({ source: samples(), domain: 'g', value: 'x', isSorted: true });
    const stats = (output) => ({
      ...(output ? { output } : {}),
      fence: S.fence === 'minmax' ? 'minmax' : +S.fence,
      method: S.method,
      value: S.value,
    });
    const box = new L.BoxPath({ width: S.width, capWidth: S.cap });
    const spread = new L.DomainSeries({ name: 'Spread' }, new L.BoxStats(stats(), source()), box);
    const dots = new L.DomainSeries({ name: 'Outliers' }, new L.BoxStats(stats('outliers'), source()), new L.DotMarker({ size: 3 }));
    const plane = new L.CartesianPlane({}, x, y, spread, dots);
    const read = ui.readout();
    const chart = new L.Chart(
      {
        theme: chartTheme(),
        onFlush: (st) => {
          ctx.onFlush(st);
          const t = L.readTable(spread.data);
          read.textContent = t
            .rows()
            .map(
              (r, i) =>
                `${'ABCDEFGH'[i]}  min ${fmt(r.min, 1)}  q1 ${fmt(r.q1, 1)}  med ${fmt(r.median, 1)}  q3 ${fmt(r.q3, 1)}  max ${fmt(r.max, 1)}  n ${r.n}`,
            )
            .join('\n');
        },
      },
      plane,
      new L.Legend({ side: 'top' }),
    );
    const redo = () => {
      x.setChild(0, new L.BandScale({ categories: Array.from({ length: S.groups }, (_, i) => 'ABCDEFGH'[i]) }));
      spread.setChild(0, new L.BoxStats(stats(), source()));
      dots.setChild(0, new L.BoxStats(stats('outliers'), source()));
    };
    const restat = () => {
      for (const [s, o] of [
        [spread, undefined],
        [dots, 'outliers'],
      ]) {
        const a = stats(o);
        for (const k in a) s.child(0, L.BoxStats).setAttribute(k, a[k]);
      }
    };
    ctx.add(
      ui.slider({
        label: 'groups',
        min: 1,
        max: 8,
        value: S.groups,
        onChange: (v) => {
          S.groups = v;
          redo();
        },
      }),
      ui.slider({
        label: 'samples per group',
        min: 5,
        max: 2000,
        value: S.per,
        log: true,
        format: (v) => fmt(v, 0),
        onChange: (v) => {
          S.per = v;
          redo();
        },
      }),
      ui.slider({
        label: 'spread',
        min: 0.5,
        max: 8,
        step: 0.5,
        value: S.spread,
        onChange: (v) => {
          S.spread = v;
          redo();
        },
      }),
      ui.seg({
        label: 'whiskers reach',
        options: [
          ['1.5', '1.5 × IQR'],
          ['3', '3 × IQR'],
          ['minmax', 'min and max'],
        ],
        value: S.fence,
        onChange: (v) => {
          S.fence = v;
          restat();
        },
      }),
      ui.seg({
        label: 'quartile rule',
        options: [
          ['inclusive', 'inclusive'],
          ['exclusive', 'exclusive'],
        ],
        value: S.method,
        onChange: (v) => {
          S.method = v;
          restat();
        },
      }),
      ui.seg({
        label: 'middle line is',
        options: [
          ['median', 'median'],
          ['mean', 'mean'],
        ],
        value: S.value,
        onChange: (v) => {
          S.value = v;
          restat();
        },
      }),
      ui.toggle({
        label: 'show outliers',
        value: S.outliers,
        onChange: (v) => {
          S.outliers = v;
          dots.setAttribute('visible', v);
        },
      }),
      ui.slider({
        label: 'box width',
        min: 0.2,
        max: 1,
        step: 0.05,
        value: S.width,
        onChange: (v) => {
          S.width = v;
          box.setAttribute('width', v);
        },
      }),
      ui.slider({
        label: 'cap width',
        min: 0,
        max: 1,
        step: 0.05,
        value: S.cap,
        onChange: (v) => {
          S.cap = v;
          box.setAttribute('capWidth', v);
        },
      }),
      read,
      ui.buttons(
        [
          'New data',
          () => {
            S.seed++;
            redo();
          },
        ],
        ['Download the summary (CSV)', () => saveCsv('box-summary.csv', L.readTable(spread.data))],
      ),
      ui.note('BoxStats is a transform, so the same samples could feed any other chart. Click the legend to hide the outliers.'),
    );
    return { chart };
  },
});

// ── Selection: box zoom and brush ────────────────────────────────────────────
demos.push({
  id: 'select',
  title: 'Box zoom & brush',
  blurb: 'Drag a rectangle to zoom to it (BoxZoom), or to select what is in it and read it back (Brush)',
  setup(ctx) {
    const S = { n: 4000, tool: 'brush', mode: 'xy', live: true, seed: 1 };
    const r0 = () => {
      const r = rng(S.seed),
        centres = [
          [-3, -1],
          [2, 2],
          [3, -3],
        ];
      return Array.from({ length: S.n }, (_, i) => {
        const [cx, cy] = centres[i % 3];
        return { x: cx + gauss(r) * 1.3, y: cy + gauss(r) * 1.3 };
      });
    };
    let rows = r0();
    const x = new L.Axis({ id: 'x', orientation: 'bottom', title: 'x', padding: 0.04 }, new L.LinearScale());
    const y = new L.Axis({ id: 'y', orientation: 'left', title: 'y', padding: 0.04 }, new L.LinearScale());
    const source = () => new L.ObjectDataSource({ source: rows, value: 'y', channels: { x: 'x' } });
    const read = ui.readout();
    const report = (b) => {
      if (!b) {
        read.textContent = 'nothing selected';
        return;
      }
      const inside = rows.filter((p) => (!b.x || (p.x >= b.x.min && p.x <= b.x.max)) && (!b.y || (p.y >= b.y.min && p.y <= b.y.max)));
      const mean = (k) => inside.reduce((s, p) => s + p[k], 0) / (inside.length || 1);
      read.textContent = [
        `${inside.length} of ${rows.length} points selected`,
        b.x ? `x ${fmt(b.x.min)} to ${fmt(b.x.max)}` : '',
        b.y ? `y ${fmt(b.y.min)} to ${fmt(b.y.max)}` : '',
        inside.length ? `mean (${fmt(mean('x'))}, ${fmt(mean('y'))})` : '',
      ]
        .filter(Boolean)
        .join('\n');
    };
    const brush = new L.Brush({ mode: S.mode, activate: 'always', live: S.live, onBrush: report });
    const zoom = new L.BoxZoom({ mode: 'xy', activate: 'always' });
    const pan = new L.PanZoom({ direction: 'both', pan: false });
    const dots = new L.CircleMarker({ size: 2.5, opacity: 0.6 });
    const series = new L.XYSeries({ x: 'x' }, source(), dots);
    const plane = new L.CartesianPlane({ frame: true }, x, y, series, pan);
    // The tool in use sits before PanZoom, which is how a press reaches it first.
    let tool = null;
    const use = (name) => {
      if (tool) plane.remove(tool);
      brush.clear?.();
      tool = name === 'brush' ? brush : name === 'zoom' ? zoom : null;
      if (tool) plane.insertBefore(tool, pan);
      pan.setAttribute('pan', name === 'pan');
      if (name !== 'brush') report(null);
    };
    use(S.tool);
    report(null);
    const chart = new L.Chart({ theme: chartTheme(), onFlush: ctx.onFlush }, plane);
    ctx.add(
      ui.note('The wheel always zooms. What a drag does is up to the tool.'),
      ui.seg({
        label: 'a drag…',
        options: [
          ['brush', 'selects'],
          ['zoom', 'zooms to a box'],
          ['pan', 'pans'],
        ],
        value: S.tool,
        onChange: (v) => {
          S.tool = v;
          use(v);
        },
      }),
      ui.seg({
        label: 'brush covers',
        options: [
          ['xy', 'a box'],
          ['x', 'a band in x'],
          ['y', 'a band in y'],
        ],
        value: S.mode,
        onChange: (v) => {
          S.mode = v;
          brush.setAttribute('mode', v);
          brush.clear?.();
        },
      }),
      ui.toggle({
        label: 'report while dragging',
        value: S.live,
        onChange: (v) => {
          S.live = v;
          brush.setAttribute('live', v);
        },
      }),
      read,
      ui.buttons(
        [
          'Select the middle',
          () => {
            if (S.tool === 'brush')
              brush.select([
                { axis: x, min: -1, max: 1 },
                { axis: y, min: -1, max: 1 },
              ]);
          },
        ],
        ['Clear', () => brush.clear?.()],
        ['Reset zoom', () => chart.resetViews()],
        [
          'New data',
          () => {
            S.seed++;
            rows = r0();
            series.setChild(0, source());
            report(null);
          },
        ],
      ),
      ui.note(
        'A brush is held in data terms, so it follows the axes as you zoom; a click clears it. brush.select(...) sets it from code, which is how two charts can follow one another. A box zoom sets the same view that panning does, so Reset zoom undoes either.',
      ),
    );
    return { chart };
  },
});

// ── Transitions ──────────────────────────────────────────────────────────────
// What the demo's controls say, kept between visits so that "Replay" can build the chart again with the same settings.
const transitionState = { shape: 'bars', on: true, enter: true, duration: 600, easing: 'ease-out', fixed: true, n: 8, seed: 1 };
demos.push({
  id: 'transitions',
  title: 'Transitions',
  blurb: 'Ease to new data with CSS transitions: off by default, data changes only, not for pan or zoom',
  setup(ctx) {
    const S = transitionState;
    const EASINGS = [
      ['ease-out', 'ease-out'],
      ['linear', 'linear'],
      ['ease-in-out', 'ease-in-out'],
      ['cubic-bezier(.34,1.56,.64,1)', 'overshoot'],
    ];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
    let data = new Float64Array(S.n);
    const fill = () => {
      const r = rng(S.seed);
      data = Float64Array.from({ length: S.n }, (_, i) => Math.round((3 + r() * 7 + Math.sin(i / 1.4) * 1.5) * 10) / 10);
    };
    fill();
    const band = new L.BandScale({ categories: months.slice(0, S.n) });
    const x = new L.Axis({ id: 'x', orientation: 'bottom' }, band);
    const y = new L.Axis({ id: 'y', orientation: 'left', min: 0, max: 14, nice: false, title: 'Level' }, new L.LinearScale());
    // A source belongs to one series, so each series gets a new one made from the current data.
    let source = null;
    const renderers = () =>
      S.shape === 'bars'
        ? [new L.BarPath({})]
        : S.shape === 'area'
          ? [new L.AreaPath({}, new L.LinearCurve())]
          : [new L.LinePath({ strokeWidth: 2 }, new L.LinearCurve()), new L.CircleMarker({ size: 5 })];
    const makeSeries = () => {
      source = new L.FlatDataSource({ data, regularDomain: { start: 0, step: 1 } });
      return new L.DomainSeries({ name: 'Level', domainAxis: 'x', valueAxis: 'y' }, source, ...renderers());
    };
    let series = makeSeries();
    const plane = new L.CartesianPlane(
      { frame: true },
      x,
      y,
      series,
      new L.BoxZoom({ axes: ['y'], mode: 'y' }),
      new L.PanZoom({ axes: ['y'], pan: false }),
    );
    const chart = new L.Chart(
      { theme: chartTheme(), onFlush: ctx.onFlush },
      plane,
      ...(S.enter ? [new L.Entrance({ duration: S.duration, easing: S.easing })] : []),
    );
    const read = ui.readout();
    const apply = () => {
      chart.setAttribute('transition', S.on ? { duration: S.duration, easing: S.easing } : undefined);
      y.setAttributes(S.fixed ? { min: 0, max: 14, nice: false } : { min: undefined, max: undefined, nice: true });
      read.textContent = S.on
        ? `transition: { duration: ${S.duration}, easing: '${S.easing}' }` + (S.enter ? ', plus an Entrance' : '')
        : 'transition: undefined (a data change is immediate)';
    };
    const reload = () => {
      band.setAttribute('categories', months.slice(0, S.n));
      source.setAttributes({ data, regularDomain: { start: 0, step: 1 } });
    };
    apply();
    ctx.add(
      ui.seg({
        label: 'shape',
        options: [
          ['bars', 'bars'],
          ['line', 'line'],
          ['area', 'area'],
        ],
        value: S.shape,
        onChange: (v) => {
          S.shape = v;
          plane.remove(series);
          series = makeSeries();
          plane.append(series);
        },
      }),
      ui.toggle({
        label: 'entrance (on the first draw)',
        value: S.enter,
        onChange: (v) => {
          S.enter = v;
          select('transitions');
        },
      }),
      ui.toggle({
        label: 'transition on',
        value: S.on,
        onChange: (v) => {
          S.on = v;
          apply();
        },
      }),
      ui.slider({
        label: 'duration (ms)',
        min: 50,
        max: 2000,
        step: 50,
        value: S.duration,
        onChange: (v) => {
          S.duration = v;
          apply();
        },
      }),
      ui.seg({
        label: 'easing',
        options: EASINGS,
        value: S.easing,
        onChange: (v) => {
          S.easing = v;
          apply();
        },
      }),
      ui.buttons(
        [
          'New values',
          () => {
            S.seed++;
            fill();
            reload();
          },
        ],
        [
          'Add a point',
          () => {
            if (S.n >= months.length) return;
            S.n++;
            fill();
            reload();
          },
        ],
        [
          'Remove a point',
          () => {
            if (S.n <= 3) return;
            S.n--;
            fill();
            reload();
          },
        ],
        ['Zoom the value axis', () => L.moveView(y, { min: 4, max: 10 })],
        ['Reset zoom', () => L.moveView(y, null)],
        ['Replay the entrance', () => select('transitions')],
      ),
      ui.toggle({
        label: 'fixed value axis (0 to 14)',
        value: S.fixed,
        onChange: (v) => {
          S.fixed = v;
          apply();
        },
      }),
      read,
      ui.note(
        'New values eases the shapes to where the data now is. Add a point and Remove a point change how many bars or points there are, so the shape cannot morph and snaps. A zoom that jumps on purpose (the button, shift-drag to box zoom, double-click to reset) eases over the same time; a wheel turn follows your hand and is never eased. With the value axis not fixed, new data rescales it: the ticks change at once while the shapes glide, which is why the axis is fixed by default here. Path morphing needs the CSS d property (Chrome and Firefox, not Safari), and prefers-reduced-motion switches it off. Colours and widths ease in every browser. The entrance (bars grow from their baseline, lines are drawn on) plays only when the chart is first drawn, so Replay builds the chart again.',
      ),
    );
    return { chart };
  },
});

// ── Right to left, and the bar chart shortcut ───────────────────────────────
const rtlState = { rtl: true, horizontal: false, stack: 'group', legend: true };
demos.push({
  id: 'rtl',
  title: 'Right to left',
  blurb: 'direction="rtl" mirrors the layout: the axes, the legend and the title; built with the barChart shortcut',
  setup(ctx) {
    const S = rtlState;
    const rows = (d) => new L.FlatDataSource({ data: d, regularDomain: { start: 0, step: 1 } });
    const chart = L.barChart(
      [
        { name: 'المبيعات', source: rows([4, 7, 5, 9]) },
        { name: 'المصروفات', source: rows([3, 4, 6, 2]) },
      ],
      {
        theme: chartTheme(),
        onFlush: ctx.onFlush,
        direction: S.rtl ? 'rtl' : 'ltr',
        categories: ['الربع الأول', 'الربع الثاني', 'الربع الثالث', 'الربع الرابع'],
        stack: S.stack,
        horizontal: S.horizontal,
        domainAxis: { title: 'الفترة' },
        valueAxis: { title: 'مليون ريال' },
        extras: [new L.ChartTitle({ text: 'المبيعات حسب الربع' }), ...(S.legend ? [new L.Legend({})] : [])],
      },
    );
    const again = () => select('rtl');
    ctx.add(
      ui.toggle({
        label: 'right to left (direction)',
        value: S.rtl,
        onChange: (v) => {
          S.rtl = v;
          chart.setAttribute('direction', v ? 'rtl' : 'ltr');
        },
      }),
      ui.toggle({
        label: 'horizontal bars',
        value: S.horizontal,
        onChange: (v) => {
          S.horizontal = v;
          again();
        },
      }),
      ui.seg({
        label: 'two series',
        options: [
          ['group', 'side by side'],
          ['stack', 'stacked'],
          ['normalize', '100%'],
        ],
        value: S.stack,
        onChange: (v) => {
          S.stack = v;
          again();
        },
      }),
      ui.note(
        'Everything placed by default mirrors: the first vertical axis, the legend, the title. The Arabic text itself is set right to left by the browser either way. What you place by hand (an axis orientation, a legend side) stays where you put it.',
      ),
    );
    return { chart };
  },
});

// ── Point annotations and the pie shortcut ───────────────────────────────────
demos.push({
  id: 'point-annotations',
  title: 'Point annotations',
  blurb: 'A note beside each point you pick: negative bars called out, labels on a pie',
  setup(ctx) {
    const S = {
      view: 'bars',
      shape: 'callout',
      placement: 'outside',
      contain: true,
      aria: 'hidden',
      limit: 0,
      hole: 0.5,
      start: 0,
      seed: 1,
    };
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const profit = () => {
      const r = rng(S.seed);
      return Float64Array.from({ length: 12 }, () => Math.round((r() * 22 - 8) * 10) / 10);
    };
    let values = profit();
    const share = new Intl.NumberFormat('en', { style: 'percent' });
    const SHARES = ['Mobile', 'Desktop', 'Tablet', 'Other'];
    // Shares that fall away the way real ones do, a little different for each seed.
    const shares = () => {
      const r = rng(S.seed);
      return SHARES.map((name, i) => ({ name, value: Math.round((60 / (1 + i * 1.6)) * (0.6 + r() * 0.8)) + 1 }));
    };
    let slices = shares();
    const PADDING = { bars: 16, pie: 60 };
    let source, notes;
    const barsPlane = () => {
      source = new L.FlatDataSource({ data: values, regularDomain: { start: 0, step: 1 } });
      notes = new L.PointAnnotations({
        anchor: 'bars',
        shape: S.shape,
        placement: S.placement,
        contain: S.contain,
        aria: S.aria,
        text: (hit, words) => (hit.second < S.limit ? `${words.second}\n${months[hit.first]}` : null),
      });
      return new L.CartesianPlane(
        { frame: true },
        new L.Axis({ orientation: 'bottom' }, new L.BandScale({ categories: months })),
        new L.Axis({ orientation: 'left', min: -18, max: 20, title: 'Profit' }, new L.LinearScale()),
        new L.DomainSeries({ name: 'Profit' }, source, new L.BarPath({ id: 'bars' })),
        notes,
      );
    };
    const piePlane = () => {
      // pieChart makes a whole chart; this demo swaps planes in one chart, so take the plane out of it.
      const made = L.pieChart(slices, {
        theme: chartTheme(),
        innerRadius: S.hole,
        startAngle: S.start,
        label: (slice, fraction) => `${slice.name} ${share.format(fraction)}`,
      });
      const plane = [...made][0];
      made.remove(plane);
      return plane;
    };
    let shown = barsPlane();
    const chart = new L.Chart({ theme: chartTheme(), padding: PADDING.bars, onFlush: ctx.onFlush }, shown);
    const read = ui.readout();
    const report = () => {
      read.textContent =
        S.view === 'bars'
          ? `notes drawn for ${values.filter((v) => v < S.limit).length} of 12 bars; omitted: ${notes.omitted}`
          : slices.map((s) => `${s.name} ${s.value}`).join('   ');
    };
    const show = () => {
      chart.remove(shown);
      shown = S.view === 'bars' ? barsPlane() : piePlane();
      chart.setAttribute('padding', PADDING[S.view]);
      chart.append(shown);
      report();
    };
    ctx.add(
      ui.seg({
        label: 'chart',
        options: [
          ['bars', 'bars'],
          ['pie', 'pieChart()'],
        ],
        value: S.view,
        onChange: (v) => {
          S.view = v;
          show();
        },
      }),
      ui.seg({
        label: 'shape',
        options: [
          ['callout', 'callout'],
          ['box', 'box'],
          ['text', 'text'],
        ],
        value: S.shape,
        onChange: (v) => {
          S.shape = v;
          notes?.setAttribute('shape', v);
        },
      }),
      ui.seg({
        label: 'placement',
        options: [
          ['outside', 'outside'],
          ['inside', 'inside'],
          ['auto', 'auto'],
        ],
        value: S.placement,
        onChange: (v) => {
          S.placement = v;
          notes?.setAttribute('placement', v);
        },
      }),
      ui.slider({
        label: 'a note on bars below',
        min: -8,
        max: 14,
        value: S.limit,
        onChange: (v) => {
          S.limit = v;
          notes?.invalidate();
          report();
        },
      }),
      ui.toggle({
        label: 'keep notes in the plot',
        value: S.contain,
        onChange: (v) => {
          S.contain = v;
          notes?.setAttribute('contain', v);
        },
      }),
      ui.seg({
        label: 'aria',
        options: [
          ['hidden', 'hidden'],
          ['text', 'text'],
        ],
        value: S.aria,
        onChange: (v) => {
          S.aria = v;
          notes?.setAttribute('aria', v);
        },
      }),
      ui.slider({
        label: 'doughnut hole',
        min: 0,
        max: 0.8,
        step: 0.1,
        value: S.hole,
        onChange: (v) => {
          S.hole = v;
          if (S.view === 'pie') show();
        },
      }),
      ui.slider({
        label: 'first slice starts at (turns)',
        min: 0,
        max: 1,
        step: 0.05,
        value: S.start / (2 * Math.PI),
        onChange: (v) => {
          S.start = v * 2 * Math.PI;
          if (S.view === 'pie') show();
        },
      }),
      ui.buttons([
        'New values',
        () => {
          S.seed++;
          values = profit();
          slices = shares();
          if (S.view === 'bars') source.setAttributes({ data: values, regularDomain: { start: 0, step: 1 } });
          else show();
          report();
        },
      ]),
      read,
      ui.note(
        'PointAnnotations is for tens of points: each note is real nodes and measured text. The text function gets the point and its two coordinates already written by the axes, and returns null for a point that gets no note. The pie is the pie() shortcut, which builds a polar plane, a normalized stack and one PointAnnotations per slice from the same pieces.',
      ),
    );
    report();
    return { chart };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Navigation, theme
// ─────────────────────────────────────────────────────────────────────────────

function select(id) {
  const demo = demos.find((d) => d.id === id) ?? demos[0];
  location.hash = demo.id;
  $('demos')
    .querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === demo.id)));
  $('blurb').replaceChildren(h('b', {}, demo.title), demo.blurb);
  mount(demo);
}
$('demos').replaceChildren(
  ...demos.map((d) => h('button', { type: 'button', 'data-id': d.id, title: d.blurb, onclick: () => select(d.id) }, d.title)),
);
$('accessible').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.accessible = String(root.dataset.accessible !== 'true');
  $('accessible').setAttribute('aria-pressed', root.dataset.accessible);
  current?.chart.setAttribute('theme', chartTheme());
  // The font arrives after the first draw; text was measured in the fallback, so draw again when it is in.
  if (root.dataset.accessible === 'true')
    document.fonts?.load('14px OpenDyslexic').then(
      () => current?.chart.invalidate(),
      () => {},
    );
  for (const fn of themeHooks) fn();
});
$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  current?.chart.setAttribute('theme', chartTheme());
  for (const fn of themeHooks) fn();
});
if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
renderTabs();
select(location.hash.slice(1));
window.inkplot = L; // for poking at from the console
/** For the page test: the live chart written as JSON and read back into a second chart on the same size of box. */
async function roundTrip() {
  const json = L.toJSON(current.chart, pageRegistry(), { refs: current.refs, inlineLimit: JSON_LIMIT });
  const wire = JSON.parse(JSON.stringify(json));
  const box = h('div', { style: `position:absolute;left:-9999px;top:0;width:${host.clientWidth}px;height:${host.clientHeight}px` });
  document.body.append(box);
  const platform = new L.DOMPlatform(box);
  const chart = L.fromJSON(wire, pageRegistry(), { refs: current.refs, inlineLimit: JSON_LIMIT });
  chart.attach(platform);
  chart.flush();
  // Stages that run elsewhere (a worker) answer later: both charts are drawn once they have.
  await Promise.all([chart.idle(), current.chart.idle()]);
  const norm = (n) => n.outerHTML.replace(/clip\d+/g, 'clip').replace(/grad\d+/g, 'grad');
  const result = {
    live: norm(host.querySelector('svg')),
    copy: norm(box.querySelector('svg')),
    json: JSON.stringify(json).length,
    refs: current.refs.names.length,
  };
  chart.detach();
  platform.dispose();
  box.remove();
  return result;
}

window.playground = {
  get current() {
    return current;
  },
  select,
  demos,
  roundTrip,
};

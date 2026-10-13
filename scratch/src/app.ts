/**
 * The page the `--html` output opens: every figure of a module, live, with the usual controls. Bundled with the
 * module itself (see cli.ts), so one file holds the app, the charts and their data.
 */
import { DOMPlatform, svgToPng } from 'inkplot';
import { hintFor, makeInteractive } from './interact.ts';
import { type Facts, type Figure, checkText, factsOf, figuresOf, svgOf } from './figures.ts';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) => {
  const { class: cls, ...rest } = props;
  const el = Object.assign(document.createElement(tag), rest);
  if (cls) el.className = cls;
  el.append(...kids);
  return el;
};

/** An element the page template is known to have. */
const byId = (id: string): HTMLElement => document.getElementById(id) ?? (() => { throw new Error(`the page has no #${id}`); })();

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export function mount(module: Record<string, unknown>, title: string, options: { interactive?: boolean } = {}): void {
  document.title = title;
  const root = byId('figures'), note = byId('note');
  byId('title').textContent = title;
  let toastTimer = 0;
  const say = (text: string) => {
    note.textContent = text;
    note.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => note.classList.remove('on'), 2500);
  };

  let figures: Figure[];
  try { figures = figuresOf(module); } catch (e) { root.append(h('pre', { class: 'error' }, e instanceof Error ? e.message : String(e))); return; }

  const svgs = new Map<string, string>(), pngs = new Map<string, Promise<Blob>>(), allFacts: Facts[] = [];
  /** The figure's exported SVG, written when its section is built, before anything can ask for it. */
  const svgText = (f: Figure) => svgs.get(f.id) ?? '';
  const png = (f: Figure, scale = 2) => {
    const key = `${f.id}@${scale}`;
    let made = pngs.get(key);
    if (!made) pngs.set(key, made = svgToPng(svgText(f), { scale, background: '#ffffff' }));
    return made;
  };
  // The clipboard wants a user gesture and, for images, a secure page; a file:// page often has neither, so every copy falls back to a download and says so.
  const copy = async (what: 'SVG' | 'PNG', f: Figure) => {
    try {
      if (what === 'SVG') await navigator.clipboard.writeText(svgText(f));
      else await navigator.clipboard.write([new ClipboardItem({ 'image/png': png(f) })]);
      say(`Copied ${f.title} as ${what}`);
    } catch {
      if (what === 'SVG') download(new Blob([svgText(f)], { type: 'image/svg+xml' }), `${f.id}.svg`);
      else download(await png(f), `${f.id}.png`);
      say(`The browser blocked the clipboard, so ${f.title} was downloaded as ${what} instead`);
    }
  };

  for (const f of figures) {
    // The export is rendered before the chart goes on the page, at the chart's own size: what is copied is the chart as written, not as zoomed.
    svgs.set(f.id, svgOf(f));
    const facts = factsOf(f);
    allFacts.push(facts);
    // After the export render above, so the file and the copy never carry them.
    let added: string[] = [];
    if (options.interactive !== false && f.interactive) try { added = makeInteractive(f.chart); } catch { added = []; }
    const host = h('div', { class: 'plot' });
    // A chart that sets its own size is drawn at exactly that size, so its box is that size (a bigger box would leave blank margin);
    // one that does not fills the page up to the default width.
    host.style.aspectRatio = `${facts.width} / ${facts.height}`;
    if (f.chart.attrs.width !== undefined || f.chart.attrs.height !== undefined) host.style.width = `${facts.width}px`;
    host.style.maxWidth = `${f.chart.attrs.width !== undefined ? facts.width : Math.max(facts.width, 640)}px`;
    const stats = h('pre', { class: 'stats' }, checkText(facts).split('\n').slice(1).join('\n').replace(/^ {2}/gm, ''));
    stats.hidden = true;
    const button = (label: string, run: () => unknown, hint: string) => h('button', { type: 'button', textContent: label, title: hint, onclick: () => void run() });
    const section = h('section', { class: 'figure', id: f.id },
      h('header', {}, h('h2', {}, f.title), h('div', { class: 'buttons' },
        button('Copy SVG', () => copy('SVG', f), 'Copy the chart as SVG markup'),
        button('Copy PNG', () => copy('PNG', f), 'Copy the chart as a 2x PNG image'),
        button('SVG ↓', () => download(new Blob([svgText(f)], { type: 'image/svg+xml' }), `${f.id}.svg`), 'Download as an SVG file'),
        button('PNG ↓', async () => download(await png(f), `${f.id}.png`), 'Download as a 2x PNG file'),
        ...(added.length ? [button('Reset view', () => f.chart.resetViews(), 'Back to the whole chart')] : []),
        button('Stats', () => { stats.hidden = !stats.hidden; }, 'Show what the chart holds: series, point counts, axis ranges'))),
      ...(f.caption ? [h('p', { class: 'caption' }, f.caption)] : []),
      ...(hintFor(added) ? [h('p', { class: 'hint' }, hintFor(added))] : []), host, stats,
      ...facts.problems.map((p) => h('p', { class: 'warning' }, `⚠ ${p}`)));
    section.dataset.interactive = added.join(' ');
    root.append(section);
    try { f.chart.attach(new DOMPlatform(host)); } catch (e) { host.replaceWith(h('pre', { class: 'error' }, `This chart could not be drawn live: ${e instanceof Error ? e.message : String(e)}\nThe copy and download buttons still work.`)); }
  }
  byId('all-svg').onclick = () => figures.forEach((f, i) => setTimeout(() => download(new Blob([svgText(f)], { type: 'image/svg+xml' }), `${f.id}.svg`), i * 150));
  byId('all-png').onclick = () => figures.forEach((f, i) => setTimeout(async () => download(await png(f), `${f.id}.png`), i * 150));
}

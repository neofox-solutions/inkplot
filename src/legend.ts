/**
 * The legend: what each series is called, with a sample of how it is drawn, beside the plots.
 *
 *   new Chart({}, plane, new Legend({ side: 'right' }))
 *
 * It lists the series of every plane in the chart that have a `name`, in drawing order. The sample is the series' own
 * (`Series.sample`): a line is a short line in its dash and colour, an area or a bar a box, a marker its shape, and a series
 * with a line and markers has the markers over the line, so it reads as the plot does.
 *
 * Clicking an entry hides its series, or shows it again (`toggle`, on by default): a series that is not shown is left out of
 * the plot's axes, its stack and its hits, and its entry is dimmed, so it can be brought back.
 *
 * Each entry is a button for the keyboard too: Tab reaches it, Enter or Space presses it, and a ring shows where focus is.
 * A press with the pointer takes effect when it is released over the same entry, so one can be abandoned by moving away.
 *
 * A legend is a chart child like a key, and takes a strip along a side of the chart; entries that do not fit along a top
 * or bottom legend wrap onto another row. It looks as `legend`, `legendLabel` and `legendTitle` say, which fall back to `text`.
 */
/* oxlint-disable typescript/no-non-null-assertion -- entries, widths and items are parallel arrays indexed together in one loop */
import { type AttrTypesFor, STRING } from './attrs.ts';
import type { Container } from './container.ts';
import { type BaseAttributes, ChartElement } from './element.ts';
import { hideFromAssistive, writeAria } from './aria.ts';
import { InteractiveElement, inputOf } from './input.ts';
import {
  type ChartEvent,
  EVENT_ARRANGE,
  EVENT_ATTACH,
  EVENT_FOCUS,
  EVENT_KEY,
  EVENT_MEASURE,
  EVENT_PAINT,
  EVENT_POINTER,
} from './events.ts';
import { drawFocusRing, makeTabStop, pressesButton } from './focus.ts';
import { type Rect, type Side, f2 } from './geometry.ts';
import { type SampleCache, type Series, paintSample } from './series.ts';
import type { PlatformNode } from './platform.ts';
import { LINE_HEIGHT, applyText, measureBlock } from './text.ts';

export interface LegendAttributes extends BaseAttributes {
  /** The edge of the chart it sits along. Default 'right' ('left' in a chart that reads right to left). */
  side?: Side;
  /** Entries in a column or a row. Default: along its side, so a column on the left and right, a row on the top and bottom. */
  orientation?: 'vertical' | 'horizontal';
  /** A heading above the entries. */
  title?: string;
  /** Clicking an entry hides or shows its series. Default true. */
  toggle?: boolean;
}

/** Width of a sample, and the gap between it and the name. */
const SAMPLE_WIDTH = 24;
const SAMPLE_GAP = 6;
/** Space between entries along a row, and between rows. */
const ENTRY_GAP = 14;
const ROW_GAP = 4;
const TITLE_BLOCK = 18;
/** How faded an entry is when its series is hidden. */
const DIMMED = 0.4;

interface Item {
  series: Series;
  name: string;
  x: number;
  y: number;
  width: number;
}

export class Legend extends InteractiveElement<Container, [], LegendAttributes> {
  static override attrTypes = { ...ChartElement.attrTypes, title: STRING } satisfies AttrTypesFor<LegendAttributes>;
  #rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  #items: Item[] = [];
  #rowHeight = 0;
  #drawn = 0;
  /** The entry the pointer went down on, and the entry holding keyboard focus (only while a ring is wanted). */
  #pressed: Series | null = null;
  #focusNode: PlatformNode | null = null;
  #ring = false;
  #nodes: PlatformNode[] = [];
  readonly #samples: SampleCache = new Map();

  get side(): Side {
    return this.attrs.side ?? (this.chart?.rtl ? 'left' : 'right');
  }
  get horizontal(): boolean {
    return (this.attrs.orientation ?? (this.side === 'top' || this.side === 'bottom' ? 'horizontal' : 'vertical')) === 'horizontal';
  }
  /** The series listed: those of all the chart's planes that have a name. */
  get entries(): readonly Series[] {
    const out: Series[] = [];
    for (const p of this.requireParent().planes) for (const s of p.allSeries) if (s.attrs.name) out.push(s);
    return out;
  }

  override onEvent(ev: ChartEvent): void {
    switch (ev.type) {
      case EVENT_ATTACH:
        this.surface.wrapper();
        inputOf(this.requireChart()).watchInput(this);
        break;
      case EVENT_MEASURE: {
        const size = this.#layout(ev.available.width);
        if (size) ev.request = { min: size, max: size, side: this.side };
        break;
      }
      case EVENT_ARRANGE:
        this.#rect = ev.rect;
        break;
      case EVENT_PAINT:
        this.#paint();
        break;
      case EVENT_POINTER: {
        if (this.attrs.toggle === false) break;
        const item = this.#at(ev.x - this.#rect.x, ev.y - this.#rect.y);
        if (ev.kind === 'down' && ev.buttons & 1 && item) {
          this.#pressed = item.series;
          ev.handled = true;
        } else if (ev.kind === 'up' && this.#pressed) {
          const press = this.#pressed;
          this.#pressed = null;
          if (item?.series === press) this.#toggle(press);
          ev.handled = true;
        }
        break;
      }
      case EVENT_KEY: {
        const i = this.#nodes.indexOf(ev.node),
          item = this.#items[i];
        if (item && pressesButton(ev)) this.#toggle(item.series);
        break;
      }
      case EVENT_FOCUS:
        if (ev.focused) {
          this.#focusNode = ev.node;
          this.#ring = ev.visible;
        } else if (this.#focusNode === ev.node) {
          this.#focusNode = null;
          this.#ring = false;
        }
        this.invalidate();
        break;
    }
  }

  #toggle(series: Series): void {
    series.setAttribute('visible', !series.shown);
  }

  /** Where a series' entry is, in the chart's pixels (valid after layout), or null if it is not listed. */
  entryRect(series: Series): Rect | null {
    const item = this.#items.find((i) => i.series === series);
    return item ? { x: this.#rect.x + item.x, y: this.#rect.y + item.y, width: item.width, height: this.#rowHeight } : null;
  }

  /** The entry at a point in the legend's own pixels. */
  #at(x: number, y: number): Item | undefined {
    const pad = ENTRY_GAP / 2;
    return this.#items.find(
      (i) => x >= i.x - 2 && x <= i.x + i.width + pad && y >= i.y - ROW_GAP / 2 && y <= i.y + this.#rowHeight + ROW_GAP / 2,
    );
  }

  #label() {
    return this.styleFor(['legendLabel', 'legend', 'text']);
  }

  /** Place every entry, given how wide the chart is, and say how big the legend is; null when there is nothing to list. */
  #layout(available: number): { width: number; height: number } | null {
    const entries = this.entries,
      chart = this.requireChart();
    this.#items = [];
    if (entries.length === 0) return null;
    const label = this.#label(),
      measure = chart.measureText;
    const top = this.attrs.title ? TITLE_BLOCK : 0;
    const rowHeight = (this.#rowHeight = Math.ceil(label.size * LINE_HEIGHT) + 2);
    const widths = entries.map((s) => SAMPLE_WIDTH + SAMPLE_GAP + measureBlock(measure, s.attrs.name ?? '', label).width);
    const titleWidth = this.attrs.title
      ? measureBlock(measure, this.attrs.title, this.styleFor(['legendTitle', 'legend', 'text'])).width
      : 0;
    let width = titleWidth,
      y = top,
      x = 0,
      rows = 1;
    entries.forEach((series, i) => {
      if (this.horizontal) {
        if (x > 0 && x + widths[i]! > available) {
          x = 0;
          y += rowHeight + ROW_GAP;
          rows++;
        }
        this.#items.push({ series, name: series.attrs.name ?? '', x, y, width: widths[i]! });
        x += widths[i]! + ENTRY_GAP;
        width = Math.max(width, x - ENTRY_GAP);
      } else {
        this.#items.push({ series, name: series.attrs.name ?? '', x: 0, y: top + i * (rowHeight + ROW_GAP), width: widths[i]! });
        width = Math.max(width, widths[i]!);
      }
    });
    const count = this.horizontal ? rows : entries.length;
    return { width: Math.ceil(width), height: top + count * rowHeight + (count - 1) * ROW_GAP };
  }

  #paint(): void {
    const s = this.surface,
      root = s.wrapper(),
      items = this.#items,
      label = this.#label(),
      toggle = this.attrs.toggle !== false;
    s.set(root, 'transform', `translate(${f2(this.#rect.x)} ${f2(this.#rect.y)})`);
    applyText(s, root, label, 'start');
    writeAria(s, root, this.attrs.meta, { role: 'group', ...(this.attrs.title && { label: this.attrs.title }) });
    const title = this.attrs.title;
    if (title) {
      const t = s.node('title', 'text');
      applyText(s, t, this.styleFor(['legendTitle', 'legend', 'text']), 'start');
      s.set(t, 'y', label.size);
      s.text(t, title);
    } else {
      s.remove('title');
    }
    const h = this.#rowHeight,
      sampleH = Math.max(6, h - 6);
    items.forEach((item, i) => {
      const shown = item.series.shown,
        opacity = shown ? 1 : DIMMED;
      const sample = paintSample(s, `s${i}`, item.series, item.x, item.y + (h - sampleH) / 2, SAMPLE_WIDTH, sampleH, this.#samples);
      s.set(sample, 'opacity', opacity);
      hideFromAssistive(s, sample);
      const t = s.node(`t${i}`, 'text');
      s.set(t, 'x', item.x + SAMPLE_WIDTH + SAMPLE_GAP);
      s.set(t, 'y', f2(item.y + h / 2 + label.size * 0.35));
      s.set(t, 'opacity', opacity);
      hideFromAssistive(s, t); // the entry's own node carries the name
      s.text(t, item.name);
      // An invisible box over the entry is what the pointer is over, and what a screen reader finds.
      const hit = s.node(`h${i}`, 'rect');
      s.set(hit, 'x', item.x);
      s.set(hit, 'y', item.y);
      s.set(hit, 'width', item.width);
      s.set(hit, 'height', h);
      s.set(hit, 'fill', '#000');
      s.set(hit, 'fill-opacity', 0);
      s.set(hit, 'stroke', 'none');
      s.set(hit, 'cursor', toggle ? 'pointer' : 'default');
      s.set(hit, 'role', toggle ? 'button' : 'img');
      s.set(hit, 'aria-label', item.name);
      if (toggle) {
        s.set(hit, 'aria-pressed', String(shown));
        makeTabStop(s, hit);
        inputOf(this.requireChart()).focusable(this, hit);
      }
      this.#nodes[i] = hit;
    });
    this.#nodes.length = items.length;
    const focused = this.#ring && this.#focusNode ? this.#nodes.indexOf(this.#focusNode) : -1;
    drawFocusRing(
      s,
      'focus',
      this.styleFor(['focusRing', 'line']),
      focused >= 0 ? { x: items[focused]!.x, y: items[focused]!.y, width: items[focused]!.width, height: h } : null,
    );
    for (let i = items.length; i < this.#drawn; i++) {
      s.removePrefix(`s${i}`);
      this.#samples.delete(`s${i}`);
      s.remove(`t${i}`);
      s.remove(`h${i}`);
    }
    this.#drawn = items.length;
  }
}

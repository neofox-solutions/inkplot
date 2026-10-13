/** Test support only (not exported from the package). */
import { type PlatformNode, type RawFocus, type RawKey, type RawPointer, type Size, StringPlatform, type Unsubscribe } from './index.ts';

/** A StringPlatform that can be resized and poked, and that flushes on demand through `runScheduled`. */
export class FakePlatform extends StringPlatform {
  resize: ((size: Size) => void) | null = null;
  pointer: ((p: RawPointer) => boolean | void) | null = null;
  keyHandler: ((k: RawKey, node: PlatformNode) => boolean | void) | null = null;
  focusHandler: ((f: RawFocus) => void) | null = null;
  focused: PlatformNode | null = null;
  announced: string[] = [];
  announce(text: string): void { this.announced.push(text); }
  pending: (() => void) | null = null;
  current: Size;
  unsubscribed = 0;
  cursor = '';
  setCursor(cursor: string): void { this.cursor = cursor; }
  constructor(size: Size) { super(size); this.current = size; }
  override size(): Size { return this.current; }
  schedule = (cb: () => void): Unsubscribe => { this.pending = cb; return () => { this.pending = null; }; };
  onResize = (cb: (size: Size) => void): Unsubscribe => { this.resize = cb; return () => { this.resize = null; this.unsubscribed++; }; };
  onPointer = (cb: (p: RawPointer) => boolean | void): Unsubscribe => { this.pointer = cb; return () => { this.pointer = null; this.unsubscribed++; }; };
  onKey = (cb: (k: RawKey, node: PlatformNode) => boolean | void): Unsubscribe => { this.keyHandler = cb; return () => { this.keyHandler = null; this.unsubscribed++; }; };
  onFocus = (cb: (f: RawFocus) => void): Unsubscribe => { this.focusHandler = cb; return () => { this.focusHandler = null; this.unsubscribed++; }; };
  /** Like the browser: moves focus, telling the old node and the new one. A keyboard-driven focus shows its ring. */
  focus(node: PlatformNode, visible = true): void {
    if (this.focused === node) return;
    if (this.focused) this.focusHandler?.({ node: this.focused, focused: false, visible: false });
    this.focused = node;
    this.focusHandler?.({ node, focused: true, visible });
  }
  blur(): void {
    if (!this.focused) return;
    const node = this.focused;
    this.focused = null;
    this.focusHandler?.({ node, focused: false, visible: false });
  }
  /** Press (and release, unless `hold`) a key on the focused node; returns whether the chart used the key down. */
  key(key: string, mods: Partial<Pick<RawKey, 'shift' | 'ctrl' | 'alt' | 'repeat'>> = {}, release = true): boolean {
    if (!this.focused) return false;
    const base = { key, shift: false, ctrl: false, alt: false, repeat: false, ...mods };
    const used = !!this.keyHandler?.({ kind: 'down', ...base }, this.focused);
    if (release) this.keyHandler?.({ kind: 'up', ...base, repeat: false }, this.focused);
    return used;
  }
  runScheduled() { const cb = this.pending; this.pending = null; cb?.(); }
}

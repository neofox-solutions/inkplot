/** Rectangles, sizes and extents: the plain-data vocabulary shared by layout, hit-testing and drawing. */

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Insets { top: number; right: number; bottom: number; left: number }
export interface Extent { min: number; max: number }
/** Half-open on the far edges, so two touching rectangles never both claim the same point. */
export const contains = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
export type Side = 'top' | 'right' | 'bottom' | 'left';
/** What an element answers when asked how much room it wants (the MEASURE event): a range, so the parent can squeeze or grow it. */
export interface LayoutRequest {
  min: Size;
  max: Size;
  /** For chart furniture: the edge of the chart it wants to sit against, taking its size from the plots. Others leave it out. */
  side?: Side;
  /**
   * With `side`: spans the whole edge and stacks outwards from it with other bands (a title, a caption), instead of
   * sharing a strip with the other furniture on that side (keys). Only the top and bottom edges take bands.
   */
  band?: boolean;
}

/** A circle as path data (SVG has no circle path command, so two half arcs), centred on (cx, cy). */
export const circlePath = (cx: number, cy: number, r: number) =>
  `M${f2(cx - r)} ${f2(cy)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0`;

/** A number for path data and attributes: two decimals at most. */
export const f2 = (n: number) => String(Math.round(n * 100) / 100);

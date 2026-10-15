/**
 * An element that lays out a body (planes) and the furniture round it (titles, captions, keys): the chart, and each item of a
 * chart group. The furniture is measured first and takes strips at the edges it names; the body gets what is left.
 */
import { type AnyElement, type BaseAttributes, ChartElement } from './element.ts';
import { Plane } from './plane.ts';
import { type LayoutRequest, type Rect, type Side } from './geometry.ts';

/** Space between the plots and the furniture at their edges. */
const FURNITURE_GAP = 8;
/** Space between stacked bands, such as a title and its subtitle. */
const BAND_GAP = 2;

/** An element that arranges itself into the body area of a container (a plane, a chart group): what the furniture leaves. */
export const isBody = (child: AnyElement): boolean => child instanceof Plane || ('isBody' in child && child.isBody === true);

export abstract class Container<
  Parent extends AnyElement | null = AnyElement | null,
  Children extends AnyElement[] = AnyElement[],
  A extends BaseAttributes = BaseAttributes,
> extends ChartElement<Parent, Children, A> {
  /** Every plane inside, in tree order, those in chart groups (and in their items that are shown) included. */
  get planes(): readonly Plane[] {
    const out: Plane[] = [];
    for (const c of this) {
      if (c instanceof Plane) out.push(c);
      else if ('planes' in c && Array.isArray(c.planes)) for (const p of c.planes) if (p instanceof Plane) out.push(p);
    }
    return out;
  }

  /**
   * Measure the children that are not the body (`isBody`: planes and groups), give them their edges of `content`, call `arrangeBody` with the
   * rectangle that is left, then arrange the furniture, now that the body has settled.
   */
  protected layOutFurniture(content: Rect, arrangeBody: (area: Rect) => void): void {
    // Everything that is not the body (planes) and asks for a side takes room along that edge, sized by what it asked for, and the
    // planes get what is left. Bands (titles, captions) span the edge and stack outwards from it, and come first; the
    // rest (keys) take a strip inside the bands, where several on one side stack along it.
    const furniture: { child: AnyElement; request: LayoutRequest; side: Side }[] = [];
    const bands: { child: AnyElement; request: LayoutRequest; side: Side }[] = [];
    const bandSize: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 };
    const strip: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const child of this) {
      if (isBody(child) || child.attrs.visible === false) continue;
      const request = this.measureChild(child, { width: content.width, height: content.height });
      const side = request.side;
      if (!side) continue;
      if (request.band) {
        bands.push({ child, request, side });
        bandSize[side] += request.min.height + (bandSize[side] ? BAND_GAP : 0);
        continue;
      }
      furniture.push({ child, request, side });
      const across = side === 'left' || side === 'right' ? request.min.width : request.min.height;
      strip[side] = Math.max(strip[side], across);
    }
    // What the bands leave. Everything below is laid out inside it.
    const bandGap = (side: Side) => (bandSize[side] ? FURNITURE_GAP : 0);
    const inner: Rect = {
      x: content.x,
      y: content.y + bandSize.top + bandGap('top'),
      width: content.width,
      height: Math.max(1, content.height - bandSize.top - bandSize.bottom - bandGap('top') - bandGap('bottom')),
    };
    const gap = (side: Side) => (strip[side] ? FURNITURE_GAP : 0);
    const plotArea: Rect = {
      x: inner.x + strip.left + gap('left'),
      y: inner.y + strip.top + gap('top'),
      width: Math.max(1, inner.width - strip.left - strip.right - gap('left') - gap('right')),
      height: Math.max(1, inner.height - strip.top - strip.bottom - gap('top') - gap('bottom')),
    };
    const edge: Record<'top' | 'bottom', number> = { top: content.y, bottom: content.y + content.height };
    for (const { child, request, side } of bands) {
      const height = request.min.height;
      if (side === 'top') {
        this.arrangeChild(child, { x: content.x, y: edge.top, width: content.width, height });
        edge.top += height + BAND_GAP;
      } else {
        edge.bottom -= height;
        this.arrangeChild(child, { x: content.x, y: edge.bottom, width: content.width, height });
        edge.bottom -= BAND_GAP;
      }
    }
    arrangeBody(plotArea);
    const along: Record<Side, number> = { top: inner.x, bottom: inner.x, left: inner.y, right: inner.y };
    for (const { child, request, side } of furniture) {
      const { width, height } = request.min;
      const vertical = side === 'left' || side === 'right';
      const rect: Rect = vertical
        ? { x: side === 'left' ? inner.x : inner.x + inner.width - strip.right, y: along[side], width: strip[side], height }
        : { x: along[side], y: side === 'top' ? inner.y : inner.y + inner.height - strip.bottom, width, height: strip[side] };
      this.arrangeChild(child, rect);
      along[side] += (vertical ? height : width) + FURNITURE_GAP;
    }
  }
}

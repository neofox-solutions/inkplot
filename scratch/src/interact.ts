/**
 * The standard interactive elements, added to a chart that is about to go on the page: pan and zoom, drag-a-box zoom, a
 * crosshair and a tooltip. It adds only what the chart does not already have, so a module that sets these up itself is left alone.
 * It runs after the chart has been rendered for export, so no SVG file, PNG or fact ever includes them.
 */
import { type AnyElement, BoxZoom, CartesianPlane, type Chart, ChartTooltip, Crosshair, Cursor, PanZoom, Plane } from 'inkplot';

/** What was added, by name: for the page's hint line and for tests. */
export function makeInteractive(chart: Chart): string[] {
  const added = new Set<string>();
  const children = (parent: AnyElement): AnyElement[] => [...parent];
  const planes = children(chart).filter((c): c is Plane => c instanceof Plane);
  for (const plane of planes) {
    const kids = children(plane);
    if (plane instanceof CartesianPlane && !kids.some((k) => k instanceof BoxZoom)) {
      // A box takes a press, so it goes before whatever else does (PanZoom, a Brush, a PointerListener).
      const first = kids.find((k) => k.claimsPress) ?? null;
      if (first) first.before(new BoxZoom());
      else plane.append(new BoxZoom());
      added.add('boxzoom');
    }
    if (!kids.some((k) => k instanceof PanZoom)) {
      plane.append(new PanZoom());
      added.add('panzoom');
    }
  }
  if (planes.length > 0 && !children(chart).some((c) => c instanceof Cursor)) {
    chart.append(new Cursor({}, new Crosshair(), new ChartTooltip()));
    added.add('cursor');
  }
  return [...added];
}

/** The hint under a figure's title for what is now on it. */
export function hintFor(added: readonly string[]): string {
  const parts: string[] = [];
  if (added.includes('panzoom')) parts.push('drag to pan', 'scroll to zoom', 'double-click to reset');
  if (added.includes('boxzoom')) parts.push('Shift-drag for a zoom box');
  return parts.length ? parts.join(' · ') : '';
}

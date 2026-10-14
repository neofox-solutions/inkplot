/**
 * Accessibility attributes from an element's `meta`.
 *
 * The core carries no words of its own: whatever a screen reader says comes from `meta` (a `title` is the accessible name,
 * a `description` the longer description) or from an opt-in component such as `ChartSummary`, which is where the
 * language-specific text lives. This module only turns `meta` into attributes on a node.
 */
import type { Meta } from './element.ts';
import type { PlatformNode } from './platform.ts';
import type { Surface } from './surface.ts';

/** What an element supplies when its `meta` says nothing: a role that fits what it is, and a name it knows. */
export interface AriaDefaults {
  role?: string;
  label?: string;
  description?: string;
}

/**
 * Write the node's role, name, description and any other ARIA attributes. `meta.aria` wins over everything: its keys are
 * attribute names (the `aria-` prefix is optional) and its values are written as they are.
 * A role is only written when there is something to name: an unnamed `group` is noise to a screen reader.
 */
export function writeAria(surface: Surface, node: PlatformNode, meta: Meta | undefined, defaults: AriaDefaults = {}): void {
  const extra = meta?.aria;
  const label = extra?.['aria-label'] ?? extra?.['label'] ?? meta?.title ?? defaults.label;
  const description = meta?.description ?? defaults.description;
  const role = meta?.role ?? defaults.role;
  if (role !== undefined && (label !== undefined || description !== undefined || meta?.role !== undefined)) surface.set(node, 'role', role);
  if (label !== undefined) surface.set(node, 'aria-label', String(label));
  if (description !== undefined) surface.set(node, 'aria-description', description);
  if (extra) {
    for (const key in extra) {
      if (key === 'label') continue;
      const name = key.startsWith('aria-') ? key : `aria-${key}`;
      if (name === 'aria-label') continue;
      surface.set(node, name, String(extra[key]));
    }
  }
}

/** Keep a decorative node (gridlines, tick labels, a swatch) out of the accessibility tree. */
export function hideFromAssistive(surface: Surface, node: PlatformNode): void {
  surface.set(node, 'aria-hidden', 'true');
}

/**
 * Grouping by look: what renderers that vary a style by data (markers, heat map cells) share.
 *
 * Each stylistic binding is quantized into a few steps, a shape's look is the combination of its steps (its `key`), and
 * every shape with the same key joins one path. The number of paths is then bounded by `maxNodes`, not by the data.
 */
import { type ElementRef, fail, resolveRef } from './element.ts';
import type { MappedDimension } from './mapped.ts';
import type { ResolvedBinding } from './renderer.ts';

/** The bound properties of `attrs.bind` with their dimensions resolved from `from`. */
export function resolveBindings(
  bind: unknown,
  from: Parameters<typeof resolveRef>[1],
  isGeometric: (property: string) => boolean,
): ResolvedBinding[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the `bind` attribute, typed here as the shape this element reads
  const map = bind as Record<string, { axis: ElementRef<MappedDimension<unknown>>; channel: string } | undefined> | undefined;
  if (!map) return [];
  const out: ResolvedBinding[] = [];
  for (const property in map) {
    const b = map[property];
    if (b) out.push({ property, channel: b.channel, axis: resolveRef(b.axis, from), stylistic: !isGeometric(property) });
  }
  return out;
}

/** How many steps each of the stylistic bindings is quantized to so that the combinations stay within `maxNodes`; 0 for none. */
export function stepsFor(bindings: readonly ResolvedBinding[], maxNodes: number): number {
  const k = bindings.reduce((n, b) => n + (b.stylistic ? 1 : 0), 0);
  if (k === 0) return 0;
  // The last step of each binding is kept for data with no value, so a binding colours with one fewer.
  const steps = Math.floor(maxNodes ** (1 / k) + 1e-9);
  if (steps < 2) fail(`maxNodes ${maxNodes} leaves fewer than 2 steps for ${k} bound styles`);
  return steps;
}

/** A binding's channel as a column of 0..1 positions along its dimension. `column` is where the channel sits in each row. */
export function fractionsOf(b: ResolvedBinding, data: ArrayLike<number>, column: number, stride: number, count: number): Float64Array {
  const f = new Float64Array(count);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
  for (let i = 0, j = column; i < count; i++, j += stride) f[i] = data[j]!;
  b.axis.normalize(f, count, 1, 0);
  return f;
}

/** Which look a shape has: one step along each bound style, the last step meaning "no value". */
export function lookKey(styled: readonly { f: Float64Array }[], i: number, steps: number): number {
  let key = 0,
    mult = 1;
  for (const { f } of styled) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
    const p = f[i]!;
    key += (p >= -1e-9 && p <= 1 + 1e-9 ? Math.min(steps - 2, Math.floor((p < 0 ? 0 : p) * (steps - 1))) : steps - 1) * mult;
    mult *= steps;
  }
  return key;
}

/** Undo `lookKey`: the value each bound style has for that key (the middle of its step), handed to `write` by property. */
export function lookValues(
  key: number,
  styled: readonly { b: ResolvedBinding }[],
  steps: number,
  write: (property: string, value: string | number) => void,
): void {
  let rest = key;
  for (const { b } of styled) {
    const step = rest % steps;
    rest = (rest - step) / steps;
    // oxlint-disable-next-line typescript/consistent-type-assertions -- an axis hands back `string | number` for a property the attribute types vouch for
    write(b.property, (step === steps - 1 ? b.axis.missing : b.axis.valueAt((step + 0.5) / (steps - 1))) as string | number);
  }
}

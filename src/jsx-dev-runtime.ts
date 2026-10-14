// The development JSX runtime: the same as jsx-runtime, with the position of the tag added to an error it raises, so that
// "a child must be a chart element" says where in your file the stray child is. Bundlers pick this one for development builds.
import type { AnyElement } from './element.ts';
import { type JsxType, jsx } from './jsx-runtime.ts';

export { Fragment, type JSX, type JsxType, jsxs } from './jsx-runtime.ts';

export interface JsxSource {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export function jsxDEV(type: JsxType, props: Record<string, unknown>, key?: unknown, _isStatic?: boolean, source?: JsxSource): AnyElement {
  try {
    return jsx(type, props, key);
  } catch (error) {
    if (error instanceof Error && source?.fileName && !error.message.includes(source.fileName)) {
      error.message += ` (${source.fileName}:${source.lineNumber}:${source.columnNumber})`;
    }
    throw error;
  }
}
